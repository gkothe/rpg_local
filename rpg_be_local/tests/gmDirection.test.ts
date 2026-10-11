import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { gmFoundationEntrySchema, gmDirectionSchema } from '../src/domain/gmDirection.js';

test('foundation requires an original or canonical campaign reference', () => {
  const entry = {
    id: randomUUID(),
    topic: 'setting',
    title: 'Harbor',
    text: 'A busy port.',
    refs: [],
  };
  assert.equal(gmFoundationEntrySchema.safeParse(entry).success, false);
  assert.equal(
    gmFoundationEntrySchema.safeParse({
      ...entry,
      refs: [{ kind: 'source_section', sourceId: randomUUID(), version: 1, sectionIndex: 0 }],
    }).success,
    true
  );
});

test('directions are labelled proposals without automatic-event or canonical-write fields', () => {
  const proposal = {
    basis: 'creative',
    trigger: null,
    development: 'A trader offers a favor.',
    choices: ['Hear the offer', 'Decline'],
    rationale: 'Links a pending armor task to a scene.',
  };
  assert.equal(gmDirectionSchema.safeParse(proposal).success, true);
  assert.equal(gmDirectionSchema.safeParse({ ...proposal, occurred: true }).success, false);
  assert.equal(gmDirectionSchema.safeParse({ ...proposal, basis: 'fact' }).success, false);
});
