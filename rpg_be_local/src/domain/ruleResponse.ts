import { responseSchema, responseJsonSchema } from './schemas.js';
import { Problem } from '../errors.js';
import {
  AUDITED_GAMEPLAY_RESPONSE_SCHEMA_VERSION,
  KNOWLEDGE_GAMEPLAY_RESPONSE_SCHEMA_VERSION,
} from './versions.js';
import {
  gameplayResponseSchema,
  gameplayResponseJsonSchema,
  gameplayResponseV5Schema,
  gameplayResponseV5WireJsonSchema,
  gameplayResponseV6Schema,
  gameplayResponseV6WireJsonSchema,
} from './gameplayResponse.js';
import { COMBAT_GAMEPLAY_RESPONSE_SCHEMA_VERSION } from './versions.js';
import { z } from 'zod';
import { diceResponseSchema, diceResponseJsonSchema } from './diceResponse.js';
import { RULE_GAMEPLAY_RESPONSE_SCHEMA_VERSION } from './versions.js';
import { RuleSystemKind, ruleCitationSchema, type RuleContext } from './rules.js';
export const ruleResponseSchema = diceResponseSchema
  .extend({
    version: z.literal(RULE_GAMEPLAY_RESPONSE_SCHEMA_VERSION),
    ruleCitations: z.array(ruleCitationSchema),
  })
  .strict();
export const ruleResponseJsonSchema = z.toJSONSchema(ruleResponseSchema);
export type RuleResponse = z.infer<typeof ruleResponseSchema>;
export const gameplayResponseContract = (context?: RuleContext, responseVersion?: number) => {
  if (responseVersion === COMBAT_GAMEPLAY_RESPONSE_SCHEMA_VERSION)
    return { schema: gameplayResponseV6Schema, jsonSchema: gameplayResponseV6WireJsonSchema };
  if (responseVersion === AUDITED_GAMEPLAY_RESPONSE_SCHEMA_VERSION)
    return { schema: gameplayResponseV5Schema, jsonSchema: gameplayResponseV5WireJsonSchema };
  if (responseVersion === KNOWLEDGE_GAMEPLAY_RESPONSE_SCHEMA_VERSION)
    return { schema: gameplayResponseSchema, jsonSchema: gameplayResponseJsonSchema };
  if (responseVersion === 1) return { schema: responseSchema, jsonSchema: responseJsonSchema };
  if (responseVersion === 2)
    return { schema: diceResponseSchema, jsonSchema: diceResponseJsonSchema };
  if (
    responseVersion === RULE_GAMEPLAY_RESPONSE_SCHEMA_VERSION ||
    (responseVersion === undefined && context?.kind === RuleSystemKind.Library)
  )
    return { schema: ruleResponseSchema, jsonSchema: ruleResponseJsonSchema };
  if (responseVersion !== undefined)
    throw new Problem(503, 'gameplay_schema', 'Unsupported explicit gameplay response schema');
  return { schema: diceResponseSchema, jsonSchema: diceResponseJsonSchema };
};
export { validateRuleCitations } from './ruleCitationValidation.js';
