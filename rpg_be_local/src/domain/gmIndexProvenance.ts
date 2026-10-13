import { Problem } from '../errors.js';
import { canonicalJson, sha256 } from './journalLedger.js';
import { projectFreshGmIndex, gmIndexEntryIdentity } from './gmIndexCompatibility.js';
import type { GmIndexDeliveredOriginals } from './gmIndexUpdate.js';
import { sourceSections } from './sourceSections.js';
import { GmIndexRefKind, type GmIndexRef } from './gmIndexRefs.js';
import type { GmIndexDocument } from './gmIndex.js';
import type { Campaign } from './types.js';

export class GmIndexProvenanceError extends Problem {
  constructor(readonly missingRefs: GmIndexRef[]) {
    super(
      422,
      'gm_index_provenance',
      'Read the exact original before adding this index reference; search snippets are navigation only.'
    );
  }
  retryFeedback(): string {
    return `${this.message} Required originals: ${JSON.stringify(
      this.missingRefs.map((ref) => {
        switch (ref.kind) {
          case GmIndexRefKind.Knowledge:
            return { tool: 'campaign_knowledge_get', arguments: { id: ref.id } };
          case GmIndexRefKind.SourceSection:
            return {
              tool: 'campaign_sources_get',
              arguments: {
                sourceId: ref.sourceId,
                version: ref.version,
                sectionIndex: ref.sectionIndex,
              },
            };
          case GmIndexRefKind.Turn:
            return { tool: 'campaign_history_get', arguments: { turnId: ref.turnId } };
          default:
            return { kind: ref.kind };
        }
      })
    )}. Retrieve only missing originals, then return the corrected delta.`;
  }
}

/** Existence is necessary; a new derived source claim also needs a delivered original. */
export function validateGmIndexProvenance(
  next: GmIndexDocument,
  prior: GmIndexDocument,
  campaign: Campaign,
  reads: readonly { name: string; result: Record<string, unknown> }[],
  currentTurnId: string,
  delivered?: GmIndexDeliveredOriginals
): void {
  const fresh = projectFreshGmIndex(prior, campaign);
  const identityFresh = [...prior.entries, ...prior.campaignFoundation].filter((entry) => {
    const dependency = [...prior.dependencyState.entries, ...prior.dependencyState.foundation].find(
      (item) => item.entryId === entry.id
    );
    return (
      dependency &&
      !dependency.stale &&
      dependency.contentHash === gmIndexEntryIdentity(entry, campaign)
    );
  });
  const retained = new Set(
    (delivered ? identityFresh : [...fresh.entries, ...fresh.campaignFoundation]).flatMap((entry) =>
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
      if (
        delivered?.sources.some(
          (s) =>
            s.sourceId === ref.sourceId &&
            s.version === ref.version &&
            s.sectionIndex === ref.sectionIndex &&
            s.contentHash === sha256(section.text)
        )
      )
        return true;
      // Changed source originals are supplied in full in this stage's initial prompt.
      if (
        !delivered &&
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
        !!delivered?.knowledge.some(
          (item) =>
            item.id === ref.id &&
            campaign.knowledge?.some(
              (record) =>
                record.id === item.id && sha256(canonicalJson(record)) === item.contentHash
            )
        ) ||
        (!delivered &&
          campaign.knowledge?.some(
            (record) => record.id === ref.id && record.updatedTurnId === currentTurnId
          )) ||
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
  const missing = new Map<string, GmIndexRef>();
  for (const entry of [...next.entries, ...next.campaignFoundation])
    for (const ref of entry.refs) if (!supplied(ref)) missing.set(canonicalJson(ref), ref);
  if (missing.size)
    throw new GmIndexProvenanceError(
      [...missing.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, ref]) => ref)
    );
}
