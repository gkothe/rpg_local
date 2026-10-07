import { randomUUID, createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { Store, ownerId } from '../store.js';
import { TurnStatus } from '../domain/options.js';
import type { Turn, Campaign } from '../domain/types.js';
import { RuleLookup } from './ruleLookup.js';
import { ZodError } from 'zod';
import { Problem, conflict } from '../errors.js';
import { sheetLayoutSchema, type SheetLayout } from '../domain/sheetLayout.js';
import {
  DEFAULT_RULE_SYSTEM_ID,
  RuleSystemKind,
  RULE_COLUMNS,
  ruleContentHash,
  validateRuleContent,
  emptyRuleColumns,
  ruleSlugSchema,
  RULE_LIMITS,
  type RuleContext,
  type RuleContent,
  type RuleSystem,
  type RuleRead,
  type RuleTool,
  serializedBytes,
  canonicalRuleJson,
} from '../domain/rules.js';

export type SheetLayoutState = {
  sheetLayout: SheetLayout;
  sheetLayoutUpdatedAt: string | null;
};
const contentFields = ['instructions', 'sources', ...RULE_COLUMNS, 'mapping'] as const;
type RuleRow = Record<string, unknown>;
const snapshotCaches = new WeakMap<Store, Map<string, { system: RuleSystem; bytes: number }>>();
const SNAPSHOT_CACHE_BYTES = 64 * 1024 * 1024;
const SNAPSHOT_CACHE_ENTRIES = 4;
export function ruleSystemFromRow(row: RuleRow): RuleSystem {
  return {
    ...Object.fromEntries(contentFields.map((key) => [key, row[key]])),
    systemId: row.id as string,
    systemKey: row.system_key as string,
    systemName: row.system_name as string,
    kind: row.kind as RuleSystemKind,
    revision: row.revision as number,
    contentHash: row.content_hash as string,
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  } as RuleSystem;
}
export function ruleContext(system: RuleSystem): RuleContext {
  const { systemId, systemKey, systemName, kind, revision, contentHash } = system;
  return { systemId, systemKey, systemName, kind, revision, contentHash };
}
export function ruleContent(system: RuleContent): RuleContent {
  return Object.fromEntries(contentFields.map((key) => [key, system[key]])) as RuleContent;
}
export class RuleStore {
  constructor(readonly store: Store) {}
  async resolve(campaign: Campaign, client?: PoolClient): Promise<RuleSystem> {
    if (campaign.ruleResolution)
      throw new Problem(
        409,
        'rules_reference_unresolved',
        'Resolve this campaign rule-library reference or explicitly choose the default'
      );
    const system = await this.get(
      campaign.ruleSystemId ?? DEFAULT_RULE_SYSTEM_ID,
      client,
      client ? 'share' : undefined
    );
    if (
      system.kind === RuleSystemKind.Library &&
      (!system.sources.length || !this.hasOriginalText(system))
    )
      throw new Problem(
        422,
        'rules_system_empty',
        'Publish a book before selecting this rule system'
      );
    return system;
  }
  private hasOriginalText(system: RuleSystem): boolean {
    const nodes = RULE_COLUMNS.flatMap((column) => Object.values(system[column]));
    while (nodes.length) {
      const node = nodes.pop()!;
      if (!node.structural && node.text.length) return true;
      nodes.push(...Object.values(node.children));
    }
    return false;
  }
  async get(
    id = DEFAULT_RULE_SYSTEM_ID,
    client?: PoolClient,
    lock?: 'share' | 'update'
  ): Promise<RuleSystem> {
    if (lock && !client) throw new Error('A rule lock requires a transaction client');
    const result = await (client ?? this.store.pool).query(
      'SELECT * FROM rule_systems WHERE id=$1' +
        (lock === 'share' ? ' FOR SHARE' : lock === 'update' ? ' FOR UPDATE' : ''),
      [id]
    );
    if (!result.rows[0]) throw new Problem(404, 'rules_system_missing', 'Rule system not found');
    return ruleSystemFromRow(result.rows[0]);
  }
  /** Display-only; read separately so it never enters rule content, hashes or cached snapshots. */
  async sheetLayout(id: string, client?: PoolClient, lock?: 'update'): Promise<SheetLayoutState> {
    if (lock && !client) throw new Error('A rule lock requires a transaction client');
    const result = await (client ?? this.store.pool).query(
      'SELECT sheet_layout,sheet_layout_updated_at FROM rule_systems WHERE id=$1' +
        (lock ? ' FOR UPDATE' : ''),
      [id]
    );
    const row = result.rows[0];
    if (!row) throw new Problem(404, 'rules_system_missing', 'Rule system not found');
    return {
      sheetLayout: sheetLayoutSchema.parse(row.sheet_layout),
      sheetLayoutUpdatedAt: row.sheet_layout_updated_at
        ? new Date(row.sheet_layout_updated_at as string).toISOString()
        : null,
    };
  }
  /** Writes only the layout columns: revision, content hash and updated_at stay unchanged. */
  async setSheetLayout(
    id: string,
    layout: SheetLayout,
    client: PoolClient
  ): Promise<SheetLayoutState> {
    const result = await client.query(
      'UPDATE rule_systems SET sheet_layout=$2,sheet_layout_updated_at=now() WHERE id=$1 RETURNING sheet_layout,sheet_layout_updated_at',
      [id, JSON.stringify(layout)]
    );
    const row = result.rows[0];
    if (!row) throw new Problem(404, 'rules_system_missing', 'Rule system not found');
    return {
      sheetLayout: layout,
      sheetLayoutUpdatedAt: new Date(row.sheet_layout_updated_at as string).toISOString(),
    };
  }
  async list(
    limit = 20,
    offset = 0
  ): Promise<(RuleContext & { selectable: boolean; isDefault: boolean })[]> {
    const result = await this.store.pool.query(
      'SELECT id,system_key,system_name,kind,revision,content_hash,has_original_text AS published FROM rule_systems ORDER BY kind DESC,system_name,system_key LIMIT $1 OFFSET $2',
      [limit, offset]
    );
    return result.rows.map((row) => ({
      systemId: row.id,
      systemKey: row.system_key,
      systemName: row.system_name,
      kind: row.kind,
      revision: row.revision,
      contentHash: row.content_hash,
      isDefault: row.kind === RuleSystemKind.ModelKnowledge,
      selectable: row.kind === RuleSystemKind.ModelKnowledge || row.published,
    }));
  }
  async create(systemKey: string, systemName: string): Promise<RuleContext> {
    ruleSlugSchema.parse(systemKey);
    if (!systemName.length || systemName.length > RULE_LIMITS.nameChars)
      throw new Problem(422, 'rules_name_invalid', 'Invalid system name');
    const content: RuleContent = {
      ...emptyRuleColumns(),
      instructions: '',
      sources: [],
      mapping: {},
    };
    const id = randomUUID();
    const result = await this.store.pool.query(
      'INSERT INTO rule_systems(id,system_key,system_name,kind,content_hash,instructions) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(system_key) DO NOTHING RETURNING *',
      [id, systemKey, systemName, RuleSystemKind.Library, ruleContentHash(content), '']
    );
    if (!result.rows[0]) throw conflict('System key already exists');
    return ruleContext(ruleSystemFromRow(result.rows[0]));
  }
  async guard(expected: RuleContext, client: PoolClient): Promise<RuleSystem> {
    // Revisions identify cached content; an older turn never blocks use of the current row.
    const head = await client.query(
      'SELECT revision,content_hash,kind FROM rule_systems WHERE id=$1 FOR SHARE',
      [expected.systemId]
    );
    const row = head.rows[0];
    if (!row) throw new Problem(404, 'rules_system_missing', 'Rule system not found');
    let cache = snapshotCaches.get(this.store);
    if (!cache) {
      cache = new Map();
      snapshotCaches.set(this.store, cache);
    }
    const key = JSON.stringify([expected.systemId, row.revision, row.content_hash, row.kind]);
    const cached = cache.get(key);
    if (cached) {
      cache.delete(key);
      cache.set(key, cached);
      return cached.system;
    }
    const system = await this.get(expected.systemId, client, 'share');
    const bytes = serializedBytes(system);
    if (bytes <= SNAPSHOT_CACHE_BYTES) {
      while (
        cache.size >= SNAPSHOT_CACHE_ENTRIES ||
        [...cache.values()].reduce((sum, entry) => sum + entry.bytes, 0) + bytes >
          SNAPSHOT_CACHE_BYTES
      )
        cache.delete(cache.keys().next().value!);
      freezeSnapshot(system);
      cache.set(key, { system, bytes });
    }
    return system;
  }
  async publish(
    id: string,
    _revision: number,
    transform: (current: RuleSystem) => RuleContent
  ): Promise<RuleContext> {
    return this.store.transaction(async (client) => {
      const current = await this.get(id, client, 'update');
      return this.write(current, transform(current), client);
    });
  }
  async write(
    current: RuleSystem,
    next: RuleContent,
    client: PoolClient,
    forceRevision = false
  ): Promise<RuleContext> {
    const content = ruleContent(next);
    validateRuleContent(content, current.kind);
    const hash = ruleContentHash(content);
    if (hash === current.contentHash && !forceRevision) return ruleContext(current);
    const values = contentFields.map((key) =>
      typeof content[key] === 'string' ? content[key] : JSON.stringify(content[key])
    );
    const result = await client.query(
      `UPDATE rule_systems SET ${contentFields.map((key, index) => `${key}=$${index + 3}`).join(',')},content_hash=$2,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *`,
      [current.systemId, hash, ...values]
    );
    if (!result.rows[0]) throw conflict('Rule system changed during publication');
    return ruleContext(ruleSystemFromRow(result.rows[0]));
  }
  async confirmation<T = RuleContext>(
    id: string,
    requestId: string,
    identity: Record<string, unknown>,
    client: PoolClient
  ): Promise<T | null> {
    const result = await client.query(
      'SELECT identity,result FROM rule_confirmations WHERE system_id=$1 AND request_id=$2',
      [id, requestId]
    );
    if (!result.rows[0]) return null;
    if (JSON.stringify(result.rows[0].identity) !== JSON.stringify(identity)) {
      // JSONB key ordering differs from JavaScript insertion order.
      const stored = result.rows[0].identity as Record<string, unknown>;
      if (
        Object.keys(stored).length !== Object.keys(identity).length ||
        Object.keys(stored).some((key) => stored[key] !== identity[key])
      )
        throw conflict('Confirmation request identity was reused with changed input');
    }
    return result.rows[0].result as T;
  }
  async saveConfirmation<T = RuleContext>(
    id: string,
    requestId: string,
    identity: Record<string, unknown>,
    inputHash: string,
    result: T,
    client: PoolClient
  ): Promise<void> {
    await client.query(
      'INSERT INTO rule_confirmations(system_id,request_id,input_hash,identity,result) VALUES($1,$2,$3,$4,$5)',
      [id, requestId, inputHash, identity, result]
    );
  }
  async read(
    turn: Turn,
    tool: RuleTool,
    raw: unknown,
    transportRequestId: string,
    lookup: RuleLookup,
    signal?: AbortSignal
  ): Promise<RuleRead> {
    if (!transportRequestId.length || transportRequestId.length > RULE_LIMITS.tokenChars)
      throw new Problem(422, 'rules_transport_invalid', 'Invalid transport request identity');
    const expected = turn.ruleContext ?? turn.context?.ruleContext;
    if (!expected)
      throw new Problem(
        422,
        'rules_context_missing',
        'Rule lookup requires captured system identity'
      );
    const argumentDigest = createHash('sha256')
      .update(canonicalRuleJson({ tool, arguments: raw }))
      .digest('hex');
    return this.store.transaction(async (client) => {
      await this.store.campaign(turn.campaignId, client, true);
      const active = await client.query(
        'SELECT owner,status,lease_until,document FROM turns WHERE id=$1 AND campaign_id=$2 FOR UPDATE',
        [turn.id, turn.campaignId]
      );
      const row = active.rows[0];
      if (
        signal?.aborted ||
        !row ||
        row.owner !== ownerId ||
        row.status !== TurnStatus.Running ||
        new Date(row.lease_until).getTime() <= Date.now()
      )
        throw new Problem(409, 'rules_inactive', 'Rule attempt is no longer active');
      if (
        canonicalRuleJson(row.document.ruleContext ?? row.document.context?.ruleContext) !==
        canonicalRuleJson(expected)
      )
        throw new Problem(
          409,
          'rules_context_changed',
          'Rule request must use the active attempt context'
        );
      const system = await this.guard(expected, client);
      const prior = await client.query(
        'SELECT * FROM turn_rule_reads WHERE turn_id=$1 AND transport_request_id=$2',
        [turn.id, transportRequestId]
      );
      if (prior.rows[0]) {
        if (prior.rows[0].argument_digest !== argumentDigest)
          throw conflict('Transport request identity reused with changed arguments');
        return this.readFromRow(prior.rows[0]);
      }
      await client.query(
        'INSERT INTO turn_rule_budgets(turn_id,campaign_id) VALUES($1,$2) ON CONFLICT(turn_id) DO NOTHING',
        [turn.id, turn.campaignId]
      );
      await client.query(
        'SELECT requests,transcript_bytes FROM turn_rule_budgets WHERE turn_id=$1 FOR UPDATE',
        [turn.id]
      );
      const id = randomUUID();
      let payload: Record<string, unknown>;
      try {
        // Pagination bounds each result; accumulated audit bytes never block another read.
        payload = lookup.execute(system, tool, raw, id);
      } catch (error) {
        if (!(error instanceof Problem || error instanceof ZodError)) throw error;
        payload = {
          receipt: id,
          error: {
            code: error instanceof Problem ? error.code : 'rules_request_invalid',
            detail: error instanceof Problem ? error.message : 'Invalid rule request',
          },
        };
      }
      const bytes = serializedBytes({ tool, arguments: raw, result: payload });
      if (signal?.aborted) throw new Problem(409, 'rules_inactive', 'Rule attempt was cancelled');
      const resultHash = createHash('sha256').update(canonicalRuleJson(payload)).digest('hex');
      const saved = await client.query(
        'INSERT INTO turn_rule_reads(id,campaign_id,turn_id,system_id,captured_context,tool_name,transport_request_id,argument_digest,result_hash,payload,transcript_bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',
        [
          id,
          turn.campaignId,
          turn.id,
          expected.systemId,
          ruleContext(system),
          tool,
          transportRequestId,
          argumentDigest,
          resultHash,
          payload,
          bytes,
        ]
      );
      await client.query(
        'UPDATE turn_rule_budgets SET requests=requests+1,transcript_bytes=transcript_bytes+$2 WHERE turn_id=$1',
        [turn.id, bytes]
      );
      return this.readFromRow(saved.rows[0]);
    });
  }
  readFromRow(row: RuleRow): RuleRead {
    return {
      id: row.id as string,
      campaignId: row.campaign_id as string,
      turnId: row.turn_id as string,
      context: row.captured_context as RuleContext,
      tool: row.tool_name as RuleTool,
      transportRequestId: row.transport_request_id as string,
      argumentDigest: row.argument_digest as string,
      resultHash: row.result_hash as string,
      payload: row.payload as Record<string, unknown>,
      createdAt: new Date(row.created_at as string).toISOString(),
    };
  }
  async history(campaignId: string, turnId: string, offset = 0) {
    await this.store.campaign(campaignId);
    const turn = await this.store.pool.query(
      'SELECT status,document FROM turns WHERE id=$1 AND campaign_id=$2',
      [turnId, campaignId]
    );
    if (!turn.rows[0]) throw new Problem(404, 'not_found', 'Turn not found');
    if ([TurnStatus.Running, TurnStatus.Pending].includes(turn.rows[0].status))
      throw new Problem(
        409,
        'rules_attempt_active',
        'Rule evidence is available after the attempt ends'
      );
    const result = await this.store.pool.query(
      'SELECT * FROM turn_rule_reads WHERE campaign_id=$1 AND turn_id=$2 ORDER BY created_at,id LIMIT $3 OFFSET $4',
      [campaignId, turnId, RULE_LIMITS.calls + 1, offset]
    );
    const data: RuleRead[] = [];
    for (const row of result.rows) {
      const candidate = [...data, this.readFromRow(row)];
      const response = {
        data: candidate,
        pagination: { nextCursor: String(offset + candidate.length) },
      };
      if (serializedBytes(response) > RULE_LIMITS.historicalResponseBytes) break;
      data.push(candidate[candidate.length - 1]!);
    }
    return {
      data,
      pagination: {
        nextCursor: data.length < result.rows.length ? String(offset + data.length) : null,
      },
    };
  }
}
function freezeSnapshot(value: unknown): void {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) freezeSnapshot(child);
  Object.freeze(value);
}
