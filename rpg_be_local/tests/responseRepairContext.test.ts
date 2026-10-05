import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectRepairEvidence } from '../src/services/responseRepairContext.js';
import { validateWithFieldRepair } from '../src/services/responseRepair.js';
import { ResponseFieldProblem } from '../src/domain/responseFields.js';
import { Problem } from '../src/errors.js';
import type { Generator } from '../src/providers/service.js';

const bundle = () => ({
  sourceSpans: [
    { id: 'source-a', version: 1, text: 'Original relevant text.', start: 0, end: 23 },
    { id: 'source-a', version: 2, text: 'Different version.' },
    { id: 'source-b', version: 1, text: 'Unrelated text.' },
  ],
  ruleReads: [
    { id: 'receipt-a', payload: { text: 'Original rule.', source: 'book-a', start: 50 } },
    { id: 'receipt-b', payload: { text: 'Unrelated rule.' } },
  ],
  characters: [{ id: 'player', attributes: { health: 6 } }, { id: 'unrelated-npc' }],
  knowledge: [{ id: 'record-a', text: 'Previous fact.' }, { id: 'record-b' }],
  rolls: [{ id: 'roll-a', groups: [{ faces: [4, 8] }] }, { id: 'roll-b' }],
  state: { gate: 'open' },
});

test('knowledge provenance repair retains exact referenced source/version and omits unrelated material', () => {
  const evidence = bundle();
  const response = {
    knowledgeChanges: [
      {
        op: 'create',
        origin: 'gm',
        characterIds: ['player'],
        holderId: null,
        evidence: [
          { type: 'campaign_source', sourceId: 'source-a', version: 1, quote: 'Incorrect quote' },
        ],
      },
    ],
  };
  const selected = selectRepairEvidence(response, [['knowledgeChanges', 0]], evidence);
  assert.equal(selected.mode, 'selected');
  assert.deepEqual(selected.evidence, {
    sourceSpans: [evidence.sourceSpans[0]],
    characters: [evidence.characters[0]],
    ruleReads: [],
    knowledge: [],
    rolls: [],
  });
});

test('operation repair follows indexed explanation, saved dice, book receipt and earlier mutations', () => {
  const evidence = bundle();
  const response = {
    operations: [
      { op: 'set', characterId: 'player', field: 'attributes', value: { health: 5 } },
      { op: 'set', characterId: 'unrelated-npc', field: 'inventory' },
      {
        op: 'set',
        characterId: 'player',
        field: 'attributes',
        expected: { health: 6 },
        value: { health: 4 },
      },
    ],
    operationExplanations: [
      {
        operationIndex: 2,
        basis: 'rule',
        rollIds: ['roll-a'],
        evidence: [{ type: 'book', citation: { receiptId: 'receipt-a' } }],
      },
    ],
  };
  const selected = selectRepairEvidence(response, [['operations', 2, 'expected']], evidence);
  assert.equal(selected.mode, 'selected');
  assert.deepEqual(selected.evidence, {
    sourceSpans: [],
    ruleReads: [evidence.ruleReads[0]],
    characters: [evidence.characters[0]],
    knowledge: [],
    rolls: [evidence.rolls[0]],
  });
});

test('batch selection includes saved knowledge, staged characters, state and roll dependencies', () => {
  const evidence = bundle();
  const response = {
    operations: [{ op: 'create', character: { name: 'New NPC' } }, { op: 'state' }],
    operationExplanations: [
      { operationIndex: 1, basis: 'established_state', rollIds: [], evidence: [] },
    ],
    knowledgeChanges: [
      {
        op: 'update',
        id: 'record-a',
        origin: 'gm',
        evidence: [],
        changes: { characterIds: [{ operationIndex: 0 }] },
      },
    ],
    rollInterpretations: [{ rollId: 'roll-a' }],
  };
  const selected = selectRepairEvidence(
    response,
    [
      ['knowledgeChanges', 0],
      ['operationExplanations', 0],
      ['rollInterpretations', 0],
    ],
    evidence
  );
  assert.equal(selected.mode, 'selected');
  assert.deepEqual(selected.evidence, {
    sourceSpans: [],
    ruleReads: [],
    characters: [],
    knowledge: [evidence.knowledge[0]],
    rolls: [evidence.rolls[0]],
    state: evidence.state,
  });
});

test('missing, forged and collection references retain broad evidence with explicit reasons', () => {
  const evidence = bundle();
  for (const [response, paths] of [
    [{ ruleCitations: [{ receiptId: 'unknown' }] }, [['ruleCitations', 0]]],
    [{ ruleCitations: [{}] }, [['ruleCitations', 0]]],
    [{ rollInterpretations: [{}] }, [['rollInterpretations', 0]]],
    [{ knowledgeChanges: [{ origin: 'source', evidence: [] }] }, [['knowledgeChanges', 0]]],
    [{ operations: [] }, [['operations']]],
    [{ operations: [{ op: 'set' }] }, [['operations', 0, 'characterId']]],
    [{ operations: [{ characterId: 'unknown' }] }, [['operations', 0]]],
  ] as const) {
    const selected = selectRepairEvidence(
      response,
      paths.map((path) => [...path]),
      evidence
    );
    assert.equal(selected.mode, 'full');
    assert.equal(selected.evidence, evidence);
    assert.ok(selected.fallbackReasons.length);
  }
});

test('restricted repair sends selected evidence and preserves valid fields and model settings', async () => {
  const evidence = bundle();
  const original = {
    narrative: 'A fixed scene.',
    operations: [],
    knowledgeChanges: [
      { origin: 'gm', evidence: [{ type: 'campaign_source', sourceId: 'source-a', version: 1 }] },
    ],
    rollInterpretations: [{ rollId: 'roll-b', explanation: 'Keep this result.' }],
  };
  const settings = { provider: 'codex', model: 'test', effort: 'high' };
  let calls = 0;
  const generator: Generator = {
    capacity: async () => 10000,
    generate: async (receivedSettings, prompt) => {
      calls++;
      assert.deepEqual(receivedSettings, settings);
      const input = JSON.parse(prompt);
      assert.deepEqual(input.evidence.sourceSpans, [evidence.sourceSpans[0]]);
      assert.deepEqual(input.evidence.ruleReads, []);
      assert.deepEqual(input.evidence.knowledge, []);
      assert.deepEqual(input.response, original);
      assert.match(
        input.knowledgeProvenance,
        /Never change origin merely to make evidence pass validation/
      );
      return { corrections: [{ path: ['knowledgeChanges', 0, 'origin'], value: 'source' }] };
    },
  };
  const result = await validateWithFieldRepair(
    original,
    async (candidate) => {
      if (candidate.knowledgeChanges[0]!.origin !== 'source')
        throw new ResponseFieldProblem(
          ['knowledgeChanges', 0, 'origin'],
          new Problem(422, 'knowledge_invalid', 'Only source origins may carry source evidence')
        );
    },
    generator,
    settings,
    undefined,
    undefined,
    async () => evidence
  );
  assert.equal(calls, 1);
  assert.equal(original.knowledgeChanges[0]!.origin, 'gm');
  assert.equal(result.narrative, original.narrative);
  assert.deepEqual(result.rollInterpretations, original.rollInterpretations);
});
