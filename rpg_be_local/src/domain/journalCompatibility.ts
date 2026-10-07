import { isDeepStrictEqual } from 'node:util';
import { Problem } from '../errors.js';
import { KnowledgeVisibility, type CampaignKnowledge } from './knowledge.js';
import { JournalEventKind } from './journal.js';
import { fieldsOf, pickFields } from './journalChanges.js';
import type { JournalCorrectionEvent, JournalCorrectionField } from './journalLedger.js';
import type { Campaign } from './types.js';

export type ApplicableCorrection = {
  event: JournalCorrectionEvent;
  record: CampaignKnowledge;
  /** Fields whose live canonical value still equals the accepted after-value. */
  fields: JournalCorrectionField[];
};

/**
 * An event field stays authoritative only while the live canonical value is deeply equal to its
 * accepted value. A later supported change supersedes that field; no semantic guessing is used.
 */
export function applicableCorrections(
  c: Pick<Campaign, 'journal' | 'knowledge'>
): ApplicableCorrection[] {
  const result = new Map<string, ApplicableCorrection>();
  for (const event of c.journal?.events ?? []) {
    if (event.kind !== JournalEventKind.Correction) continue;
    const record = (c.knowledge ?? []).find((r) => r.id === event.knowledgeId);
    const live = record && fieldsOf(record);
    if (!record || !live || record.visibility === KnowledgeVisibility.GmOnly) continue;
    const fields = event.fields.filter((f) => isDeepStrictEqual(live[f], event.after[f]));
    if (fields.length) result.set(`${event.id}`, { event, record, fields });
  }
  return [...result.values()];
}

export type CorrectionGuidance = {
  knowledgeId: string;
  title: string;
  status: string;
  certainty: string;
  /** Always read from the live canonical record, never from the event's stored text. */
  correctedFields: Record<string, unknown>;
  reason: string;
};

/** Authoritative corrected facts for new GM context and compaction. */
export function correctionGuidance(
  c: Pick<Campaign, 'journal' | 'knowledge'>
): CorrectionGuidance[] {
  return applicableCorrections(c).map(({ event, record, fields }) => {
    const live = fieldsOf(record)!;
    return {
      knowledgeId: record.id,
      title: record.title,
      status: record.status,
      certainty: record.certainty,
      correctedFields: pickFields(live, fields),
      reason: event.reason,
    };
  });
}

export const CORRECTION_PROMPT_INSTRUCTION =
  'Corrected facts are authoritative player-confirmed corrections of earlier statements. They override older transcript text, memory and summaries that disagree; do not restate the superseded information as true.';

/**
 * A frozen context that still carries a value later superseded by an applicable correction must not
 * be replayed. Unrelated later gameplay updates and historical events do not block it.
 */
export function frozenContextConflict(
  frozen: { records: readonly CampaignKnowledge[] } | null | undefined,
  c: Pick<Campaign, 'journal' | 'knowledge'>
): string | null {
  if (!frozen) return null;
  for (const { record, fields } of applicableCorrections(c)) {
    const old = frozen.records.find((r) => r.id === record.id);
    const live = fieldsOf(record)!;
    if (old && fields.some((f) => !isDeepStrictEqual(fieldsOf(old)?.[f], live[f])))
      return 'A Journal correction changed facts used by this saved attempt; start a new action';
  }
  return null;
}

export function assertFrozenContext(
  frozen: { records: readonly CampaignKnowledge[] } | null | undefined,
  c: Pick<Campaign, 'journal' | 'knowledge'>
): void {
  const reason = frozenContextConflict(frozen, c);
  if (reason) throw new Problem(409, 'journal_context_changed', reason);
}
