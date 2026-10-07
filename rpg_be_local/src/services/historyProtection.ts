import type { PoolClient } from 'pg';
import { Problem } from '../errors.js';
import {
  DEFAULT_HISTORY_SETTINGS,
  HISTORY_DEFAULTS,
  HISTORY_KIND_OPTIONS,
  HISTORY_REASON_OPTIONS,
  HistoryFragmentKind,
  HistorySelectionStatus,
  HistorySettingsAction,
  compareFragments,
  decodeCursor,
  corpusKey,
  fragmentScore,
  fragmentSummary,
  historySettingsOf,
  pageOriginals,
  selectHistory,
  termsOf,
  type HistoryDiagnostics,
  type HistoryFragment,
  type HistorySettings,
} from '../domain/historyRecall.js';
import { canonicalJson, sha256 } from '../domain/journalLedger.js';
import {
  CORRECTION_PROMPT_INSTRUCTION,
  correctionGuidance,
} from '../domain/journalCompatibility.js';
import { publicKnowledge } from '../domain/playerProjection.js';
import { RECENT_GAMEPLAY_TURN_COUNT } from '../domain/context.js';
import type { Campaign, Memory } from '../domain/types.js';
import type { Store } from '../store.js';
import { HistoryStore, finalizedTurns } from './historyStore.js';

export type HistoryStatus = HistorySettings & {
  coveredTurns: number;
  totalTurns: number;
  searchableSections: number;
  pendingRefresh: boolean;
  /** Pinned items that can no longer be supplied (superseded checkpoint, unavailable source). */
  unavailableProtectedIds: string[];
  diagnostics: HistoryDiagnostics;
};
export type HistoryReceiptResult = { status: HistoryStatus };

const identityOf = (value: unknown) => sha256(canonicalJson(value));
const reused = () =>
  new Problem(
    409,
    'history_request_reused',
    'Request ID was already used with different input; generate a new ID'
  );

/** Public history browsing plus reversible, idempotent pins and the disable switch. */
export class HistoryRecallService {
  private history: HistoryStore;
  constructor(private store: Store) {
    this.history = new HistoryStore(store);
  }

  // ---------------------------------------------------------------- reads

  async status(campaignId: string, client?: PoolClient): Promise<HistoryStatus> {
    const c = await this.store.campaign(campaignId, client);
    const settings = historySettingsOf(c);
    const turns = finalizedTurns(await this.store.activeTurns(campaignId, client));
    const fragments = await this.history.list(campaignId, client);
    const valid = fragments.filter((f) => f.selection === HistorySelectionStatus.Valid);
    const sections = valid.filter((f) => f.kind === HistoryFragmentKind.Section);
    const covered = new Set(sections.flatMap((f) => f.sources.map((s) => s.turnId)));
    const older = turns.slice(0, Math.max(0, turns.length - RECENT_GAMEPLAY_TURN_COUNT));
    const overview = valid.find((f) => f.id === settings.activeOverviewId);
    const memoryIds = new Set(
      (await this.memories(campaignId, settings.protectedMemoryIds, client)).map((m) => m.id)
    );
    const unavailable = [
      ...settings.protectedMemoryIds.filter((id) => !memoryIds.has(id)),
      ...settings.protectedSectionIds.filter(
        (id) => !fragments.some((f) => f.id === id && f.selection === HistorySelectionStatus.Valid)
      ),
    ];
    return {
      ...settings,
      coveredTurns: turns.filter((t) => covered.has(t.id)).length,
      totalTurns: turns.length,
      searchableSections: sections.length,
      pendingRefresh: settings.enabled && (!overview || older.some((t) => !covered.has(t.id))),
      unavailableProtectedIds: unavailable,
      diagnostics: selectHistory(valid, settings, '').diagnostics,
    };
  }

  options() {
    return {
      kindOptions: HISTORY_KIND_OPTIONS,
      reasonOptions: HISTORY_REASON_OPTIONS,
      limits: {
        pageSizeDefault: HISTORY_DEFAULTS.searchPageSize,
        pageSizeMax: HISTORY_DEFAULTS.searchPageMax,
        originalsPageSize: HISTORY_DEFAULTS.originalsPageSize,
        originalsPageMax: HISTORY_DEFAULTS.originalsPageMax,
        queryMaxChars: HISTORY_DEFAULTS.queryMaxChars,
      },
      defaults: {
        turnsPerSection: HISTORY_DEFAULTS.turnsPerSection,
        sectionsPerChapter: HISTORY_DEFAULTS.sectionsPerChapter,
        overviewBytes: HISTORY_DEFAULTS.overviewBytes,
        optionalHistoryBytes: HISTORY_DEFAULTS.optionalHistoryBytes,
        optionalKnowledgeBytes: HISTORY_DEFAULTS.optionalKnowledgeBytes,
      },
    };
  }

