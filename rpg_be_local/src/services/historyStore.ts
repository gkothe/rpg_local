import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { Problem } from '../errors.js';
import {
  HistoryFragmentKind,
  HistorySelectionStatus,
  correctionDigestOf,
  fragmentDigest,
  fragmentSummary,
  frozenHistorySchema,
  HISTORY_DEFAULTS,
  originalHistorySearchSchema,
  originalHistoryGetSchema,
  pageOriginals,
  searchFragments,
  termsOf,
  turnVersionOf,
  versionHashOf,
  type FrozenHistory,
  type HistoryFragment,
  type HistoryFragmentPayload,
  type SourceLocator,
  type TurnVersion,
  type TurnVersionDocument,
} from '../domain/historyRecall.js';
import { CORRECTION_PROMPT_INSTRUCTION } from '../domain/journalCompatibility.js';
import { TurnStatus } from '../domain/options.js';
import type { Turn } from '../domain/types.js';
import type { Store } from '../store.js';
import { canonicalJson, sha256 } from '../domain/journalLedger.js';

const MISSING_TABLE = '42P01';
const COLUMN_MISSING = '42703';
/** A missing migration is an installation problem, not an unrelated failure. */
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const code = (e as { code?: string } | null)?.code;
    if (code === MISSING_TABLE || code === COLUMN_MISSING)
      throw new Problem(
        503,
        'history_database_setup',
        'History tables are missing; run setup-database.cmd and restart the application.'
      );
    throw e;
  }
}

/** Only finalized, delivered pairs are history; an unhumanized candidate never is. */
export const finalizedTurns = (turns: readonly Turn[]): Turn[] =>
  turns.filter(
    (t) => t.status === TurnStatus.Completed && !t.undone && !t.editingPending && !!t.narrative
  );

type FragmentRow = {
  id: string;
  campaign_id: string;
  kind: HistoryFragmentKind;
  title: string;
  body: string;
  sources: SourceLocator[];
  parent_ids: string[];
  links: string[];
  derivation_digest: string;
  correction_digest: string;
  content_digest: string;
  selection_status: HistorySelectionStatus;
  created_at: Date;
};
const mapFragment = (r: FragmentRow): HistoryFragment => ({
  id: r.id,
  campaignId: r.campaign_id,
  kind: r.kind,
  title: r.title,
  text: r.body,
  sources: r.sources,
  parentIds: r.parent_ids,
  links: r.links,
  derivationDigest: r.derivation_digest,
  correctionDigest: r.correction_digest,
  contentDigest: r.content_digest,
  createdAt: new Date(r.created_at).toISOString(),
  selection: r.selection_status,
});

/** Persistence for immutable history sources and published derived fragments. */
export class HistoryStore {
  constructor(private store: Store) {}

  /** Insert missing source versions (idempotent by content hash) and return their locators. */
  captureVersions(client: PoolClient, campaignId: string, turns: readonly Turn[]) {
    return guarded(async () => {
      const versions = finalizedTurns(turns).map(turnVersionOf);
      for (const v of versions)
        await client.query(
          'INSERT INTO history_turn_versions(campaign_id,turn_id,content_hash,document) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
          [campaignId, v.turnId, v.contentHash, v.document]
        );
      return versions;
    });
  }

  /** Verified original documents by content hash; a corrupt or missing row is an explicit error. */
  versionDocuments(
    campaignId: string,
    locators: readonly SourceLocator[],
    client?: PoolClient
  ): Promise<Map<string, TurnVersionDocument>> {
    return guarded(async () => {
      const out = new Map<string, TurnVersionDocument>();
      if (!locators.length) return out;
      const r = await (client ?? this.store.pool).query(
        'SELECT turn_id,content_hash,document FROM history_turn_versions WHERE campaign_id=$1 AND (turn_id,content_hash) IN (SELECT t,h FROM unnest($2::uuid[],$3::text[]) AS x(t,h))',
        [campaignId, locators.map((l) => l.turnId), locators.map((l) => l.contentHash)]
      );
      for (const row of r.rows) {
        const doc = row.document as TurnVersionDocument;
        if (versionHashOf(doc) !== row.content_hash)
          throw new Problem(
            409,
            'history_source_corrupt',
            'A stored original history version no longer matches its hash'
          );
        out.set(row.content_hash, doc);
      }
      for (const l of locators)
        if (!out.has(l.contentHash))
          throw new Problem(
            409,
            'history_source_missing',
            'An original history version is missing'
          );
      return out;
    });
  }

