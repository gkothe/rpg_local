import { KNOWLEDGE_GAMEPLAY_RESPONSE_SCHEMA_VERSION } from './versions.js';
import { gameplayResponseSchema, gameplayResponseJsonSchema } from './gameplayResponse.js';
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
export const gameplayResponseContract = (context?: RuleContext, responseVersion?: number) =>
  responseVersion === KNOWLEDGE_GAMEPLAY_RESPONSE_SCHEMA_VERSION
    ? { schema: gameplayResponseSchema, jsonSchema: gameplayResponseJsonSchema }
    : context?.kind === RuleSystemKind.Library
      ? { schema: ruleResponseSchema, jsonSchema: ruleResponseJsonSchema }
      : { schema: diceResponseSchema, jsonSchema: diceResponseJsonSchema };
export { validateRuleCitations } from './ruleCitationValidation.js';
