import { isDeepStrictEqual } from 'node:util';
import { Problem } from '../errors.js';
import { isRuleOriginal, originalReadLocator, ruleReadCoverage } from './ruleReadCoverage.js';
import type { RuleRead } from './rules.js';

/** Authenticate saved coverage references without claiming that archive presence proves delivery. */
export function validateRuleSearchEvidence(reads: readonly RuleRead[]): void {
  const byId = new Map(reads.map((read) => [read.id, read]));
  const invalid = (): never => {
    throw new Problem(422, 'archive_invalid', 'Rule search evidence references are invalid');
  };
  for (const search of reads) {
    if (search.tool !== 'rules_search' || search.payload.error) continue;
    if (!Array.isArray(search.payload.entries)) continue;
    for (const entry of search.payload.entries) {
      if (!entry || typeof entry !== 'object') continue;
      if (entry.suppliedOriginals === undefined) {
        if (entry.matchSupplied === true || entry.originalComplete === true) invalid();
        continue;
      }
      if (!Array.isArray(entry.suppliedOriginals) || !entry.suppliedOriginals.length) invalid();
      const originals: Record<string, unknown>[] = [];
      const references = new Set<string>();
      for (const locator of entry.suppliedOriginals) {
        if (!locator || typeof locator !== 'object' || typeof locator.receiptId !== 'string')
          invalid();
        const original = byId.get(locator.receiptId);
        if (!original) return invalid();
        if (
          references.has(original.id) ||
          original.tool !== 'rules_get' ||
          original.campaignId !== search.campaignId ||
          original.turnId !== search.turnId ||
          !isDeepStrictEqual(original.context, search.context) ||
          original.payload.revision !== search.payload.revision ||
          original.payload.contentHash !== search.payload.contentHash ||
          original.payload.path !== entry.path ||
          !isRuleOriginal(original.payload) ||
          !isDeepStrictEqual(locator, originalReadLocator(original.payload))
        )
          invalid();
        references.add(original.id);
        originals.push(original.payload);
      }
      const coverage = ruleReadCoverage(
        entry,
        search.payload.revision,
        search.payload.contentHash,
        originals
      );
      if (
        !coverage.matchSupplied ||
        entry.matchSupplied !== coverage.matchSupplied ||
        entry.originalComplete !== coverage.originalComplete ||
        !isDeepStrictEqual(entry.suppliedOriginals, coverage.suppliedOriginals)
      )
        invalid();
    }
  }
}

/** Only declared receipt references change; historical paths and continuation tokens remain audit data. */
export function remapRuleSearchEvidence(
  payload: Record<string, unknown>,
  mapped: (id: string) => string
): void {
  if (!Array.isArray(payload.entries)) return;
  for (const entry of payload.entries) {
    if (!entry || !Array.isArray(entry.suppliedOriginals)) continue;
    for (const locator of entry.suppliedOriginals) locator.receiptId = mapped(locator.receiptId);
  }
}
