import { createHash } from 'node:crypto';
import { z } from 'zod';
import { MAX_ENTITY_NAME_CHARS, MAX_LONG_TEXT_CHARS } from './limits.js';
import { KnowledgeCertainty, KnowledgeKind, KnowledgeStatus } from './knowledge.js';
import { JOURNAL_LIMITS, JournalDecision, JournalEventKind } from './journal.js';

/** Fields a Journal event may change on a canonical knowledge record. */
export const JOURNAL_CORRECTION_FIELDS = [
  'kind',
  'title',
  'text',
  'certainty',
  'status',
  'characterIds',
  'holderId',
] as const;
export type JournalCorrectionField = (typeof JOURNAL_CORRECTION_FIELDS)[number];

export const transcriptFieldSchema = z.enum(['action', 'narrative']);
export const transcriptEvidenceSchema = z
  .object({
    turnId: z.uuid(),
    field: transcriptFieldSchema,
    quote: z.string().min(1).max(MAX_LONG_TEXT_CHARS),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    digest: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict()
  .refine((e) => e.end === e.start + e.quote.length, 'Quote coordinates must match its length');
export type TranscriptEvidence = z.infer<typeof transcriptEvidenceSchema>;

export const journalFieldsSchema = z
  .object({
    kind: z.enum(KnowledgeKind),
    title: z.string().trim().min(1).max(MAX_ENTITY_NAME_CHARS),
    text: z.string().trim().min(1).max(MAX_LONG_TEXT_CHARS),
    // Beliefs are never recorded or restored through the Journal.
    certainty: z.enum([KnowledgeCertainty.Established, KnowledgeCertainty.Rumor]),
    status: z.enum(KnowledgeStatus),
    characterIds: z.array(z.uuid()),
    holderId: z.uuid().nullable(),
  })
  .strict();
export type JournalFields = z.infer<typeof journalFieldsSchema>;
export const journalFieldsPatchSchema = journalFieldsSchema.partial().strict();
export type JournalFieldsPatch = z.infer<typeof journalFieldsPatchSchema>;

const digestSchema = z.string().regex(/^[0-9a-f]{64}$/);

/** One transcript-supported transition of a recovered record; replayable without AI. */
export const journalContributionSchema = z
  .object({
    ordinal: z.number().int().nonnegative(),
    turnId: z.uuid(),
    knowledgeId: z.uuid(),
    op: z.enum(['create', 'update']),
    before: journalFieldsSchema.nullable(),
    after: journalFieldsSchema,
    evidence: z.array(transcriptEvidenceSchema).min(1),
    dependsOn: z.array(z.uuid()),
  })
  .strict();
export type JournalContribution = z.infer<typeof journalContributionSchema>;

export const journalBackfillEventSchema = z
  .object({
    id: z.uuid(),
    kind: z.literal(JournalEventKind.Backfill),
    createdAt: z.iso.datetime(),
    jobId: z.uuid(),
    knowledgeIds: z.array(z.uuid()),
    contributions: z.array(journalContributionSchema),
    skipped: z.number().int().nonnegative(),
    digest: digestSchema,
  })
  .strict();
export const journalCorrectionEventSchema = z
  .object({
    id: z.uuid(),
    kind: z.literal(JournalEventKind.Correction),
    createdAt: z.iso.datetime(),
    jobId: z.uuid(),
    decision: z.literal(JournalDecision.Accepted),
    knowledgeId: z.uuid(),
    fields: z.array(z.enum(JOURNAL_CORRECTION_FIELDS)).min(1),
    before: journalFieldsPatchSchema,
    after: journalFieldsPatchSchema,
    reason: z.string().trim().min(1).max(JOURNAL_LIMITS.reasonMaxChars),
    evidence: z.array(transcriptEvidenceSchema),
    digest: digestSchema,
  })
  .strict();
export const journalEventSchema = z.discriminatedUnion('kind', [
  journalBackfillEventSchema,
  journalCorrectionEventSchema,
]);
export type JournalEvent = z.infer<typeof journalEventSchema>;
export type JournalBackfillEvent = z.infer<typeof journalBackfillEventSchema>;
export type JournalCorrectionEvent = z.infer<typeof journalCorrectionEventSchema>;

export const journalLedgerSchema = z
  .object({
    events: z.array(journalEventSchema),
    /** Eligible turns already examined by a completed backfill. */
    coverageTurnIds: z.array(z.uuid()),
    /** Audit label: turns undone after contributing evidence. */
    undoneTurnIds: z.array(z.uuid()),
  })
  .strict();
export type JournalLedger = z.infer<typeof journalLedgerSchema>;
export const emptyLedger = (): JournalLedger => ({
  events: [],
  coverageTurnIds: [],
  undoneTurnIds: [],
});

/** Stable JSON: object keys sorted so digests do not depend on construction order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
export const eventDigest = (event: Record<string, unknown>): string => {
  const rest = { ...event };
  delete rest.digest;
  return sha256(canonicalJson(rest));
};
