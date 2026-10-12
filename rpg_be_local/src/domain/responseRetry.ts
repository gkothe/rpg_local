import { ZodError } from 'zod';
import { Problem } from '../errors.js';
import { GM_INDEX_DIRECTION_GUIDANCE } from './gmIndex.js';

export const RESPONSE_RETRY_COUNT = 2;
const RETRYABLE_RESPONSE_CODES = new Set([
  'provider_json',
  'provider_protocol',
  'provider_failure',
  'dice_protocol',
  'rules_citations_invalid',
  'dice_references',
  'invalid_operation',
  'knowledge_invalid',
  'operation_explanation_invalid',
  'gameplay_tool_unavailable',
  'gameplay_tool_arguments',
]);

export function responseRetryFeedback(error: unknown): string | null {
  if (error instanceof ZodError) {
    return (
      'Invalid response fields: ' +
      error.issues
        .map(
          (issue) =>
            `${issue.path.join('.')}: ${issue.code}${issue.code === 'custom' && issue.message === GM_INDEX_DIRECTION_GUIDANCE ? `; ${GM_INDEX_DIRECTION_GUIDANCE}` : ''}`
        )
        .join('; ')
    );
  }
  if (error instanceof SyntaxError)
    return 'Return valid JSON matching the supplied final response schema.';
  if (error instanceof Problem && RETRYABLE_RESPONSE_CODES.has(error.code)) return error.message;
  return null;
}

/** Retry rejected responses before committing state; cancellation and ownership failures stop immediately. */
export async function withResponseRetries<T>(
  generate: (attempt: number, feedback: string) => Promise<T>,
  prepare: () => Promise<void>,
  signal?: AbortSignal
): Promise<T> {
  let feedback = '';
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) throw new Problem(409, 'cancelled', 'Request cancelled');
    try {
      return await generate(attempt, feedback);
    } catch (error) {
      const reason = responseRetryFeedback(error);
      if (signal?.aborted || reason === null || attempt >= RESPONSE_RETRY_COUNT) throw error;
      await prepare();
      feedback = `Your previous response was rejected: ${reason}. Correct it and return the complete required JSON. All saved dice are authoritative; replay their original requests without changing their specifications or faces. Cite only retrieved original text. For each citation, provide an exact unique quote and its source identity. Omit offsets and page metadata; the application computes them. Never invent receipt IDs or state.`;
    }
  }
}

/** Correctable contracts and generic CLI failures; quota/auth and isolation failures stop. */
export function structuredResponseRetryFeedback(error: unknown): string | null {
  if (error instanceof Problem && error.code === 'provider_failure')
    return 'The CLI failed before completing this stage. Retry this same stage with the supplied inputs; do not repeat completed work.';
  if (error instanceof ZodError || error instanceof SyntaxError)
    return responseRetryFeedback(error);
  if (
    error instanceof Problem &&
    (['provider_json', 'gameplay_tool_unavailable', 'gameplay_tool_arguments'].includes(
      error.code
    ) ||
      (error.status === 422 && ['gm_index_reference', 'gm_index_provenance'].includes(error.code)))
  )
    return error.message;
  return null;
}
