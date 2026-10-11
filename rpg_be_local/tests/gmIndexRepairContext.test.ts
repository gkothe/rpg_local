import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectRepairEvidence } from '../src/services/responseRepairContext.js';

test('handoff repair retains private index evidence while a resolved operation repair omits it', () => {
  const evidence = {
    sourceSpans: [],
    ruleReads: [],
    knowledge: [],
    rolls: [],
    characters: [{ id: 'player', attributes: { health: 6 } }],
    state: { scene: 'Harbor' },
    gmIndex: { entries: [{ text: 'PRIVATE_REPAIR_INDEX_MARKER' }] },
  };
  const response = {
    operations: [
      {
        op: 'set',
        characterId: 'player',
        field: 'attributes',
        expected: { health: 6 },
        value: { health: 5 },
      },
    ],
    operationExplanations: [],
    gmIndexHandoff: [{ kind: 'task', text: 'Remember the armor.', refs: [] }],
  };
  const handoff = selectRepairEvidence(response, [['gmIndexHandoff', 0, 'refs']], evidence);
  assert.equal(handoff.mode, 'full');
  assert.ok(handoff.fallbackReasons.includes('private_index_context'));
  assert.equal(handoff.evidence, evidence);
  assert.match(JSON.stringify(handoff.evidence), /PRIVATE_REPAIR_INDEX_MARKER/);
  const operation = selectRepairEvidence(response, [['operations', 0, 'expected']], evidence);
  assert.equal(operation.mode, 'selected');
  assert.doesNotMatch(JSON.stringify(operation.evidence), /gmIndex|PRIVATE_REPAIR_INDEX_MARKER/);
  assert.deepEqual((operation.evidence as { characters: unknown }).characters, evidence.characters);
});
