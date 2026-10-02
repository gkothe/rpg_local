import { ZodError } from 'zod';
import { Problem } from '../errors.js';

export const RESPONSE_RETRY_COUNT = 2;
const RETRYABLE_RESPONSE_CODES = new Set([
  'provider_json',
  'provider_protocol',
  'provider_failure',
  'dice_protocol',
  'rules_citations_invalid',
  'dice_references',
  'invalid_operation',
]);

export function responseRetryFeedback(error: unknown): string | null {
  if (error instanceof ZodError) {
    return (
      'Invalid response fields: ' +
      error.issues.map((issue) => `${issue.path.join('.')}: ${issue.code}`).join('; ')
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
      feedback = `Your previous response was rejected: ${reason}. Correct it and return the complete required JSON. All saved dice are authoritative; replay their original requests without changing their specifications or faces. Cite only retrieved original text. For each citation, start and end must identify exactly the quoted substring (end = start + quote.length), not the whole retrieved section. Never invent receipt IDs or state.`;
    }
  }
}
