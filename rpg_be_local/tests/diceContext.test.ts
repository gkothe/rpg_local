import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newCampaign } from '../src/domain/campaign.js';
import { diceDigest, gameplayDigest } from '../src/domain/diceContext.js';
test('legacy digest retains original keys and ignores new empty knowledge while new digest includes canonical registry', () => {
  const c = newCampaign({ name: 'Legacy' });
  const original = {
    description: c.description,
    instructions: c.instructions,
    characters: [],
    sources: [],
    pinnedFacts: [],
    pinnedSourceIds: [],
    pinnedSourceSections: [],
    budgets: c.budgets,
    state: {},
    memory: null,
    history: [],
  };
  const old = diceDigest(original);
  assert.equal(gameplayDigest(c, []), old);
  c.knowledge = [];
  assert.equal(gameplayDigest(c, [], undefined, 1), old);
  assert.notEqual(gameplayDigest(c, [], undefined, 2), old);
  assert.equal(
    gameplayDigest({ ...c, knowledge: undefined }, [], undefined, 2),
    gameplayDigest(c, [], undefined, 2)
  );
});

test('digest 4 keeps the digest 3 content and adds only the combat contract identity', () => {
  const c = newCampaign({ name: 'Combat digest' });
  c.sources = [
    {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Notes',
      kind: 'text',
      text: 'Gate',
      status: 'confirmed',
      version: 1,
      pages: [],
      warnings: [],
    },
  ];
  c.state = { combat: { soldiers: 2 } };
  const v3 = {
    knowledge: [],
    description: c.description,
    instructions: c.instructions,
    characters: [],
    sources: [
      { id: c.sources[0]!.id, version: 1, status: 'confirmed', text: 'Gate', purpose: 'reference' },
    ],
    pinnedFacts: [],
    pinnedSourceIds: [],
    pinnedSourceSections: [],
    budgets: c.budgets,
    state: c.state,
    memory: null,
    history: [],
  };
  assert.equal(gameplayDigest(c, [], undefined, 3), diceDigest(v3));
  assert.equal(gameplayDigest(c, [], undefined, 4), diceDigest({ ...v3, combatTracking: 1 }));
  assert.notEqual(gameplayDigest(c, [], undefined, 4), gameplayDigest(c, [], undefined, 3));
});
