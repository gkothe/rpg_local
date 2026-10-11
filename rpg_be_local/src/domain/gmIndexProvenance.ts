import { Problem } from '../errors.js';
import { canonicalJson, sha256 } from './journalLedger.js';
import { projectFreshGmIndex } from './gmIndexCompatibility.js';
import { sourceSections } from './sourceSections.js';
import { GmIndexRefKind, type GmIndexRef } from './gmIndexRefs.js';
import type { GmIndexDocument } from './gmIndex.js';
import type { Campaign } from './types.js';

/** Existence is necessary; a new derived source claim also needs a delivered original. */
export function validateGmIndexProvenance(
  next: GmIndexDocument,
  prior: GmIndexDocument,
  campaign: Campaign,
  reads: readonly { name: string; result: Record<string, unknown> }[],
  currentTurnId: string
): void {
  const fresh = projectFreshGmIndex(prior, campaign);
  const retained = new Set(
    [...fresh.entries, ...fresh.campaignFoundation].flatMap((entry) =>
      entry.refs.map((ref) => canonicalJson(ref))
    )
  );
  const supplied = (ref: GmIndexRef): boolean => {
    if (retained.has(canonicalJson(ref))) return true;
    if (ref.kind === GmIndexRefKind.SourceSection) {
      const source = campaign.sources.find(
        (source) => source.id === ref.sourceId && source.version === ref.version
      );
      const section = source && sourceSections(source)[ref.sectionIndex];
      if (!section) return false;
      // Changed source originals are supplied in full in this stage's initial prompt.
      if (
        !prior.dependencyState.sourceCoverage.some(
          (old) =>
            old.sourceId === ref.sourceId &&
            old.version === ref.version &&
            old.sectionIndex === ref.sectionIndex &&
            old.contentHash === sha256(section.text)
        )
      )
        return true;
      return reads.some((read) => {
        const span = read.result.sourceSpan as
          | { id?: string; version?: number; start?: number; end?: number; text?: string }
          | undefined;
        return (
          read.name === 'campaign_sources_get' &&
          span?.id === ref.sourceId &&
          span.version === ref.version &&
          span.start === section.start &&
          span.end === section.end &&
          span.text === section.text
        );
      });
    }
    if (ref.kind === GmIndexRefKind.Knowledge)
      return (
        campaign.knowledge?.some(
          (record) => record.id === ref.id && record.updatedTurnId === currentTurnId
        ) ||
        reads.some((read) => read.name === 'campaign_knowledge_get' && read.result.id === ref.id)
      );
    if (ref.kind === GmIndexRefKind.Turn)
      return (
        ref.turnId === currentTurnId ||
        reads.some(
          (read) =>
            read.name === 'campaign_history_get' &&
            Array.isArray(read.result.originals) &&
            read.result.originals.some(
              (original: { turnId?: string }) => original.turnId === ref.turnId
            )
        )
      );
    // Canonical characters and these campaign fields are supplied explicitly; rule hints are navigation.
    return true;
  };
  for (const entry of [...next.entries, ...next.campaignFoundation])
    for (const ref of entry.refs)
      if (!supplied(ref))
        throw new Problem(
          422,
          'gm_index_provenance',
          'Read the exact original before adding this index reference; search snippets are navigation only.'
        );
}
