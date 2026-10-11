import { canonicalJson, sha256 } from './journalLedger.js';
import { sourceSections } from './sourceSections.js';
import { SourceStatus } from './options.js';
import {
  GmIndexRefKind,
  validateGmIndexRefs,
  type GmIndexReferenceCapture,
  type GmIndexRef,
} from './gmIndexRefs.js';
import { GM_INDEX_TARGETS, GmIndexEntryStatus, type GmIndexDocument } from './gmIndex.js';
import type { Campaign } from './types.js';
import { Problem } from '../errors.js';

export function gmIndexCanonicalIdentity(c: Campaign): string {
  return sha256(
    canonicalJson({
      state: c.state,
      description: c.description,
      instructions: c.instructions,
      characters: c.characters.map(
        ({ notes: _notes, revision: _revision, ...character }) => character
      ),
      knowledge: (c.knowledge ?? []).map(({ revision: _revision, ...record }) => record),
      continuity: c.continuity ?? null,
      sources: c.sources.map(({ id, version, status, purpose, text }) => ({
        id,
        version,
        status,
        purpose: purpose ?? null,
        text,
      })),
    })
  );
}
const identityOfRef = (ref: GmIndexRef, c: Campaign): unknown => {
  switch (ref.kind) {
    case GmIndexRefKind.Knowledge: {
      const record = c.knowledge?.find((r) => r.id === ref.id);
      if (!record) return null;
      const value = structuredClone(record);
      delete (value as Partial<typeof record>).revision;
      return value;
    }
    case GmIndexRefKind.Character: {
      const record = c.characters.find((r) => r.id === ref.characterId);
      if (!record) return null;
      const value = structuredClone(record);
      delete (value as Partial<typeof record>).notes;
      delete (value as Partial<typeof record>).revision;
      return value;
    }
    case GmIndexRefKind.CampaignField:
      return c[ref.field];
    case GmIndexRefKind.SourceSection: {
      const source = c.sources.find(
        (s) =>
          s.id === ref.sourceId && s.version === ref.version && s.status === SourceStatus.Confirmed
      );
      return source
        ? {
            text: sourceSections(source)[ref.sectionIndex]?.text ?? null,
            purpose: source.purpose ?? null,
            name: source.name,
          }
        : null;
    }
    case GmIndexRefKind.Turn:
      return ref;
    case GmIndexRefKind.RuleHint:
      return ref;
  }
};
export const gmIndexEntryIdentity = (
  entry: { refs: GmIndexRef[]; ownerCharacterId?: string | null },
  c: Campaign
) =>
  sha256(
    canonicalJson({
      refs: entry.refs.map((ref) => [ref, identityOfRef(ref, c)]),
      owner: entry.ownerCharacterId
        ? identityOfRef({ kind: GmIndexRefKind.Character, characterId: entry.ownerCharacterId }, c)
        : null,
      ...(entry.refs.length === 0 ? { state: c.state } : {}),
    })
  );
export function gmIndexSourceCoverage(c: Campaign) {
  return c.sources
    .filter((source) => source.status === SourceStatus.Confirmed)
    .flatMap((source) =>
      sourceSections(source).map((section) => ({
        sourceId: source.id,
        version: source.version,
        sectionIndex: section.index,
        contentHash: sha256(section.text),
      }))
    );
}
export function refreshGmIndexDependencies(
  document: GmIndexDocument,
  capture: GmIndexReferenceCapture
): GmIndexDocument {
  const next = structuredClone(document);
  const dependencies = (
    entries: { id: string; refs: GmIndexRef[]; ownerCharacterId?: string | null }[]
  ) =>
    entries.map((entry) => {
      let stale = false;
      try {
        validateGmIndexRefs(entry.refs, capture);
      } catch (error) {
        if (!(error instanceof Problem) || error.code !== 'gm_index_reference') throw error;
        stale = true;
      }
      if (
        entry.ownerCharacterId &&
        !capture.campaign.characters.some((c) => c.id === entry.ownerCharacterId)
      )
        stale = true;
      return {
        entryId: entry.id,
        contentHash: gmIndexEntryIdentity(entry, capture.campaign),
        stale,
      };
    });
  next.dependencyState = {
    ...next.dependencyState,
    canonicalHash: gmIndexCanonicalIdentity(capture.campaign),
    entries: dependencies(next.entries),
    foundation: dependencies(next.campaignFoundation),
  };
  return next;
}
/** Private notes are reference data; invalidated derived prose never reaches gameplay. */
export function projectFreshGmIndex(document: GmIndexDocument, c: Campaign) {
  const fresh = (
    entry: { id: string; refs: GmIndexRef[]; ownerCharacterId?: string | null },
    dependencies: GmIndexDocument['dependencyState']['entries']
  ) => {
    const prior = dependencies.find((d) => d.entryId === entry.id);
    return !!prior && !prior.stale && prior.contentHash === gmIndexEntryIdentity(entry, c);
  };
  return {
    campaignFoundation: document.campaignFoundation.filter((entry) =>
      fresh(entry, document.dependencyState.foundation)
    ),
    entries: document.entries.filter(
      (entry) =>
        entry.status === GmIndexEntryStatus.Active && fresh(entry, document.dependencyState.entries)
    ),
    diagnostics: {
      entries: indexBytes(document.entries, GM_INDEX_TARGETS.entriesBytes),
      foundation: indexBytes(document.campaignFoundation, GM_INDEX_TARGETS.foundationBytes),
    },
    refreshRequired:
      document.entries.some((entry) => !fresh(entry, document.dependencyState.entries)) ||
      document.campaignFoundation.some(
        (entry) => !fresh(entry, document.dependencyState.foundation)
      ) ||
      canonicalJson(gmIndexSourceCoverage(c)) !==
        canonicalJson(document.dependencyState.sourceCoverage),
  };
}
export function invalidateGmIndexAfterUndo(campaign: Campaign, turnId: string): void {
  const document = campaign.gmIndex?.document;
  if (!document) return;
  for (const [entries, dependencies] of [
    [document.entries, document.dependencyState.entries],
    [document.campaignFoundation, document.dependencyState.foundation],
  ] as const) {
    for (const entry of entries) {
      const prior = dependencies.find((d) => d.entryId === entry.id);
      if (
        prior &&
        (entry.refs.some((ref) => ref.kind === GmIndexRefKind.Turn && ref.turnId === turnId) ||
          prior.contentHash !== gmIndexEntryIdentity(entry, campaign))
      )
        prior.stale = true;
    }
  }
  if (document.lastCheckedTurnId === turnId) document.lastCheckedTurnId = null;
  document.dependencyState.turnCoverage = document.dependencyState.turnCoverage.filter(
    (v) => v.turnId !== turnId
  );
}

function indexBytes(value: unknown, targetBytes: number) {
  const suppliedBytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
  return { targetBytes, suppliedBytes, overflowBytes: Math.max(0, suppliedBytes - targetBytes) };
}
