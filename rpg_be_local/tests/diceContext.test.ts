import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newCampaign } from '../src/domain/campaign.js';
import { diceDigest, gameplayDigest } from '../src/domain/diceContext.js';

test('gameplay digest fingerprints canonical campaign input without private notes', () => {
  const c = newCampaign({ name: 'Digest' });
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
  c.state = { scene: 'Gate' };
  const expected = {
    knowledge: [],
    description: c.description,
    instructions: c.instructions,
    characters: [],
    sources: [
      { id: c.sources[0]!.id, version: 1, status: 'confirmed', text: 'Gate', purpose: 'reference' },
    ],
    pinnedSourceIds: [],
    pinnedSourceSections: [],
    budgets: c.budgets,
    state: c.state,
    memory: null,
    history: [],
  };
  assert.equal(gameplayDigest(c, []), diceDigest(expected));
  assert.equal(gameplayDigest({ ...c, knowledge: undefined }, []), gameplayDigest(c, []));
  const noted = { ...c, notes: 'private', notesRevision: 1 };
  assert.equal(gameplayDigest(noted, []), gameplayDigest(c, []));
  assert.notEqual(gameplayDigest({ ...c, state: { scene: 'Hall' } }, []), gameplayDigest(c, []));
});
