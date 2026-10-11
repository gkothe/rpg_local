import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSheetWithRepair } from '../src/services/npcSheetGeneration.js';
import { npcSheetRequirementsSchema } from '../src/domain/npcSheet.js';
test('sheet repair touches only the invalid mechanical root and preserves the rest', async () => {
  const req = npcSheetRequirementsSchema.parse({
    version: 1,
    systemName: 'Synthetic game',
    edition: '1',
    category: 'Mortal',
    basis: 'model_knowledge',
    citations: [],
    applicability: ['Compact block'],
    fields: [{ path: ['attributes', 'hp'], type: 'number', min: 1, reason: 'Vitality' }],
  });
  const result = await validateSheetWithRepair(
    {
      attributes: {},
      inventory: { sword: true },
      rationales: [{ path: ['attributes', 'hp'], reason: 'Guard vitality' }],
      conflicts: [],
    },
    req,
    { attributes: {}, inventory: { sword: true } },
    {
      capacity: async () => 16000,
      generate: async (_settings, prompt) => {
        const input = JSON.parse(prompt);
        assert.deepEqual(input.allowedPaths, [['operations', 0, 'attributes']]);
        return { corrections: [{ path: ['operations', 0, 'attributes'], value: { hp: 8 } }] };
      },
    },
    { provider: 'openrouter', model: 'mock', effort: null }
  );
  assert.deepEqual(result.attributes, { hp: 8 });
  assert.deepEqual(result.inventory, { sword: true });
  assert.equal(result.rationales[0]!.reason, 'Guard vitality');
});
