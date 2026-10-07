import { z } from 'zod';
import type { Memory } from './types.js';

export enum MemoryRebuildStatus {
  Pending = 'pending',
  Running = 'running',
  Ready = 'ready',
  Failed = 'failed',
  Cancelled = 'cancelled',
  Interrupted = 'interrupted',
  Applied = 'applied',
  Discarded = 'discarded',
}
export enum MemoryRebuildPurpose {
  /** Reconstruct the full archival memory (the original behavior). */
  Memory = 'memory',
  /** Stage a compact, reversible history index; Apply activates it. */
  CompactHistory = 'compact_history',
}
export const MEMORY_REBUILD_PURPOSE_OPTIONS = [
  { id: MemoryRebuildPurpose.Memory, label: 'Rebuild memory' },
  { id: MemoryRebuildPurpose.CompactHistory, label: 'Prepare compact history' },
] as const;
export enum MemoryRebuildAction {
  Cancel = 'cancel',
  Resume = 'resume',
  Apply = 'apply',
  Discard = 'discard',
}
/** Actions whose retries are recorded as durable receipts. */
export type MemoryRebuildReceiptAction =
  MemoryRebuildAction.Resume | MemoryRebuildAction.Apply | MemoryRebuildAction.Discard;

export const MEMORY_REBUILD_STATUS_OPTIONS = [
  {
    id: MemoryRebuildStatus.Pending,
    label: 'Waiting to start',
    active: true,
    actions: [MemoryRebuildAction.Cancel],
  },
  {
    id: MemoryRebuildStatus.Running,
    label: 'Rebuilding',
    active: true,
    actions: [MemoryRebuildAction.Cancel],
  },
  {
    id: MemoryRebuildStatus.Ready,
    label: 'Ready to review',
    active: false,
    actions: [MemoryRebuildAction.Apply, MemoryRebuildAction.Discard],
  },
  {
    id: MemoryRebuildStatus.Failed,
    label: 'Failed',
    active: false,
    actions: [MemoryRebuildAction.Resume, MemoryRebuildAction.Discard],
  },
  { id: MemoryRebuildStatus.Cancelled, label: 'Cancelled', active: false, actions: [] },
  {
    id: MemoryRebuildStatus.Interrupted,
    label: 'Interrupted',
    active: false,
    actions: [MemoryRebuildAction.Resume, MemoryRebuildAction.Discard],
  },
  { id: MemoryRebuildStatus.Applied, label: 'Applied', active: false, actions: [] },
  { id: MemoryRebuildStatus.Discarded, label: 'Discarded', active: false, actions: [] },
] as const;
export const MEMORY_REBUILD_ACTION_OPTIONS = [
  { id: MemoryRebuildAction.Cancel, label: 'Cancel' },
  { id: MemoryRebuildAction.Resume, label: 'Retry' },
  { id: MemoryRebuildAction.Apply, label: 'Apply' },
  { id: MemoryRebuildAction.Discard, label: 'Discard' },
] as const;
export const MEMORY_REBUILD_LIMITS = { pageSizeDefault: 20, pageSizeMax: 100 } as const;
/** Heartbeat renews ownership of a running rebuild attempt; it is not an AI deadline. */
export const MEMORY_REBUILD_LEASE_SECONDS = 60;
export const MEMORY_REBUILD_HEARTBEAT_MS = 15_000;
/** Error codes owned by the rebuild contract. */
export const MemoryRebuildError = {
  Busy: 'memory_busy',
  Stale: 'memory_stale',
  Invalid: 'memory_invalid',
  RequestReused: 'memory_request_reused',
  DatabaseSetup: 'memory_database_setup',
  Interrupted: 'memory_interrupted',
} as const;

export const statusOption = (status: MemoryRebuildStatus) =>
  MEMORY_REBUILD_STATUS_OPTIONS.find((o) => o.id === status)!;
export const isActiveStatus = (status: MemoryRebuildStatus) => statusOption(status).active;

const digestSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const memoryRebuildRequestSchema = z.object({ requestId: z.uuid() }).strict();
export const memoryRebuildStartSchema = z
  .object({
    requestId: z.uuid(),
    purpose: z.enum(MemoryRebuildPurpose).default(MemoryRebuildPurpose.Memory),
  })
  .strict();
export const memoryRebuildApplySchema = z
  .object({
    requestId: z.uuid(),
    proposalDigest: digestSchema,
    /** Compact history only: also protect the exact current memory text. */
    preserveMemory: z.boolean().optional(),
  })
  .strict();
export const memoryRebuildListQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MEMORY_REBUILD_LIMITS.pageSizeMax)
      .default(MEMORY_REBUILD_LIMITS.pageSizeDefault),
    cursor: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export type MemoryRebuildCandidate = {
  text: string;
  coveredTurnIds: string[];
  proposalDigest: string;
};
export type MemoryRebuildDecision = {
  action: MemoryRebuildAction.Apply | MemoryRebuildAction.Discard;
  requestId: string;
  memoryId: string | null;
};
export type MemoryRebuildJobView = {
  id: string;
  campaignId: string;
  purpose: MemoryRebuildPurpose;
  status: MemoryRebuildStatus;
  statusLabel: string;
  active: boolean;
  processedTurns: number;
  totalTurns: number;
  createdAt: string;
  updatedAt: string;
  errorCode: string | null;
  safeError: string | null;
  allowedActions: MemoryRebuildAction[];
  baseline: Memory | null;
  candidate: MemoryRebuildCandidate | null;
  /** Compact history only: what the staged index contains. */
  compact: { sections: number; chapters: number } | null;
  decision: MemoryRebuildDecision | null;
};
export type MemoryRebuildPage = {
  jobs: MemoryRebuildJobView[];
  /** Newest job that still needs the player's attention (active, ready, failed or interrupted). */
  current: MemoryRebuildJobView | null;
  nextCursor: string | null;
};
