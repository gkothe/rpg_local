import { isDeepStrictEqual } from 'node:util';
import { Problem } from '../errors.js';
import type { Campaign } from './types.js';
import type { FrozenContinuity } from './continuity.js';

export function continuityConflict(
  frozen: FrozenContinuity | undefined,
  campaign: Campaign
): string | null {
  if (!frozen) return null;
  for (const profile of frozen.npcProfiles)
    if (
      !isDeepStrictEqual(
        profile,
        campaign.continuity?.npcProfiles.find((p) => p.characterId === profile.characterId)
      )
    )
      return 'NPC profile changed since this action was prepared';
  return null;
}
export function assertContinuity(frozen: FrozenContinuity | undefined, campaign: Campaign): void {
  const reason = continuityConflict(frozen, campaign);
  if (reason) throw new Problem(409, 'npc_context_changed', reason);
}
