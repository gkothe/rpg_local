import { z } from 'zod';
import { prepareCitationInput, citationWireSchema } from './citationInput.js';
import { responseSchema, operationSchema } from './schemas.js';
import { diceResponseSchema, placedRollInterpretationSchema } from './diceResponse.js';
import { DICE_LIMITS } from './dice.js';
import { ruleResponseSchema } from './ruleResponse.js';
import { ruleCitationSchema } from './rules.js';
import {
  knowledgeChangeSchema,
  knowledgeProvenanceSchema,
  knowledgeChangeV5Schema,
  knowledgeProvenanceV5Schema,
} from './knowledge.js';
import { operationExplanationSchema } from './operationExplanations.js';
import { combatEffectSchema, participantReferenceSchema } from './combat.js';
import {
  AUDITED_GAMEPLAY_RESPONSE_SCHEMA_VERSION,
  COMBAT_GAMEPLAY_RESPONSE_SCHEMA_VERSION,
  KNOWLEDGE_GAMEPLAY_RESPONSE_SCHEMA_VERSION,
} from './versions.js';
const create = operationSchema.options[0]
  .extend({ introduction: knowledgeProvenanceSchema })
  .strict();
export const gameplayResponseSchema = diceResponseSchema
  .extend({
    version: z.literal(KNOWLEDGE_GAMEPLAY_RESPONSE_SCHEMA_VERSION),
    operations: z.array(
      z.discriminatedUnion('op', [create, operationSchema.options[1], operationSchema.options[2]])
    ),
    ruleCitations: z.array(ruleCitationSchema),
    knowledgeChanges: z.array(knowledgeChangeSchema),
  })
  .strict();
export const gameplayResponseJsonSchema = z.toJSONSchema(gameplayResponseSchema);
export type GameplayResponse = z.infer<typeof gameplayResponseSchema>;
export const gameplayResponseV5Schema = gameplayResponseSchema
  .extend({
    version: z.literal(AUDITED_GAMEPLAY_RESPONSE_SCHEMA_VERSION),
    rollInterpretations: z.array(placedRollInterpretationSchema).max(DICE_LIMITS.slots),
    operations: z.array(
      z.discriminatedUnion('op', [
        operationSchema.options[0].extend({ introduction: knowledgeProvenanceV5Schema }).strict(),
        operationSchema.options[1],
        operationSchema.options[2],
      ])
    ),
    knowledgeChanges: z.array(knowledgeChangeV5Schema),
    operationExplanations: z.array(operationExplanationSchema),
  })
  .strict();
export const gameplayResponseV5JsonSchema = z.toJSONSchema(gameplayResponseV5Schema);
export const gameplayResponseV5InputSchema = z.preprocess(
  prepareCitationInput,
  gameplayResponseV5Schema
);
export const gameplayResponseV5WireJsonSchema = citationWireSchema(gameplayResponseV5JsonSchema);
export type GameplayResponseV5 = z.infer<typeof gameplayResponseV5Schema>;
// A prepared NPC is created under its reserved ID; ordinary creates stay server-identified.
export const createOperationV6Schema = operationSchema.options[0]
  .extend({
    introduction: knowledgeProvenanceV5Schema,
    characterId: z.uuid().optional(),
    preparationReceiptId: z.uuid().optional(),
  })
  .strict();
export const gameplayResponseV6Schema = gameplayResponseV5Schema
  .extend({
    version: z.literal(COMBAT_GAMEPLAY_RESPONSE_SCHEMA_VERSION),
    operations: z.array(
      z.discriminatedUnion('op', [
        createOperationV6Schema,
        operationSchema.options[1],
        operationSchema.options[2],
      ])
    ),
    combatEffects: z.array(combatEffectSchema),
    participantReferences: z.array(participantReferenceSchema),
  })
  .strict();
export const gameplayResponseV6JsonSchema = z.toJSONSchema(gameplayResponseV6Schema);
export const gameplayResponseV6InputSchema = z.preprocess(
  prepareCitationInput,
  gameplayResponseV6Schema
);
export const gameplayResponseV6WireJsonSchema = citationWireSchema(gameplayResponseV6JsonSchema);
export type GameplayResponseV6 = z.infer<typeof gameplayResponseV6Schema>;
/** Audited (v5/v6) responses share provenance, sources and narrative editing. */
export type AuditedGameplayResponse = GameplayResponseV5 | GameplayResponseV6;
export function auditedResponseSchema(version: number) {
  return version === COMBAT_GAMEPLAY_RESPONSE_SCHEMA_VERSION
    ? gameplayResponseV6Schema
    : gameplayResponseV5Schema;
}
export function auditedResponseInputSchema(version: number) {
  return version === COMBAT_GAMEPLAY_RESPONSE_SCHEMA_VERSION
    ? gameplayResponseV6InputSchema
    : gameplayResponseV5InputSchema;
}
export function parseGameplayResponse(raw: unknown, version: number) {
  if (version === COMBAT_GAMEPLAY_RESPONSE_SCHEMA_VERSION)
    return gameplayResponseV6Schema.parse(raw);
  return version === AUDITED_GAMEPLAY_RESPONSE_SCHEMA_VERSION
    ? gameplayResponseV5Schema.parse(raw)
    : version === KNOWLEDGE_GAMEPLAY_RESPONSE_SCHEMA_VERSION
      ? gameplayResponseSchema.parse(raw)
      : version === 3
        ? ruleResponseSchema.parse(raw)
        : version === 2
          ? diceResponseSchema.parse(raw)
          : version === 1
            ? responseSchema.parse(raw)
            : (() => {
                throw new Error('Unsupported gameplay response version');
              })();
}
