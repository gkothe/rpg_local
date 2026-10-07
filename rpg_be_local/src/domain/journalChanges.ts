import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { conflict, Problem } from '../errors.js';
import {
  KnowledgeCertainty,
  KnowledgeOrigin,
  KnowledgeVisibility,
  campaignKnowledgeSchema,
  type CampaignKnowledge,
} from './knowledge.js';
import { JournalDecision, JournalEventKind } from './journal.js';
import {
  JOURNAL_CORRECTION_FIELDS,
  emptyLedger,
  eventDigest,
  journalContributionSchema,
  journalFieldsPatchSchema,
  journalFieldsSchema,
  sha256,
  transcriptEvidenceSchema,
  type JournalBackfillEvent,
  type JournalContribution,
  type JournalCorrectionEvent,
  type JournalCorrectionField,
  type JournalFields,
  type JournalFieldsPatch,
  type JournalLedger,
  type TranscriptEvidence,
} from './journalLedger.js';
import { TurnStatus } from './options.js';
import type { Campaign, Character, Turn } from './types.js';

export const JOURNAL_CHANGED_MESSAGE =
  'The campaign history or recorded facts changed while the Journal was working';
export const journalChanged = (detail = JOURNAL_CHANGED_MESSAGE) =>
  new Problem(409, 'journal_changed', detail);
const evidenceInvalid = (detail: string) => new Problem(422, 'evidence_invalid', detail);
const journalInvalid = (detail: string) => new Problem(422, 'journal_invalid', detail);

export type TranscriptField = TranscriptEvidence['field'];
export const transcriptText = (
  turn: Pick<Turn, 'action' | 'narrative'>,
  field: TranscriptField
): string => (field === 'action' ? turn.action : (turn.narrative ?? ''));

/** Completed, non-undone turns with public transcript text are the only valid evidence. */
export const eligibleTurns = (turns: readonly Turn[]): Turn[] =>
  turns.filter((t) => t.status === TurnStatus.Completed && !t.undone && !!t.narrative);

/** Locate an exact quote in one transcript field; coordinates are absolute UTF-16 offsets. */
export function locateQuote(
  turn: Pick<Turn, 'id' | 'action' | 'narrative'>,
  field: TranscriptField,
  quote: string
): TranscriptEvidence | null {
  const text = transcriptText(turn, field);
  if (!quote || quote.length > text.length) return null;
  const start = text.indexOf(quote);
  if (start < 0) return null;
  return transcriptEvidenceSchema.parse({
    turnId: turn.id,
    field,
    quote,
    start,
    end: start + quote.length,
    digest: sha256(text),
  });
}

/** Evidence must still match the stored final transcript of an active completed turn. */
export function validateTranscriptEvidence(
  evidence: TranscriptEvidence,
  turns: ReadonlyMap<string, Turn>
): void {
  const turn = turns.get(evidence.turnId);
  if (!turn || turn.status !== TurnStatus.Completed || turn.undone)
    throw evidenceInvalid('Evidence conversation is no longer part of the active story');
  const text = transcriptText(turn, evidence.field);
  if (
    sha256(text) !== evidence.digest ||
    evidence.end !== evidence.start + evidence.quote.length ||
    text.slice(evidence.start, evidence.end) !== evidence.quote
  )
    throw evidenceInvalid('Evidence quote no longer matches the saved conversation');
}

export const fieldsOf = (record: CampaignKnowledge): JournalFields | null =>
  record.certainty === KnowledgeCertainty.Belief
    ? null
    : {
        kind: record.kind,
        title: record.title,
        text: record.text,
        certainty: record.certainty,
        status: record.status,
        characterIds: [...record.characterIds],
        holderId: record.holderId ?? null,
      };

export const pickFields = (
  fields: Partial<Record<JournalCorrectionField, unknown>>,
  keys: readonly JournalCorrectionField[]
): JournalFieldsPatch =>
  Object.fromEntries(keys.map((k) => [k, structuredClone(fields[k])])) as JournalFieldsPatch;

const visible = (r: CampaignKnowledge) =>
  (r.visibility ?? KnowledgeVisibility.Player) === KnowledgeVisibility.Player;

