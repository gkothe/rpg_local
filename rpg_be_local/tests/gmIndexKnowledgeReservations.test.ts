import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { applyKnowledgeChanges, knowledgeChangeSchema } from '../src/domain/knowledge.js';

test('reserved knowledge identity and timestamps are identical in staged and final application', () => {
  const create = knowledgeChangeSchema.parse({
    op: 'create',
    kind: 'objective',
    title: 'Armor',
    text: 'Find armor.',
    certainty: 'established',
    status: 'active',
    characterIds: [],
    holderId: null,
    origin: 'gm',
    evidence: [],
    visibility: 'player',
  });
  const context = { campaignId: randomUUID(), turnId: randomUUID() };
  const id = randomUUID();
  const reservations = { createIds: new Map([[0, id]]), appliedAt: '2026-10-11T15:00:00.000Z' };
  const apply = () =>
    applyKnowledgeChanges([], [create], [], new Map(), context, undefined, undefined, reservations);
  assert.deepEqual(apply().records, apply().records);
  assert.equal(apply().records[0]!.id, id);
  assert.equal(apply().records[0]!.attributions[0]!.at, reservations.appliedAt);
  const update = knowledgeChangeSchema.parse({
    op: 'update',
    id,
    expectedRevision: 1,
    changes: { text: 'Armor obtained.' },
    origin: 'gm',
    evidence: [],
  });
  const original = apply().records;
  assert.deepEqual(
    applyKnowledgeChanges(
      original,
      [update],
      [],
      new Map(),
      context,
      undefined,
      undefined,
      reservations
    ),
    applyKnowledgeChanges(
      original,
      [update],
      [],
      new Map(),
      context,
      undefined,
      undefined,
      reservations
    )
  );
  assert.throws(
    () =>
      applyKnowledgeChanges(
        [],
        [create],
        [],
        new Map(),
        { ...context, preparedKnowledgeIds: new Map([[0, randomUUID()]]) },
        undefined,
        undefined,
        reservations
      ),
    /differs/
  );
});
