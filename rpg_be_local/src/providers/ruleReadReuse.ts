import type { RuleTool } from '../domain/rules.js';

type Read = (tool: RuleTool, input: unknown, id: string) => Promise<Record<string, unknown>>;
export function originalReadLocator(read: Record<string, unknown>) {
  return {
    receiptId: read.receipt,
    path: read.path,
    start: read.start,
    end: read.end,
    complete: read.complete,
    nextRead:
      typeof read.cursor === 'string'
        ? { path: read.path, view: 'text', cursor: read.cursor }
        : null,
  };
}

/** Metadata only: every lookup still reaches the owner/identity checks and persisted audit. */
export function withSuppliedRuleReads(read: Read): Read {
  const originals = new Map<string, ReturnType<typeof originalReadLocator>[]>();
  const deliveredSearches = new Map<string, Record<string, unknown>>();
  const key = (revision: unknown, hash: unknown, path: unknown) =>
    JSON.stringify([revision, hash, path]);
  return async (tool, input, id) => {
    const result = await read(tool, input, id);
    if (
      !result.error &&
      result.view === 'text' &&
      !result.structural &&
      typeof result.text === 'string' &&
      result.text.length > 0 &&
      typeof result.receipt === 'string' &&
      typeof result.path === 'string' &&
      typeof result.revision === 'number' &&
      typeof result.contentHash === 'string'
    ) {
      const identity = key(result.revision, result.contentHash, result.path);
      const spans = originals.get(identity) ?? [];
      if (!spans.some((span) => span.receiptId === result.receipt))
        spans.push(originalReadLocator(result));
      originals.set(identity, spans);
    }
    if (tool !== 'rules_search' || !Array.isArray(result.entries)) return result;
    const searchIdentity = key(result.revision, result.contentHash, id);
    const delivered = deliveredSearches.get(searchIdentity);
    if (delivered) return delivered;
    const annotated = {
      ...result,
      entries: result.entries.map((entry: Record<string, unknown>) => {
        if (!entry || typeof entry !== 'object') return entry;
        const supplied = originals.get(key(result.revision, result.contentHash, entry.path));
        return supplied?.length
          ? {
              ...entry,
              alreadySupplied: true,
              originalComplete: supplied.some((span) => span.start === 0 && span.complete === true),
              suppliedOriginals: [...supplied],
            }
          : entry;
      }),
    };
    deliveredSearches.set(searchIdentity, annotated);
    return annotated;
  };
}