  /** Publish immutable fragments; the caller owns the surrounding transaction. */
  publish(client: PoolClient, campaignId: string, payloads: HistoryFragmentPayload[]) {
    return guarded(async () => {
      const out: HistoryFragment[] = [];
      for (const p of payloads) {
        const id = randomUUID();
        const digest = fragmentDigest(p);
        const created = await client.query(
          'INSERT INTO history_fragments(id,campaign_id,kind,title,body,sources,parent_ids,links,derivation_digest,correction_digest,content_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING created_at',
          [
            id,
            campaignId,
            p.kind,
            p.title,
            p.text,
            JSON.stringify(p.sources),
            JSON.stringify(p.parentIds),
            JSON.stringify(p.links),
            p.derivationDigest,
            p.correctionDigest,
            digest,
          ]
        );
        out.push({
          ...p,
          id,
          campaignId,
          contentDigest: digest,
          createdAt: new Date(created.rows[0].created_at).toISOString(),
          selection: HistorySelectionStatus.Valid,
        });
      }
      return out;
    });
  }

  list(campaignId: string, client?: PoolClient, onlyValid = false): Promise<HistoryFragment[]> {
    return guarded(async () => {
      const r = await (client ?? this.store.pool).query(
        'SELECT * FROM history_fragments WHERE campaign_id=$1' +
          (onlyValid ? " AND selection_status='valid'" : '') +
          ' ORDER BY created_at,id',
        [campaignId]
      );
      return r.rows.map(mapFragment);
    });
  }

  byIds(campaignId: string, ids: readonly string[], client?: PoolClient) {
    return guarded(async () => {
      if (!ids.length) return [];
      const r = await (client ?? this.store.pool).query(
        'SELECT * FROM history_fragments WHERE campaign_id=$1 AND id=ANY($2::uuid[]) ORDER BY created_at,id',
        [campaignId, ids]
      );
      return r.rows.map(mapFragment);
    });
  }

  /** Make fragments sourced from these turns, and everything derived from them, unusable. */
  async invalidateTurns(client: PoolClient, campaignId: string, turnIds: readonly string[]) {
    if (!turnIds.length) return 0;
    let stale = 0;
    for (const turnId of turnIds) {
      const r = await client.query(
        "UPDATE history_fragments SET selection_status='stale' WHERE campaign_id=$1 AND selection_status='valid' AND sources @> $2::jsonb",
        [campaignId, JSON.stringify([{ turnId }])]
      );
      stale += r.rowCount ?? 0;
    }
    return stale + (await this.invalidateDescendants(client, campaignId));
  }

  /** A correction supersedes older derivations; every current fragment waits for a refresh. */
  async invalidateAll(client: PoolClient, campaignId: string) {
    const r = await client.query(
      "UPDATE history_fragments SET selection_status='stale' WHERE campaign_id=$1 AND selection_status='valid'",
      [campaignId]
    );
    return r.rowCount ?? 0;
  }

  private async invalidateDescendants(client: PoolClient, campaignId: string) {
    let total = 0;
    for (;;) {
      const r = await client.query(
        "UPDATE history_fragments f SET selection_status='stale' WHERE f.campaign_id=$1 AND f.selection_status='valid' AND EXISTS (SELECT 1 FROM history_fragments p WHERE p.campaign_id=f.campaign_id AND p.selection_status='stale' AND f.parent_ids @> to_jsonb(p.id::text))",
        [campaignId]
      );
      if (!r.rowCount) return total;
      total += r.rowCount;
    }
  }
}

export type HistoryToolInput = unknown;

/** Reads only the logical action's frozen corpus; text comes from immutable stored payloads. */
export class HistoryReader {
  private store: HistoryStore;
  private frozen: FrozenHistory;
  private corpus: Promise<HistoryFragment[]> | null = null;
  constructor(
    private db: Store,
    raw: FrozenHistory,
    private overlays: readonly TurnVersion[] = []
  ) {
    this.store = new HistoryStore(db);
    this.frozen = frozenHistorySchema.parse(raw) as FrozenHistory;
  }

  private load(): Promise<HistoryFragment[]> {
    this.corpus ??= (async () => {
      const rows = await this.store.byIds(
        this.frozen.campaignId,
        this.frozen.fragments.map((f) => f.id)
      );
      for (const f of this.frozen.fragments) {
        const row = rows.find((r) => r.id === f.id);
        if (!row || row.contentDigest !== f.contentDigest)
          throw new Problem(
            409,
            'history_source_changed',
            'A frozen history fragment is missing or changed'
          );
      }
      return rows;
    })();
    return this.corpus;
  }

  private async dates(fragments: HistoryFragment[]) {
    const hashes = new Map(this.frozen.turnVersions.map((v) => [v.turnId, v]));
    const wanted = [
      ...new Map(
        fragments.flatMap((f) => f.sources).map((s) => [s.turnId, hashes.get(s.turnId) ?? s])
      ).values(),
    ];
    const docs = await this.store.versionDocuments(this.frozen.campaignId, wanted);
    return new Map([...docs.values()].map((d) => [d.turnId, d.createdAt]));
  }

