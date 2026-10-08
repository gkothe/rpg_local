import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import type { Store } from '../src/store.js';
import type { Generator } from '../src/providers/service.js';
import { AdvancementService, type AdvancementReview } from '../src/services/advancement.js';
import {
  AdvancementBasis as Basis,
  AdvancementKind as Kind,
  AdvancementOutcome as Outcome,
  AdvancementStatus as Status,
  type AdvancementProposal,
} from '../src/domain/advancement.js';
import { CharacterType } from '../src/domain/options.js';
import { seedCampaign, sleep } from './journalFixture.js';

export async function advancementFixture(store: Store) {
  const f = await seedCampaign(store, [
    { action: 'Rescue the merchant', narrative: 'The merchant is safely rescued.' },
  ]);
  const characterId = randomUUID();
  f.campaign.characters.push({
    id: characterId,
    name: 'Historical player',
    type: CharacterType.Player,
    attributes: { xp: 321 },
    inventory: {},
    description: {},
    notes: 'Private notes',
    revision: 0,
  });
  await store.transaction(async (client) => store.save(f.campaign, client));
  return { ...f, characterId };
}
export function advancementProvider(characterId: string) {
  const calls: Record<string, unknown>[] = [];
  const generator: Generator = {
    capacity: async () => 16000,
    generate: async () => {
      throw new Error('Unexpected generation fallback');
    },
    generateOwnedGameplay: async (_settings, prompt) => {
      const input = JSON.parse(prompt) as Record<string, unknown>;
      calls.push(input);
      return {
        outcome: Outcome.Reviewed,
        rewardSystem: { key: 'test_edition', label: 'Test game', editionLabel: 'Edition 1' },
        explanation: 'Rescued the merchant.',
        progressionBasis: 'Ten XP for completed objectives during continuous play.',
        progressionBasisKind: Basis.HouseRule,
        awards: [
          {
            characterId,
            kind: Kind.Resource,
            unitKey: 'xp',
            unitLabel: 'XP',
            amount: 10,
            reason: 'Merchant rescued',
            basis: 'Objective reward',
            basisKind: Basis.HouseRule,
            evidenceTurnIds: (input.unreviewedTurns as { id: string }[]).map((t) => t.id),
          },
        ],
        cumulativeSummary: 'The merchant is safe.',
        pendingObjectives: [],
        ruleEvidence: [],
      } satisfies AdvancementProposal;
    },
  };
  return { generator, calls };
}
export async function stagedReview(
  service: AdvancementService,
  campaignId: string
): Promise<AdvancementReview> {
  const started = await service.start(campaignId, randomUUID());
  assert.ok(started);
  for (let i = 0; i < 300; i++) {
    const r = await service.status(campaignId, started.id);
    if (r.status !== Status.Running) {
      assert.equal(r.status, Status.Ready, r.safeError ?? 'Expected staged proposal');
      return r;
    }
    await sleep(15);
  }
  throw new Error('Review did not complete');
}
export async function applyReview(service: AdvancementService, r: AdvancementReview) {
  return service.decide(r.campaignId, r.id, 'apply', {
    requestId: randomUUID(),
    proposalDigest: r.proposalDigest!,
  });
}
