import { SourcePurpose } from './options.js';
import { createHash } from 'node:crypto';
import type { Campaign, Turn } from './types.js';
import type { RuleContext } from './rules.js';
export function diceDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
/** Audit fingerprint of the campaign input a dice session was created from. */
export function gameplayDigest(
  campaign: Campaign,
  history: Turn[],
  ruleContext?: RuleContext
): string {
  return diceDigest({
    knowledge: campaign.knowledge ?? [],
    ...(campaign.continuity ? { continuity: campaign.continuity } : {}),
    ...(ruleContext
      ? {
          rules: {
            systemId: ruleContext.systemId,
            revision: ruleContext.revision,
            kind: ruleContext.kind,
            contentHash: ruleContext.contentHash,
          },
        }
      : {}),
    description: campaign.description,
    instructions: campaign.instructions,
    characters: campaign.characters.map(
      ({ notes: _notes, revision: _revision, ...character }) => character
    ),
    sources: campaign.sources.map((source) => ({
      id: source.id,
      version: source.version,
      status: source.status,
      text: source.text,
      purpose: source.purpose ?? SourcePurpose.Reference,
    })),
    pinnedSourceIds: campaign.pinnedSourceIds,
    pinnedSourceSections: campaign.pinnedSourceSections ?? [],
    budgets: campaign.budgets,
    state: campaign.state,
    memory: campaign.memory,
    history: history.map((turn) => turn.id),
  });
}
