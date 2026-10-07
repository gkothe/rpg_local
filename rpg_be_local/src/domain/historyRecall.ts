import { z } from 'zod';
import { Problem } from '../errors.js';
import { canonicalJson, sha256 } from './journalLedger.js';
import type { CorrectionGuidance } from './journalCompatibility.js';

export const HISTORY_SEARCH_TOOL_NAME = 'campaign_history_search';
export const HISTORY_GET_TOOL_NAME = 'campaign_history_get';
export type HistoryTool = typeof HISTORY_SEARCH_TOOL_NAME | typeof HISTORY_GET_TOOL_NAME;

export enum HistoryFragmentKind {
  Section = 'section',
  Chapter = 'chapter',
  Overview = 'overview',
}
export enum HistorySelectionStatus {
  Valid = 'valid',
  Stale = 'stale',
}
/** Why a piece of history reached (or did not reach) the prompt. */
export enum HistoryReason {
  Overview = 'overview',
  Protected = 'protected',
  Relevant = 'relevant',
  Consolidated = 'consolidated',
  SearchableOnly = 'searchable_only',
}
export enum HistorySettingsAction {
  Disable = 'disable',
  ProtectKnowledge = 'protect_knowledge',
  ProtectSection = 'protect_section',
  ProtectMemory = 'protect_memory',
}
export const HISTORY_KIND_OPTIONS = [
  { id: HistoryFragmentKind.Section, label: 'Section' },
  { id: HistoryFragmentKind.Chapter, label: 'Chapter' },
  { id: HistoryFragmentKind.Overview, label: 'Overview' },
] as const;
export const HISTORY_REASON_OPTIONS = [
  { id: HistoryReason.Overview, label: 'Overview' },
  { id: HistoryReason.Protected, label: 'Protected' },
  { id: HistoryReason.Relevant, label: 'Relevant to this scene' },
  { id: HistoryReason.Consolidated, label: 'Covered by a summary' },
  { id: HistoryReason.SearchableOnly, label: 'Searchable only' },
] as const;

/** Soft retrieval/generation heuristics, never rejection, token or output limits. */
export const HISTORY_DEFAULTS = {
  turnsPerSection: 8,
  sectionsPerChapter: 4,
  overviewBytes: 4096,
  optionalHistoryBytes: 16384,
  optionalKnowledgeBytes: 8192,
  originalsPageSize: 4,
  originalsPageMax: 20,
  originalsTargetBytes: 16384,
  searchPageSize: 20,
  searchPageMax: 100,
  queryMaxChars: 200,
  cursorMaxChars: 4096,
  excerptChars: 240,
} as const;

const uuid = z.uuid();
const hash = z.string().regex(/^[0-9a-f]{64}$/);
export const sourceLocatorSchema = z.object({ turnId: uuid, contentHash: hash }).strict();
export type SourceLocator = z.infer<typeof sourceLocatorSchema>;

export const historySearchSchema = z
  .object({
    query: z.string().max(HISTORY_DEFAULTS.queryMaxChars),
    kind: z.enum(HistoryFragmentKind).optional(),
    cursor: z.string().max(HISTORY_DEFAULTS.cursorMaxChars).optional(),
  })
  .strict();
export const historyGetSchema = z
  .object({
    id: uuid,
    includeOriginals: z.boolean().optional(),
    limit: z.number().int().min(1).max(HISTORY_DEFAULTS.originalsPageMax).optional(),
    cursor: z.string().max(HISTORY_DEFAULTS.cursorMaxChars).optional(),
  })
  .strict();
export const historyListQuerySchema = z
  .object({
    query: z.string().trim().max(HISTORY_DEFAULTS.queryMaxChars).default(''),
    kind: z.enum(HistoryFragmentKind).optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(HISTORY_DEFAULTS.searchPageMax)
      .default(HISTORY_DEFAULTS.searchPageSize),
    cursor: z.string().max(HISTORY_DEFAULTS.cursorMaxChars).optional(),
  })
  .strict();
