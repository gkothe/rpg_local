import type { Archive } from '../domain/types.js';
import type { GmIndexDocument } from '../domain/gmIndex.js';
import { GmIndexRefKind } from '../domain/gmIndexRefs.js';
import { canonicalJson } from '../domain/journalLedger.js';
import { refreshGmIndexDependencies } from '../domain/gmIndexCompatibility.js';
import type { SourceLocator } from '../domain/historyRecall.js';

export function gmIndexDocuments(archive: Archive): GmIndexDocument[] {
  return [
    ...(archive.campaign.gmIndex ? [archive.campaign.gmIndex.document] : []),
    ...archive.snapshots.flatMap((snapshot) =>
      [snapshot.beforeGmIndexDocument, snapshot.afterGmIndexDocument].filter(
        (document): document is GmIndexDocument => !!document
      )
    ),
    ...archive.turns.flatMap((turn) =>
      turn.context?.frozenGmIndex ? [turn.context.frozenGmIndex.document] : []
    ),
    ...archive.diceSessions.flatMap((session) =>
      session.frozenGmIndex ? [session.frozenGmIndex.document] : []
    ),
  ];
}
/** Identical before/after/live documents share the same transformation, preserving undo equality. */
export function remapGmIndexDocuments(
  archive: Archive,
  mapped: (id: string) => string,
  versions: ReadonlyMap<string, SourceLocator>
): void {
  const cache = new Map<string, GmIndexDocument>();
  for (const document of gmIndexDocuments(archive)) {
    const key = canonicalJson(document);
    const cached = cache.get(key);
    if (cached) {
      Object.assign(document, structuredClone(cached));
      continue;
    }
    const next = structuredClone(document);
    next.generationId = mapped(next.generationId);
    if (next.lastCheckedTurnId) next.lastCheckedTurnId = mapped(next.lastCheckedTurnId);
    for (const entry of [...next.entries, ...next.campaignFoundation]) {
      entry.id = mapped(entry.id);
      if ('ownerCharacterId' in entry && entry.ownerCharacterId)
        entry.ownerCharacterId = mapped(entry.ownerCharacterId);
      for (const ref of entry.refs) {
        switch (ref.kind) {
          case GmIndexRefKind.Knowledge:
            ref.id = mapped(ref.id);
            break;
          case GmIndexRefKind.Character:
            ref.characterId = mapped(ref.characterId);
            break;
          case GmIndexRefKind.SourceSection:
            ref.sourceId = mapped(ref.sourceId);
            break;
          case GmIndexRefKind.Turn: {
            const original = versions.get(`${ref.turnId}:${ref.contentHash}`);
            if (original) Object.assign(ref, original);
            else ref.turnId = mapped(ref.turnId);
            break;
          }
          case GmIndexRefKind.CampaignField:
          case GmIndexRefKind.RuleHint:
            break;
        }
      }
    }
    next.dependencyState.sourceCoverage.forEach((section) => {
      section.sourceId = mapped(section.sourceId);
    });
    next.dependencyState.turnCoverage = next.dependencyState.turnCoverage.map(
      (locator) =>
        versions.get(`${locator.turnId}:${locator.contentHash}`) ?? {
          ...locator,
          turnId: mapped(locator.turnId),
        }
    );
    const refreshed = refreshGmIndexDependencies(next, {
      campaign: archive.campaign,
      turns: (archive.historyTurnVersions ?? []).map(({ turnId, contentHash }) => ({
        turnId,
        contentHash,
      })),
    });
    // A stale dependency must stay stale even if remapping makes its locator mechanically valid.
    for (const [prior, deps] of [
      [document.dependencyState.entries, refreshed.dependencyState.entries],
      [document.dependencyState.foundation, refreshed.dependencyState.foundation],
    ] as const)
      for (const dependency of prior) {
        if (dependency.stale) {
          const remapped = deps.find((d) => d.entryId === mapped(dependency.entryId));
          if (remapped) remapped.stale = true;
        }
      }
    Object.assign(document, refreshed);
    cache.set(key, structuredClone(refreshed));
  }
  if (archive.campaign.gmIndex?.settings.activationHistoryBaseline.modeDecisionId)
    archive.campaign.gmIndex.settings.activationHistoryBaseline.modeDecisionId = mapped(
      archive.campaign.gmIndex.settings.activationHistoryBaseline.modeDecisionId
    );
}