  async list(
    campaignId: string,
    query: { query: string; kind?: HistoryFragmentKind; limit: number; cursor?: string }
  ) {
    const c = await this.store.campaign(campaignId);
    const settings = historySettingsOf(c);
    const fragments = (await this.history.list(campaignId)).filter(
      (f) => f.selection === HistorySelectionStatus.Valid
    );
    const turns = new Map(
      (await this.store.activeTurns(campaignId)).map((t) => [t.id, t.createdAt] as const)
    );
    const key = corpusKey(
      {
        fragments: fragments.map((f) => ({ id: f.id, contentDigest: f.contentDigest })),
        turnVersions: [],
      },
      { query: query.query, kind: query.kind ?? null, limit: query.limit }
    );
    const offset = decodeCursor(query.cursor, key);
    const words = termsOf(query.query);
    const matches = fragments
      .filter((f) => !query.kind || f.kind === query.kind)
      .map((f) => ({ f, score: fragmentScore(f, words) }))
      .filter((x) => !words.length || x.score > 0)
      .sort((a, b) => b.score - a.score || compareFragments(a.f, b.f));
    const page = matches.slice(offset, offset + query.limit);
    return {
      items: page.map(({ f }) => ({
        id: f.id,
        title: f.title,
        kind: f.kind,
        sourceTurnIds: f.sources.map((s) => s.turnId),
        ...(({ startAt, endAt, excerpt }) => ({ startAt, endAt, excerpt }))(
          fragmentSummary(f, turns, words)
        ),
        protected: settings.protectedSectionIds.includes(f.id),
        available: f.sources.every((s) => turns.has(s.turnId)),
      })),
      nextCursor:
        offset + query.limit < matches.length
          ? Buffer.from(JSON.stringify({ key, offset: offset + query.limit })).toString('base64url')
          : null,
    };
  }

  async detail(
    campaignId: string,
    fragmentId: string,
    query: { originals: boolean; limit?: number; cursor?: string }
  ) {
    const c = await this.store.campaign(campaignId);
    const settings = historySettingsOf(c);
    const [fragment] = await this.history.byIds(campaignId, [fragmentId]);
    if (!fragment) throw new Problem(404, 'history_not_found', 'History item not found');
    const turns = new Map(
      (await this.store.activeTurns(campaignId)).map((t) => [t.id, t.createdAt] as const)
    );
    const docs = query.originals
      ? await this.history.versionDocuments(campaignId, fragment.sources)
      : new Map();
    const paged = query.originals
      ? pageOriginals(
          fragment.sources,
          docs,
          { fragments: [], turnVersions: [] },
          {
            fragmentId,
            limit: query.limit,
            cursor: query.cursor,
          }
        )
      : { originals: [], nextCursor: null };
    const items = correctionGuidance(c);
    return {
      item: {
        id: fragment.id,
        title: fragment.title,
        kind: fragment.kind,
        text: fragment.text,
        sourceTurnIds: fragment.sources.map((s) => s.turnId),
        protected: settings.protectedSectionIds.includes(fragment.id),
        available: fragment.sources.every((s) => turns.has(s.turnId)),
        stale: fragment.selection === HistorySelectionStatus.Stale,
      },
      sourceLocators: fragment.sources,
      originals: paged.originals,
      nextCursor: paged.nextCursor,
      correctionGuidance: { instruction: CORRECTION_PROMPT_INSTRUCTION, items },
    };
  }

  private async memories(campaignId: string, ids: readonly string[], client?: PoolClient) {
    if (!ids.length) return [];
    const r = await (client ?? this.store.pool).query(
      'SELECT document FROM memories WHERE campaign_id=$1 AND id=ANY($2::uuid[])',
      [campaignId, ids]
    );
    return r.rows.map((row) => row.document as Memory).filter((m) => m.valid);
  }

  // ---------------------------------------------------------------- mutations

