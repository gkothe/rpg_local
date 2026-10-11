import { test } from 'node:test';
import assert from 'node:assert/strict';
import { npcSheetRequirementsSchema, validateNpcSheet } from '../src/domain/npcSheet.js';

const requirements = () =>
  npcSheetRequirementsSchema.parse({
    version: 1,
    systemName: 'Synthetic skill game',
    edition: '1',
    category: 'Mortal',
    basis: 'model_knowledge',
    applicability: ['No supernatural powers for mortals'],
    citations: [],
    fields: [
      {
        path: ['attributes', 'skills', 'Athletics'],
        type: 'number',
        min: 0,
        max: 5,
        integer: true,
        reason: 'Full skill catalog',
      },
      {
        path: ['attributes', 'skills', 'Lore'],
        type: 'number',
        min: 0,
        max: 5,
        integer: true,
        reason: 'Full skill catalog',
      },
      { path: ['attributes', 'health'], type: 'number', min: 1, reason: 'Required vitality' },
    ],
  });
test('complete skill catalog includes zero skills and preserves established values', () => {
  const sheet = { attributes: { skills: { Athletics: 0, Lore: 2 }, health: 8 }, inventory: {} };
  assert.doesNotThrow(() =>
    validateNpcSheet(requirements(), sheet, {
      attributes: { skills: { Athletics: 0 } },
      inventory: {},
    })
  );
  assert.throws(
    () =>
      validateNpcSheet(
        requirements(),
        { ...sheet, attributes: { skills: { Athletics: 1, Lore: 2 }, health: 8 } },
        { attributes: { skills: { Athletics: 0 } }, inventory: {} }
      ),
    /established/
  );
});
test('missing catalog entries, wrong types, ranges and empty contracts fail', () => {
  for (const attrs of [
    { skills: { Athletics: 0 }, health: 8 },
    { skills: { Athletics: '0', Lore: 1 }, health: 8 },
    { skills: { Athletics: 6, Lore: 1 }, health: 8 },
  ])
    assert.throws(() => validateNpcSheet(requirements(), { attributes: attrs, inventory: {} }));
  assert.equal(
    npcSheetRequirementsSchema.safeParse({ ...requirements(), fields: [] }).success,
    false
  );
});
test('compact NPC stat blocks do not require unrelated player fields', () => {
  const req = npcSheetRequirementsSchema.parse({
    ...requirements(),
    systemName: 'Compact game',
    fields: [
      { path: ['attributes', 'difficulty'], type: 'number', reason: 'Complete NPC block', min: 1 },
    ],
  });
  assert.doesNotThrow(() =>
    validateNpcSheet(req, { attributes: { difficulty: 3 }, inventory: {} })
  );
});
test('unsafe and overlapping paths are rejected', () => {
  for (const path of [['attributes', '__proto__'], ['notes'], ['inventory', 'constructor']])
    assert.equal(
      npcSheetRequirementsSchema.safeParse({
        ...requirements(),
        fields: [{ path, type: 'number', reason: 'Bad' }],
      }).success,
      false
    );
  assert.equal(
    npcSheetRequirementsSchema.safeParse({
      ...requirements(),
      fields: [
        { path: ['attributes', 'skills'], type: 'object', reason: 'Parent' },
        requirements().fields[0],
      ],
    }).success,
    false
  );
});
test('false, empty strings and arrays are preserved and inherited fields never satisfy coverage', () => {
  const req = npcSheetRequirementsSchema.parse({
    ...requirements(),
    fields: [{ path: ['attributes', 'flag'], type: 'boolean', reason: 'Flag' }],
  });
  assert.throws(
    () =>
      validateNpcSheet(
        req,
        { attributes: { flag: true, label: 'new', tags: ['x'] }, inventory: {} },
        { attributes: { flag: false, label: '', tags: [] }, inventory: {} }
      ),
    /established/
  );
  assert.throws(() =>
    validateNpcSheet(req, {
      attributes: Object.create({ flag: false }) as Record<string, unknown>,
      inventory: {},
    })
  );
});