function characterNames(
  ids: readonly string[],
  characters: readonly Character[],
  previous: Record<string, string> = {}
): Record<string, string> {
  const names: Record<string, string> = {};
  for (const id of ids) {
    const name = characters.find((c) => c.id === id)?.name ?? previous[id];
    if (!name) throw journalInvalid('Linked character does not exist');
    names[id] = name;
  }
  return names;
}

function assertLinks(fields: JournalFieldsPatch, characters: readonly Character[]): void {
  for (const id of fields.characterIds ?? [])
    if (!characters.some((c) => c.id === id))
      throw journalInvalid('Linked character does not exist');
  if (fields.characterIds && new Set(fields.characterIds).size !== fields.characterIds.length)
    throw journalInvalid('Linked characters must be unique');
  if (fields.holderId && !characters.some((c) => c.id === fields.holderId))
    throw journalInvalid('Holder does not exist');
}

/** Merge validated mutable fields onto a record, keeping server-owned identity and provenance. */
function withFields(
  record: CampaignKnowledge,
  fields: JournalFieldsPatch,
  characters: readonly Character[],
  now: string
): CampaignKnowledge {
  const next: CampaignKnowledge = { ...structuredClone(record), ...structuredClone(fields) };
  next.characterNames = characterNames(next.characterIds, characters, record.characterNames);
  if (next.holderId) next.holderName = characters.find((c) => c.id === next.holderId)?.name;
  else {
    next.holderId = null;
    delete next.holderName;
  }
  next.updatedAt = now;
  next.revision = record.revision + 1;
  // Journal edits have no gameplay turn; creation provenance is preserved.
  next.attributions = [
    ...record.attributions,
    {
      origin: KnowledgeOrigin.Gm,
      evidence: [],
      turnId: null,
      at: now,
      visibility: KnowledgeVisibility.Player,
    },
  ];
  return campaignKnowledgeSchema.parse(next);
}

// ---------------------------------------------------------------------------
// Backfill staging and commit
// ---------------------------------------------------------------------------

export const stagedEntrySchema = z
  .object({
    ref: z.string().min(1).max(64),
    id: z.uuid(),
    fields: journalFieldsSchema,
    contributions: z.array(journalContributionSchema).min(1),
  })
  .strict();
export type StagedEntry = z.infer<typeof stagedEntrySchema>;
export const stagedBackfillSchema = z
  .object({
    entries: z.array(stagedEntrySchema),
    nextOrdinal: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
  })
  .strict();
export type StagedBackfill = z.infer<typeof stagedBackfillSchema>;
export const emptyStaged = (): StagedBackfill => ({ entries: [], nextOrdinal: 0, skipped: 0 });

export const normalizeTitle = (title: string) => title.trim().replace(/\s+/g, ' ').toLowerCase();

