import { sourceSections } from './domain/sourceSections.js';
import pg, { type PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { databaseUrl } from './config.js';
import { conflict, Problem } from './errors.js';
import type { Campaign, Turn, Memory, Snapshot } from './domain/types.js';
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
      'SELECT document FROM campaigns WHERE id=$1' + (lock ? ' FOR UPDATE' : ''),
      [id]
    );
    if (!r.rows[0]) throw new Problem(404, 'not_found', 'Campaign not found');
    return r.rows[0].document as Campaign;
  }
  async save(c: Campaign, client: PoolClient): Promise<void> {
    c.updatedAt = new Date().toISOString();
    await client.query('UPDATE campaigns SET document=$2,updated_at=now() WHERE id=$1', [c.id, c]);
  }
  async insert(c: Campaign, client?: PoolClient): Promise<void> {
    await (client ?? this.pool).query('INSERT INTO campaigns(id,document) VALUES($1,$2)', [
      c.id,
      c,
    ]);
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
    return r.rows.map((x) => x.document);
  }
  async activeTurns(campaignId: string, client?: PoolClient): Promise<Turn[]> {
    const r = await (client ?? this.pool).query(
      "SELECT document FROM turns WHERE campaign_id=$1 AND status='completed' AND NOT (document->>'undone')::boolean ORDER BY created_at,id",
      [campaignId]
    );
    return r.rows.map((x) => x.document);
  }
  async recentTurns(campaignId: string, limit = 100): Promise<Turn[]> {
    const r = await this.pool.query(
      'SELECT document FROM turns WHERE campaign_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2',
      [campaignId, limit]
    );
    return r.rows.map((x) => x.document as Turn).reverse();
  }
  async turn(campaignId: string, id: string, client?: PoolClient, lock = false): Promise<Turn> {
    const r = await (client ?? this.pool).query(
      'SELECT document FROM turns WHERE campaign_id=$1 AND id=$2' + (lock ? ' FOR UPDATE' : ''),
      [campaignId, id]
    );
    if (!r.rows[0]) throw new Problem(404, 'not_found', 'Turn not found');
    return r.rows[0].document;
  }
  async saveTurn(t: Turn, client: PoolClient): Promise<void> {
    await client.query('UPDATE turns SET document=$2,status=$3 WHERE id=$1', [t.id, t, t.status]);
  }
  async assertIdle(id: string, client: PoolClient): Promise<void> {
    const r = await client.query(
      "SELECT id FROM turns WHERE campaign_id=$1 AND status IN ('pending','running')",
      [id]
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
      "UPDATE turns SET status='interrupted',document=jsonb_set(jsonb_set(document,'{status}','\"interrupted\"'),'{error}','\"The app restarted during this turn; submit a new request to retry\"'),owner=NULL,lease_until=NULL WHERE status IN ('pending','running') AND (lease_until IS NULL OR lease_until < now())"
    );
    return r.rowCount ?? 0;
  }
  async reindex(c: Campaign, client: PoolClient): Promise<void> {
    await client.query('DELETE FROM source_chunks WHERE campaign_id=$1', [c.id]);
    for (const source of c.sources.filter((s) => s.status === 'confirmed')) {
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
  ): Promise<{ id: string; version: number; text: string }[]> {
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
      "SELECT source_id,version,content FROM source_chunks WHERE campaign_id=$1 AND search @@ to_tsquery('simple',$2) ORDER BY ts_rank(search,to_tsquery('simple',$2)) DESC,source_id,ordinal LIMIT 8",
      [c.id, terms]
    );
    return r.rows
      .filter((x) =>
        c.sources.some(
          (s) => s.id === x.source_id && s.version === x.version && s.status === 'confirmed'
        )
      )
      .map((x) => ({ id: x.source_id, version: x.version, text: x.content }));
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
