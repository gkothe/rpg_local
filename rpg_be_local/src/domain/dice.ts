import { frozenCampaignSourcesSchema } from './campaignSourceRecall.js';
import { frozenKnowledgeSchema, frozenKnowledgeV5Schema } from './knowledgeRecall.js';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { DEFAULT_GAMEPLAY_NARRATOR } from './gameplayNarrator.js';
import { CombatRollKind, CombatRollScope } from './combat.js';

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
const diceInputObject = z
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
  .strict();
function checkDiceInput(value: z.infer<typeof diceInputObject>, ctx: z.RefinementCtx): void {
  if (new Set(value.groups.map((group) => group.label)).size !== value.groups.length)
    ctx.addIssue({ code: 'custom', message: 'Dice group labels must be unique' });
  if (value.groups.reduce((sum, group) => sum + group.count, 0) > DICE_LIMITS.facesPerCall)
    ctx.addIssue({ code: 'custom', message: 'Too many dice in one call' });
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > DICE_LIMITS.inputBytes)
    ctx.addIssue({ code: 'custom', message: 'Dice input exceeds byte limit' });
}
export const diceInputSchema = diceInputObject.superRefine(checkDiceInput);
const combatScopeShape = {
  scope: z.enum(CombatRollScope),
  encounterId: z.uuid().optional(),
  combatKind: z.enum(CombatRollKind).optional(),
};
function checkCombatScope(
  value: z.infer<typeof diceInputObject> & {
    scope: CombatRollScope;
    encounterId?: string;
    combatKind?: CombatRollKind;
  },
  ctx: z.RefinementCtx
): void {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (value.scope === CombatRollScope.Combat) {
    if (!value.encounterId || !value.combatKind || !value.actorId)
      issue('Combat rolls require encounterId, combatKind and actorId');
    if (value.combatKind === CombatRollKind.Attack && !value.targetId)
      issue('Attack rolls require targetId');
  } else {
    if (value.encounterId || value.combatKind)
      issue('Only combat-scope rolls carry encounterId or combatKind');
    if (value.scope === CombatRollScope.Oracle && (value.actorId || value.targetId))
      issue('Oracle rolls have no actor or target');
  }
}
/** Version 6 contract; versions 1–5 keep diceInputSchema and reject these fields. */
export const diceInputV6Schema = diceInputObject
  .extend(combatScopeShape)
  .strict()
  .superRefine((value, ctx) => {
    checkDiceInput(value, ctx);
    checkCombatScope(value, ctx);
  });
export type DiceInputV6 = z.infer<typeof diceInputV6Schema>;
export type DiceInput = z.infer<typeof diceInputSchema>;
export type DiceFaces = { label: string; sides: number; faces: number[] };
export type DiceRecord = Omit<DiceInput, 'groups'> &
  Partial<Pick<DiceInputV6, 'scope' | 'encounterId' | 'combatKind'>> & {
    id: string;
    sessionId: string;
    campaignId: string;
    createdAt: string;
    groups: DiceFaces[];
  };
export type DiceResult = { rollId: string; slot: number; groups: DiceFaces[]; reused: boolean };
const recordGroups = z
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
  .max(DICE_LIMITS.groupsPerCall);
const recordShape = {
  id: z.uuid(),
  sessionId: z.uuid(),
  campaignId: z.uuid(),
  createdAt: z.iso.datetime(),
  groups: recordGroups,
};
function checkRecord(
  input: z.ZodType,
  record: Record<string, unknown> & { groups: z.infer<typeof recordGroups> },
  ctx: z.RefinementCtx
): void {
  const spec: Record<string, unknown> = { ...record };
  for (const key of ['id', 'sessionId', 'campaignId', 'createdAt']) delete spec[key];
  const groups = record.groups;
  if (
    !input.safeParse({
      ...spec,
      groups: groups.map((group) => ({
        label: group.label,
        sides: group.sides,
        count: group.faces.length,
      })),
    }).success ||
    groups.some((group) => group.faces.some((face) => face < 1 || face > group.sides))
  )
    ctx.addIssue({ code: 'custom', message: 'Invalid archived dice faces or specification' });
}
export const diceRecordSchema = z
  .object({ ...diceInputObject.shape, ...recordShape })
  .strict()
  .superRefine((record, ctx) => checkRecord(diceInputSchema, record, ctx));
export const diceRecordV6Schema = z
  .object({ ...diceInputObject.shape, ...combatScopeShape, ...recordShape })
  .strict()
  .superRefine((record, ctx) => checkRecord(diceInputV6Schema, record, ctx));
export const diceSessionSchema = z
  .object({
    id: z.uuid(),
    campaignId: z.uuid(),
    rootTurnId: z.uuid(),
    contextDigest: z.string().regex(/^[a-f0-9]{64}$/),
    frozenPrompt: z.string(),
    promptContractVersion: z.union([z.literal(4), z.literal(5), z.literal(6)]).optional(),
    digestVersion: z.union([z.literal(2), z.literal(3), z.literal(4)]).optional(),
    systemPrompt: z.string().optional(),
    frozenKnowledge: z.union([frozenKnowledgeSchema, frozenKnowledgeV5Schema]).optional(),
    frozenSources: frozenCampaignSourcesSchema.optional(),
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
  .strict()
  .superRefine((session, ctx) => {
    if (
      session.promptContractVersion === 4 &&
      session.frozenKnowledge &&
      !frozenKnowledgeSchema.safeParse(session.frozenKnowledge).success
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Legacy session requires its original knowledge contract',
      });
    if (session.promptContractVersion === 4 && session.frozenSources)
      ctx.addIssue({ code: 'custom', message: 'Legacy session cannot contain v5 sources' });
  });
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
