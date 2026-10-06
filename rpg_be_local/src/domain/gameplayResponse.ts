import { z } from 'zod';
import { prepareCitationInput, citationWireSchema } from './citationInput.js';
import { operationSchema } from './schemas.js';
import { placedRollInterpretationSchema } from './diceResponse.js';
import { DICE_LIMITS } from './dice.js';
import { ruleCitationSchema } from './rules.js';
import { knowledgeChangeSchema, knowledgeIntroductionSchema } from './knowledge.js';
import { operationExplanationSchema } from './operationExplanations.js';
import { combatEffectSchema, participantReferenceSchema } from './combat.js';
// A prepared NPC is created under its reserved ID; ordinary creates stay server-identified.
export const createOperationSchema = operationSchema.options[0]
  .extend({
    introduction: knowledgeIntroductionSchema,
    characterId: z.uuid().optional(),
    preparationReceiptId: z.uuid().optional(),
  })
  .strict();
export const gameplayResponseSchema = z
  .object({
    narrative: z.string().trim().min(1),
    operations: z.array(
      z.discriminatedUnion('op', [
        createOperationSchema,
        operationSchema.options[1],
        operationSchema.options[2],
      ])
    ),
    rollInterpretations: z.array(placedRollInterpretationSchema).max(DICE_LIMITS.slots),
    ruleCitations: z.array(ruleCitationSchema),
    knowledgeChanges: z.array(knowledgeChangeSchema),
    operationExplanations: z.array(operationExplanationSchema),
    combatEffects: z.array(combatEffectSchema),
    participantReferences: z.array(participantReferenceSchema),
  })
  .strict();
export const gameplayResponseJsonSchema = z.toJSONSchema(gameplayResponseSchema);
// Citation offsets and page metadata are calculated by the application, not the GM.
export const gameplayResponseInputSchema = z.preprocess(
  prepareCitationInput,
  gameplayResponseSchema
);
export const gameplayResponseWireJsonSchema = citationWireSchema(gameplayResponseJsonSchema);
export type GameplayResponse = z.infer<typeof gameplayResponseSchema>;
