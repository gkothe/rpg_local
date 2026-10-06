import { z } from 'zod';
import { Problem } from '../errors.js';
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
export type RollInterpretation = z.infer<typeof rollInterpretationSchema>;

// Interpretations recorded before inline placement have no afterParagraph.
export const placedRollInterpretationSchema = rollInterpretationSchema.extend({
  afterParagraph: z.number().int().positive().optional(),
});
export type PlacedRollInterpretation = z.infer<typeof placedRollInterpretationSchema>;

export function validateRollPlacement(response: {
  narrative: string;
  rollInterpretations: PlacedRollInterpretation[];
}): void {
  const count = response.narrative.trim().split(/\r?\n\s*\r?\n/).length;
  if (response.rollInterpretations.some((entry) => (entry.afterParagraph ?? 0) > count))
    throw new Problem(
      502,
      'dice_references',
      'Roll afterParagraph must identify an existing narrative paragraph'
    );
}

export function validateRollInterpretations(
  response: { rollInterpretations: readonly RollInterpretation[] },
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