export const historyDetailQuerySchema = z
  .object({
    originals: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    limit: z.coerce.number().int().min(1).max(HISTORY_DEFAULTS.originalsPageMax).optional(),
    cursor: z.string().max(HISTORY_DEFAULTS.cursorMaxChars).optional(),
  })
  .strict();
export const historyProtectionSchema = z
  .object({ requestId: uuid, expected: z.boolean(), protected: z.boolean() })
  .strict();
export const historyDisableSchema = z
  .object({ requestId: uuid, enabled: z.literal(false), expectedEnabled: z.boolean() })
  .strict();

export type HistorySettings = {
  enabled: boolean;
  activeOverviewId: string | null;
  protectedKnowledgeIds: string[];
  protectedSectionIds: string[];
  protectedMemoryIds: string[];
};
export const DEFAULT_HISTORY_SETTINGS: HistorySettings = {
  enabled: false,
  activeOverviewId: null,
  protectedKnowledgeIds: [],
  protectedSectionIds: [],
  protectedMemoryIds: [],
};
export const historySettingsSchema = z
  .object({
    enabled: z.boolean(),
    activeOverviewId: uuid.nullable(),
    protectedKnowledgeIds: z.array(uuid),
    protectedSectionIds: z.array(uuid),
    protectedMemoryIds: z.array(uuid),
  })
  .strict();
export const historySettingsOf = (c: { historyRecall?: HistorySettings }): HistorySettings =>
  c.historyRecall ?? DEFAULT_HISTORY_SETTINGS;

export type TurnVersionDocument = {
  turnId: string;
  player: string;
  gm: string;
  createdAt: string;
  dice?: unknown[];
  interpretations?: unknown[];
};
export type TurnVersion = SourceLocator & { document: TurnVersionDocument };
/** Complete projected source of one finalized pair, including delivered dice evidence. */
export function turnVersionOf(turn: {
  id: string;
  action: string;
  narrative: string | null;
  createdAt: string;
  rolls?: { id: string; reason: string; declaration: string; groups: unknown }[];
  rollInterpretations?: unknown[];
}): TurnVersion {
  const document: TurnVersionDocument = {
    turnId: turn.id,
    player: turn.action,
    gm: turn.narrative ?? '',
    createdAt: turn.createdAt,
    ...((turn.rolls?.length ?? 0) > 0
      ? {
          dice: turn.rolls!.map((roll) => ({
            id: roll.id,
            reason: roll.reason,
            declaration: roll.declaration,
            groups: roll.groups,
          })),
          interpretations: turn.rollInterpretations ?? [],
        }
      : {}),
  };
  return { turnId: turn.id, contentHash: sha256(canonicalJson(document)), document };
}
export const versionHashOf = (document: TurnVersionDocument) => sha256(canonicalJson(document));

export type HistoryFragmentPayload = {
  kind: HistoryFragmentKind;
  title: string;
  text: string;
  sources: SourceLocator[];
  parentIds: string[];
  derivationDigest: string;
  correctionDigest: string;
  links: string[];
};
export type HistoryFragment = HistoryFragmentPayload & {
  id: string;
  campaignId: string;
  contentDigest: string;
  createdAt: string;
  selection: HistorySelectionStatus;
};
export const fragmentDigest = (p: HistoryFragmentPayload): string =>
  sha256(
    canonicalJson({
      kind: p.kind,
      title: p.title,
      text: p.text,
      sources: p.sources,
      parentIds: p.parentIds,
      derivationDigest: p.derivationDigest,
      correctionDigest: p.correctionDigest,
      links: p.links,
    })
  );
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
/** Independent of entity IDs, so an imported archive keeps the same digest after remapping. */
export const correctionDigestOf = (items: readonly CorrectionGuidance[]): string =>
  sha256(canonicalJson(items).replace(UUID_PATTERN, '<id>'));

