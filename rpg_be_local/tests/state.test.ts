import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyResponse, undoSnapshot } from '../src/domain/state.js';
import { newCampaign } from '../src/domain/campaign.js';
test('turn changes existing NPC and undo restores health and removes new NPC while preserving notes', () => {
  const c = newCampaign({ name: 'Test' });
  c.characters.push({
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Marta',
    type: 'npc',
    attributes: { hp: 12 },
    inventory: { key: 1 },
    description: {},
    notes: 'my note',
    revision: 0,
  });
  const r = applyResponse(
    c,
    {
      version: 1,
      narrative: 'Fight',
      operations: [
        {
          op: 'set',
          characterId: c.characters[0]!.id,
          field: 'attributes',
          expected: { hp: 12 },
          value: { hp: 5 },
        },
        {
          op: 'create',
          character: { name: 'Guard', type: 'npc', attributes: {}, inventory: {}, description: {} },
        },
      ],
    },
    'turn'
  );
  assert.equal(r.campaign.characters[0]!.attributes.hp, 5);
  assert.equal(r.campaign.characters.length, 2);
  r.campaign.characters[0]!.notes = 'later private note';
  const restored = undoSnapshot(r.campaign, r.snapshot);
  assert.equal(restored.characters[0]!.attributes.hp, 12);
  assert.equal(restored.characters.length, 1);
  assert.equal(restored.characters[0]!.notes, 'later private note');
});
test('invalid cross-campaign mutation applies nothing and conflicting manual change blocks undo', () => {
  const c = newCampaign({ name: 'Test' });
  assert.throws(
    () =>
      applyResponse(
        c,
        {
          version: 1,
          narrative: 'no',
          operations: [
            {
              op: 'set',
              characterId: '11111111-1111-4111-8111-111111111111',
              field: 'inventory',
              expected: {},
              value: { gold: 100 },
            },
          ],
        },
        't'
      ),
    /not in this campaign/
  );
  const r = applyResponse(
    c,
    {
      version: 1,
      narrative: 'ok',
      operations: [{ op: 'state', expected: {}, value: { door: 'open' } }],
    },
    't'
  );
  r.campaign.state = { door: 'locked' };
  assert.throws(() => undoSnapshot(r.campaign, r.snapshot), /manually changed/);
  assert.deepEqual(c.state, {});
});
test('undo preserves manual changes to untouched character fields and unrelated campaign state', () => {
  const c = newCampaign({ name: 'Test' });
  const id = '11111111-1111-4111-8111-111111111111';
  c.characters.push({
    id,
    name: 'Marta',
    type: 'npc',
    attributes: { hp: 12 },
    inventory: { key: 1 },
    description: {},
    notes: '',
    revision: 0,
  });
  const result = applyResponse(
    c,
    {
      version: 1,
      narrative: 'Fight',
      operations: [
        { op: 'set', characterId: id, field: 'attributes', expected: { hp: 12 }, value: { hp: 5 } },
      ],
    },
    'turn'
  );
  result.campaign.characters[0]!.inventory = { key: 1, manualGem: 1 };
  result.campaign.state = { manualScene: 'camp' };
  const restored = undoSnapshot(result.campaign, result.snapshot);
  assert.deepEqual(restored.characters[0]!.attributes, { hp: 12 });
  assert.deepEqual(restored.characters[0]!.inventory, { key: 1, manualGem: 1 });
  assert.deepEqual(restored.state, { manualScene: 'camp' });
});
