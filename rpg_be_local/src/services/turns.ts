import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { Store, ownerId } from '../store.js';
import { Problem, conflict } from '../errors.js';
import type { Campaign, Turn, ProviderSettings, Memory, GMResponse } from '../domain/types.js';
import type { Generator } from '../providers/service.js';
import {
  buildContext,
  compactionBatch,
  estimateTokens,
  uncovered,
  uncoveredHistoryTokens,
} from '../domain/context.js';
import {
  responseSchema,
  responseJsonSchema,
  memoryJsonSchema,
  memorySchema,
} from '../domain/schemas.js';
import { applyResponse, undoSnapshot } from '../domain/state.js';
import { TurnStatus } from '../domain/options.js';
import { DiceService, gameplayDigest } from './dice.js';
import {
  diceResponseSchema,
  validateRollInterpretations,
  type DiceResponse,
} from '../domain/diceResponse.js';
import { GM_RESPONSE_SCHEMA_VERSION } from '../domain/versions.js';
import { DICE_LIMITS } from '../domain/dice.js';
const TURN_LEASE_SECONDS = 45;
const TURN_HEARTBEAT_INTERVAL_MS = 10_000;
const AUTO_COMPACTION_HISTORY_THRESHOLD_TOKENS = 6_000;
const CONTEXT_REBUILD_THRESHOLD = 0.8;
export class TurnService {
  private aborts = new Map<string, AbortController>();
  constructor(
    readonly store: Store,
    readonly generator: Generator
  ) {}
  private gameplayCapacity(settings: ProviderSettings, ceiling: number): Promise<number> {
    return (
      this.generator.gameplayCapacity?.(settings, ceiling) ??
      this.generator.capacity(settings, ceiling)
    );
  }
  async submit(
    campaignId: string,
    input: { revision: number; requestId: string; action: string; settings?: ProviderSettings }
  ): Promise<Turn> {
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    // Resolve local CLI capabilities outside the write transaction. Existing IDs replay even
    // when the provider has subsequently become unavailable.
    const prior = await this.store.pool.query(
      'SELECT payload_hash,document FROM turns WHERE campaign_id=$1 AND request_id=$2',
      [campaignId, input.requestId]
    );
    if (prior.rows[0]) {
      if (prior.rows[0].payload_hash !== hash)
        throw conflict('Request ID was already used with different input; generate a new ID');
      return this.store.turn(campaignId, prior.rows[0].document.id);
    }
    const initialCampaign = await this.store.campaign(campaignId);
    const capacity = await this.gameplayCapacity(
      input.settings ?? initialCampaign.settings,
      initialCampaign.budgets.gameplay
    );
    let launch = false;
    const turn = await this.store.transaction(async (client) => {
      const c = await this.store.campaign(campaignId, client, true);
      const existing = await client.query(
        'SELECT payload_hash,document FROM turns WHERE campaign_id=$1 AND request_id=$2',
        [campaignId, input.requestId]
      );
      if (existing.rows[0]) {
        if (existing.rows[0].payload_hash !== hash)
          throw conflict('Request ID was already used with different input; generate a new ID');
        return this.store.turn(campaignId, existing.rows[0].document.id, client);
      }
      if (c.revision !== input.revision)
        throw conflict('Campaign changed; refresh before submitting');
      await this.store.assertIdle(campaignId, client);
      const settings = input.settings ?? c.settings;
      const t: Turn = {
        id: randomUUID(),
        campaignId,
        requestId: input.requestId,
        status: TurnStatus.Pending,
        action: input.action,
        narrative: null,
        changes: [],
        error: null,
        undone: false,
        settings: structuredClone(settings),
        context: null,
        createdAt: new Date().toISOString(),
        completedAt: null,
      };
      const history = await this.store.activeTurns(c.id, client);
      const rules = await this.store.retrieve(c, t.action, client);
      let context = null;
      try {
        context = buildContext(
          c,
          history,
          t.action,
          rules,
          capacity,
          !!this.generator.generateGameplay
        );
      } catch (e) {
        if (!(e instanceof Problem && e.code === 'context_overflow')) throw e;
      }
      // Capture the complete immutable input; compaction may replace it only at the same revision.
      t.context = context ?? {
        revision: c.revision,
        prompt: '',
        estimatedTokens: 0,
        estimator: 'pending bounded compaction',
        sourceVersions: [],
        historyIds: history.map((x) => x.id),
        memoryId: c.memory?.id ?? null,
      };
      await client.query(
        "INSERT INTO turns(id,campaign_id,request_id,payload_hash,status,document,owner,lease_until) VALUES($1,$2,$3,$4,$5,$6,$7,now()+($8 * interval '1 second'))",
        [t.id, c.id, t.requestId, hash, t.status, t, ownerId, TURN_LEASE_SECONDS]
      );
      launch = true;
      return t;
    });
    if (launch)
      queueMicrotask(() => {
        void this.run(turn).catch(() => {});
      });
    return turn;
  }
  private async lockedOwned(
    t: Turn,
    client: PoolClient
  ): Promise<{ campaign: Campaign; turn: Turn }> {
    const campaign = await this.store.campaign(t.campaignId, client, true);
    const turn = await this.store.turn(t.campaignId, t.id, client, true);
    const owner = await client.query('SELECT owner,lease_until FROM turns WHERE id=$1', [t.id]);
    if (
      owner.rows[0]?.owner !== ownerId ||
      new Date(owner.rows[0]?.lease_until).getTime() <= Date.now() ||
      ![TurnStatus.Pending, TurnStatus.Running].includes(turn.status as TurnStatus)
    )
      throw new Problem(409, 'cancelled', 'Turn is no longer active');
    if (campaign.revision !== t.context!.revision)
      throw conflict('Campaign was edited during generation; output was discarded');
    return { campaign, turn };
  }
  async retry(
    campaignId: string,
    turnId: string,
    input: { revision: number; requestId: string; settings?: ProviderSettings }
  ): Promise<Turn> {
    const hash = createHash('sha256')
      .update(JSON.stringify({ retryOf: turnId, ...input }))
      .digest('hex');
    const prior = await this.store.pool.query(
      'SELECT payload_hash,document FROM turns WHERE campaign_id=$1 AND request_id=$2',
      [campaignId, input.requestId]
    );
    if (prior.rows[0]) {
      if (prior.rows[0].payload_hash !== hash)
        throw conflict('Request ID was reused with different retry input');
      return this.store.turn(campaignId, prior.rows[0].document.id);
    }
    const initial = await this.store.campaign(campaignId);
    const capacity = await this.gameplayCapacity(
      input.settings ?? initial.settings,
      initial.budgets.gameplay
    );
    let launch = false;
    const next = await this.store.transaction(async (client) => {
      const campaign = await this.store.campaign(campaignId, client, true);
      const duplicate = await client.query(
        'SELECT payload_hash,document FROM turns WHERE campaign_id=$1 AND request_id=$2',
        [campaignId, input.requestId]
      );
      if (duplicate.rows[0]) {
        if (duplicate.rows[0].payload_hash !== hash)
          throw conflict('Request ID was reused with different retry input');
        return duplicate.rows[0].document as Turn;
      }
      if (campaign.revision !== input.revision)
        throw conflict('Campaign changed; refresh before retrying');
      await this.store.assertIdle(campaignId, client);
      const previous = await this.store.turn(campaignId, turnId, client, true);
      if (
        ![TurnStatus.Failed, TurnStatus.Cancelled, TurnStatus.Interrupted].includes(
          previous.status as TurnStatus
        ) ||
        !previous.diceSessionId ||
        !previous.context
      )
        throw conflict('Only an unfinished local dice turn can be retried');
      const latest = await client.query(
        'SELECT id FROM turns WHERE campaign_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',
        [campaignId]
      );
      if (latest.rows[0]?.id !== previous.id)
        throw conflict('A later action superseded this attempt; start a new action');
      const session = await client.query(
        'SELECT * FROM dice_sessions WHERE id=$1 AND campaign_id=$2 FOR UPDATE',
        [previous.diceSessionId, campaignId]
      );
      const saved = session.rows[0];
      if (
        !saved ||
        saved.imported ||
        saved.context_digest !==
          gameplayDigest(campaign, await this.store.activeTurns(campaignId, client))
      )
        throw conflict(
          'Game context changed or this archive session is non-executable; start a new action'
        );
      if (estimateTokens(saved.frozen_prompt) > capacity)
        throw new Problem(
          422,
          'context_overflow',
          'The selected CLI cannot fit the frozen retry context'
        );
      const turn: Turn = {
        ...previous,
        id: randomUUID(),
        requestId: input.requestId,
        status: TurnStatus.Pending,
        narrative: null,
        changes: [],
        error: null,
        rolls: [],
        rollInterpretations: [],
        undone: false,
        settings: structuredClone(input.settings ?? campaign.settings),
        retryOfTurnId: previous.id,
        context: { ...previous.context, prompt: saved.frozen_prompt, revision: campaign.revision },
        createdAt: new Date().toISOString(),
        completedAt: null,
      };
      delete turn.diceRetry;
      await client.query(
        "INSERT INTO turns(id,campaign_id,request_id,payload_hash,status,document,owner,lease_until) VALUES($1,$2,$3,$4,$5,$6,$7,now()+($8 * interval '1 second'))",
        [turn.id, campaignId, turn.requestId, hash, turn.status, turn, ownerId, TURN_LEASE_SECONDS]
      );
      await client.query(
        'INSERT INTO dice_attempts(turn_id,campaign_id,session_id) VALUES($1,$2,$3)',
        [turn.id, campaignId, turn.diceSessionId]
      );
      launch = true;
      return turn;
    });
    if (launch)
      queueMicrotask(() => {
        void this.run(next).catch(() => {});
      });
    return next;
  }
  private async run(t: Turn): Promise<void> {
    const ctl = new AbortController();
    let timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      ctl.abort();
    }, DICE_LIMITS.attemptMs);
    this.aborts.set(t.id, ctl);
    const heartbeat = setInterval(() => {
      void this.store.pool
        .query(
          "UPDATE turns SET lease_until=now()+($4 * interval '1 second') WHERE id=$1 AND owner=$2 AND status IN ($3,$5)",
          [t.id, ownerId, TurnStatus.Pending, TURN_LEASE_SECONDS, TurnStatus.Running]
        )
        .catch(() => ctl.abort());
    }, TURN_HEARTBEAT_INTERVAL_MS);
    try {
      await this.store.transaction(async (client) => {
        const { turn } = await this.lockedOwned(t, client);
        turn.status = TurnStatus.Running;
        await this.store.saveTurn(turn, client);
      });
      let c = await this.store.campaign(t.campaignId);
      let history = await this.store.activeTurns(c.id);
      const capacity = await this.gameplayCapacity(t.settings, c.budgets.gameplay);
      let needs =
        uncoveredHistoryTokens(c, history) > AUTO_COMPACTION_HISTORY_THRESHOLD_TOKENS ||
        !t.context?.prompt ||
        t.context.estimatedTokens > capacity * CONTEXT_REBUILD_THRESHOLD;
      // Each bounded batch covers a consecutive prefix; never recursively summarizes the full transcript.
      while (!t.retryOfTurnId && needs && uncovered(c, history).length > 1) {
        const compactionCapacity = await this.generator.capacity(t.settings, c.budgets.compaction);
        const batch = compactionBatch(
          c,
          history,
          Math.min(c.budgets.compaction, compactionCapacity)
        );
        if (!batch.turns.length) break;
        const parsed = memorySchema.parse(
          await this.generator.generate(t.settings, batch.prompt, memoryJsonSchema, ctl.signal)
        );
        if (estimateTokens(parsed.text) > c.budgets.memory)
          throw new Problem(
            422,
            'memory_overflow',
            'Summary exceeds memory budget; review a manual checkpoint'
          );
        const memory: Memory = {
          id: randomUUID(),
          text: parsed.text,
          coveredTurnIds: [
            ...(c.memory?.valid ? c.memory.coveredTurnIds : []),
            ...batch.turns.map((x) => x.id),
          ],
          valid: true,
          createdAt: new Date().toISOString(),
        };
        await this.store.transaction(async (client) => {
          const { campaign } = await this.lockedOwned(t, client);
          await this.store.memory(campaign, memory, client);
          await this.store.save(campaign, client);
        });
        c = await this.store.campaign(c.id);
        history = await this.store.activeTurns(c.id);
        needs = uncoveredHistoryTokens(c, history) > AUTO_COMPACTION_HISTORY_THRESHOLD_TOKENS;
      }
      // A failure to compact never removes uncovered history. Rebuild must fit or fail explicitly.
      if (!t.retryOfTurnId)
        await this.store.transaction(async (client) => {
          const { campaign, turn } = await this.lockedOwned(t, client);
          const h = await this.store.activeTurns(campaign.id, client);
          const rules = await this.store.retrieve(campaign, t.action, client);
          turn.context = buildContext(
            campaign,
            h,
            t.action,
            rules,
            capacity,
            !!this.generator.generateGameplay
          );
          t.context = turn.context;
          await this.store.saveTurn(turn, client);
        });
      const dice = new DiceService(this.store);
      let diceResponse: DiceResponse | undefined;
      let response: GMResponse;
      if (this.generator.generateGameplay) {
        if (!t.diceSessionId) {
          c = await this.store.campaign(t.campaignId);
          history = await this.store.activeTurns(c.id);
          const characters = JSON.parse(t.context!.prompt).mandatory.characters as { id: string }[];
          t.diceSessionId = await dice.createSession(
            t,
            gameplayDigest(c, history),
            characters.map((character) => character.id)
          );
        }
        const existing = await dice.records(t.diceSessionId);
        const specifications = existing.map(
          ({
            id: _id,
            sessionId: _sessionId,
            campaignId: _campaignId,
            createdAt: _createdAt,
            groups,
            ...input
          }) => ({
            ...input,
            groups: groups.map((group) => ({
              label: group.label,
              sides: group.sides,
              count: group.faces.length,
            })),
          })
        );
        const prompt =
          t.context!.prompt +
          (specifications.length
            ? '\nReplay the original requests in order with exactly these specifications before appending any dice: ' +
              JSON.stringify(specifications)
            : '');
        diceResponse = diceResponseSchema.parse(
          await this.generator.generateGameplay(
            t.settings,
            prompt,
            (input) => dice.roll(t.diceSessionId!, t, input),
            ctl.signal
          )
        );
        response = {
          version: GM_RESPONSE_SCHEMA_VERSION,
          narrative: diceResponse.narrative,
          operations: diceResponse.operations,
        };
      } else {
        response = responseSchema.parse(
          await this.generator.generate(
            t.settings,
            t.context!.prompt,
            responseJsonSchema,
            ctl.signal
          )
        );
      }
      await this.store.transaction(async (client) => {
        const { campaign, turn } = await this.lockedOwned(t, client);
        if (diceResponse && t.diceSessionId) {
          const records = await dice.records(t.diceSessionId, client);
          const attempt = await client.query(
            'SELECT next_slot FROM dice_attempts WHERE turn_id=$1',
            [t.id]
          );
          if (attempt.rows[0]?.next_slot !== records.length)
            throw new Problem(
              409,
              'dice_replay',
              'Replay every original roll before completing the retry'
            );
          validateRollInterpretations(
            diceResponse,
            records.map((record) => record.id)
          );
          turn.rollInterpretations = diceResponse.rollInterpretations;
          turn.rolls = records;
        }
        const applied = applyResponse(campaign, response, t.id);
        applied.campaign.revision++;
        turn.narrative = response.narrative;
        turn.changes = applied.changes;
        turn.status = TurnStatus.Completed;
        turn.completedAt = new Date().toISOString();
        await client.query('INSERT INTO snapshots(turn_id,campaign_id,document) VALUES($1,$2,$3)', [
          t.id,
          campaign.id,
          applied.snapshot,
        ]);
        await this.store.save(applied.campaign, client);
        await this.store.saveTurn(turn, client);
      });
    } catch (e) {
      await this.store
        .transaction(async (client) => {
          await this.store.campaign(t.campaignId, client, true);
          const turn = await this.store.turn(t.campaignId, t.id, client, true);
          if (![TurnStatus.Pending, TurnStatus.Running].includes(turn.status as TurnStatus)) return;
          turn.status = ctl.signal.aborted && !timedOut ? TurnStatus.Cancelled : TurnStatus.Failed;
          turn.completedAt = new Date().toISOString();
          turn.error = timedOut
            ? 'The GM attempt exceeded its time limit; retry keeps its recorded dice'
            : e instanceof Problem
              ? e.message
              : 'Invalid local AI response or unavailable local service; no game-state changes were applied';
          await this.store.saveTurn(turn, client);
        })
        .catch(() => {});
    } finally {
      clearTimeout(deadline);
      clearInterval(heartbeat);
      this.aborts.delete(t.id);
    }
  }
  async cancel(campaignId: string, id: string): Promise<Turn> {
    const turn = await this.store.transaction(async (client) => {
      await this.store.campaign(campaignId, client, true);
      const t = await this.store.turn(campaignId, id, client, true);
      if ([TurnStatus.Pending, TurnStatus.Running].includes(t.status as TurnStatus)) {
        t.status = TurnStatus.Cancelled;
        t.completedAt = new Date().toISOString();
        t.error = 'Cancelled by player';
        await this.store.saveTurn(t, client);
      }
      return t;
    });
    this.aborts.get(id)?.abort();
    return turn;
  }
  async undo(campaignId: string, revision: number): Promise<Campaign> {
    return this.store.transaction(async (client) => {
      const c = await this.store.campaign(campaignId, client, true);
      if (c.revision !== revision) throw conflict('Campaign changed; refresh before undo');
      await this.store.assertIdle(c.id, client);
      const turns = await this.store.activeTurns(c.id, client);
      const last = turns.at(-1);
      if (!last) throw conflict('No completed active turn to undo');
      const restored = undoSnapshot(c, await this.store.snapshot(last.id, client));
      last.undone = true;
      await this.store.saveTurn(last, client);
      const rows = await client.query(
        'SELECT id,document FROM memories WHERE campaign_id=$1 ORDER BY created_at DESC',
        [c.id]
      );
      let chosen: Memory | null = null;
      for (const row of rows.rows) {
        const m = row.document as Memory;
        if (m.coveredTurnIds.includes(last.id)) {
          m.valid = false;
          await client.query('UPDATE memories SET document=$2 WHERE id=$1', [m.id, m]);
        }
        if (
          !chosen &&
          m.valid &&
          m.coveredTurnIds.every((id) => turns.some((t) => t.id === id && !t.undone))
        )
          chosen = m;
      }
      restored.memory = chosen;
      restored.revision++;
      await this.store.save(restored, client);
      return restored;
    });
  }
  async manualMemory(
    id: string,
    input: { revision: number; text: string; coveredTurnIds: string[]; confirm: true }
  ): Promise<Campaign> {
    return this.store.edit(id, input.revision, async (c, client) => {
      await this.store.assertIdle(c.id, client);
      if (estimateTokens(input.text) > c.budgets.memory)
        throw new Problem(422, 'memory_overflow', 'Memory text exceeds configured budget');
      const turns = await this.store.activeTurns(c.id, client);
      const exact = turns.slice(0, input.coveredTurnIds.length).map((t) => t.id);
      if (
        !input.coveredTurnIds.length ||
        JSON.stringify(exact) !== JSON.stringify(input.coveredTurnIds)
      )
        throw new Problem(
          422,
          'memory_coverage',
          'Reviewed coverage must be an exact consecutive prefix of active completed turns'
        );
      await this.store.memory(
        c,
        {
          id: randomUUID(),
          text: input.text,
          coveredTurnIds: exact,
          valid: true,
          createdAt: new Date().toISOString(),
        },
        client
      );
    });
  }
}
