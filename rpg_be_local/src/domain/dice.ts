import { frozenKnowledgeSchema } from './knowledgeRecall.js';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { DEFAULT_GAMEPLAY_NARRATOR } from './gameplayNarrator.js';

export const DICE_TOOL_NAME = 'roll_dice';
export const DICE_NARRATOR = DEFAULT_GAMEPLAY_NARRATOR;
export const DICE_LIMITS = {
  slots: 12,
  groupsPerCall: 8,
  labelChars: 80,
  dicePerGroup: 50,
  maxSides: 1_000_000,
  reasonChars: 240,
  declarationChars: 600,
  facesPerCall: 100,
  facesPerSession: 200,
  requestsPerAttempt: 24,
  inputBytes: 4096,
  transcriptBytes: 8192,
  attemptMs: 180_000,
} as const;
const groupSchema = z
  .object({
    label: z.string().trim().min(1).max(DICE_LIMITS.labelChars),
    count: z.number().int().min(1).max(DICE_LIMITS.dicePerGroup),
    sides: z.number().int().min(2).max(DICE_LIMITS.maxSides),
  })
  .strict();
export const diceInputSchema = z
  .object({
    slot: z
      .number()
      .int()
      .min(0)
      .max(DICE_LIMITS.slots - 1),
    groups: z.array(groupSchema).min(1).max(DICE_LIMITS.groupsPerCall),
    reason: z.string().trim().min(1).max(DICE_LIMITS.reasonChars),
    declaration: z.string().trim().min(1).max(DICE_LIMITS.declarationChars),
    actorId: z.uuid().optional(),
    targetId: z.uuid().optional(),
    rerollOf: z
      .object({ rollId: z.uuid(), reason: z.string().trim().min(1).max(DICE_LIMITS.reasonChars) })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.groups.map((group) => group.label)).size !== value.groups.length)
      ctx.addIssue({ code: 'custom', message: 'Dice group labels must be unique' });
    if (value.groups.reduce((sum, group) => sum + group.count, 0) > DICE_LIMITS.facesPerCall)
      ctx.addIssue({ code: 'custom', message: 'Too many dice in one call' });
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > DICE_LIMITS.inputBytes)
      ctx.addIssue({ code: 'custom', message: 'Dice input exceeds byte limit' });
  });
export type DiceInput = z.infer<typeof diceInputSchema>;
export type DiceFaces = { label: string; sides: number; faces: number[] };
export type DiceRecord = Omit<DiceInput, 'groups'> & {
  id: string;
  sessionId: string;
  campaignId: string;
  createdAt: string;
  groups: DiceFaces[];
};
export type DiceResult = { rollId: string; slot: number; groups: DiceFaces[]; reused: boolean };
export const diceRecordSchema = z
  .object({
    ...diceInputSchema.shape,
    id: z.uuid(),
    sessionId: z.uuid(),
    campaignId: z.uuid(),
    createdAt: z.iso.datetime(),
    groups: z
      .array(
        z
          .object({
            label: z.string(),
            sides: z.number().int(),
            faces: z.array(z.number().int()).min(1).max(DICE_LIMITS.dicePerGroup),
          })
          .strict()
      )
      .min(1)
      .max(DICE_LIMITS.groupsPerCall),
  })
  .strict()
  .superRefine((record, ctx) => {
    const input: Record<string, unknown> = { ...record };
    for (const key of ['id', 'sessionId', 'campaignId', 'createdAt']) delete input[key];
    const groups = record.groups;
    if (
      !diceInputSchema.safeParse({
        ...input,
        groups: groups.map((group) => ({
          label: group.label,
          sides: group.sides,
          count: group.faces.length,
        })),
      }).success ||
      groups.some((group) => group.faces.some((face) => face < 1 || face > group.sides))
    )
      ctx.addIssue({ code: 'custom', message: 'Invalid archived dice faces or specification' });
  });
export const diceSessionSchema = z
  .object({
    id: z.uuid(),
    campaignId: z.uuid(),
    rootTurnId: z.uuid(),
    contextDigest: z.string().regex(/^[a-f0-9]{64}$/),
    frozenPrompt: z.string(),
    promptContractVersion: z.literal(4).optional(),
    digestVersion: z.literal(2).optional(),
    systemPrompt: z.string().optional(),
    frozenKnowledge: frozenKnowledgeSchema.optional(),
    toolDefinitions: z
      .array(
        z
          .object({
            name: z.string(),
            description: z.string(),
            inputSchema: z.record(z.string(), z.unknown()),
          })
          .strict()
      )
      .optional(),
    frozenRevision: z.number().int().nonnegative(),
    characterIds: z.array(z.uuid()).max(1000),
    newFaces: z.number().int().min(0).max(DICE_LIMITS.facesPerSession),
    createdAt: z.iso.datetime(),
    imported: z.boolean(),
  })
  .strict();
export type DiceSession = z.infer<typeof diceSessionSchema>;

// This internal seam permits deterministic boundary tests; no request selects the RNG.
export function generateFaces(
  input: DiceInput,
  draw: (min: number, max: number) => number = randomInt
): DiceFaces[] {
  return input.groups.map((group) => {
    const faces: number[] = [];
    for (let i = 0; i < group.count; i++) faces.push(draw(1, group.sides + 1));
    return { label: group.label, sides: group.sides, faces };
  });
}
