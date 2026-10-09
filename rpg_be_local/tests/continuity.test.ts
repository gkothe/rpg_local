import { CharacterType } from '../src/domain/options.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { newCampaign } from '../src/domain/campaign.js';
import { applyResponse, undoSnapshot } from '../src/domain/state.js';
import { gmResponse, gmIntroduction } from './ownedGameplayFixture.js';
import { continuitySchema } from '../src/domain/continuity.js';
import { publicCampaign, publicTurn } from '../src/domain/playerProjection.js';
import { assertContinuity } from '../src/domain/continuityCompatibility.js';
import { resolveKnowledgeRef } from '../src/domain/responseReferences.js';
import { mapResponseCitations } from '../src/domain/citationInput.js';

import { core } from './npcFixture.js';
test('same-turn profiles resolve created NPC/introduction IDs, stay private and undo atomically', () => {
  const c = newCampaign({ name: 'Inn' });
  const response = gmResponse(
    'Mara offers a contract.',
    [
      {
        op: 'create',
        character: {
          name: 'Mara',
          type: CharacterType.Npc,
          description: { role: 'Innkeeper' },
          attributes: {},
          inventory: {},
        },
        introduction: gmIntroduction,
      },
    ],
    {
      continuityChanges: [
        {
          op: 'create',
          characterId: { operationIndex: 0 },
          expected: null,
          next: { ...core, revealedTraitKnowledgeIds: [{ npcIntroductionOperationIndex: 0 }] },
          origin: gmIntroduction.origin,
          evidence: [],
          explanation: 'Private core',
        },
      ],
    }
  );
  const applied = applyResponse(c, response, randomUUID());
  const p = applied.campaign.continuity!.npcProfiles[0]!;
  assert.equal(p.characterId, applied.campaign.characters[0]!.id);
  assert.equal(p.revealedTraitKnowledgeIds[0], applied.campaign.knowledge![0]!.id);
  assert.ok(!JSON.stringify(publicCampaign(applied.campaign)).includes(core.secret));
  assert.ok(!JSON.stringify(applied.changes).includes(core.secret));
  const undone = undoSnapshot(applied.campaign, applied.snapshot);
  assert.equal(undone.characters.length, 0);
  assert.equal(undone.continuity?.npcProfiles.length, 0);
});
test('profile removal undo preserves unrelated profiles and refuses overwritten after-values', () => {
  const c = newCampaign({ name: 'Inn' });
  for (const name of ['Mara', 'Other'])
    c.characters.push({
      id: randomUUID(),
      name,
      type: CharacterType.Npc,
      attributes: {},
      inventory: {},
      description: {},
      notes: '',
      revision: 0,
    });
  c.continuity = { npcProfiles: c.characters.map((x) => ({ ...core, characterId: x.id })) };
  const profile = c.continuity.npcProfiles[0]!;
  const r = applyResponse(
    c,
    gmResponse('A profile is removed.', [], {
      continuityChanges: [
        {
          op: 'remove',
          characterId: profile.characterId,
          expected: profile,
          next: null,
          explanation: 'Remove obsolete guidance',
          origin: gmIntroduction.origin,
          evidence: [],
        },
      ],
    }),
    randomUUID()
  );
  r.campaign.continuity!.npcProfiles[0]!.longTermGoal = 'Later unrelated edit';
  const undone = undoSnapshot(r.campaign, r.snapshot);
  assert.equal(
    undone.continuity!.npcProfiles.find((p) => p.characterId === c.characters[1]!.id)!.longTermGoal,
    'Later unrelated edit'
  );
  r.campaign.continuity!.npcProfiles.push(profile);
  assert.throws(() => undoSnapshot(r.campaign, r.snapshot), /profile changed/);
});
test('constraints, alias kinds, freeze compatibility and citation visitor fail closed', () => {
  const p = { ...core, characterId: randomUUID() };
  assert.equal(continuitySchema.safeParse({ npcProfiles: [p, p] }).success, false);
  assert.equal(
    continuitySchema.safeParse({ npcProfiles: [{ ...p, boundaries: ['same', 'same'] }] }).success,
    false
  );
  assert.throws(
    () =>
      resolveKnowledgeRef(
        { knowledgeChangeIndex: 2 },
        { characters: new Map([[2, randomUUID()]]), knowledge: new Map(), introductions: new Map() }
      ),
    /resolve/
  );
  const c = newCampaign({ name: 'Frozen' });
  c.continuity = { npcProfiles: [p] };
  assertContinuity({ npcProfiles: [p] }, c);
  c.continuity.npcProfiles[0]!.secret = 'Changed';
  assert.throws(
    () => assertContinuity({ npcProfiles: [{ ...p, secret: core.secret }] }, c),
    /profile changed/
  );
  let visited = 0;
  mapResponseCitations(
    { continuityChanges: [{ evidence: [{ type: 'campaign_source', quote: 'test' }] }] },
    () => {
      visited++;
    }
  );
  assert.equal(visited, 1);
});
test('private turn context remains excluded from player projection', () => {
  const raw = {
    context: { frozenContinuity: { npcProfiles: [{ ...core, characterId: randomUUID() }] } },
  };
  assert.equal(publicTurn(raw as unknown as Parameters<typeof publicTurn>[0]).context, null);
});