export type FrozenHistory = {
  campaignId: string;
  mode: 'compact';
  turnVersions: SourceLocator[];
  fragments: { id: string; contentDigest: string }[];
  correctionGuidance: CorrectionGuidance[];
  protectedLocators: { kind: 'knowledge' | 'section' | 'memory'; id: string }[];
  selectionDiagnostics: HistoryDiagnostics;
};
export const frozenHistorySchema = z
  .object({
    campaignId: uuid,
    mode: z.literal('compact'),
    turnVersions: z.array(sourceLocatorSchema),
    fragments: z.array(z.object({ id: uuid, contentDigest: hash }).strict()),
    correctionGuidance: z.array(z.custom<CorrectionGuidance>()),
    protectedLocators: z.array(
      z.object({ kind: z.enum(['knowledge', 'section', 'memory']), id: uuid }).strict()
    ),
    selectionDiagnostics: z.custom<HistoryDiagnostics>(),
  })
  .strict();

export type HistoryDiagnostics = {
  targetBytes: number;
  suppliedBytes: number;
  mandatoryBytes: number;
  overflowBytes: number;
  included: { id: string; reason: HistoryReason }[];
  omitted: { count: number; reasonCounts: Partial<Record<HistoryReason, number>> };
};

// ---------------------------------------------------------------------------
// Ranking and search (pure; operate on the frozen corpus only)
// ---------------------------------------------------------------------------

const STOP = new Set(
  'a an the and or of to in on at is are was were be for with from that this it i you my me have has had will would could'.split(
    ' '
  )
);
export const termsOf = (text: string): string[] =>
  (text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
    (w) => w.length > 2 && !STOP.has(w)
  );
export function fragmentScore(f: Pick<HistoryFragment, 'title' | 'text'>, words: string[]): number {
  if (!words.length) return 0;
  const title = f.title.toLocaleLowerCase();
  const text = f.text.toLocaleLowerCase();
  return words.reduce((n, w) => n + (title.includes(w) ? 3 : text.includes(w) ? 1 : 0), 0);
}
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
export const compareFragments = (a: HistoryFragment, b: HistoryFragment) =>
  a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

function excerptOf(text: string, words: string[]): string {
  const lower = text.toLocaleLowerCase();
  const hit =
    words
      .map((w) => lower.indexOf(w))
      .filter((i) => i >= 0)
      .sort((x, y) => x - y)[0] ?? 0;
  const start = Math.max(0, hit - 60);
  const slice = text.slice(start, start + HISTORY_DEFAULTS.excerptChars);
  return `${start > 0 ? '…' : ''}${slice}${start + HISTORY_DEFAULTS.excerptChars < text.length ? '…' : ''}`;
}

export type FragmentSummary = {
  id: string;
  title: string;
  kind: HistoryFragmentKind;
  sourceTurnIds: string[];
  startAt: string | null;
  endAt: string | null;
  excerpt: string;
  contentDigest: string;
};
export function fragmentSummary(
  f: HistoryFragment,
  dates: Map<string, string>,
  words: string[]
): FragmentSummary {
  const times = f.sources
    .map((s) => dates.get(s.turnId))
    .filter((x): x is string => !!x)
    .sort();
  return {
    id: f.id,
    title: f.title,
    kind: f.kind,
    sourceTurnIds: f.sources.map((s) => s.turnId),
    startAt: times[0] ?? null,
    endAt: times.at(-1) ?? null,
    excerpt: excerptOf(f.text, words),
    contentDigest: f.contentDigest,
  };
}

type CursorBody = { key: string; offset: number };
const encodeCursor = (c: CursorBody) => Buffer.from(JSON.stringify(c)).toString('base64url');
export function decodeCursor(cursor: string | undefined, key: string): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as CursorBody;
    if (parsed.key !== key || !Number.isInteger(parsed.offset) || parsed.offset < 0) throw Error();
    return parsed.offset;
  } catch {
    throw new Problem(422, 'history_cursor', 'Cursor does not belong to this history request');
  }
}
/** Digest-bound identity of a frozen corpus plus the request that pages over it. */
export const corpusKey = (
  frozen: Pick<FrozenHistory, 'fragments' | 'turnVersions'>,
  request: Record<string, unknown>
): string =>
  sha256(canonicalJson({ fragments: frozen.fragments, turns: frozen.turnVersions, request }));

