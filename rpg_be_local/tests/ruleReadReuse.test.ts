import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withSuppliedRuleReads } from '../src/providers/ruleReadReuse.js';
import { findRules } from '../src/providers/rulesFind.js';

test('repeated find reuses delivered complete originals while still checking and auditing search', async () => {
  const calls: string[] = [];
  let revision = 1;
  const read = withSuppliedRuleReads(async (tool) => {
    calls.push(tool);
    return tool === 'rules_search'
      ? { revision, contentHash: 'hash', entries: [{ path: 'core.rule', readableOriginal: true }] }
      : {
          revision,
          contentHash: 'hash',
          receipt: `receipt-${revision}`,
          path: 'core.rule',
          view: 'text',
          structural: false,
          text: 'A complete original rule.',
          start: 0,
          end: 25,
          complete: true,
        };
  });
  let activeChecks = 0;
  const active = async () => {
    activeChecks++;
  };
  const first = await findRules(read, { query: 'rule' }, 'first', active);
  assert.equal(first.reads.length, 1);
  const repeated = await findRules(read, { query: 'rule' }, 'second', active);
  assert.equal(repeated.reads.length, 0);
  assert.deepEqual(repeated.suppliedOriginals, first.suppliedOriginals);
  assert.deepEqual(calls, ['rules_search', 'rules_get', 'rules_search']);
  assert.equal(activeChecks, 3);
  const replayed = await findRules(read, { query: 'rule' }, 'first', active);
  assert.deepEqual(replayed, first);
  revision++;
  const changed = await findRules(read, { query: 'rule' }, 'third', active);
  assert.equal(changed.reads.length, 1);
  assert.equal(changed.suppliedOriginals.length, 1);
});

test('partial and failed originals never cause a complete-read shortcut; intentional rereads remain available', async () => {
  let calls = 0;
  let failed = false;
  const read = withSuppliedRuleReads(async (tool) => {
    calls++;
    if (tool === 'rules_search')
      return {
        revision: 1,
        contentHash: 'hash',
        entries: [{ path: 'core.rule', readableOriginal: true }],
      };
    return failed
      ? { error: { code: 'rules_missing' } }
      : {
          revision: 1,
          contentHash: 'hash',
          receipt: `receipt-${calls}`,
          path: 'core.rule',
          view: 'text',
          text: 'Only a later window.',
          start: 100,
          end: 120,
          complete: true,
        };
  });
  await read('rules_get', { path: 'core.rule', view: 'text' }, 'intentional');
  const result = await findRules(read, { query: 'rule' }, 'find', async () => {});
  assert.equal(result.reads.length, 1);
  assert.equal(calls, 3);
  await read('rules_get', { path: 'core.rule', view: 'text' }, 'reread');
  assert.equal(calls, 4);
  failed = true;
  const failure = await read('rules_get', {}, 'failure');
  assert.deepEqual(failure.error, { code: 'rules_missing' });
});
