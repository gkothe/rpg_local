import { Problem } from '../errors.js';
import { continuitySchema, npcProfileSchema, type NpcProfile } from '../domain/continuity.js';
import type { Campaign, Snapshot } from '../domain/types.js';

export function remapProfile(profile: NpcProfile, mapped: (id: string) => string): void {
  profile.characterId = mapped(profile.characterId);
  profile.relationshipKnowledgeIds = profile.relationshipKnowledgeIds.map(mapped);
  profile.revealedTraitKnowledgeIds = profile.revealedTraitKnowledgeIds.map(mapped);
}
export function validateProfileLinks(
  profiles: NpcProfile[],
  character: (id: string) => void,
  knowledgeIds: ReadonlySet<string>
): void {
  continuitySchema.parse({ npcProfiles: profiles });
  for (const value of profiles) {
    const p = npcProfileSchema.parse(value);
    character(p.characterId);
    for (const id of [...p.relationshipKnowledgeIds, ...p.revealedTraitKnowledgeIds])
      if (!knowledgeIds.has(id))
        throw new Problem(422, 'archive_invalid', 'NPC profile links unknown knowledge');
  }
}
export function profileCollections(campaign: Campaign, snapshots: Snapshot[]): NpcProfile[][] {
  return [
    campaign.continuity?.npcProfiles ?? [],
    ...snapshots.flatMap((s) => [s.beforeContinuity ?? [], s.afterContinuity ?? []]),
  ];
}
