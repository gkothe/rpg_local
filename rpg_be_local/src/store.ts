import { sourceSections } from './domain/sourceSections.js';
import { selectInitialSourceSections } from './domain/campaignSourceRecall.js';
import pg, { type PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { databaseUrl } from './config.js';
import { conflict, Problem } from './errors.js';
import type { Campaign, Turn, Memory, Snapshot } from './domain/types.js';
import { frozenContextConflict } from './domain/journalCompatibility.js';
import type { KnowledgeSnapshotVersion } from './domain/journalProjection.js';
import { SourceStatus, TurnStatus } from './domain/options.js';
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
      'SELECT * FROM dice_sessions WHERE id=ANY($1::uuid[]) AND campaign_id=$2',
      [failures.map((turn) => turn.diceSessionId), campaignId]
    );
    const latest = await db.query(
      'SELECT id FROM turns WHERE campaign_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',
      [campaignId]
    );
    const campaign = await this.campaign(campaignId, client);
    const heads = await db.query(
      'SELECT id,revision,kind,content_hash FROM rule_systems WHERE id=$1',
      [campaign.ruleSystemId ?? DEFAULT_RULE_SYSTEM_ID]
    );
    for (const turn of failures) {
      const session = sessions.rows.find((row) => row.id === turn.diceSessionId);
      const head = heads.rows[0];
      const outdatedRules =
        turn.ruleContext &&
        (!head || head.id !== turn.ruleContext.systemId || head.kind !== turn.ruleContext.kind);
      const reason =
        !session || session.imported
          ? 'Imported dice are preserved for audit and cannot be executed'
          : !session.system_prompt
            ? 'This attempt predates the current game contract; start a new action'
            : latest.rows[0]?.id !== turn.id
              ? 'A later action superseded this attempt'
              : (frozenContextConflict(session.frozen_knowledge, campaign) ??
                (outdatedRules || campaign.ruleResolution
                  ? 'Rule library changed or is unresolved; start a new action after selecting current rules'
                  : null));
      if (turn.editingPending) {
        turn.editingResume = { available: reason === null, reason };
        delete turn.diceRetry;
      } else turn.diceRetry = { available: reason === null, reason };
    }
    return turns;
  }
  async turnContext(campaignId: string, turnId: string) {
    const turn = await this.turn(campaignId, turnId);
    if (!turn.context || !turn.diceSessionId) return turn.context;
    const saved = await this.pool.query(
      'SELECT * FROM dice_sessions WHERE id=$1 AND campaign_id=$2',
      [turn.diceSessionId, campaignId]
    );
    const root = saved.rows[0];
    if (!root) throw new Problem(409, 'dice_context', 'Frozen turn context is missing');
    // Sessions without a system prompt predate the instruction envelope; their turn keeps its context.
    if (!root.system_prompt) return turn.context;
    return {
      ...turn.context,
      diceSessionId: root.id,
      prompt: root.frozen_prompt,
      revision: root.frozen_revision,
      systemPrompt: root.system_prompt,
      frozenKnowledge: root.frozen_knowledge,
      ...(root.frozen_sources ? { frozenSources: root.frozen_sources } : {}),
      ...(root.frozen_history ? { frozenHistory: root.frozen_history } : {}),
      toolDefinitions: root.tool_definitions,
    };
  }
  async saveTurn(t: Turn, client: PoolClient): Promise<void> {
    const document = { ...t };
    delete document.diceRetry;
    delete document.editingResume;
    if (document.context?.diceSessionId) {
      document.context = { ...document.context };
      delete document.context.systemPrompt;
      delete document.context.frozenKnowledge;
      delete document.context.frozenSources;
      delete document.context.frozenHistory;
    }
    await client.query('UPDATE turns SET document=$2,status=$3 WHERE id=$1', [
      t.id,
      document,
      t.status,
    ]);
  }
  /**
   * A running Journal job or memory rebuild owns the campaign; the exempt IDs let that job's own
   * commit through.
   */
  async assertIdle(
    id: string,
    client: PoolClient,
    exemptJournalJobId?: string,
    exemptRebuildJobId?: string
  ): Promise<void> {
    const r = await client.query(
      "SELECT id FROM turns WHERE campaign_id=$1 AND (status IN ($2,$3) OR document->>'editingPending'='true')",
      [id, TurnStatus.Pending, TurnStatus.Running]
    );
    if (r.rowCount) throw conflict('Wait for or cancel the active turn first');
    const journal = await client.query(
      "SELECT id FROM journal_jobs WHERE campaign_id=$1 AND status IN ('pending','running') AND ($2::uuid IS NULL OR id<>$2::uuid)",
      [id, exemptJournalJobId ?? null]
    );
    if (journal.rowCount)
      throw new Problem(
        409,
        'journal_busy',
        'Wait for or cancel the Journal task first (Journal tab)'
      );
    const rebuild = await client.query(
      "SELECT id FROM memory_rebuild_jobs WHERE campaign_id=$1 AND status IN ('pending','running') AND ($2::uuid IS NULL OR id<>$2::uuid)",
      [id, exemptRebuildJobId ?? null]
    );
    if (rebuild.rowCount)
      throw new Problem(
        409,
        'memory_busy',
        'Wait for or cancel the memory rebuild first (Journal tab)'
      );
  }
  /** Stored before/after versions of one record from non-undone turns, oldest first. */
  async knowledgeSnapshots(
    campaignId: string,
    knowledgeId: string
  ): Promise<KnowledgeSnapshotVersion[]> {
    const r = await this.pool.query(
      "SELECT s.turn_id,s.document FROM snapshots s JOIN turns t ON t.id=s.turn_id AND t.campaign_id=s.campaign_id WHERE s.campaign_id=$1 AND s.document->'afterKnowledge' @> $2::jsonb AND NOT COALESCE((t.document->>'undone')::boolean,false) ORDER BY t.created_at,t.id",
      [campaignId, JSON.stringify([{ id: knowledgeId }])]
    );
    return r.rows.flatMap((row) => {
      const doc = row.document as Snapshot;
      const after = doc.afterKnowledge?.find((k) => k.id === knowledgeId);
      if (!after) return [];
      return [
        {
          turnId: row.turn_id as string,
          before: doc.beforeKnowledge?.find((k) => k.id === knowledgeId) ?? null,
          after,
        },
      ];
    });
  }
  async edit(
    id: string,
    _revision: number,
    fn: (c: Campaign, client: PoolClient) => Promise<void> | void
  ): Promise<Campaign> {
    return this.transaction(async (client) => {
      const c = await this.campaign(id, client, true);
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
      "UPDATE turns SET status=$1,document=jsonb_set(jsonb_set(document,'{status}',to_jsonb($1::text)),'{error}',to_jsonb(CASE WHEN document->>'editingPending'='true' THEN 'Narrative editing was interrupted; resume editing to finish without repeating gameplay.' ELSE $4::text END)),owner=NULL,lease_until=NULL WHERE status IN ($2,$3) AND (lease_until IS NULL OR lease_until < now())",
      [
        TurnStatus.Interrupted,
        TurnStatus.Pending,
        TurnStatus.Running,
        'The app restarted during this turn; use Retry to preserve its recorded dice',
      ]
    );
    // Journal jobs whose owner lease expired cannot commit; surface them for an explicit retry.
    const journal = await this.pool.query(
      "UPDATE journal_jobs SET status='interrupted',owner=NULL,lease_until=NULL,updated_at=now(),safe_error='The app restarted during this Journal task; retry it.',error_code='journal_interrupted' WHERE status IN ('pending','running') AND (lease_until IS NULL OR lease_until < now())"
    );
    // Rebuild attempts whose lease expired lost ownership; their persisted batches survive for an explicit retry.
    const rebuild = await this.pool.query(
      "UPDATE memory_rebuild_jobs SET status='interrupted',owner=NULL,lease_until=NULL,updated_at=now(),safe_error='The app restarted during this memory rebuild; retry it.',error_code='memory_interrupted' WHERE status IN ('pending','running') AND (lease_until IS NULL OR lease_until < now())"
    );
    return (r.rowCount ?? 0) + (journal.rowCount ?? 0) + (rebuild.rowCount ?? 0);
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
    client?: PoolClient,
    scene?: string
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
        (
          [action, scene ?? '']
            .join(' ')
            .toLowerCase()
            .match(/[\p{L}\p{N}]+/gu) ?? []
        ).filter((word) => word.length > 2 && !stop.has(word))
      ),
    ].slice(0, 32);
    if (!words.length) return [];
    const terms = words.map((word) => `'${word}'`).join(' | ');
    const r = await (client ?? this.pool).query(
      "SELECT source_id,version,content,ordinal FROM source_chunks WHERE campaign_id=$1 AND search @@ to_tsquery('simple',$2) ORDER BY ts_rank(search,to_tsquery('simple',$2)) DESC,source_id,ordinal LIMIT 8",
      [c.id, terms]
    );
    const originals = r.rows
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
    return scene === undefined ? originals : selectInitialSourceSections(originals, action, scene);
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
