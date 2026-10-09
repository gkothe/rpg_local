import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withSuppliedRuleReads } from '../src/providers/ruleReadReuse.js';
import { findRules } from '../src/providers/rulesFind.js';

function original(receipt: string, path: string, start = 0, end = 100, complete = true) {
  return {
    revision: 1,
    contentHash: 'hash',
    receipt,
    path,
    view: 'text',
    structural: false,
    text: 'x'.repeat(end - start),
    start,
    end,
    complete,
  };
}

test('exact readable titles occupy automatic slots and never backfill weaker matches', async () => {
  const gets: string[] = [];
  const read = withSuppliedRuleReads(async (tool, input, id) => {
    if (tool === 'rules_search')
      return {
        revision: 1,
        contentHash: 'hash',
        entries: [
          { path: 'core.named', name: 'Larceny', exactTitle: true, readableOriginal: true },
          ...['other', 'weaker', 'last'].map((name) => ({
            path: `core.${name}`,
            readableOriginal: true,
          })),
        ],
      };
    const path = (input as { path: string }).path;
    gets.push(path);
    return original(id, path);
  });
  const first = await findRules(read, { query: 'Larceny' }, 'first-exact', async () => {});
  read.delivered(first);
  const next = await findRules(read, { query: 'Larceny' }, 'next-exact', async () => {});
  assert.deepEqual(gets, ['core.named']);
  assert.equal(next.reads.length, 0);
  assert.equal(next.suppliedOriginals[0]?.path, 'core.named');
});

test('reused ranked slots do not backfill and an uncovered window remains readable', async () => {
  const gets: { path: string; locator?: string }[] = [];
  let uncovered = false;
  const read = withSuppliedRuleReads(async (tool, input, id) => {
    if (tool === 'rules_search')
      return {
        revision: 1,
        contentHash: 'hash',
        entries: ['first', 'second', 'third', 'fourth'].map((name) => ({
          path: `core.${name}`,
          readableOriginal: true,
          locator: `${name}-locator`,
          matchWindow: {
            start: uncovered && name === 'first' ? 200 : 10,
            end: uncovered && name === 'first' ? 220 : 30,
          },
        })),
      };
    const args = input as { path: string; locator?: string };
    gets.push(args);
    return original(id, args.path, 200, 250, false);
  });
  read.delivered(original('covered', 'core.first', 0, 50, false));
  const first = await findRules(read, { query: 'partial' }, 'partial-one', async () => {});
  assert.deepEqual(
    gets.map((args) => args.path),
    ['core.second', 'core.third']
  );
  assert.equal(
    first.suppliedOriginals.find((span) => span.path === 'core.first')?.originalComplete,
    false
  );
  assert.deepEqual(first.unreadPaths, ['core.fourth']);
  uncovered = true;
  await findRules(read, { query: 'other window' }, 'partial-two', async () => {});
  assert.deepEqual(gets[2], { path: 'core.first', view: 'text', locator: 'first-locator' });
});

test('failed composed output does not deliver its successful child read', async () => {
  const evidence: string[][] = [];
  const read = withSuppliedRuleReads(async (tool, input, id, supplied) => {
    evidence.push(supplied?.receiptIds ?? []);
    if (tool === 'rules_search')
      return {
        revision: 1,
        contentHash: 'hash',
        entries: ['one', 'two'].map((name) => ({ path: `core.${name}`, readableOriginal: true })),
      };
    if ((input as { path: string }).path === 'core.two') throw new Error('interrupted child');
    return original(id, 'core.one');
  });
  await assert.rejects(
    findRules(read, { query: 'rule' }, 'failed-find', async () => {}),
    /interrupted child/
  );
  const retrySearch = await read('rules_search', { query: 'rule' }, 'new-search');
  assert.equal(
    (retrySearch.entries as { originalComplete?: boolean }[])[0]?.originalComplete,
    undefined
  );
  assert.deepEqual(evidence, [[], [], [], []]);
});

test('captured empty evidence remains untouched while new fallback searches see delivery', async () => {
  const captured = {
    revision: 1,
    contentHash: 'hash',
    suppliedEvidenceCaptured: true,
    entries: [{ path: 'core.rule', readableOriginal: true }],
  };
  const read = withSuppliedRuleReads(async (tool, _input, id) =>
    tool === 'rules_search'
      ? id === 'captured'
        ? captured
        : { revision: 1, contentHash: 'hash', entries: captured.entries }
      : original(id, 'core.rule')
  );
  read.delivered(await read('rules_get', { path: 'core.rule' }, 'whole-captured'));
  assert.strictEqual(await read('rules_search', {}, 'captured'), captured);
  assert.equal((captured.entries[0] as { originalComplete?: boolean }).originalComplete, undefined);
  const fresh = await read('rules_search', {}, 'fresh');
  assert.equal((fresh.entries as { originalComplete?: boolean }[])[0]?.originalComplete, true);
});

test('local replay preserves empty search annotations after later delivery', async () => {
  const read = withSuppliedRuleReads(async (tool, _input, id) =>
    tool === 'rules_search'
      ? {
          revision: 1,
          contentHash: 'hash',
          entries: [{ path: 'core.rule', readableOriginal: true }],
        }
      : original(id, 'core.rule')
  );
  const first = await read('rules_search', {}, 'same-search');
  read.delivered(await read('rules_get', { path: 'core.rule' }, 'later-whole'));
  assert.deepEqual(await read('rules_search', {}, 'same-search'), first);
  const next = await read('rules_search', {}, 'new-search');
  assert.equal((next.entries as { originalComplete?: boolean }[])[0]?.originalComplete, true);
});

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
  read.delivered(first);
  assert.equal(first.reads.length, 1);
  assert.equal(first.suppliedOriginals[0]?.originalComplete, true);
  assert.equal(first.suppliedOriginals[0]?.name, 'core.rule');
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
  read.delivered(await read('rules_get', { path: 'core.rule', view: 'text' }, 'intentional'));
  const result = await findRules(read, { query: 'rule' }, 'find', async () => {});
  assert.equal(result.reads.length, 1);
  assert.equal(calls, 3);
  await read('rules_get', { path: 'core.rule', view: 'text' }, 'reread');
  assert.equal(calls, 4);
  failed = true;
  const failure = await read('rules_get', {}, 'failure');
  assert.deepEqual(failure.error, { code: 'rules_missing' });
});

test('find labels completeness per delivered span, not from another complete span on the entry', async () => {
  const read = withSuppliedRuleReads(async (tool, input, id) => {
    if (tool === 'rules_search')
      return {
        revision: 1,
        contentHash: 'hash',
        entries: [{ path: 'core.rule', name: 'Healing', readableOriginal: true }],
      };
    const later = (input as { cursor?: string }).cursor === 'later';
    return {
      revision: 1,
      contentHash: 'hash',
      receipt: id,
      path: 'core.rule',
      view: 'text',
      structural: false,
      text: 'Original passage.',
      start: later ? 10 : 0,
      end: 25,
      complete: true,
    };
  });
  read.delivered(await read('rules_get', { path: 'core.rule' }, 'whole'));
  read.delivered(await read('rules_get', { path: 'core.rule', cursor: 'later' }, 'tail'));
  const result = await findRules(read, { query: 'healing' }, 'find', async () => {});
  assert.equal(result.reads.length, 0);
  assert.deepEqual(
    result.suppliedOriginals.map((span) => ({
      name: span.name,
      originalComplete: span.originalComplete,
      receiptId: span.receiptId,
    })),
    [{ name: 'Healing', originalComplete: true, receiptId: 'whole' }]
  );
});
