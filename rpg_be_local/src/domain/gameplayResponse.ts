import { atlasMutationSchema } from './atlas.js';
import { atlasFeatureEnabled } from './features.js';
import { z } from 'zod';
import { continuityChangeSchema } from './continuity.js';
import { prepareCitationInput, citationWireSchema } from './citationInput.js';
import { operationSchema } from './schemas.js';
import { placedRollInterpretationSchema } from './diceResponse.js';
import { DICE_LIMITS } from './dice.js';
import { ruleCitationSchema } from './rules.js';
import { knowledgeChangeSchema, knowledgeIntroductionSchema } from './knowledge.js';
import { operationExplanationSchema } from './operationExplanations.js';
import { combatEffectSchema, participantReferenceSchema } from './combat.js';
import { GmIndexContractVersion, GmIndexEntryKind } from './gmIndex.js';
import { gmIndexProseSchema } from './gmDirection.js';
import { gmIndexWireRefSchema } from './gmIndexRefs.js';
import { Problem } from '../errors.js';
export const gmIndexHandoffSchema = z.array(
  z
    .object({
      kind: z.enum([GmIndexEntryKind.GmPlan, GmIndexEntryKind.Task]),
      text: gmIndexProseSchema,
      refs: z.array(gmIndexWireRefSchema),
    })
    .strict()
);
// A prepared NPC is created under its reserved ID; ordinary creates stay server-identified.
export const createOperationSchema = operationSchema.options[0]
  .extend({
    introduction: knowledgeIntroductionSchema,
    characterId: z.uuid().optional(),
    preparationReceiptId: z.uuid().optional(),
    npcPreparationReceiptId: z.uuid().optional(),
  })
  .strict();
export const gameplayResponseSchema = z
  .object({
    gmIndexHandoff: gmIndexHandoffSchema.optional(),
    continuityChanges: z.array(continuityChangeSchema).optional(),
    atlasChanges: atlasMutationSchema.optional(),
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
// Archives retain the complete schema; disabled capabilities disappear only from live input/output.
const liveResponseSchema = atlasFeatureEnabled()
  ? gameplayResponseSchema.omit({ gmIndexHandoff: true })
  : gameplayResponseSchema.omit({ atlasChanges: true, gmIndexHandoff: true });
// Citation offsets and page metadata are calculated by the application, not the GM.
export const gameplayResponseInputSchema = z.preprocess(prepareCitationInput, liveResponseSchema);
export const gameplayResponseWireJsonSchema = citationWireSchema(
  z.toJSONSchema(liveResponseSchema)
);
export type GameplayResponse = z.infer<typeof gameplayResponseSchema>;

/** Choose from the saved execution contract, never the current campaign's activation setting. */
export function gameplayResponseContract(version?: GmIndexContractVersion) {
  if (version !== undefined && version !== GmIndexContractVersion.V1)
    throw new Problem(422, 'gm_index_contract', 'Unsupported frozen GM index contract');
  const schema =
    version === GmIndexContractVersion.V1
      ? liveResponseSchema.extend({ gmIndexHandoff: gmIndexHandoffSchema }).strict()
      : liveResponseSchema;
  return {
    inputSchema: z.preprocess(prepareCitationInput, schema),
    wireJsonSchema: citationWireSchema(z.toJSONSchema(schema)),
  };
}
