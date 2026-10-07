import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeMemory } from '../src/domain/memory.js';
import { compactionBatch } from '../src/domain/context.js';
import { newCampaign } from '../src/domain/campaign.js';
import type { Turn } from '../src/domain/types.js';

const prior = (text: string, ids: string[], valid = true) => ({
  text,
  coveredTurnIds: ids,
  valid,
});

test('composition keeps the exact prior text when the model returns only new events', () => {
  const old = '- The arena fight ended with the Embrace.\n- Marta owes a favor.';
  const result = composeMemory(prior(old, ['a', 'b']), '- They escaped the cellar.', ['c', 'd']);
  assert.ok(result.text.startsWith(old));
  assert.equal(result.text, `${old}\n- They escaped the cellar.`);
  assert.deepEqual(result.coveredTurnIds, ['a', 'b', 'c', 'd']);
  assert.equal(result.priorBytes, Buffer.byteLength(old));
  assert.equal(result.resultBytes, Buffer.byteLength(result.text));
});

test('legacy paragraph memory stays byte-identical and trailing newline adds no blank separator', () => {
  const legacy = 'Legacy paragraph — ünïcode.   ';
  assert.ok(composeMemory(prior(legacy, ['a']), 'New.', ['b']).text.startsWith(legacy));
  assert.equal(composeMemory(prior('- a\n', ['a']), '- b', ['b']).text, '- a\n- b');
});

test('invalid or absent prior memory is never appended and coverage is deduplicated', () => {
  assert.equal(composeMemory(prior('stale', ['a'], false), '- new', ['b']).text, '- new');
  assert.deepEqual(composeMemory(prior('stale', ['a'], false), '- new', ['b']).coveredTurnIds, [
    'b',
  ]);
  assert.equal(composeMemory(null, '- first', ['a']).text, '- first');
  assert.deepEqual(composeMemory(prior('x', ['a', 'b']), '- y', ['b', 'c']).coveredTurnIds, [
    'a',
    'b',
    'c',
  ]);
});

test('compaction instruction asks only for the new batch and marks prior memory as context', () => {
  const c = newCampaign({ name: 'Synthetic' });
  const turn = (id: string): Turn =>
    ({ id, status: 'completed', undone: false, action: 'a', narrative: 'n' }) as unknown as Turn;
  c.memory = { id: 'm', text: 'Prior memory', coveredTurnIds: ['t1'], valid: true, createdAt: '' };
  const history = [turn('t1'), turn('t2'), turn('t3'), turn('t4'), turn('t5'), turn('t6')];
  const input = JSON.parse(compactionBatch(c, history).prompt);
  assert.match(input.instruction, /ONLY the consecutive events in the turns field/);
  assert.match(input.instruction, /priorMemory is read-only background context/);
  assert.equal(input.priorMemory, 'Prior memory');
});
