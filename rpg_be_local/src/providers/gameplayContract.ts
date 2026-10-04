import { gameplayResponseContract } from '../domain/ruleResponse.js';
import { diceResponseSchema } from '../domain/diceResponse.js';
import { ruleResponseSchema } from '../domain/ruleResponse.js';
import type { BookGameplayAdapter } from './gameplayTools.js';
import { Problem } from '../errors.js';
import {
  AUDITED_GAMEPLAY_RESPONSE_SCHEMA_VERSION,
  KNOWLEDGE_GAMEPLAY_RESPONSE_SCHEMA_VERSION,
  RULE_GAMEPLAY_RESPONSE_SCHEMA_VERSION,
  DICE_GAMEPLAY_RESPONSE_SCHEMA_VERSION,
} from '../domain/versions.js';

export function nativeGameplaySchema(adapter: BookGameplayAdapter | undefined, book: boolean) {
  const version = (adapter?.schema as { properties?: { version?: { const?: number } } })?.properties
    ?.version?.const;
  if (adapter?.schema !== undefined) {
    if (
      version === AUDITED_GAMEPLAY_RESPONSE_SCHEMA_VERSION ||
      version === KNOWLEDGE_GAMEPLAY_RESPONSE_SCHEMA_VERSION
    )
      return gameplayResponseContract(undefined, version).schema;
    if (version === RULE_GAMEPLAY_RESPONSE_SCHEMA_VERSION) return ruleResponseSchema;
    if (version === DICE_GAMEPLAY_RESPONSE_SCHEMA_VERSION) return diceResponseSchema;
    throw new Problem(503, 'gameplay_schema', 'Unsupported explicit gameplay response schema');
  }
  return book ? ruleResponseSchema : diceResponseSchema;
}