/** Stable chronological listing for an empty query, relevance order otherwise. */
export function searchFragments(
  corpus: HistoryFragment[],
  frozen: Pick<FrozenHistory, 'fragments' | 'turnVersions'>,
  dates: Map<string, string>,
  args: { query: string; kind?: HistoryFragmentKind; cursor?: string; limit?: number }
) {
  const limit = args.limit ?? HISTORY_DEFAULTS.searchPageSize;
  const key = corpusKey(frozen, { query: args.query, kind: args.kind ?? null, limit });
  const offset = decodeCursor(args.cursor, key);
  const words = termsOf(args.query);
  const matches = corpus
    .filter((f) => !args.kind || f.kind === args.kind)
    .map((f) => ({ f, score: fragmentScore(f, words) }))
    .filter((x) => !words.length || x.score > 0)
    .sort((a, b) => b.score - a.score || compareFragments(a.f, b.f));
  const page = matches.slice(offset, offset + limit);
  return {
    items: page.map((x) => fragmentSummary(x.f, dates, words)),
    nextCursor:
      offset + limit < matches.length ? encodeCursor({ key, offset: offset + limit }) : null,
  };
}

/** Complete original pairs from `sources`; one oversized pair is returned whole. */
export function pageOriginals(
  sources: SourceLocator[],
  versions: Map<string, TurnVersionDocument>,
  frozen: Pick<FrozenHistory, 'fragments' | 'turnVersions'>,
  args: { fragmentId: string; limit?: number; cursor?: string }
) {
  const limit = args.limit ?? HISTORY_DEFAULTS.originalsPageSize;
  const key = corpusKey(frozen, { fragmentId: args.fragmentId, limit, originals: true });
  let offset = decodeCursor(args.cursor, key);
  const originals: { turnId: string; player: string; gm: string; createdAt: string }[] = [];
  let used = 0;
  while (offset < sources.length && originals.length < limit) {
    const doc = versions.get(sources[offset]!.contentHash);
    if (!doc)
      throw new Problem(409, 'history_source_missing', 'An original history version is missing');
    const item = { turnId: doc.turnId, player: doc.player, gm: doc.gm, createdAt: doc.createdAt };
    const size = bytes(item);
    if (originals.length && used + size > HISTORY_DEFAULTS.originalsTargetBytes) break;
    originals.push(item);
    used += size;
    offset++;
  }
  return {
    originals,
    nextCursor: offset < sources.length ? encodeCursor({ key, offset }) : null,
  };
}

// ---------------------------------------------------------------------------
// Prompt selection
// ---------------------------------------------------------------------------

export type SelectedHistory = {
  overview: { id: string; title: string; text: string } | null;
  protectedItems: { id: string; kind: HistoryFragmentKind; title: string; text: string }[];
  relevant: { id: string; kind: HistoryFragmentKind; title: string; text: string }[];
  diagnostics: HistoryDiagnostics;
};

/**
 * Overview, then protected sections (mandatory), then relevant sections by lexical score, then
 * chapter orientation that no included section already covers. Whole items only; protected
 * material may exceed the soft target and the overflow is reported.
 */
