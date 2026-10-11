import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import { Store } from '../store.js';
import { Problem, conflict } from '../errors.js';
import type { Generator } from '../providers/service.js';
import type { Character, ProviderSettings } from '../domain/types.js';
import {
  npcSheetCompletionRequestSchema,
  npcSheetCompletionDecisionSchema,
  NpcSheetCompletionStatus as Status,
  NpcSheetCompletionAction as Action,
  NPC_SHEET_COMPLETION_LEASE_SECONDS,
  NPC_SHEET_COMPLETION_HEARTBEAT_MS,
} from '../domain/npcSheetCompletion.js';
import { RuleStore, ruleContext } from './ruleStore.js';
import type { RuleContext } from '../domain/rules.js';
import {
  deriveNpcSheetRequirements,
  executeNpcSheetLookup,
  type NpcSheetCheckpoint,
} from './npcSheetRules.js';
import { generateNpcSheet } from './npcSheetGeneration.js';
import { bindNpcSheetEvidence, type NpcSheetRead } from '../domain/npcSheetEvidence.js';
import {
  npcSheetMetadataSchema,
  validateNpcSheetResult,
  type NpcSheetResult,
  type NpcSheetRequirements,
} from '../domain/npcSheet.js';
import { npcArgumentDigest } from './npcPreparation.js';
import {
  createPromptTrace,
  traceEvent,
  safeTraceFailure,
  type PromptTraceContext,
} from '../providers/promptLog.js';

