import type { Memory } from './types.js';

/** Joins a new batch summary after preserved prior text; the prior bytes are never altered. */
export const MEMORY_BATCH_SEPARATOR = '\n';

export interface ComposedMemory {
  text: string;
  coveredTurnIds: string[];
  priorBytes: number;
  additionBytes: number;
  resultBytes: number;
}

/**
 * Appends a freshly generated batch summary to the previous valid memory.
 * An invalid or absent prior memory is never carried forward.
 */
export function composeMemory(
  prior: Pick<Memory, 'text' | 'coveredTurnIds' | 'valid'> | null | undefined,
  addition: string,
  batchTurnIds: readonly string[]
): ComposedMemory {
  const base = prior?.valid ? prior : null;
  const priorText = base?.text ?? '';
  const separator =
    priorText && !priorText.endsWith(MEMORY_BATCH_SEPARATOR) ? MEMORY_BATCH_SEPARATOR : '';
  const text = priorText ? `${priorText}${separator}${addition}` : addition;
  const coveredTurnIds = [...new Set([...(base?.coveredTurnIds ?? []), ...batchTurnIds])];
  const bytes = (value: string) => Buffer.byteLength(value, 'utf8');
  return {
    text,
    coveredTurnIds,
    priorBytes: bytes(priorText),
    additionBytes: bytes(addition),
    resultBytes: bytes(text),
  };
}
