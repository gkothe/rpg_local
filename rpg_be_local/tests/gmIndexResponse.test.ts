import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameplayResponseContract } from '../src/domain/gameplayResponse.js';
import { GmIndexContractVersion } from '../src/domain/gmIndex.js';

const response = {
  narrative: 'The trader greets you.',
  operations: [],
  rollInterpretations: [],
  ruleCitations: [],
  knowledgeChanges: [],
  operationExplanations: [],
  combatEffects: [],
  participantReferences: [],
};
test('only indexed executions require a private handoff; legacy contracts remain unchanged', () => {
  const legacy = gameplayResponseContract();
  const indexed = gameplayResponseContract(1);
  assert.throws(() => gameplayResponseContract(2 as GmIndexContractVersion), /Unsupported/);
  assert.equal(legacy.inputSchema.safeParse(response).success, true);
  assert.equal(legacy.inputSchema.safeParse({ ...response, gmIndexHandoff: [] }).success, false);
  assert.equal(indexed.inputSchema.safeParse(response).success, false);
  assert.equal(indexed.inputSchema.safeParse({ ...response, gmIndexHandoff: [] }).success, true);
  assert.equal(
    indexed.inputSchema.safeParse({
      ...response,
      gmIndexHandoff: [{ kind: 'fact', text: 'The trader is a spy.', refs: [] }],
    }).success,
    false
  );
  assert.equal(
    indexed.inputSchema.safeParse({
      ...response,
      gmIndexHandoff: [{ kind: 'task', text: 'Remember the promised armor.', refs: [] }],
    }).success,
    true
  );
  const schema = indexed.wireJsonSchema as {
    properties: Record<string, unknown>;
    required: string[];
  };
  assert.ok(schema.required.includes('gmIndexHandoff'));
  assert.ok(Buffer.byteLength(JSON.stringify(schema.properties.gmIndexHandoff), 'utf8') < 8192);
  assert.doesNotMatch(
    JSON.stringify(schema.properties.gmIndexHandoff),
    /gmIndexChanges|gmFoundationChanges|knowledgeChanges/
  );
});
