import { createHash } from 'node:crypto';
import { Problem } from '../errors.js';
import {
  KnowledgeCertainty,
  KnowledgeVisibility,
  KnowledgeKind,
  KnowledgeStatus,
  type CampaignKnowledge,
} from './knowledge.js';
import { publicKnowledge } from './playerProjection.js';
import {
  JOURNAL_CERTAINTY_LABELS,
  JOURNAL_FIELD_LABELS,
  JOURNAL_GROUP_OPTIONS,
  JOURNAL_LIMITS,
  JOURNAL_STATUS_LABELS,
  JournalEventKind,
  JournalGroup,
  journalGroupFor,
  type JournalConnection,
  type JournalEntry,
  type JournalEvidenceRef,
  type JournalHistoryChange,
  type JournalHistoryItem,
  type JournalListQuery,
  type JournalPage,
} from './journal.js';
import { ledgerLinks } from './journalChanges.js';
import type { Campaign, Character } from './types.js';

/** Stored before/after versions of one record from a turn snapshot (turn undone ones excluded). */
export type KnowledgeSnapshotVersion = {
  turnId: string;
  before: CampaignKnowledge | null;
  after: CampaignKnowledge;
};
type LedgerSource = Pick<Campaign, 'journal'>;
type NamedCharacter = Pick<Character, 'id' | 'name'>;

const PLACEHOLDER = /^.{1,200}\swas introduced\.?$/;
const ELLIPSIS = '…';

/** Cut at a word boundary within max characters; reports whether anything was removed. */
export function excerptText(text: string, max: number): { text: string; cut: boolean } {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return { text: flat, cut: false };
  const head = flat.slice(0, max - 1);
  const space = head.lastIndexOf(' ');
  return { text: (space > max / 2 ? head.slice(0, space) : head).trimEnd() + ELLIPSIS, cut: true };
}

function stringLeaves(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    if (value.trim()) out.push(value.trim());
  } else if (Array.isArray(value)) for (const v of value) stringLeaves(v, out);
  else if (value && typeof value === 'object')
    for (const v of Object.values(value)) stringLeaves(v, out);
  return out;
}

/** Visible entries only: hidden records and the player's own beliefs never enter the Journal. */
export function journalSources(records: readonly CampaignKnowledge[]): CampaignKnowledge[] {
  return publicKnowledge(records).filter((r) => r.certainty !== KnowledgeCertainty.Belief);
}

function overviewFor(
  record: CampaignKnowledge,
  characters: readonly Character[]
): { text: string; cut: boolean } {
  const past = record.status !== KnowledgeStatus.Active;
  const limit = past ? JOURNAL_LIMITS.pastExcerptMaxChars : JOURNAL_LIMITS.overviewMaxChars;
  let text = record.text;
  if (!past && record.kind === KnowledgeKind.Npc && PLACEHOLDER.test(record.text.trim())) {
    // Placeholder introductions gain the public description of the linked character only.
    const linked = characters.find((c) => record.characterIds.includes(c.id));
    const description = linked ? stringLeaves(linked.description).join('. ') : '';
    if (description) text = `${record.text.trim()} Character information: ${description}`;
  }
  return excerptText(text, limit);
}

/** Explicit shared characters plus ledger-supported links, limited to public records. */
function connectionsFor(
  record: CampaignKnowledge,
  all: readonly CampaignKnowledge[],
  links: ReadonlyMap<string, readonly string[]>
): JournalConnection[] {
  const ids = new Set(record.characterIds);
  const ledgerOut = new Set(links.get(record.id) ?? []);
  return all
    .filter(
      (o) =>
        o.id !== record.id &&
        (o.characterIds.some((c) => ids.has(c)) ||
          ledgerOut.has(o.id) ||
          (links.get(o.id) ?? []).includes(record.id))
    )
    .slice(0, JOURNAL_LIMITS.connectionsMax)
    .map((o) => ({ id: o.id, title: o.title, group: journalGroupFor(o.kind) }));
}

export function toEntry(
  record: CampaignKnowledge,
  all: readonly CampaignKnowledge[],
  characters: readonly Character[],
  links: ReadonlyMap<string, readonly string[]> = new Map()
): JournalEntry {
  const overview = overviewFor(record, characters);
  return {
    id: record.id,
    title: record.title,
    kind: record.kind,
    group: journalGroupFor(record.kind),
    status: record.status,
    statusLabel: JOURNAL_STATUS_LABELS[record.status],
    certainty: record.certainty,
    certaintyLabel: JOURNAL_CERTAINTY_LABELS[record.certainty as 'established' | 'rumor'],
    overview: overview.text,
    excerpt: overview.cut,
    updatedAt: record.updatedAt,
    connections: connectionsFor(record, all, links),
  };
}