  /** One locked transaction: receipt replay, expected-flag check, change and receipt together. */
  private async mutate(
    campaignId: string,
    requestId: string,
    action: HistorySettingsAction,
    payload: Record<string, unknown>,
    change: (c: Campaign, settings: HistorySettings, client: PoolClient) => Promise<void>
  ): Promise<HistoryReceiptResult> {
    const identity = identityOf({ action, ...payload });
    return this.store.transaction(async (client) => {
      const c = await this.store.campaign(campaignId, client, true);
      const prior = await client.query(
        'SELECT identity_digest,result FROM history_setting_requests WHERE campaign_id=$1 AND request_id=$2',
        [campaignId, requestId]
      );
      if (prior.rows[0]) {
        if (prior.rows[0].identity_digest !== identity) throw reused();
        return prior.rows[0].result as HistoryReceiptResult;
      }
      const settings = structuredClone(historySettingsOf(c) ?? DEFAULT_HISTORY_SETTINGS);
      await change(c, settings, client);
      c.historyRecall = settings;
      c.revision++;
      await this.store.save(c, client);
      const result: HistoryReceiptResult = { status: await this.status(campaignId, client) };
      await client.query(
        'INSERT INTO history_setting_requests(campaign_id,request_id,action,identity_digest,result) VALUES($1,$2,$3,$4,$5)',
        [campaignId, requestId, action, identity, JSON.stringify(result)]
      );
      return result;
    });
  }

  private toggle(list: string[], id: string, expected: boolean, wanted: boolean) {
    if (list.includes(id) !== expected)
      throw new Problem(
        409,
        'history_changed',
        'The protection changed since you loaded it; review the current state'
      );
    const next = list.filter((x) => x !== id);
    if (wanted) next.push(id);
    return next;
  }

  protectKnowledge(
    campaignId: string,
    knowledgeId: string,
    input: { requestId: string; expected: boolean; protected: boolean }
  ) {
    return this.mutate(
      campaignId,
      input.requestId,
      HistorySettingsAction.ProtectKnowledge,
      { knowledgeId, expected: input.expected, protected: input.protected },
      async (c, s) => {
        // Only public records can be pinned; a hidden record must not reveal itself.
        if (
          input.protected &&
          !publicKnowledge(c.knowledge ?? []).some((r) => r.id === knowledgeId)
        )
          throw new Problem(404, 'history_not_found', 'Knowledge record not found');
        s.protectedKnowledgeIds = this.toggle(
          s.protectedKnowledgeIds,
          knowledgeId,
          input.expected,
          input.protected
        );
      }
    );
  }

  protectSection(
    campaignId: string,
    sectionId: string,
    input: { requestId: string; expected: boolean; protected: boolean }
  ) {
    return this.mutate(
      campaignId,
      input.requestId,
      HistorySettingsAction.ProtectSection,
      { sectionId, expected: input.expected, protected: input.protected },
      async (c, s, client) => {
        if (input.protected) {
          const [fragment] = await this.history.byIds(campaignId, [sectionId], client);
          if (!fragment || fragment.kind !== HistoryFragmentKind.Section)
            throw new Problem(404, 'history_not_found', 'History section not found');
        }
        s.protectedSectionIds = this.toggle(
          s.protectedSectionIds,
          sectionId,
          input.expected,
          input.protected
        );
        void c;
      }
    );
  }

  protectMemory(
    campaignId: string,
    memoryId: string,
    input: { requestId: string; expected: boolean; protected: boolean }
  ) {
    return this.mutate(
      campaignId,
      input.requestId,
      HistorySettingsAction.ProtectMemory,
      { memoryId, expected: input.expected, protected: input.protected },
      async (_c, s, client) => {
        if (input.protected && !(await this.memories(campaignId, [memoryId], client)).length)
          throw new Problem(404, 'history_not_found', 'Reviewed memory checkpoint not found');
        s.protectedMemoryIds = this.toggle(
          s.protectedMemoryIds,
          memoryId,
          input.expected,
          input.protected
        );
      }
    );
  }

  /** Settings can only be switched off; enabling goes through Prepare, Review and Activate. */
  disable(
    campaignId: string,
    input: { requestId: string; enabled: false; expectedEnabled: boolean }
  ) {
    return this.mutate(
      campaignId,
      input.requestId,
      HistorySettingsAction.Disable,
      { expectedEnabled: input.expectedEnabled },
      async (_c, s) => {
        if (s.enabled !== input.expectedEnabled)
          throw new Problem(409, 'history_changed', 'Selective history changed; review its state');
        s.enabled = false;
      }
    );
  }
}

export type { HistoryFragment };
