import { z } from 'zod';
import { Problem } from '../errors.js';
import { responseSchema } from './schemas.js';
import { DICE_GAMEPLAY_RESPONSE_SCHEMA_VERSION } from './versions.js';
import { DICE_LIMITS } from './dice.js';

export const rollInterpretationSchema = z
  .object({
    rollId: z.uuid(),
    explanation: z.string().trim().min(1).max(DICE_LIMITS.declarationChars),
    corrections: z
      .array(
        z
          .object({
            explanation: z.string().trim().min(1).max(DICE_LIMITS.declarationChars),
          })
          .strict()
      )
      .max(DICE_LIMITS.slots)
      .optional(),
  })
  .strict();
export const diceResponseSchema = responseSchema
  .extend({
    version: z.literal(DICE_GAMEPLAY_RESPONSE_SCHEMA_VERSION),
    rollInterpretations: z.array(rollInterpretationSchema).max(DICE_LIMITS.slots),
  })
  .strict();
export const diceResponseJsonSchema = z.toJSONSchema(diceResponseSchema);
export type DiceResponse = z.infer<typeof diceResponseSchema>;
export type RollInterpretation = z.infer<typeof rollInterpretationSchema>;

export function validateRollInterpretations<T extends Pick<DiceResponse, 'rollInterpretations'>>(
  response: T,
  rollIds: readonly string[]
): void {
  const actual = response.rollInterpretations.map((entry) => entry.rollId);
  if (
    new Set(actual).size !== actual.length ||
    actual.length !== rollIds.length ||
    actual.some((id) => !rollIds.includes(id))
  )
    throw new Problem(
      502,
      'dice_references',
      'The GM must acknowledge exactly every recorded roll; unknown, duplicate or missing roll references are rejected'
    );
}
