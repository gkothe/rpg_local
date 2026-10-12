import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAntigravityResponse } from '../src/providers/antigravityResponse.js';
import { gmIndexScanSchema } from '../src/domain/gmIndexGeneration.js';

test('repairs only trailing commas in objects and arrays, including fenced responses', () => {
  assert.deepEqual(parseAntigravityResponse('{"foundation":[],"entries":[],}'), {
    foundation: [],
    entries: [],
  });
  assert.deepEqual(parseAntigravityResponse('```json\n{"a":[1,2, ],}\n```'), { a: [1, 2] });
});

test('quoted punctuation, escaped quotes and backslashes are preserved exactly', () => {
  const text = 'literal ,} ,] and "quote" and \\slash';
  const input = JSON.stringify({ text, nested: [text] });
  assert.deepEqual(parseAntigravityResponse(input.slice(0, -1) + ',}'), { text, nested: [text] });
});

test('other malformed syntax, missing values and commentary are rejected', () => {
  for (const text of [
    '[,]',
    '{,}',
    '{"a":,}',
    '[1,,]',
    '{a:1}',
    '{"a":1 // comment\n}',
    'text {"a":1,}',
    '{"a":"unfinished,}',
  ])
    assert.throws(() => parseAntigravityResponse(text), SyntaxError);
});

test('syntax repair does not accept unknown keys or invalid schema values', () => {
  for (const text of [
    '{"foundation":"bad","entries":[],}',
    '{"foundation":[],"entries":[],"extra":true,}',
  ])
    assert.equal(gmIndexScanSchema.safeParse(parseAntigravityResponse(text)).success, false);
});
