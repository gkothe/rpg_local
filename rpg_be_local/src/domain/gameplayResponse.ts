import { z } from 'zod';
import { operationSchema } from './schemas.js';
import { diceResponseSchema } from './diceResponse.js';
import { ruleResponseSchema } from './ruleResponse.js';
import { ruleCitationSchema } from './rules.js';
import { knowledgeChangeSchema, knowledgeProvenanceSchema } from './knowledge.js';
import { KNOWLEDGE_GAMEPLAY_RESPONSE_SCHEMA_VERSION } from './versions.js';
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
export function parseGameplayResponse(raw: unknown, version: number) {
  return version === KNOWLEDGE_GAMEPLAY_RESPONSE_SCHEMA_VERSION
    ? gameplayResponseSchema.parse(raw)
    : version === 3
      ? ruleResponseSchema.parse(raw)
      : diceResponseSchema.parse(raw);
}