/** Commit the staged result atomically as new records plus one immutable Journal event. */
export function applyBackfill(
  original: Campaign,
  staged: StagedBackfill,
  turns: ReadonlyMap<string, Turn>,
  eligibleIds: readonly string[],
  jobId: string,
  now = new Date().toISOString()
): Campaign {
  const c = structuredClone(original);
  const knowledge = c.knowledge ?? [];
  const existingIds = new Set(knowledge.filter(visible).map((r) => r.id));
  const stagedIds = new Set(staged.entries.map((e) => e.id));
  const taken = new Set(knowledge.map((r) => r.id));
  const contributions: JournalContribution[] = [];
  for (const entry of staged.entries) {
    if (taken.has(entry.id)) throw journalChanged();
    assertLinks(entry.fields, c.characters);
    for (const contribution of entry.contributions) {
      for (const e of contribution.evidence) validateTranscriptEvidence(e, turns);
      for (const dep of contribution.dependsOn)
        if (!stagedIds.has(dep) && !existingIds.has(dep))
          throw journalChanged('A related record is no longer available');
      contributions.push(contribution);
    }
    const ordered = [...entry.contributions].sort((a, b) => a.ordinal - b.ordinal);
    if (!isDeepStrictEqual(ordered.at(-1)!.after, entry.fields))
      throw journalInvalid('Staged contributions do not reproduce the final record');
    const base = entry.fields;
    const created: CampaignKnowledge = campaignKnowledgeSchema.parse({
      id: entry.id,
      visibility: KnowledgeVisibility.Player,
      introductionVisibility: KnowledgeVisibility.Player,
      ...base,
      characterNames: characterNames(base.characterIds, c.characters),
      origin: KnowledgeOrigin.Gm,
      evidence: [],
      createdTurnId: null,
      updatedTurnId: null,
      createdAt: now,
      updatedAt: now,
      revision: 1,
      attributions: [
        {
          origin: KnowledgeOrigin.Gm,
          evidence: [],
          turnId: null,
          at: now,
          visibility: KnowledgeVisibility.Player,
        },
      ],
    });
    c.knowledge = [...(c.knowledge ?? []), created];
  }
  contributions.sort((a, b) => a.ordinal - b.ordinal);
  const event: JournalBackfillEvent = {
    id: randomUUID(),
    kind: JournalEventKind.Backfill,
    createdAt: now,
    jobId,
    knowledgeIds: staged.entries.map((e) => e.id),
    contributions,
    skipped: staged.skipped,
    digest: '',
  };
  event.digest = eventDigest(event);
  const ledger: JournalLedger = c.journal ?? emptyLedger();
  ledger.events.push(event);
  ledger.coverageTurnIds = [...new Set([...ledger.coverageTurnIds, ...eligibleIds])];
  c.journal = ledger;
  c.revision++;
  return c;
}

// ---------------------------------------------------------------------------
// Accepted corrections
// ---------------------------------------------------------------------------

export const correctionProposalSchema = z
  .object({
    knowledgeId: z.uuid(),
    changes: journalFieldsPatchSchema.refine((v) => Object.keys(v).length > 0, 'No changes'),
    reason: z.string().trim().min(1).max(2000),
    evidence: z.array(transcriptEvidenceSchema),
  })
  .strict();
export type CorrectionProposal = z.infer<typeof correctionProposalSchema>;

/** Apply an accepted correction to the same canonical record and retain its audit event. */
export function applyCorrection(
  original: Campaign,
  proposal: CorrectionProposal,
  turns: ReadonlyMap<string, Turn>,
  jobId: string,
  now = new Date().toISOString()
): { campaign: Campaign; event: JournalCorrectionEvent } {
  const c = structuredClone(original);
  const record = (c.knowledge ?? []).find((r) => r.id === proposal.knowledgeId);
  const live = record && visible(record) ? fieldsOf(record) : null;
  if (!record || !live) throw new Problem(404, 'journal_not_found', 'Journal entry not found');
  const keys = Object.keys(proposal.changes) as JournalCorrectionField[];
  for (const key of keys)
    if (!JOURNAL_CORRECTION_FIELDS.includes(key))
      throw journalInvalid(`Field ${key} is not editable`);
  assertLinks(proposal.changes, c.characters);
  for (const e of proposal.evidence) validateTranscriptEvidence(e, turns);
  const changed = keys.filter((k) => !isDeepStrictEqual(live[k], proposal.changes[k]));
  if (!changed.length) throw journalInvalid('The proposal does not change the record');
  const next = withFields(record, proposal.changes, c.characters, now);
  c.knowledge = c.knowledge!.map((r) => (r.id === record.id ? next : r));
  const event: JournalCorrectionEvent = {
    id: randomUUID(),
    kind: JournalEventKind.Correction,
    createdAt: now,
    jobId,
    decision: JournalDecision.Accepted,
    knowledgeId: record.id,
    fields: changed,
    before: pickFields(live, changed),
    after: pickFields(proposal.changes, changed),
    reason: proposal.reason,
    evidence: proposal.evidence,
    digest: '',
  };
  event.digest = eventDigest(event);
  const ledger = c.journal ?? emptyLedger();
  ledger.events.push(event);
  c.journal = ledger;
  c.revision++;
  return { campaign: c, event };
}

/** Digest of the player-visible content a correction decision depends on. */
export const targetDigest = (record: CampaignKnowledge): string =>
  sha256(JSON.stringify({ id: record.id, fields: fieldsOf(record), revision: record.revision }));

// ---------------------------------------------------------------------------
// Undo reconciliation
// ---------------------------------------------------------------------------