const digest = (parts: unknown): string =>
  createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16);

function encodeCursor(offset: number, view: string): string {
  return Buffer.from(JSON.stringify({ o: offset, v: view })).toString('base64url');
}
function decodeCursor(cursor: string, view: string): number {
  let parsed: { o?: unknown; v?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new Problem(422, 'journal_invalid', 'Journal cursor is malformed');
  }
  if (typeof parsed.o !== 'number' || !Number.isInteger(parsed.o) || parsed.o < 0)
    throw new Problem(422, 'journal_invalid', 'Journal cursor is malformed');
  if (parsed.v !== view)
    throw new Problem(409, 'journal_changed', 'Journal changed; restart from the first page');
  return parsed.o;
}

export function listEntries(
  records: readonly CampaignKnowledge[],
  characters: readonly Character[],
  q: JournalListQuery,
  ledger: LedgerSource = {}
): JournalPage {
  const visible = journalSources(records);
  const links = ledgerLinks(ledger);
  const needle = q.query.toLocaleLowerCase();
  const entries = visible
    .filter((r) => q.includePast || r.status === KnowledgeStatus.Active)
    .map((r) => toEntry(r, visible, characters, links))
    .filter(
      (e) =>
        !needle ||
        [e.title, e.overview, ...e.connections.map((c) => c.title)].some((s) =>
          s.toLocaleLowerCase().includes(needle)
        )
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  const view = digest([q.query, q.includePast, entries.map((e) => [e.id, e.updatedAt])]);
  const offset = q.cursor ? decodeCursor(q.cursor, view) : 0;
  const counts = Object.fromEntries(Object.values(JournalGroup).map((g) => [g, 0])) as Record<
    JournalGroup,
    number
  >;
  for (const e of entries) counts[e.group]++;
  const page = entries.slice(offset, offset + q.limit);
  return {
    entries: page,
    counts,
    groups: JOURNAL_GROUP_OPTIONS.map((g) => ({ ...g, count: counts[g.id] })),
    total: entries.length,
    nextCursor: offset + q.limit < entries.length ? encodeCursor(offset + q.limit, view) : null,
  };
}

/** Active transcript evidence cited by the ledger for one record. */
function ledgerTurnIds(record: CampaignKnowledge, ledger: LedgerSource): string[] {
  const undone = new Set(ledger.journal?.undoneTurnIds ?? []);
  const ids: string[] = [];
  for (const event of ledger.journal?.events ?? []) {
    if (event.kind === JournalEventKind.Backfill)
      for (const x of event.contributions)
        if (x.knowledgeId === record.id && !undone.has(x.turnId))
          ids.push(...x.evidence.map((e) => e.turnId));
    if (event.kind === JournalEventKind.Correction && event.knowledgeId === record.id)
      ids.push(...event.evidence.map((e) => e.turnId));
  }
  return ids;
}

export function evidenceRefs(
  record: CampaignKnowledge,
  ledger: LedgerSource = {}
): JournalEvidenceRef[] {
  const refs: JournalEvidenceRef[] = [];
  const seen = new Set<string>();
  const turnIds = [
    record.createdTurnId,
    ...record.attributions.map((a) => a.turnId),
    ...ledgerTurnIds(record, ledger),
  ];
  for (const turnId of turnIds) {
    if (!turnId || seen.has(turnId)) continue;
    seen.add(turnId);
    refs.push({
      id: `turn-${turnId}`,
      kind: 'turn',
      label: 'Conversation',
      turnId,
      available: true,
    });
  }
  record.evidence.forEach((e, i) =>
    refs.push(
      e.type === 'map_asset'
        ? {
            id: `evidence-${i}`,
            kind: 'map_asset',
            label: 'Map observation (private source)',
            available: false,
          }
        : e.type === 'campaign_source'
          ? {
              id: `evidence-${i}`,
              kind: 'campaign_source',
              label: `${e.sourceName} (version ${e.version})`,
              available: true,
            }
          : { id: `evidence-${i}`, kind: 'book', label: 'Rule book excerpt', available: true }
    )
  );
  return refs;
}

const HISTORY_FIELDS = [
  'kind',
  'title',
  'text',
  'certainty',
  'status',
  'characterIds',
  'holderId',
] as const;

function shown(
  field: (typeof HISTORY_FIELDS)[number],
  value: unknown,
  characters: readonly NamedCharacter[]
): string | null {
  const name = (id: unknown) => characters.find((c) => c.id === id)?.name ?? 'an unknown character';
  if (value === null || value === undefined) return null;
  if (field === 'characterIds') return (value as string[]).map(name).join(', ') || null;
  if (field === 'holderId') return name(value);
  return String(value);
}

export function diffVersions(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
  characters: readonly NamedCharacter[],
  only?: readonly string[]
): JournalHistoryChange[] {
  const changes: JournalHistoryChange[] = [];
  for (const field of HISTORY_FIELDS) {
    if (only && !only.includes(field)) continue;
    const a = shown(field, after[field], characters);
    const b = before ? shown(field, before[field], characters) : null;
    if (before && a === b) continue;
    if (!before) continue;
    changes.push({ field, label: JOURNAL_FIELD_LABELS[field], before: b, after: a });
  }
  return changes;
}

/**
 * Field history from stored turn snapshots (each version projected independently, so a hidden
 * version is never disclosed after a partial reveal) plus non-turn Journal events.
 */
export function historyFor(
  record: CampaignKnowledge,
  characters: readonly Character[],
  snapshots: readonly KnowledgeSnapshotVersion[] = [],
  ledger: LedgerSource = {}
): JournalHistoryItem[] {
  const ledgerTimes = new Set<string>();
  const items: JournalHistoryItem[] = [];
  const undone = new Set(ledger.journal?.undoneTurnIds ?? []);
  for (const event of ledger.journal?.events ?? []) {
    if (event.kind === JournalEventKind.Backfill) {
      for (const x of event.contributions) {
        if (x.knowledgeId !== record.id || undone.has(x.turnId)) continue;
        ledgerTimes.add(event.createdAt);
        items.push({
          at: event.createdAt,
          kind: 'recovered',
          origin: 'gm',
          turnId: x.turnId,
          summary: 'Recovered from past conversations',
          ...(x.before ? { changes: diffVersions(x.before, x.after, characters) } : {}),
        });
      }
    } else if (event.knowledgeId === record.id) {
      ledgerTimes.add(event.createdAt);
      items.push({
        at: event.createdAt,
        kind: 'corrected',
        origin: 'gm',
        turnId: null,
        summary: 'Corrected after review',
        reason: event.reason,
        changes: diffVersions(
          event.before as Record<string, unknown>,
          event.after as Record<string, unknown>,
          characters,
          event.fields
        ),
      });
    }
  }
  record.attributions.forEach((a, i) => {
    if (ledgerTimes.has(a.at) && a.turnId === null) return;
    const snap = snapshots.find((s) => s.turnId === a.turnId);
    const before = snap ? (publicKnowledge(snap.before ? [snap.before] : [])[0] ?? null) : null;
    const after = snap ? (publicKnowledge([snap.after])[0] ?? null) : null;
    items.push({
      at: a.at,
      kind: i === 0 ? 'recorded' : 'updated',
      origin: a.origin,
      turnId: a.turnId,
      summary: i === 0 ? 'Recorded' : 'Updated',
      ...(before && after
        ? {
            changes: diffVersions(
              before as unknown as Record<string, unknown>,
              after as unknown as Record<string, unknown>,
              characters
            ),
          }
        : {}),
    });
  });
  return items.sort((x, y) => x.at.localeCompare(y.at));
}

export function entryDetail(
  records: readonly CampaignKnowledge[],
  characters: readonly Character[],
  id: string,
  ledger: LedgerSource = {},
  snapshots: readonly KnowledgeSnapshotVersion[] = []
): { entry: JournalEntry; record: CampaignKnowledge } {
  const visible = journalSources(records);
  const record = visible.find((r) => r.id === id);
  if (!record) throw new Problem(404, 'journal_not_found', 'Journal entry not found');
  const canonical = records.find((r) => r.id === id)!;
  const evidenceRecord = {
    ...record,
    evidence:
      canonical.introductionVisibility === KnowledgeVisibility.GmOnly
        ? record.evidence
        : canonical.evidence,
  };
  const entry = toEntry(record, visible, characters, ledgerLinks(ledger));
  return {
    record: evidenceRecord,
    entry: {
      ...entry,
      text: record.text,
      evidence: evidenceRefs(evidenceRecord, ledger),
      history: historyFor(record, characters, snapshots, ledger),
    },
  };
}
