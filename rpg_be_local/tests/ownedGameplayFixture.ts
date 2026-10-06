import { randomUUID } from 'node:crypto';
import { GameplayTools } from '../src/providers/gameplayTools.js';
import type { FrozenKnowledge } from '../src/domain/knowledgeRecall.js';
import type { GameplayResponse } from '../src/domain/gameplayResponse.js';
import type { Generator } from '../src/providers/service.js';
import { ExplanationBasis } from '../src/domain/operationExplanations.js';
import { KnowledgeOrigin, KnowledgeVisibility } from '../src/domain/knowledge.js';

/** An empty frozen registry for tests that exercise tools other than knowledge recall. */
export const emptyKnowledge = (campaignId: string = randomUUID()): FrozenKnowledge => ({
  campaignId,
  records: [],
  npcCharacters: [],
  characters: [],
  sourceIds: [],
  sourceVersions: [],
});

/** The owned gameplay registry with inert handlers; tests override the ones they exercise. */
export function ownedTools(
  options: Partial<ConstructorParameters<typeof GameplayTools>[0]> = {}
): GameplayTools {
  return new GameplayTools({
    book: false,
    assertActive: async () => {},
    roll: async () => {
      throw new Error('No roll expected');
    },
    knowledge: emptyKnowledge(),
    readCampaignSource: async () => ({}),
    prepareCombat: async () => ({}),
    ...options,
  });
}

/** An empty but complete GM response; spread overrides for the fields under test. */
export const emptyResponse = {
  narrative: 'The scene continues.',
  operations: [],
  rollInterpretations: [],
  ruleCitations: [],
  knowledgeChanges: [],
  operationExplanations: [],
  combatEffects: [],
  participantReferences: [],
};

/** A GM response whose every operation carries a provisional public explanation. */
export function gmResponse(
  narrative: string,
  operations: GameplayResponse['operations'],
  extra: Partial<GameplayResponse> = {}
): GameplayResponse {
  return {
    ...emptyResponse,
    narrative,
    operations,
    operationExplanations: operations.map((_, operationIndex) => ({
      operationIndex,
      reason: 'Synthetic consequence',
      basis: ExplanationBasis.Provisional,
      rollIds: [],
      evidence: [],
      visibility: KnowledgeVisibility.Player,
    })),
    ...extra,
  };
}
/** Public GM-improvised introduction provenance for a created character. */
export const gmIntroduction = {
  origin: KnowledgeOrigin.Gm,
  evidence: [],
  visibility: KnowledgeVisibility.Player,
};
/** Synthetic editor and summarizer: returns the supplied narrative unchanged, or a summary. */
export function syntheticGenerate(summary = 'Synthetic summary'): Generator['generate'] {
  return async (_settings, prompt, schema) => {
    const properties = (schema as { properties?: Record<string, unknown> }).properties ?? {};
    if ('narrative' in properties) return JSON.parse(/^\{"narrative":.*\}$/m.exec(prompt)![0]);
    if ('text' in properties) return { text: summary };
    throw new Error('Unexpected synthetic generate request');
  };
}
