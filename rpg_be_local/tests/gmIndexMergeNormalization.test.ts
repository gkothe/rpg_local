import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { newCampaign } from '../src/domain/campaign.js';
import {
  captureGmIndexGeneration,
  GmIndexPreparationMode,
  gmIndexPreparationSchema,
  gmIndexPreparedDocument,
  normalizeGmIndexPreparationOutput,
} from '../src/domain/gmIndexGeneration.js';

const entry = () => ({
  kind: 'task',
  status: 'active',
  title: 'Armor reminder',
  text: 'Ask the trader about armor.',
  ownerCharacterId: null,
  refs: [],
  direction: null,
});

test('workingEntries alias normalizes only its field name and preserves canonical output and original input', () => {
  const entries = [entry()];
  const raw = { foundation: [], workingEntries: entries };
  const saved = structuredClone(raw);
  assert.deepEqual(gmIndexPreparationSchema.parse(normalizeGmIndexPreparationOutput(raw)), {
    foundation: [],
    entries,
  });
  assert.deepEqual(raw, saved);
  const canonical = { foundation: [], entries };
  assert.equal(normalizeGmIndexPreparationOutput(canonical), canonical);
  const capture = captureGmIndexGeneration(
    newCampaign({ name: 'Alias fixture' }),
    [],
    GmIndexPreparationMode.Prepare,
    []
  );
  const doc = gmIndexPreparedDocument(capture, raw);
  assert.equal(doc.entries[0]!.title, 'Armor reminder');
  assert.equal(doc.generationId, capture.generationId);
});

test('ambiguous aliases, invalid arrays and unknown fields remain rejected by strict preparation schema', () => {
  for (const raw of [
    { foundation: [], entries: [], workingEntries: [] },
    { foundation: [], entries: undefined, workingEntries: [] },
    { foundation: [], workingEntries: 'not an array' },
    { foundation: [], workingEntries: [], unknown: true },
    { foundation: [], workingEntries: [{ ...entry(), untrusted: 'extra' }] },
    { foundation: 'wrong type', workingEntries: [] },
  ])
    assert.equal(
      gmIndexPreparationSchema.safeParse(normalizeGmIndexPreparationOutput(raw)).success,
      false
    );
});

test('alias handling never bypasses canonical reference validation', () => {
  const capture = captureGmIndexGeneration(
    newCampaign({ name: 'Reference fixture' }),
    [],
    GmIndexPreparationMode.Prepare,
    []
  );
  assert.throws(
    () =>
      gmIndexPreparedDocument(capture, {
        foundation: [],
        workingEntries: [{ ...entry(), refs: [{ kind: 'knowledge', id: randomUUID() }] }],
      }),
    /reference is missing/
  );
});

test('missing turn hashes come only from captured versions; explicit values and unknown turns remain rejected', () => {
  const turnId = randomUUID();
  const contentHash = 'a'.repeat(64);
  const capture = captureGmIndexGeneration(
    newCampaign({ name: 'Captured hash fixture' }),
    [],
    GmIndexPreparationMode.Prepare,
    [{ turnId, contentHash }]
  );
  const ref = { kind: 'turn', turnId };
  const raw = { foundation: [], entries: [{ ...entry(), refs: [ref] }] };
  const original = structuredClone(raw);
  const document = gmIndexPreparedDocument(capture, raw);
  assert.deepEqual(document.entries[0]!.refs, [{ ...ref, contentHash }]);
  assert.deepEqual(raw, original);
  for (const pointer of [
    { ...ref, turnId: randomUUID() },
    { ...ref, contentHash: 'b'.repeat(64) },
    { ...ref, contentHash: null },
    { ...ref, contentHash: undefined },
    { ...ref, unexpected: true },
  ])
    assert.throws(() =>
      gmIndexPreparedDocument(capture, {
        foundation: [],
        entries: [{ ...entry(), refs: [pointer] }],
      })
    );
});
