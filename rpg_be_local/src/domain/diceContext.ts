import { createHash } from 'node:crypto';
import type { Campaign, Turn } from './types.js';
export function diceDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export function gameplayDigest(campaign: Campaign, history: Turn[]): string {
  return diceDigest({
    description: campaign.description,
    instructions: campaign.instructions,
    characters: campaign.characters.map(
      ({ notes: _notes, revision: _revision, ...character }) => character
    ),
    sources: campaign.sources.map(({ id, version, status, text }) => ({
      id,
      version,
      status,
      text,
    })),
    pinnedFacts: campaign.pinnedFacts,
    pinnedSourceIds: campaign.pinnedSourceIds,
    pinnedSourceSections: campaign.pinnedSourceSections ?? [],
    budgets: campaign.budgets,
    state: campaign.state,
    memory: campaign.memory,
    history: history.map((turn) => turn.id),
  });
}
