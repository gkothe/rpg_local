import { z } from 'zod';
import { Problem } from '../errors.js';
import type { Operation } from './types.js';
import type { DiceRecord } from './dice.js';
import {
  knowledgeEvidenceSchema,
  validateKnowledgeEvidence,
  KnowledgeOrigin,
  KnowledgeVisibility,
  type KnowledgeValidation,
} from './knowledge.js';
import { MAX_LONG_TEXT_CHARS } from './limits.js';
export enum ExplanationBasis {
  InitialState = 'initial_state',
  EstablishedState = 'established_state',
  Rule = 'rule',
  Provisional = 'provisional',
  Dice = 'dice',
  Source = 'source',
}
export const operationExplanationSchema = z
  .object({
    operationIndex: z.number().int().nonnegative(),
    reason: z.string().trim().min(1).max(MAX_LONG_TEXT_CHARS),
    basis: z.enum(ExplanationBasis),
    rollIds: z.array(z.uuid()),
    evidence: z.array(knowledgeEvidenceSchema),
    visibility: z.enum(KnowledgeVisibility),
  })
  .strict();
export type OperationExplanation = z.infer<typeof operationExplanationSchema>;
export function validateOperationExplanations(
  response: {
    operations: readonly Operation[];
    operationExplanations: readonly OperationExplanation[];
  },
  context: KnowledgeValidation & { rolls?: readonly DiceRecord[] }
): void {
  const seen = new Set<number>();
  for (const raw of response.operationExplanations) {
    const e = operationExplanationSchema.parse(raw);
    if (!response.operations[e.operationIndex] || seen.has(e.operationIndex))
      throw new Problem(
        422,
        'operation_explanation_invalid',
        'Each operation needs exactly one explanation by index'
      );
    seen.add(e.operationIndex);
    if (
      new Set(e.rollIds).size !== e.rollIds.length ||
      e.rollIds.some(
        (id) => !context.rolls?.some((r) => r.id === id && r.campaignId === context.campaignId)
      )
    )
      throw new Problem(
        422,
        'operation_explanation_invalid',
        'Explanation dice must refer to saved rolls in this turn'
      );
    if (e.basis === ExplanationBasis.Dice && !e.rollIds.length)
      throw new Problem(422, 'operation_explanation_invalid', 'Dice basis requires a saved roll');
    if (
      (e.basis === ExplanationBasis.Source &&
        !e.evidence.some((v) => v.type === 'campaign_source')) ||
      (e.basis === ExplanationBasis.Rule && !e.evidence.some((v) => v.type === 'book'))
    )
      throw new Problem(
        422,
        'operation_explanation_invalid',
        'Source basis requires exact source or book evidence'
      );
    if (e.evidence.length)
      validateKnowledgeEvidence({ origin: KnowledgeOrigin.Source, evidence: e.evidence }, context);
  }
  if (
    response.operations.some(
      (op, index) =>
        (op.op !== 'set' || op.field === 'attributes' || op.field === 'inventory') &&
        !seen.has(index)
    )
  )
    throw new Problem(
      422,
      'operation_explanation_invalid',
      'Every mechanical operation requires an explanation'
    );
}
