import type { NpcProfile } from './continuity.js';

/** Short authored fields, not an expanding biography or a second history store. */
export function npcCore(profile: NpcProfile): Record<string, unknown> {
  return {
    characterId: profile.characterId,
    wants: profile.shortTermGoal,
    motive: profile.longTermGoal,
    boundaries: profile.boundaries,
    ...(profile.tension ? { tension: profile.tension } : {}),
    ...(profile.secret ? { secret: profile.secret } : {}),
  };
}