/** An accepted correction that relied on this turn as evidence must not silently lose it. */
export function assertNoCorrectionEvidence(c: Campaign, turnId: string): void {
  for (const event of c.journal?.events ?? [])
    if (
      event.kind === JournalEventKind.Correction &&
      event.evidence.some((e) => e.turnId === turnId)
    )
      throw new Problem(
        409,
        'journal_correction_evidence',
        'An accepted Journal correction relies on this conversation as evidence; undo would leave it unsupported'
      );
}

/** Corrections applied after the target turn make ordinary knowledge undo unsafe. */
export function assertNoLaterCorrection(
  c: Campaign,
  afterKnowledge: readonly CampaignKnowledge[]
): void {
  for (const after of afterKnowledge) {
    const current = (c.knowledge ?? []).find((r) => r.id === after.id);
    if (current && isDeepStrictEqual(current, after)) continue;
    const corrected = (c.journal?.events ?? []).some(
      (e) => e.kind === JournalEventKind.Correction && e.knowledgeId === after.id
    );
    if (corrected)
      throw new Problem(
        409,
        'journal_correction_conflict',
        'A later accepted Journal correction changed this fact; undo would overwrite it'
      );
  }
}

/**
 * Rewind recovered records after `undoneTurnId` is undone. Undo always removes the most recent turn,
 * so effective support is a chronological prefix of each record's contributions.
 * `protectedIds` are records the ordinary snapshot restore already handles.
 */
export function reconcileBackfillUndo(
  c: Campaign,
  undoneTurnId: string,
  protectedIds: ReadonlySet<string>,
  now = new Date().toISOString()
): void {
  const ledger = c.journal;
  if (!ledger) return;
  const alreadyUndone = new Set(ledger.undoneTurnIds);
  for (const event of ledger.events) {
    if (event.kind !== JournalEventKind.Backfill) continue;
    for (const id of event.knowledgeIds) {
      if (protectedIds.has(id)) continue;
      const own = event.contributions
        .filter((x) => x.knowledgeId === id)
        .sort((a, b) => a.ordinal - b.ordinal);
      const before = own.filter((x) => !alreadyUndone.has(x.turnId));
      if (!before.some((x) => x.turnId === undoneTurnId)) continue;
      const record = (c.knowledge ?? []).find((r) => r.id === id);
      if (!record) continue;
      if (!isDeepStrictEqual(fieldsOf(record), before.at(-1)!.after))
        throw conflict(
          'A recovered Journal fact was changed after it was recovered; undo would overwrite that change'
        );
      const after = before.filter((x) => x.turnId !== undoneTurnId);
      if (!after.length) c.knowledge = c.knowledge!.filter((r) => r.id !== id);
      else {
        const restored = withFields(record, after.at(-1)!.after, c.characters, now);
        c.knowledge = c.knowledge!.map((r) => (r.id === id ? restored : r));
      }
    }
  }
  // Only turns that actually supplied Journal evidence are labelled; ordinary undo stays out of the ledger.
  const cited = ledger.events.some(
    (event) =>
      event.kind === JournalEventKind.Backfill &&
      event.contributions.some((x) => x.turnId === undoneTurnId)
  );
  if (cited) ledger.undoneTurnIds = [...new Set([...ledger.undoneTurnIds, undoneTurnId])];
  ledger.coverageTurnIds = ledger.coverageTurnIds.filter((id) => id !== undoneTurnId);
}

/** Connections supplied by effective backfill contributions, limited to still-existing ids. */
export function ledgerLinks(c: Pick<Campaign, 'journal'>): Map<string, string[]> {
  const links = new Map<string, string[]>();
  const undone = new Set(c.journal?.undoneTurnIds ?? []);
  for (const event of c.journal?.events ?? []) {
    if (event.kind !== JournalEventKind.Backfill) continue;
    const latest = new Map<string, JournalContribution>();
    for (const x of [...event.contributions].sort((a, b) => a.ordinal - b.ordinal))
      if (!undone.has(x.turnId)) latest.set(x.knowledgeId, x);
    for (const [id, x] of latest) links.set(id, x.dependsOn);
  }
  return links;
}
