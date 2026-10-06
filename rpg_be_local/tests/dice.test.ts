import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diceInputSchema, generateFaces } from '../src/domain/dice.js';
import { gameplayDigest } from '../src/domain/diceContext.js';
import { newCampaign } from '../src/domain/campaign.js';
test('retry identity ignores private notes/provider preferences but changes with gameplay state', () => {
  const campaign = newCampaign({ name: 'Digest fixture' });
  const digest = gameplayDigest(campaign, []);
  campaign.notes = 'Private notes';
  campaign.notesRevision++;
  campaign.revision++;
  campaign.settings = { provider: 'codex', model: 'other', effort: 'low' };
  campaign.updatedAt = new Date().toISOString();
  assert.equal(gameplayDigest(campaign, []), digest);
  campaign.state = { door: 'open' };
  assert.notEqual(gameplayDigest(campaign, []), digest);
});

const input = {
  slot: 0,
  groups: [{ label: 'check', count: 3, sides: 10 }],
  reason: 'Test a check',
  declaration: 'No modifiers; target unknown',
  scope: 'oracle',
};
test('dice generate individual bounded faces sequentially and never perform interpretation', () => {
  const calls: [number, number][] = [];
  const groups = generateFaces(diceInputSchema.parse(input), (min, max) => {
    calls.push([min, max]);
    return min + calls.length - 1;
  });
  assert.deepEqual(groups, [{ label: 'check', sides: 10, faces: [1, 2, 3] }]);
  assert.deepEqual(calls, [
    [1, 11],
    [1, 11],
    [1, 11],
  ]);
  for (let i = 0; i < 20; i++) {
    const actual = generateFaces(diceInputSchema.parse(input));
    assert.ok(actual[0]!.faces.every((face) => Number.isInteger(face) && face >= 1 && face <= 10));
  }
});
test('dice reject extra fields, invalid ranges, duplicate labels and excessive faces/bytes', () => {
  for (const value of [
    { ...input, slot: 12 },
    { ...input, faces: [20] },
    { ...input, groups: [{ label: 'check', count: 51, sides: 10 }] },
    { ...input, groups: [{ label: 'check', count: 1, sides: 1 }] },
    { ...input, groups: [{ label: 'check', count: 1, sides: 1000001 }] },
    { ...input, groups: [input.groups[0], input.groups[0]] },
    {
      ...input,
      groups: Array.from({ length: 8 }, (_, i) => ({ label: String(i), count: 50, sides: 6 })),
    },
    { ...input, reason: '' },
    {
      ...input,
      groups: Array.from({ length: 8 }, (_, i) => ({
        label: String(i) + '漢'.repeat(79),
        count: 1,
        sides: 6,
      })),
      declaration: '漢'.repeat(600),
      reason: '漢'.repeat(240),
    },
  ])
    assert.equal(diceInputSchema.safeParse(value).success, false);
});
