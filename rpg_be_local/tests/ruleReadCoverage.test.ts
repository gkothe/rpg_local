import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ruleReadCoverage, type RuleOriginalRead } from '../src/domain/ruleReadCoverage.js';

const read = (id: string, start: number, end: number, complete = false): RuleOriginalRead => ({
  receipt: id,
  revision: 1,
  contentHash: 'hash',
  path: 'core.rule',
  view: 'text',
  text: 'x'.repeat(end - start),
  start,
  end,
  complete,
});
test('coverage needs owned matching successful originals and a gap-free minimal union', () => {
  const entry = { path: 'core.rule', matchWindow: { start: 10, end: 40 } };
  const spans = [read('a', 0, 20), read('b', 20, 50), read('redundant', 12, 15)];
  const covered = ruleReadCoverage(entry, 1, 'hash', spans);
  assert.equal(covered.matchSupplied, true);
  assert.equal(covered.originalComplete, false);
  assert.deepEqual(
    covered.suppliedOriginals?.map((s) => s.receiptId),
    ['a', 'b']
  );
  assert.equal(
    ruleReadCoverage(entry, 1, 'hash', [read('a', 0, 19), read('b', 20, 50)]).matchSupplied,
    false
  );
  assert.equal(ruleReadCoverage(entry, 2, 'hash', spans).alreadySupplied, false);
  assert.equal(ruleReadCoverage(entry, 1, 'changed', spans).alreadySupplied, false);
  assert.equal(
    ruleReadCoverage(entry, 1, 'hash', [{ ...read('bad', 0, 50), error: {} }]).alreadySupplied,
    false
  );
  assert.equal(
    ruleReadCoverage(entry, 1, 'hash', [{ ...read('bad', 0, 50), structural: true }])
      .alreadySupplied,
    false
  );
});
test('prefer a whole original and never promote a complete tail or union into whole-original coverage', () => {
  const entry = { path: 'core.rule', matchWindow: { start: 10, end: 40 } };
  const result = ruleReadCoverage(entry, 1, 'hash', [
    read('tail', 10, 50, true),
    read('whole', 0, 50, true),
  ]);
  assert.equal(result.originalComplete, true);
  assert.deepEqual(
    result.suppliedOriginals?.map((s) => s.receiptId),
    ['whole']
  );
  const tail = ruleReadCoverage(entry, 1, 'hash', [read('tail', 10, 50, true)]);
  assert.equal(tail.matchSupplied, true);
  assert.equal(tail.originalComplete, false);
  assert.equal(
    ruleReadCoverage({ path: 'core.rule' }, 1, 'hash', [read('tail', 10, 50, true)]).matchSupplied,
    false
  );
});

test('overlap uses the farthest minimal cover and partial unions never claim a whole original', () => {
  const entry = { path: 'core.rule', matchWindow: { start: 10, end: 60 } };
  const spans = [
    read('short', 0, 20),
    read('wide', 5, 40),
    read('overlap', 30, 70),
    read('redundant', 35, 45),
    read('other-path', 0, 100),
  ];
  spans[4]!.path = 'core.other';
  const result = ruleReadCoverage(entry, 1, 'hash', spans);
  assert.equal(result.matchSupplied, true);
  assert.equal(result.originalComplete, false);
  assert.deepEqual(
    result.suppliedOriginals?.map((span) => span.receiptId),
    ['wide', 'overlap']
  );
  assert.equal(
    ruleReadCoverage({ path: 'core.rule', matchWindow: { start: 70, end: 80 } }, 1, 'hash', spans)
      .matchSupplied,
    false
  );
});

test('invalid or empty match windows cannot authorize partial reuse', () => {
  for (const matchWindow of [
    { start: -1, end: 10 },
    { start: 10, end: 10 },
    { start: 20, end: 10 },
    { start: 1.5, end: 10 },
    { start: '0', end: 10 },
  ]) {
    const result = ruleReadCoverage({ path: 'core.rule', matchWindow }, 1, 'hash', [
      read('partial', 0, 50),
    ]);
    assert.equal(result.alreadySupplied, true);
    assert.equal(result.matchSupplied, false);
    assert.equal(result.suppliedOriginals, undefined);
  }
});
