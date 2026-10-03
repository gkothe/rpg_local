import {
  KNOWLEDGE_GAMEPLAY_RESPONSE_SCHEMA_VERSION,
  LEGACY_GAMEPLAY_DIGEST_VERSION,
} from './domain/versions.js';
import { sourceSections } from './domain/sourceSections.js';
import pg, { type PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { databaseUrl } from './config.js';
import { conflict, Problem } from './errors.js';
import type { Campaign, Turn, Memory, Snapshot } from './domain/types.js';
import { SourceStatus, TurnStatus } from './domain/options.js';
import { gameplayDigest } from './domain/diceContext.js';
import type { DiceRecord } from './domain/dice.js';
import { DEFAULT_RULE_SYSTEM_ID, type RuleRead } from './domain/rules.js';
export class Store {
  readonly pool: pg.Pool;
  constructor(url = databaseUrl()) {
    this.pool = new pg.Pool({ connectionString: url, max: 8, connectionTimeoutMillis: 3000 });
  }
  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
  async campaign(id: string, client?: PoolClient, lock = false): Promise<Campaign> {
    const r = await (client ?? this.pool).query(
      'SELECT document,rule_system_id FROM campaigns WHERE id=$1' + (lock ? ' FOR UPDATE' : ''),
      [id]
    );
    if (!r.rows[0]) throw new Problem(404, 'not_found', 'Campaign not found');
    const campaign = r.rows[0].document as Campaign;
    if ((campaign.ruleSystemId ?? null) !== r.rows[0].rule_system_id)
      throw new Problem(503, 'rules_campaign_mirror', 'Campaign rule selection is inconsistent');
    return campaign;
  }
  async save(c: Campaign, client: PoolClient): Promise<void> {
    c.updatedAt = new Date().toISOString();
    await client.query(
      'UPDATE campaigns SET document=$2,rule_system_id=$3,updated_at=now() WHERE id=$1',
      [c.id, c, c.ruleSystemId ?? null]
    );
  }
  async insert(c: Campaign, client?: PoolClient): Promise<void> {
    await (client ?? this.pool).query(
      'INSERT INTO campaigns(id,document,rule_system_id) VALUES($1,$2,$3)',
      [c.id, c, c.ruleSystemId ?? null]
    );
  }
  async list(limit: number, offset: number): Promise<Campaign[]> {
    const r = await this.pool.query(
      'SELECT document FROM campaigns ORDER BY updated_at DESC,id LIMIT $1 OFFSET $2',
      [limit, offset]
    );
    return r.rows.map((x) => x.document);
  }
  async turns(campaignId: string, client?: PoolClient, limit = 100, offset = 0): Promise<Turn[]> {
    const r = await (client ?? this.pool).query(
      'SELECT document FROM turns WHERE campaign_id=$1 ORDER BY created_at,id LIMIT $2 OFFSET $3',
      [campaignId, limit, offset]
    );
    return this.hydrateTurns(
      r.rows.map((x) => x.document),
      client
    );
  }
  async activeTurns(campaignId: string, client?: PoolClient): Promise<Turn[]> {
    const r = await (client ?? this.pool).query(
      "SELECT document FROM turns WHERE campaign_id=$1 AND status=$2 AND NOT (document->>'undone')::boolean ORDER BY created_at,id",
      [campaignId, TurnStatus.Completed]
    );
    return this.hydrateTurns(
      r.rows.map((x) => x.document),
      client
    );
  }
  async recentTurns(campaignId: string, limit = 100): Promise<Turn[]> {
    const r = await this.pool.query(
      'SELECT document FROM turns WHERE campaign_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2',
      [campaignId, limit]
    );
    return this.hydrateTurns(r.rows.map((x) => x.document as Turn).reverse());
  }
  async turn(campaignId: string, id: string, client?: PoolClient, lock = false): Promise<Turn> {
    const r = await (client ?? this.pool).query(
      'SELECT document FROM turns WHERE campaign_id=$1 AND id=$2' + (lock ? ' FOR UPDATE' : ''),
      [campaignId, id]
    );
    if (!r.rows[0]) throw new Problem(404, 'not_found', 'Turn not found');
    return (await this.hydrateTurns([r.rows[0].document], client))[0]!;
  }
  private async hydrateTurns(turns: Turn[], client?: PoolClient): Promise<Turn[]> {
    const terminal = turns.filter(
      (turn) => ![TurnStatus.Pending, TurnStatus.Running].includes(turn.status as TurnStatus)
    );
    if (!terminal.length) return turns;
    const db = client ?? this.pool;
    const records = await db.query(
      "SELECT record.*,attempt_turn.id AS attempt_turn_id FROM dice_records record JOIN turns attempt_turn ON (attempt_turn.document->>'diceSessionId')::uuid=record.session_id AND attempt_turn.campaign_id=record.campaign_id LEFT JOIN dice_attempts attempt ON attempt.turn_id=attempt_turn.id WHERE attempt_turn.id=ANY($1::uuid[]) AND record.slot<COALESCE(attempt.next_slot,jsonb_array_length(COALESCE(attempt_turn.document->'rolls','[]'::jsonb))) ORDER BY record.slot",
      [terminal.map((turn) => turn.id)]
    );
    const byTurn = new Map<string, DiceRecord[]>();
    for (const row of records.rows) {
      const group = byTurn.get(row.attempt_turn_id) ?? [];
      group.push({
        ...row.input,
        id: row.id,
        sessionId: row.session_id,
        campaignId: row.campaign_id,
        groups: row.groups,
        createdAt: new Date(row.created_at).toISOString(),
      });
      byTurn.set(row.attempt_turn_id, group);
    }
    for (const turn of terminal) {
      turn.rolls = byTurn.get(turn.id) ?? [];
      turn.rollInterpretations ??= [];
    }
    const readRows = await db.query(
      'SELECT * FROM turn_rule_reads WHERE turn_id=ANY($1::uuid[]) AND campaign_id=$2 ORDER BY created_at,id',
      [terminal.map((turn) => turn.id), terminal[0]!.campaignId]
    );
    for (const turn of terminal)
      turn.ruleReads = readRows.rows
        .filter((row) => row.turn_id === turn.id)
        .map((row): RuleRead => ({
          id: row.id,
          campaignId: row.campaign_id,
          turnId: row.turn_id,
          context: row.captured_context,
          tool: row.tool_name,
          transportRequestId: row.transport_request_id,
          argumentDigest: row.argument_digest,
          resultHash: row.result_hash,
          payload: row.payload,
          createdAt: new Date(row.created_at).toISOString(),
        }));
    const failures = terminal.filter(
      (turn) =>
        turn.diceSessionId &&
        [TurnStatus.Failed, TurnStatus.Cancelled, TurnStatus.Interrupted].includes(
          turn.status as TurnStatus
        )
    );
    if (!failures.length) return turns;
    // Every Store turn collection belongs to one campaign. Derived retry state is never persisted.
    const campaignId = failures[0]!.campaignId;
    const sessions = await db.query(
      "SELECT *,to_jsonb(dice_sessions)->>'digest_version' AS saved_digest_version FROM dice_sessions WHERE id=ANY($1::uuid[]) AND campaign_id=$2",
      [failures.map((turn) => turn.diceSessionId), campaignId]
    );
    const latest = await db.query(
      'SELECT id FROM turns WHERE campaign_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',
      [campaignId]
    );
    const history = await db.query(
      "SELECT document FROM turns WHERE campaign_id=$1 AND status=$2 AND NOT (document->>'undone')::boolean ORDER BY created_at,id",
      [campaignId, TurnStatus.Completed]
    );
    const campaign = await this.campaign(campaignId, client);
    const heads = await db.query(
      'SELECT id,revision,kind,content_hash FROM rule_systems WHERE id=$1',
      [campaign.ruleSystemId ?? DEFAULT_RULE_SYSTEM_ID]
    );
    for (const turn of failures) {
      const session = sessions.rows.find((row) => row.id === turn.diceSessionId);
      const digest = gameplayDigest(
        campaign,
        history.rows.map((row) => row.document),
        turn.ruleContext,
        Number(session?.saved_digest_version ?? LEGACY_GAMEPLAY_DIGEST_VERSION)
      );
      const head = heads.rows[0];
      const outdatedRules =
        turn.ruleContext &&
        (!head ||
          head.id !== turn.ruleContext.systemId ||
          head.revision !== turn.ruleContext.revision ||
          head.kind !== turn.ruleContext.kind ||
          head.content_hash !== turn.ruleContext.contentHash);
      const reason =
        !session || session.imported
          ? 'Imported dice are preserved for audit and cannot be executed'
          : latest.rows[0]?.id !== turn.id
            ? 'A later action superseded this attempt'
            : outdatedRules || campaign.ruleResolution
              ? 'Rule library changed or is unresolved; start a new action after selecting current rules'
              : session.context_digest !== digest
                ? 'Game context changed; start a new action'
                : null;
      turn.diceRetry = { available: reason === null, reason };
    }
    return turns;
  }
  async turnContext(campaignId: string, turnId: string) {
    const turn = await this.turn(campaignId, turnId);
    if (
      !turn.context ||
      turn.context.promptContractVersion !== KNOWLEDGE_GAMEPLAY_RESPONSE_SCHEMA_VERSION ||
      !turn.diceSessionId
    )
      return turn.context;
    const saved = await this.pool.query(
      'SELECT * FROM dice_sessions WHERE id=$1 AND campaign_id=$2',
      [turn.diceSessionId, campaignId]
    );
    const root = saved.rows[0];
    if (!root || root.prompt_contract_version !== KNOWLEDGE_GAMEPLAY_RESPONSE_SCHEMA_VERSION)
      throw new Problem(409, 'dice_context', 'Frozen turn context is missing');
    return {
      ...turn.context,
      diceSessionId: root.id,
      prompt: root.frozen_prompt,
      revision: root.frozen_revision,
      promptContractVersion: root.prompt_contract_version,
      digestVersion: root.digest_version,
      systemPrompt: root.system_prompt,
      frozenKnowledge: root.frozen_knowledge,
      toolDefinitions: root.tool_definitions,
    };
  }
  async saveTurn(t: Turn, client: PoolClient): Promise<void> {
    const document = { ...t };
    delete document.diceRetry;
    if (
      document.context?.diceSessionId &&
      document.context.promptContractVersion === KNOWLEDGE_GAMEPLAY_RESPONSE_SCHEMA_VERSION
    ) {
      document.context = { ...document.context };
      delete document.context.systemPrompt;
      delete document.context.frozenKnowledge;
    }
    await client.query('UPDATE turns SET document=$2,status=$3 WHERE id=$1', [
      t.id,
      document,
      t.status,
    ]);
  }
  async assertIdle(id: string, client: PoolClient): Promise<void> {
    const r = await client.query(
      'SELECT id FROM turns WHERE campaign_id=$1 AND status IN ($2,$3)',
      [id, TurnStatus.Pending, TurnStatus.Running]
    );
    if (r.rowCount) throw conflict('Wait for or cancel the active turn first');
  }
  async edit(
    id: string,
    revision: number,
    fn: (c: Campaign, client: PoolClient) => Promise<void> | void
  ): Promise<Campaign> {
    return this.transaction(async (client) => {
      const c = await this.campaign(id, client, true);
      if (c.revision !== revision) throw conflict('Campaign changed; refresh before saving');
      await fn(c, client);
      c.revision++;
      await this.save(c, client);
      return c;
    });
  }
  async memory(c: Campaign, m: Memory, client: PoolClient): Promise<void> {
    await client.query('INSERT INTO memories(id,campaign_id,document) VALUES($1,$2,$3)', [
      m.id,
      c.id,
      m,
    ]);
    c.memory = m;
  }
  async recover(): Promise<number> {
    const r = await this.pool.query(
      "UPDATE turns SET status=$1,document=jsonb_set(jsonb_set(document,'{status}',to_jsonb($1::text)),'{error}',to_jsonb($4::text)),owner=NULL,lease_until=NULL WHERE status IN ($2,$3) AND (lease_until IS NULL OR lease_until < now())",
      [
        TurnStatus.Interrupted,
        TurnStatus.Pending,
        TurnStatus.Running,
        'The app restarted during this turn; use Retry to preserve its recorded dice',
      ]
    );
    return r.rowCount ?? 0;
  }
  async reindex(c: Campaign, client: PoolClient): Promise<void> {
    await client.query('DELETE FROM source_chunks WHERE campaign_id=$1', [c.id]);
    for (const source of c.sources.filter((s) => s.status === SourceStatus.Confirmed)) {
      let ordinal = 0;
      const chunks = sourceSections(source).map((s) => s.text);
      for (const content of chunks)
        await client.query(
          'INSERT INTO source_chunks(campaign_id,source_id,version,ordinal,content) VALUES($1,$2,$3,$4,$5)',
          [c.id, source.id, source.version, ordinal++, content]
        );
    }
  }
  async retrieve(
    c: Campaign,
    action: string,
    client?: PoolClient
  ): Promise<
    { id: string; version: number; text: string; name: string; start: number; end: number }[]
  > {
    const stop = new Set([
      'the',
      'and',
      'with',
      'from',
      'that',
      'this',
      'into',
      'past',
      'then',
      'have',
      'will',
      'would',
      'could',
      'are',
      'for',
    ]);
    const words = [
      ...new Set(
        (action.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
          (word) => word.length > 2 && !stop.has(word)
        )
      ),
    ].slice(0, 32);
    if (!words.length) return [];
    const terms = words.map((word) => `'${word}'`).join(' | ');
    const r = await (client ?? this.pool).query(
      "SELECT source_id,version,content,ordinal FROM source_chunks WHERE campaign_id=$1 AND search @@ to_tsquery('simple',$2) ORDER BY ts_rank(search,to_tsquery('simple',$2)) DESC,source_id,ordinal LIMIT 8",
      [c.id, terms]
    );
    return r.rows
      .filter((x) =>
        c.sources.some(
          (s) =>
            s.id === x.source_id && s.version === x.version && s.status === SourceStatus.Confirmed
        )
      )
      .map((x) => {
        const source = c.sources.find((s) => s.id === x.source_id)!;
        const section = sourceSections(source)[x.ordinal];
        if (!section || section.text !== x.content)
          throw new Problem(503, 'source_index_changed', 'Source retrieval index is inconsistent');
        return {
          id: x.source_id,
          version: x.version,
          text: x.content,
          name: source.name,
          start: section.start,
          end: section.end,
        };
      });
  }
  async snapshot(id: string, client: PoolClient): Promise<Snapshot> {
    const r = await client.query('SELECT document FROM snapshots WHERE turn_id=$1', [id]);
    if (!r.rows[0]) throw conflict('Turn has no undo snapshot');
    return r.rows[0].document;
  }
  async close() {
    await this.pool.end();
  }
}
export const ownerId = randomUUID();