type Frozen = {
  character: Character;
  rules: RuleContext;
  settings: ProviderSettings;
  context: unknown;
  categoryHint?: string;
};
type Row = {
  id: string;
  campaign_id: string;
  character_id: string;
  status: Status;
  owner: string | null;
  lease_until: Date;
  frozen_input: Frozen;
  checkpoint: NpcSheetCheckpoint | null;
  result: { requirements: NpcSheetRequirements; result: NpcSheetResult } | null;
  safe_error: string | null;
};
export type SheetCompletionView = {
  id: string;
  status: string;
  active: boolean;
  canStart: boolean;
  actions: { id: string; label: string; decision: boolean }[];
  error: string | null;
  basis: string | null;
  systemName: string | null;
  conflicts: string[];
  additions: { path: string[]; value: unknown }[];
};
const sheet = (c: Character) => ({ attributes: c.attributes, inventory: c.inventory });
function additions(
  before: unknown,
  after: unknown,
  path: string[] = []
): SheetCompletionView['additions'] {
  const result: SheetCompletionView['additions'] = [];
  if (after && typeof after === 'object' && !Array.isArray(after)) {
    for (const [k, v] of Object.entries(after)) {
      if (!before || typeof before !== 'object' || !Object.hasOwn(before, k))
        result.push({ path: [...path, k], value: v });
      else result.push(...additions((before as Record<string, unknown>)[k], v, [...path, k]));
    }
  }
  return result;
}
export class NpcSheetCompletionService {
  private controllers = new Map<string, AbortController>();
  constructor(
    readonly store: Store,
    readonly generator: Generator
  ) {}
  private async row(
    campaignId: string,
    characterId: string,
    id: string,
    client?: PoolClient,
    lock = false
  ): Promise<Row> {
    const r = await (client ?? this.store.pool).query(
      `SELECT * FROM npc_sheet_completions WHERE id=$1 AND campaign_id=$2 AND character_id=$3${lock ? ' FOR UPDATE' : ''}`,
      [id, campaignId, characterId]
    );
    if (!r.rows[0]) throw new Problem(404, 'npc_sheet_not_found', 'NPC sheet completion not found');
    return r.rows[0] as Row;
  }
  private view(r: Row): SheetCompletionView {
    const actions =
      r.status === Status.Running
        ? [Action.Cancel]
        : r.status === Status.Ready
          ? [...(r.result?.result.conflicts.length ? [] : [Action.Apply]), Action.Discard]
          : [Status.Failed, Status.Interrupted, Status.Cancelled].includes(r.status)
            ? [Action.Retry, Action.Discard]
            : [];
    return {
      id: r.id,
      status: r.status,
      active: r.status === Status.Running,
      canStart: [Status.Applied, Status.Discarded].includes(r.status),
      actions: actions.map((id) => ({
        id,
        label: id[0]!.toUpperCase() + id.slice(1),
        decision: id === Action.Apply || id === Action.Discard,
      })),
      error: r.safe_error,
      basis: r.result?.requirements.basis ?? null,
      systemName: r.result?.requirements.systemName ?? null,
      conflicts: r.result?.result.conflicts ?? [],
      additions: r.result
        ? additions(sheet(r.frozen_input.character), {
            attributes: r.result.result.attributes,
            inventory: r.result.result.inventory,
          })
        : [],
    };
  }
  async get(
    campaignId: string,
    characterId: string,
    id?: string
  ): Promise<SheetCompletionView | null> {
    if (id) return this.view(await this.row(campaignId, characterId, id));
    const campaign = await this.store.campaign(campaignId);
    if (!campaign.characters.some((c) => c.id === characterId && c.type === 'npc'))
      throw new Problem(404, 'npc_not_found', 'NPC is not in this campaign');
    const r = await this.store.pool.query(
      'SELECT * FROM npc_sheet_completions WHERE campaign_id=$1 AND character_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1',
      [campaignId, characterId]
    );
    return r.rows[0] ? this.view(r.rows[0]) : null;
  }
  async start(campaignId: string, characterId: string, raw: unknown): Promise<SheetCompletionView> {
    const input = npcSheetCompletionRequestSchema.parse(raw);
    const result = await this.store.transaction(async (client) => {
      const c = await this.store.campaign(campaignId, client, true);
      const old = await client.query(
        'SELECT * FROM npc_sheet_completions WHERE campaign_id=$1 AND request_id=$2',
        [campaignId, input.requestId]
      );
      const digest = npcArgumentDigest({ characterId, ...input });
      if (old.rows[0]) {
        if (old.rows[0].argument_digest !== digest)
          throw conflict('Sheet request identity reused with different arguments');
        return { row: old.rows[0] as Row, launch: false };
      }
      await this.store.assertIdle(campaignId, client);
      const character = c.characters.find((ch) => ch.id === characterId && ch.type === 'npc');
      if (!character) throw new Problem(404, 'npc_not_found', 'NPC is not in this campaign');
      const rules = await new RuleStore(this.store).resolve(c, client);
      const id = randomUUID();
      const frozen: Frozen = {
        character,
        rules: ruleContext(rules),
        settings: c.settings,
        categoryHint: input.categoryHint,
        context: {
          campaign: { description: c.description, instructions: c.instructions, state: c.state },
          character: { ...character, notes: '' },
          categoryHint: input.categoryHint,
          knowledge: (c.knowledge ?? []).filter((k) => k.characterIds.includes(characterId)),
        },
      };
      const r = await client.query(
        'INSERT INTO npc_sheet_completions(id,campaign_id,character_id,request_id,argument_digest,status,owner,lease_until,frozen_input) VALUES($1,$2,$3,$4,$5,$6,$7,now()+make_interval(secs=>$8),$9) RETURNING *',
        [
          id,
          campaignId,
          characterId,
          input.requestId,
          digest,
          Status.Running,
          randomUUID(),
          NPC_SHEET_COMPLETION_LEASE_SECONDS,
          frozen,
        ]
      );
      return { row: r.rows[0] as Row, launch: true };
    });
    if (result.launch) this.launch(result.row);
    return this.view(result.row);
  }
  private async alive(row: Row, client?: PoolClient): Promise<void> {
    const current = await this.row(row.campaign_id, row.character_id, row.id, client);
    if (
      current.status !== Status.Running ||
      current.owner !== row.owner ||
      new Date(current.lease_until).getTime() <= Date.now()
    )
      throw conflict('Sheet completion no longer owns this request');
    const c = await this.store.campaign(row.campaign_id, client);
    const char = c.characters.find((ch) => ch.id === row.character_id);
    if (
      !char ||
      !isDeepStrictEqual(
        { ...row.frozen_input.character, revision: 0, notes: '' },
        { ...char, revision: 0, notes: '' }
      )
    )
      throw conflict('NPC fields changed; discard this draft and start again');
    const rules = await new RuleStore(this.store).resolve(c, client);
    if (
      rules.systemId !== row.frozen_input.rules.systemId ||
      rules.contentHash !== row.frozen_input.rules.contentHash
    )
      throw conflict('Selected rules changed; discard this draft and start again');
  }
  private async reads(row: Row): Promise<NpcSheetRead[]> {
    const r = await this.store.pool.query(
      'SELECT * FROM npc_sheet_reads WHERE job_id=$1 AND campaign_id=$2 AND character_id=$3 ORDER BY created_at,id',
      [row.id, row.campaign_id, row.character_id]
    );
    return r.rows.map((read) => ({
      id: read.id,
      campaignId: read.campaign_id,
      characterId: read.character_id,
      ownerId: read.job_id,
      tool: read.tool,
      context: read.context,
      payload: read.payload,
    }));
  }
  private launch(row: Row): void {
    const ctl = new AbortController();
    this.controllers.set(row.id, ctl);
    void this.run(row, ctl)
      .catch((error) => {
        console.error('NPC sheet persistence failed', safeTraceFailure(error));
      })
      .finally(() => {
        if (this.controllers.get(row.id) === ctl) this.controllers.delete(row.id);
      });
  }
  private async run(row: Row, ctl: AbortController): Promise<void> {
    let trace: PromptTraceContext | undefined;
    const heartbeat = setInterval(() => {
      void this.store.pool
        .query(
          'UPDATE npc_sheet_completions SET lease_until=now()+make_interval(secs=>$3) WHERE id=$1 AND owner=$2 AND status=$4 AND lease_until>now()',
          [row.id, row.owner, NPC_SHEET_COMPLETION_LEASE_SECONDS, Status.Running]
        )
        .then(
          (r) => {
            if (!r.rowCount) ctl.abort();
          },
          () => ctl.abort()
        );
    }, NPC_SHEET_COMPLETION_HEARTBEAT_MS);
    heartbeat.unref();
    try {
      trace = {
        executionId: randomUUID(),
        runId: row.id,
        campaignId: row.campaign_id,
        purpose: 'npc_sheet_completion',
      };
      trace.trace = await createPromptTrace('npc_sheet_completion', trace);
      const system = await new RuleStore(this.store).resolve(
        await this.store.campaign(row.campaign_id)
      );
      const scope = {
        campaignId: row.campaign_id,
        characterId: row.character_id,
        ownerId: row.id,
        systemId: system.systemId,
      };
      const requirements = await deriveNpcSheetRequirements({
        generator: this.generator,
        settings: row.frozen_input.settings,
        system,
        context: row.frozen_input.context,
        scope,
        checkpoint: row.checkpoint ?? undefined,
        reads: () => this.reads(row),
        alive: () => this.alive(row),
        signal: ctl.signal,
        trace,
        save: async (checkpoint) =>
          this.store.transaction(async (client) => {
            await this.store.campaign(row.campaign_id, client, true);
            await this.alive(row, client);
            await client.query(
              'UPDATE npc_sheet_completions SET checkpoint=$2,updated_at=now() WHERE id=$1',
              [row.id, checkpoint]
            );
          }),
        read: async (request, index) =>
          this.store.transaction(async (client) => {
            await this.store.campaign(row.campaign_id, client, true);
            await this.alive(row, client);
            const identity = `sheet:${index}`,
              digest = npcArgumentDigest(request);
            const old = await client.query(
              'SELECT * FROM npc_sheet_reads WHERE job_id=$1 AND request_id=$2',
              [row.id, identity]
            );
            if (old.rows[0]) {
              if (old.rows[0].argument_digest !== digest)
                throw conflict('Sheet read identity changed');
              return old.rows[0].payload;
            }
            const current = await new RuleStore(this.store).resolve(
              await this.store.campaign(row.campaign_id, client),
              client
            );
            const id = randomUUID(),
              payload = executeNpcSheetLookup(current, request, id);
            await client.query(
              'INSERT INTO npc_sheet_reads(id,job_id,campaign_id,character_id,request_id,argument_digest,tool,context,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
              [
                id,
                row.id,
                row.campaign_id,
                row.character_id,
                identity,
                digest,
                request.tool,
                ruleContext(current),
                payload,
              ]
            );
            return payload;
          }),
      });
      await this.alive(row);
      const result = await generateNpcSheet(
        requirements,
        sheet(row.frozen_input.character),
        {
          context: row.frozen_input.context,
          ruleEvidence: (await this.row(row.campaign_id, row.character_id, row.id)).checkpoint
            ?.history,
        },
        this.generator,
        row.frozen_input.settings,
        ctl.signal,
        trace
      );
      await this.store.transaction(async (client) => {
        await this.store.campaign(row.campaign_id, client, true);
        await this.alive(row, client);
        if (ctl.signal.aborted) throw new Problem(409, 'cancelled', 'Sheet completion cancelled');
        await client.query(
          'UPDATE npc_sheet_completions SET status=$2,owner=NULL,lease_until=NULL,result=$3,updated_at=now() WHERE id=$1',
          [row.id, Status.Ready, { requirements, result }]
        );
      });
    } catch (error) {
      await traceEvent(trace, 'npc_sheet_completion_failed', safeTraceFailure(error));
      const message =
        error instanceof Problem
          ? error.message
          : 'NPC sheet generation failed; the saved sheet is unchanged';
      await this.store.pool.query(
        'UPDATE npc_sheet_completions SET status=$2,owner=NULL,lease_until=NULL,safe_error=$3,updated_at=now() WHERE id=$1 AND owner=$4 AND status=$5',
        [row.id, Status.Failed, message, row.owner, Status.Running]
      );
    } finally {
      clearInterval(heartbeat);
    }
  }
  async action(
    campaignId: string,
    characterId: string,
    id: string,
    action: Action
  ): Promise<SheetCompletionView> {
    const result = await this.store.transaction(async (client) => {
      await this.store.campaign(campaignId, client, true);
      const row = await this.row(campaignId, characterId, id, client, true);
      if (action === Action.Cancel) {
        if (row.status !== Status.Running) return { row, launch: false };
        const updated = await client.query(
          'UPDATE npc_sheet_completions SET status=$2,owner=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 RETURNING *',
          [id, Status.Cancelled]
        );
        return { row: updated.rows[0] as Row, launch: false };
      }
      if ([Status.Running, Status.Ready, Status.Applied].includes(row.status))
        return { row, launch: false };
      if (![Status.Failed, Status.Cancelled, Status.Interrupted].includes(row.status))
        throw conflict('Only failed, cancelled or interrupted sheet drafts can be retried');
      await this.store.assertIdle(campaignId, client, undefined, undefined, undefined, id);
      const updated = await client.query(
        'UPDATE npc_sheet_completions SET status=$2,owner=$3,lease_until=now()+make_interval(secs=>$4),safe_error=NULL,updated_at=now() WHERE id=$1 RETURNING *',
        [id, Status.Running, randomUUID(), NPC_SHEET_COMPLETION_LEASE_SECONDS]
      );
      return { row: updated.rows[0] as Row, launch: true };
    });
    if (action === Action.Cancel) this.controllers.get(id)?.abort();
    else if (result.launch) this.launch(result.row);
    return this.view(result.row);
  }
  async decide(
    campaignId: string,
    characterId: string,
    id: string,
    raw: unknown
  ): Promise<SheetCompletionView> {
    const input = npcSheetCompletionDecisionSchema.parse(raw);
    return this.store.transaction(async (client) => {
      const c = await this.store.campaign(campaignId, client, true);
      const row = await this.row(campaignId, characterId, id, client, true);
      const old = await client.query(
        'SELECT * FROM npc_sheet_decisions WHERE job_id=$1 AND request_id=$2',
        [id, input.requestId]
      );
      if (old.rows[0]) {
        if (old.rows[0].decision !== input.decision) throw conflict('Decision identity changed');
        return old.rows[0].result;
      }
      if (
        row.status === Status.Running ||
        row.status === Status.Applied ||
        row.status === Status.Discarded
      )
        throw conflict('Sheet draft cannot be decided in this state');
      await this.store.assertIdle(campaignId, client, undefined, undefined, undefined, id);
      if (input.decision === Action.Apply) {
        if (row.status !== Status.Ready || !row.result)
          throw conflict('A completed draft is required');
        const char = c.characters.find((ch) => ch.id === characterId);
        if (
          !char ||
          !isDeepStrictEqual(
            { ...row.frozen_input.character, revision: 0, notes: '' },
            { ...char, revision: 0, notes: '' }
          )
        )
          throw conflict('NPC fields changed; discard this draft and start again');
        const current = await new RuleStore(this.store).resolve(c, client);
        if (
          current.systemId !== row.frozen_input.rules.systemId ||
          current.contentHash !== row.frozen_input.rules.contentHash
        )
          throw conflict('Selected rules changed; discard this draft and start again');
        const metadata = npcSheetMetadataSchema.parse(row.result);
        const requirements = bindNpcSheetEvidence(metadata.requirements, await this.reads(row), {
          campaignId,
          characterId,
          ownerId: id,
          systemId: current.systemId,
        });
        if (metadata.result.conflicts.length)
          throw conflict('Resolve the reported sheet conflicts before applying');
        validateNpcSheetResult(requirements, metadata.result, sheet(char));
        char.attributes = metadata.result.attributes;
        char.inventory = metadata.result.inventory;
        char.revision++;
        c.revision++;
        await this.store.save(c, client);
      }
      const updated = await client.query(
        'UPDATE npc_sheet_completions SET status=$2,updated_at=now() WHERE id=$1 RETURNING *',
        [id, input.decision === Action.Apply ? Status.Applied : Status.Discarded]
      );
      const view = this.view(updated.rows[0]);
      await client.query(
        'INSERT INTO npc_sheet_decisions(job_id,request_id,decision,result) VALUES($1,$2,$3,$4)',
        [id, input.requestId, input.decision, view]
      );
      return view;
    });
  }
}
