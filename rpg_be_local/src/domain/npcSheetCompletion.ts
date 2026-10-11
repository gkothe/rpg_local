import { z } from 'zod';
import { MAX_LONG_TEXT_CHARS } from './limits.js';
export enum NpcSheetCompletionStatus {
  Running = 'running',
  Ready = 'ready',
  Failed = 'failed',
  Interrupted = 'interrupted',
  Cancelled = 'cancelled',
  Applied = 'applied',
  Discarded = 'discarded',
}
export enum NpcSheetCompletionAction {
  Retry = 'retry',
  Cancel = 'cancel',
  Apply = 'apply',
  Discard = 'discard',
}
export const NPC_SHEET_COMPLETION_LEASE_SECONDS = 60;
export const NPC_SHEET_COMPLETION_HEARTBEAT_MS = 10000;
export const NPC_SHEET_COMPLETION_OPTIONS = {
  statuses: Object.values(NpcSheetCompletionStatus).map((id) => ({
    id,
    label: id[0]!.toUpperCase() + id.slice(1),
  })),
  actions: Object.values(NpcSheetCompletionAction).map((id) => ({
    id,
    label: id[0]!.toUpperCase() + id.slice(1),
  })),
};
export const npcSheetCompletionRequestSchema = z
  .object({
    requestId: z.uuid(),
    categoryHint: z.string().trim().min(1).max(MAX_LONG_TEXT_CHARS).optional(),
  })
  .strict();
export const npcSheetCompletionDecisionSchema = z
  .object({
    requestId: z.uuid(),
    decision: z.enum([NpcSheetCompletionAction.Apply, NpcSheetCompletionAction.Discard]),
  })
  .strict();
