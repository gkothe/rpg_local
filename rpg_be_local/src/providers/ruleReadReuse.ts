import type { RuleTool } from '../domain/rules.js';
import {
  isRuleOriginal,
  ruleReadCoverage,
  type RuleOriginalRead,
  type RuleDeliveredEvidence,
} from '../domain/ruleReadCoverage.js';
export { originalReadLocator } from '../domain/ruleReadCoverage.js';

type Read = (
  tool: RuleTool,
  input: unknown,
  id: string,
  evidence?: RuleDeliveredEvidence
) => Promise<Record<string, unknown>>;
export type SuppliedRuleReader = Read & { delivered: (result: Record<string, unknown>) => void };

/** A receipt becomes supplied only after a complete external tool result succeeds. */
export function withSuppliedRuleReads(read: Read): SuppliedRuleReader {
  const originals = new Map<string, RuleOriginalRead>();
  const searches = new Map<string, Record<string, unknown>>();
  const wrapped: SuppliedRuleReader = async (tool, input, id) => {
    const result = await read(tool, input, id, { receiptIds: [...originals.keys()] });
    if (tool !== 'rules_search' || !Array.isArray(result.entries)) return result;
    // Owned persistence captured the exact selection state, including an empty snapshot.
    if (result.suppliedEvidenceCaptured === true) return result;
    const identity = JSON.stringify([result.revision, result.contentHash, id]);
    const replay = searches.get(identity);
    if (replay) return replay;
    const annotated = {
      ...result,
      entries: result.entries.map((entry: Record<string, unknown>) => {
        const coverage = ruleReadCoverage(entry, result.revision, result.contentHash, [
          ...originals.values(),
        ]);
        return coverage.alreadySupplied ? { ...entry, ...coverage } : entry;
      }),
    };
    searches.set(identity, annotated);
    return annotated;
  };
  wrapped.delivered = (result) => {
    const values = Array.isArray(result.reads) ? result.reads : [result];
    for (const value of values)
      if (value && isRuleOriginal(value)) originals.set(value.receipt, value);
  };
  return wrapped;
}
