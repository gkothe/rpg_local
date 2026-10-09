import { isDeepStrictEqual } from 'node:util';
import { Problem } from '../errors.js';
import { npcCore } from './npcContext.js';
import { z } from 'zod';
import { MAX_LONG_TEXT_CHARS } from './limits.js';
import { npcDraftSchema } from './combat.js';
import { knowledgeIntroductionSchema } from './knowledge.js';
import { profileCoreSchema, npcProfileSchema } from './continuity.js';

export const NPC_PREPARE_TOOL_NAME = 'npc_prepare';
export const NPC_PREPARATION_LIMITS = {
  requestBytes: 4 * 1024 * 1024,
  localKeyChars: 200,
  targetWords: { min: 80, max: 150 },
  references: 1000,
} as const;
export enum NpcPreparationStatus {
  Running = 'running',
  Ready = 'ready',
  Failed = 'failed',
  Interrupted = 'interrupted',
}
const text = z.string().trim().min(1).max(MAX_LONG_TEXT_CHARS);
const refs = z
  .array(z.uuid())
  .max(NPC_PREPARATION_LIMITS.references)
  .refine((x) => new Set(x).size === x.length, 'References must be unique');
export const npcPrepareSchema = z
  .object({
    localKey: z.string().trim().min(1).max(NPC_PREPARATION_LIMITS.localKeyChars),
    intent: text,
    roleHint: text.optional(),
    establishedCharacter: npcDraftSchema.optional(),
    introduction: knowledgeIntroductionSchema,
    relevantCharacterIds: refs.optional(),
    distinctFromCharacterIds: refs.optional(),
    relevantKnowledgeIds: refs.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > NPC_PREPARATION_LIMITS.requestBytes)
      ctx.addIssue({
        code: 'custom',
        message: 'NPC tool arguments exceed the transport byte limit',
      });
  });
export type NpcPrepareInput = z.infer<typeof npcPrepareSchema>;
export const npcCreatorOutputSchema = z
  .object({
    name: npcDraftSchema.shape.name,
    description: z
      .object({ role: text, impression: text.optional(), voice: text.optional() })
      .strict(),
    profile: profileCoreSchema,
  })
  .strict();
export const npcPreparationPayloadSchema = z
  .object({
    receiptId: z.uuid(),
    characterId: z.uuid(),
    publicCharacter: npcDraftSchema,
    profile: npcProfileSchema,
    introduction: knowledgeIntroductionSchema,
  })
  .strict();
export type NpcPreparationPayload = z.infer<typeof npcPreparationPayloadSchema>;
export function preparationOperations(payload: NpcPreparationPayload): Record<string, unknown> {
  const { characterId, ...core } = payload.profile;
  return {
    ...payload,
    createOperation: {
      op: 'create',
      characterId,
      npcPreparationReceiptId: payload.receiptId,
      character: payload.publicCharacter,
      introduction: payload.introduction,
    },
    profileChange: {
      op: 'create',
      characterId,
      expected: null,
      next: core,
      explanation: 'Initial private NPC core',
      origin: 'gm',
      evidence: [],
    },
    guidance:
      'Use the exact createOperation and profileChange if introducing this NPC. Keep private motives out of public description/narration until revealed. Unused drafts are not committed. Use npcPreparationReceiptId with combat_prepare to reuse this identity.',
  };
}

export function validateNpcPreparedCreates(
  response: { operations: unknown[]; continuityChanges?: unknown[] },
  payloads: NpcPreparationPayload[],
  rolls: readonly { actorId?: string; targetId?: string }[] = []
): void {
  for (const payload of payloads) {
    if (
      rolls.some(
        (roll) => roll.actorId === payload.characterId || roll.targetId === payload.characterId
      ) &&
      !response.operations.some((raw) => {
        const op = raw as { op?: string; npcPreparationReceiptId?: string; characterId?: string };
        return (
          op.op === 'create' &&
          op.npcPreparationReceiptId === payload.receiptId &&
          op.characterId === payload.characterId
        );
      })
    )
      throw new Problem(
        422,
        'npc_receipt',
        'Prepared NPC used in dice must include its exact creation receipt'
      );
  }
  for (const raw of response.operations) {
    const op = raw as {
      op: string;
      characterId?: string;
      npcPreparationReceiptId?: string;
      character?: unknown;
      introduction?: unknown;
    };
    if (op.op !== 'create' || !op.npcPreparationReceiptId) continue;
    const payload = payloads.find(
      (p) => p.receiptId === op.npcPreparationReceiptId && p.characterId === op.characterId
    );
    if (
      !payload ||
      !isDeepStrictEqual(op.character, payload.publicCharacter) ||
      !isDeepStrictEqual(op.introduction, payload.introduction)
    )
      throw new Problem(422, 'npc_receipt', 'Prepared NPC must use its exact creation receipt');
    const expected = preparationOperations(payload).profileChange;
    if (!(response.continuityChanges ?? []).some((c) => isDeepStrictEqual(c, expected)))
      throw new Problem(
        422,
        'npc_profile_receipt',
        'Prepared NPC must include its exact private profile change'
      );
  }
}
export function stagedNpcSnapshots(payloads: NpcPreparationPayload[]): Record<string, unknown>[] {
  return payloads.map((p) => ({
    id: p.characterId,
    ...p.publicCharacter,
    revision: 0,
    privateCore: npcCore(p.profile),
  }));
}
