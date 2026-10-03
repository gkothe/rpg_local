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