export function selectHistory(
  corpus: HistoryFragment[],
  settings: HistorySettings,
  query: string,
  targetBytes: number = HISTORY_DEFAULTS.optionalHistoryBytes
): SelectedHistory {
  const valid = corpus.filter((f) => f.selection === HistorySelectionStatus.Valid);
  const overview = valid.find((f) => f.id === settings.activeOverviewId) ?? null;
  const item = (f: HistoryFragment) => ({ id: f.id, kind: f.kind, title: f.title, text: f.text });
  const included: { id: string; reason: HistoryReason }[] = [];
  const reasonCounts: Partial<Record<HistoryReason, number>> = {};
  const note = (reason: HistoryReason) => (reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1);
  const covered = new Set<string>();
  const protectedItems = corpus
    .filter((f) => settings.protectedSectionIds.includes(f.id))
    .sort(compareFragments)
    .map((f) => {
      included.push({ id: f.id, reason: HistoryReason.Protected });
      f.sources.forEach((s) => covered.add(s.turnId));
      return item(f);
    });
  const mandatoryBytes = bytes({
    overview: overview ? item(overview) : null,
    protectedItems,
  });
  if (overview) included.push({ id: overview.id, reason: HistoryReason.Overview });
  const words = termsOf(query);
  const pool = valid
    .filter(
      (f) => f.kind !== HistoryFragmentKind.Overview && !settings.protectedSectionIds.includes(f.id)
    )
    .map((f) => ({ f, score: fragmentScore(f, words) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || compareFragments(a.f, b.f));
  const relevant: SelectedHistory['relevant'] = [];
  let used = mandatoryBytes;
  // Detailed sections first so overlapping chapter excerpts are dropped, not the other way round.
  for (const kind of [HistoryFragmentKind.Section, HistoryFragmentKind.Chapter]) {
    for (const { f } of pool.filter((x) => x.f.kind === kind)) {
      if (f.sources.length && f.sources.every((s) => covered.has(s.turnId))) continue;
      const size = bytes(item(f));
      if (used + size > targetBytes) {
        note(HistoryReason.SearchableOnly);
        continue;
      }
      used += size;
      relevant.push(item(f));
      included.push({ id: f.id, reason: HistoryReason.Relevant });
      f.sources.forEach((s) => covered.add(s.turnId));
    }
  }
  const unselected = valid.filter(
    (f) => f.kind !== HistoryFragmentKind.Overview && !included.some((i) => i.id === f.id)
  );
  const consolidated = unselected.filter(
    (f) => f.sources.length && f.sources.every((s) => covered.has(s.turnId))
  ).length;
  if (consolidated) reasonCounts[HistoryReason.Consolidated] = consolidated;
  const searchable =
    unselected.length - consolidated - (reasonCounts[HistoryReason.SearchableOnly] ?? 0);
  if (searchable > 0)
    reasonCounts[HistoryReason.SearchableOnly] =
      (reasonCounts[HistoryReason.SearchableOnly] ?? 0) + searchable;
  const suppliedBytes = used;
  return {
    overview: overview ? { id: overview.id, title: overview.title, text: overview.text } : null,
    protectedItems,
    relevant,
    diagnostics: {
      targetBytes,
      suppliedBytes,
      mandatoryBytes,
      overflowBytes: Math.max(0, suppliedBytes - targetBytes),
      included,
      omitted: {
        count: Object.values(reasonCounts).reduce((n, v) => n + (v ?? 0), 0),
        reasonCounts,
      },
    },
  };
}

export const historyVersionArchiveSchema = z
  .object({
    turnId: uuid,
    contentHash: hash,
    document: z
      .object({
        turnId: uuid,
        player: z.string(),
        gm: z.string(),
        createdAt: z.string(),
        dice: z.array(z.unknown()).optional(),
        interpretations: z.array(z.unknown()).optional(),
      })
      .strict(),
  })
  .strict();
export const historyFragmentArchiveSchema = z
  .object({
    id: uuid,
    kind: z.enum(HistoryFragmentKind),
    title: z.string().min(1),
    text: z.string().min(1),
    sources: z.array(sourceLocatorSchema),
    parentIds: z.array(uuid),
    links: z.array(uuid),
    derivationDigest: hash,
    correctionDigest: hash,
    contentDigest: hash,
    selection: z.enum(HistorySelectionStatus),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type HistoryVersionArchive = z.infer<typeof historyVersionArchiveSchema>;
export type HistoryFragmentArchive = z.infer<typeof historyFragmentArchiveSchema>;
/** Derivation identity from an already-computed correction digest (used after an import remap). */
export const derivationDigestOf = (
  kind: HistoryFragmentKind,
  sources: readonly SourceLocator[],
  correctionDigest: string,
  instruction: string
): string => sha256(canonicalJson({ kind, sources, corrections: correctionDigest, instruction }));