  async search(input: HistoryToolInput) {
    const args = originalHistorySearchSchema.parse(input);
    if (args.mode === 'originals') {
      const originals = await this.originalDocuments(this.frozen.turnVersions);
      const key = sha256(canonicalJson({ versions: this.frozen.turnVersions, query: args.query }));
      let offset = 0;
      if (args.cursor) {
        try {
          const cursor = JSON.parse(Buffer.from(args.cursor, 'base64url').toString('utf8'));
          if (cursor.key !== key || !Number.isInteger(cursor.offset) || cursor.offset < 0)
            throw Error();
          offset = cursor.offset;
        } catch {
          throw new Problem(
            422,
            'history_cursor',
            'Cursor does not belong to this frozen original search'
          );
        }
      }
      const words = termsOf(args.query);
      const selected = [...originals.values()].filter(
        (document) =>
          words.length === 0 ||
          words.some((word) =>
            `${document.player} ${document.gm}`.toLocaleLowerCase().includes(word)
          )
      );
      const items = selected
        .slice(offset, offset + HISTORY_DEFAULTS.searchPageSize)
        .map((document) => ({
          turnId: document.turnId,
          contentHash: versionHashOf(document),
          createdAt: document.createdAt,
          excerpt: `${document.player}\n${document.gm}`.slice(0, HISTORY_DEFAULTS.excerptChars),
        }));
      return {
        campaignId: this.frozen.campaignId,
        items,
        corpusTurns: originals.size,
        nextCursor:
          offset + items.length < selected.length
            ? Buffer.from(JSON.stringify({ key, offset: offset + items.length })).toString(
                'base64url'
              )
            : null,
      };
    }
    const corpus = await this.load();
    const page = searchFragments(corpus, this.frozen, new Map(), args);
    const shown = corpus.filter((f) => page.items.some((i) => i.id === f.id));
    const dates = await this.dates(shown);
    const words = termsOf(args.query);
    return {
      campaignId: this.frozen.campaignId,
      items: page.items.map((i) => {
        const f = shown.find((x) => x.id === i.id)!;
        return { ...fragmentSummary(f, dates, words), kind: i.kind };
      }),
      corpusFragments: corpus.length,
      corpusTurns: this.frozen.turnVersions.length,
      nextCursor: page.nextCursor,
    };
  }

  async get(input: HistoryToolInput) {
    const args = originalHistoryGetSchema.parse(input);
    if (args.turnId) {
      if (args.cursor)
        throw new Problem(
          422,
          'history_cursor',
          'Direct original lookup has no continuation cursor'
        );
      const locator = this.frozen.turnVersions.find((version) => version.turnId === args.turnId);
      if (!locator)
        throw new Problem(
          404,
          'history_not_found',
          'Original turn is outside this frozen campaign'
        );
      const originals = await this.originalDocuments([locator]);
      return {
        originals: [originals.get(locator.contentHash)!],
        sourceLocators: [locator],
        nextCursor: null,
        correctionGuidance: {
          instruction: CORRECTION_PROMPT_INSTRUCTION,
          items: this.frozen.correctionGuidance,
        },
      };
    }
    const corpus = await this.load();
    const fragment = corpus.find((f) => f.id === args.id);
    if (!fragment)
      throw new Problem(404, 'history_not_found', 'History is not in this frozen campaign');
    const dates = await this.dates([fragment]);
    const pageOf = args.includeOriginals
      ? pageOriginals(
          fragment.sources,
          await this.store.versionDocuments(this.frozen.campaignId, fragment.sources),
          this.frozen,
          { fragmentId: fragment.id, limit: args.limit, cursor: args.cursor }
        )
      : { originals: [], nextCursor: null };
    return {
      item: { ...fragmentSummary(fragment, dates, []), text: fragment.text },
      sourceLocators: fragment.sources,
      originals: pageOf.originals,
      nextCursor: pageOf.nextCursor,
      correctionGuidance: {
        instruction: CORRECTION_PROMPT_INSTRUCTION,
        items: this.frozen.correctionGuidance,
        sourceSuperseded:
          this.frozen.correctionGuidance.length > 0 &&
          fragment.correctionDigest !== correctionDigestOf(this.frozen.correctionGuidance),
      },
    };
  }
  private async originalDocuments(
    locators: readonly SourceLocator[]
  ): Promise<Map<string, TurnVersionDocument>> {
    const overlayHashes = new Set(this.overlays.map((version) => version.contentHash));
    const result = await this.store.versionDocuments(
      this.frozen.campaignId,
      locators.filter((locator) => !overlayHashes.has(locator.contentHash))
    );
    for (const overlay of this.overlays) {
      if (versionHashOf(overlay.document) !== overlay.contentHash)
        throw new Problem(
          409,
          'history_source_corrupt',
          'Staged original differs from its saved identity'
        );
      if (
        locators.some(
          (locator) =>
            locator.contentHash === overlay.contentHash && locator.turnId === overlay.turnId
        )
      )
        result.set(overlay.contentHash, overlay.document);
    }
    return result;
  }
}

export { turnVersionOf };
export type { TurnVersion };
