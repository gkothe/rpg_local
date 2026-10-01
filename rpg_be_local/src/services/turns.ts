import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { Store, ownerId } from '../store.js';
import { Problem, conflict } from '../errors.js';
import type { Campaign, Turn, ProviderSettings, Memory } from '../domain/types.js';
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
export class TurnService {
  private aborts = new Map<string, AbortController>();
  constructor(
    readonly store: Store,
    readonly generator: Generator
  ) {}
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
      return prior.rows[0].document as Turn;
    }
    const initialCampaign = await this.store.campaign(campaignId);
    const capacity = await this.generator.capacity(
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
        return existing.rows[0].document as Turn;
      }
      if (c.revision !== input.revision)
        throw conflict('Campaign changed; refresh before submitting');
      await this.store.assertIdle(campaignId, client);
      const settings = input.settings ?? c.settings;
      const t: Turn = {
        id: randomUUID(),
        campaignId,
        requestId: input.requestId,
        status: 'pending',
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
        context = buildContext(c, history, t.action, rules, capacity);
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
        "INSERT INTO turns(id,campaign_id,request_id,payload_hash,status,document,owner,lease_until) VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '45 seconds')",
        [t.id, c.id, t.requestId, hash, t.status, t, ownerId]
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
    const owner = await client.query('SELECT owner FROM turns WHERE id=$1', [t.id]);
    if (owner.rows[0]?.owner !== ownerId || !['pending', 'running'].includes(turn.status))
      throw new Problem(409, 'cancelled', 'Turn is no longer active');
    if (campaign.revision !== t.context!.revision)
      throw conflict('Campaign was edited during generation; output was discarded');
    return { campaign, turn };
  }
  private async run(t: Turn): Promise<void> {
    const ctl = new AbortController();
    this.aborts.set(t.id, ctl);
    const heartbeat = setInterval(() => {
      void this.store.pool
        .query(
          "UPDATE turns SET lease_until=now()+interval '45 seconds' WHERE id=$1 AND owner=$2 AND status IN ('pending','running')",
          [t.id, ownerId]
        )
        .catch(() => ctl.abort());
    }, 10000);
    try {
      await this.store.transaction(async (client) => {
        const { turn } = await this.lockedOwned(t, client);
        turn.status = 'running';
        await this.store.saveTurn(turn, client);
      });
      let c = await this.store.campaign(t.campaignId);
      let history = await this.store.activeTurns(c.id);
      const capacity = await this.generator.capacity(t.settings, c.budgets.gameplay);
      let needs =
        uncoveredHistoryTokens(c, history) > 6000 ||
        !t.context?.prompt ||
        t.context.estimatedTokens > capacity * 0.8;
      // Each bounded batch covers a consecutive prefix; never recursively summarizes the full transcript.
      while (needs && uncovered(c, history).length > 1) {
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
        needs = uncoveredHistoryTokens(c, history) > 6000;
      }
      // A failure to compact never removes uncovered history. Rebuild must fit or fail explicitly.
      await this.store.transaction(async (client) => {
        const { campaign, turn } = await this.lockedOwned(t, client);
        const h = await this.store.activeTurns(campaign.id, client);
        const rules = await this.store.retrieve(campaign, t.action, client);
        turn.context = buildContext(campaign, h, t.action, rules, capacity);
        t.context = turn.context;
        await this.store.saveTurn(turn, client);
      });
      const response = responseSchema.parse(
        await this.generator.generate(t.settings, t.context!.prompt, responseJsonSchema, ctl.signal)
      );
      await this.store.transaction(async (client) => {
        const { campaign, turn } = await this.lockedOwned(t, client);
        const applied = applyResponse(campaign, response, t.id);
        applied.campaign.revision++;
        turn.narrative = response.narrative;
        turn.changes = applied.changes;
        turn.status = 'completed';
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
          if (!['pending', 'running'].includes(turn.status)) return;
          turn.status = ctl.signal.aborted ? 'cancelled' : 'failed';
          turn.error =
            e instanceof Problem
              ? e.message
              : 'Invalid local AI response or unavailable local service; no game-state changes were applied';
          await this.store.saveTurn(turn, client);
        })
        .catch(() => {});
    } finally {
      clearInterval(heartbeat);
      this.aborts.delete(t.id);
    }
  }
  async cancel(campaignId: string, id: string): Promise<Turn> {
    const turn = await this.store.transaction(async (client) => {
      await this.store.campaign(campaignId, client, true);
      const t = await this.store.turn(campaignId, id, client, true);
      if (['pending', 'running'].includes(t.status)) {
        t.status = 'cancelled';
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
