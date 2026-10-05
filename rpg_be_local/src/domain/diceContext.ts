import { SourcePurpose } from './options.js';
import { legacyKnowledge } from './knowledge.js';
import {
  AUDITED_GAMEPLAY_DIGEST_VERSION,
  KNOWLEDGE_GAMEPLAY_DIGEST_VERSION,
  LEGACY_GAMEPLAY_DIGEST_VERSION,
} from './versions.js';
import { createHash } from 'node:crypto';
import type { Campaign, Turn } from './types.js';
import type { RuleContext } from './rules.js';
export function diceDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export function gameplayDigest(
  campaign: Campaign,
  history: Turn[],
  ruleContext?: RuleContext,
  digestVersion = LEGACY_GAMEPLAY_DIGEST_VERSION
): string {
  return diceDigest({
    ...(digestVersion >= KNOWLEDGE_GAMEPLAY_DIGEST_VERSION
      ? {
          knowledge:
            digestVersion === KNOWLEDGE_GAMEPLAY_DIGEST_VERSION
              ? legacyKnowledge(campaign.knowledge ?? [])
              : (campaign.knowledge ?? []),
        }
      : {}),
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
    // Historical retry digests retain this metadata; it is not included in GM prompts.
    description: campaign.description,
    instructions: campaign.instructions,
    characters: campaign.characters.map(
      ({ notes: _notes, revision: _revision, ...character }) => character
    ),
    sources: campaign.sources.map((source) => {
      const { id, version, status, text } = source;
      return {
        id,
        version,
        status,
        text,
        ...(digestVersion === AUDITED_GAMEPLAY_DIGEST_VERSION
          ? { purpose: source.purpose ?? SourcePurpose.Reference }
          : {}),
      };
    }),
    // Keep the retired empty slot in the immutable digest contract for saved-dice retries.
    pinnedFacts: [],
    pinnedSourceIds: campaign.pinnedSourceIds,
    pinnedSourceSections: campaign.pinnedSourceSections ?? [],
    budgets: campaign.budgets,
    state: campaign.state,
    memory: campaign.memory,
    history: history.map((turn) => turn.id),
  });
}
