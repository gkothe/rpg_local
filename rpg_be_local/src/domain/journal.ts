import { z } from 'zod';
import { KnowledgeKind } from './knowledge.js';

export enum JournalGroup {
  PeoplePlaces = 'people_places',
  UnfinishedBusiness = 'unfinished_business',
  Discoveries = 'discoveries',
}
export const JOURNAL_GROUP_OPTIONS = [
  { id: JournalGroup.PeoplePlaces, label: 'People and places' },
  { id: JournalGroup.UnfinishedBusiness, label: 'Unfinished business' },
  { id: JournalGroup.Discoveries, label: 'Discoveries' },
] as const;
export const JOURNAL_STATUS_LABELS = {
  active: 'Current',
  resolved: 'Completed',
  retracted: 'Retracted',
} as const;
export const JOURNAL_CERTAINTY_LABELS = {
  established: 'Known',
  rumor: 'Rumor',
} as const;

export enum JournalJobKind {
  Backfill = 'backfill',
  Check = 'check',
}
export enum JournalJobStatus {
  Pending = 'pending',
  Running = 'running',
  Completed = 'completed',
  Failed = 'failed',
  Cancelled = 'cancelled',
  Interrupted = 'interrupted',
}
export enum JournalCheckOutcome {
  Proposed = 'proposed',
  Unchanged = 'unchanged',
  Inconclusive = 'inconclusive',
}
export enum JournalEventKind {
  Backfill = 'backfill',
  Correction = 'correction',
}
export enum JournalDecision {
  Accepted = 'accepted',
  Dismissed = 'dismissed',
}
export const JOURNAL_JOB_KIND_OPTIONS = [
  { id: JournalJobKind.Backfill, label: 'Fill from past conversations' },
  { id: JournalJobKind.Check, label: 'Check a recorded fact' },
] as const;
export const JOURNAL_JOB_STATUS_OPTIONS = [
  { id: JournalJobStatus.Pending, label: 'Waiting to start', active: true },
  { id: JournalJobStatus.Running, label: 'Working', active: true },
  { id: JournalJobStatus.Completed, label: 'Finished', active: false },
  { id: JournalJobStatus.Failed, label: 'Failed', active: false },
  { id: JournalJobStatus.Cancelled, label: 'Cancelled', active: false },
  { id: JournalJobStatus.Interrupted, label: 'Interrupted', active: false },
] as const;
export const JOURNAL_CHECK_OUTCOME_OPTIONS = [
  { id: JournalCheckOutcome.Proposed, label: 'Correction proposed' },
  { id: JournalCheckOutcome.Unchanged, label: 'Recorded fact is supported' },
  { id: JournalCheckOutcome.Inconclusive, label: 'Evidence is inconclusive' },
] as const;
export const JOURNAL_FIELD_LABELS = {
  kind: 'Kind',
  title: 'Title',
  text: 'Text',
  certainty: 'Certainty',
  status: 'Status',
  characterIds: 'Linked characters',
  holderId: 'Holder',
} as const;

export const JOURNAL_LIMITS = {
  pageSizeDefault: 20,
  pageSizeMax: 100,
  queryMaxChars: 200,
  overviewMaxChars: 400,
  pastExcerptMaxChars: 180,
  connectionsMax: 6,
  explanationMaxChars: 2000,
  reasonMaxChars: 2000,
} as const;
/** Heartbeat renews ownership of a running Journal job; it is not an AI deadline. */
export const JOURNAL_LEASE_SECONDS = 60;

export const journalGroupFor = (kind: KnowledgeKind): JournalGroup =>
  kind === KnowledgeKind.Npc || kind === KnowledgeKind.Place
    ? JournalGroup.PeoplePlaces
    : kind === KnowledgeKind.Debt || kind === KnowledgeKind.Objective
      ? JournalGroup.UnfinishedBusiness
      : JournalGroup.Discoveries;

export const journalListQuerySchema = z
  .object({
    query: z.string().trim().max(JOURNAL_LIMITS.queryMaxChars).default(''),
    includePast: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    cursor: z.string().max(500).optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(JOURNAL_LIMITS.pageSizeMax)
      .default(JOURNAL_LIMITS.pageSizeDefault),
  })
  .strict();
export type JournalListQuery = z.infer<typeof journalListQuerySchema>;

export type JournalConnection = { id: string; title: string; group: JournalGroup };
export type JournalEvidenceRef = {
  id: string;
  kind: 'turn' | 'campaign_source' | 'book' | 'map_asset';
  label: string;
  turnId?: string;
  available: boolean;
};
export type JournalHistoryChange = {
  field: string;
  label: string;
  before: string | null;
  after: string | null;
};
export type JournalHistoryItem = {
  at: string;
  kind: 'recorded' | 'updated' | 'recovered' | 'corrected';
  origin: string;
  turnId: string | null;
  summary: string;
  changes?: JournalHistoryChange[];
  reason?: string;
};
export type JournalEntry = {
  id: string;
  title: string;
  kind: KnowledgeKind;
  group: JournalGroup;
  status: string;
  statusLabel: string;
  certainty: string;
  certaintyLabel: string;
  overview: string;
  /** True when overview is a shortened form of the full text. */
  excerpt: boolean;
  text?: string;
  updatedAt: string;
  connections: JournalConnection[];
  evidence?: JournalEvidenceRef[];
  history?: JournalHistoryItem[];
};
export type JournalPage = {
  entries: JournalEntry[];
  counts: Record<JournalGroup, number>;
  /** Backend-owned order and labels; the frontend renders these as given. */
  groups: { id: JournalGroup; label: string; count: number }[];
  total: number;
  nextCursor: string | null;
};

export const journalRequestSchema = z.object({ requestId: z.uuid() }).strict();
export const journalCheckRequestSchema = z
  .object({
    requestId: z.uuid(),
    explanation: z.string().trim().min(1).max(JOURNAL_LIMITS.explanationMaxChars),
  })
  .strict();
export const journalAcceptRequestSchema = z
  .object({ requestId: z.uuid(), proposalDigest: z.string().regex(/^[0-9a-f]{64}$/) })
  .strict();
