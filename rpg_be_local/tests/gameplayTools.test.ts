import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { GameplayTools } from '../src/providers/gameplayTools.js';
import { freezeKnowledge } from '../src/domain/knowledgeRecall.js';
import { newCampaign } from '../src/domain/campaign.js';

test('combined originals identify supplied receipts and exact continuation arguments without blocking rereads', async () => {
  const reads: unknown[] = [];
  const registry = new GameplayTools({
    book: true,
    ruleFind: true,
    assertActive: async () => {},
    roll: async () => ({ rollId: randomUUID(), slot: 0, groups: [], reused: false }),
    read: async (tool, input) => {
      reads.push(input);
      return tool === 'rules_search'
        ? { entries: [{ path: 'core_rules.book.damage', readableOriginal: true }] }
        : {
            receipt: 'original-receipt',
            path: 'core_rules.book.damage',
            view: 'text',
            structural: false,
            start: 0,
            end: 8,
            text: 'Original',
            complete: false,
            cursor: 'next_window',
          };
    },
  });
  const result = (await registry.call('rules_find', { query: 'damage' }, 'find')) as Record<
    string,
    unknown
  >;
  assert.deepEqual(result.suppliedOriginals, [
    {
      receiptId: 'original-receipt',
      path: 'core_rules.book.damage',
      start: 0,
      end: 8,
      complete: false,
      nextRead: { path: 'core_rules.book.damage', view: 'text', cursor: 'next_window' },
    },
  ]);
  await registry.call('rules_get', { path: 'core_rules.book.damage', view: 'text' }, 'reread');
  assert.equal(reads.length, 3);
});

test('rules_find combines eligible original reads with stable child identities and native replay', async () => {
  const calls: { tool: string; input: unknown; id: string }[] = [];
  const registry = new GameplayTools({
    book: true,
    ruleFind: true,
    assertActive: async () => {},
    roll: async () => ({ rollId: randomUUID(), slot: 0, groups: [], reused: false }),
    read: async (tool, input, id) => {
      calls.push({ tool, input, id });
      return tool === 'rules_search'
        ? {
            entries: [
              { path: 'core_rules.book', readableOriginal: false },
              ...['a', 'b', 'c', 'd'].map((path) => ({ path, readableOriginal: true })),
            ],
            cursor: 'next',
          }
        : { receipt: id, text: 'Original', path: (input as { path: string }).path };
    },
  });
  const result = (await registry.call('rules_find', { query: 'movement' }, 'native-id')) as Record<
    string,
    unknown
  >;
  assert.equal((result.reads as unknown[]).length, 3);
  assert.deepEqual(result.unreadPaths, ['d']);
  assert.deepEqual(
    calls.map((c) => c.tool),
    ['rules_search', 'rules_get', 'rules_get', 'rules_get']
  );
  assert.deepEqual(calls[1]!.input, { path: 'a', view: 'text' });
  assert.equal(new Set(calls.map((c) => c.id)).size, 4);
  assert.ok(calls.every((c) => c.id.length < 160));
  assert.deepEqual(await registry.call('rules_find', { query: 'movement' }, 'native-id'), result);
  assert.equal(calls.length, 4);
  await assert.rejects(
    registry.call('rules_find', { query: 'different' }, 'native-id'),
    /changed tool arguments/
  );
});

test('rules_find preserves read errors and stops constituent reads after cancellation', async () => {
  const controller = new AbortController();
  let calls = 0;
  const registry = new GameplayTools({
    book: true,
    ruleFind: true,
    signal: controller.signal,
    assertActive: async () => {},
    roll: async () => ({ rollId: randomUUID(), slot: 0, groups: [], reused: false }),
    read: async () => {
      calls++;
      controller.abort();
      return { entries: [{ path: 'a', readableOriginal: true }] };
    },
  });
  await assert.rejects(registry.call('rules_find', { query: 'test' }, 'cancel'), /cancelled/);
  assert.equal(calls, 1);
  const errors = new GameplayTools({
    book: true,
    ruleFind: true,
    assertActive: async () => {},
    roll: async () => ({ rollId: randomUUID(), slot: 0, groups: [], reused: false }),
    read: async () => ({
      receipt: 'error-receipt',
      error: { code: 'rules_cursor_invalid', detail: 'Expired' },
    }),
  });
  const result = (await errors.call(
    'rules_find',
    { query: 'test', cursor: 'expired' },
    'error'
  )) as Record<string, unknown>;
  assert.deepEqual(result.search, {
    receipt: 'error-receipt',
    error: { code: 'rules_cursor_invalid', detail: 'Expired' },
  });
  assert.deepEqual(result.reads, []);
  assert.deepEqual(result.suppliedOriginals, []);
});
test('knowledge tools remain owned without a library and do not consume dice or rules allowance', async () => {
  const c = newCampaign({ name: 'Frozen recall' });
  const tools = new GameplayTools({
    book: false,
    knowledge: freezeKnowledge(c),
    roll: async () => ({ rollId: randomUUID(), slot: 0, groups: [], reused: false }),
    assertActive: async () => {},
    limits: { diceCalls: 0, ruleCalls: 0, combinedCalls: 3, promptBytes: 100 },
  });
  assert.deepEqual(
    tools.definitions.map((d) => d.name),
    ['roll_dice', 'campaign_knowledge_search', 'campaign_knowledge_get']
  );
  assert.deepEqual(await tools.call('campaign_knowledge_search', { query: '' }, 'search'), {
    campaignId: c.id,
    records: [],
    nextCursor: null,
  });
  await assert.rejects(
    tools.call('campaign_knowledge_get', { id: randomUUID() }, 'missing'),
    /frozen campaign/
  );
  await assert.rejects(
    tools.call('campaign_knowledge_search', { query: '', campaignId: randomUUID() }, 'foreign'),
    /registered schema/
  );
});
test('registry advertises exactly owned tools, replays once and rechecks active ownership before replay', async () => {
  let reads = 0;
  let active = true;
  const registry = new GameplayTools({
    book: true,
    assertActive: async () => {
      if (!active) throw new Error('Inactive');
    },
    roll: async () => ({ rollId: randomUUID(), slot: 0, groups: [], reused: false }),
    read: async () => {
      reads++;
      return { receipt: randomUUID(), text: 'Original synthetic text' };
    },
  });
  assert.deepEqual(
    registry.definitions.map((definition) => definition.name),
    ['roll_dice', 'rules_map', 'rules_search', 'rules_get', 'rules_list']
  );
  const first = await registry.call('rules_map', {}, 'same');
  assert.deepEqual(await registry.call('rules_map', {}, 'same'), first);
  assert.equal(reads, 1);
  await assert.rejects(registry.call('rules_map', { column: 'lore' }, 'same'), /changed/);
  await assert.rejects(registry.call('shell', {}, 'shell'), /outside/);
  active = false;
  await assert.rejects(registry.call('rules_map', {}, 'same'), /Inactive/);
  const fallback = new GameplayTools({
    book: false,
    assertActive: async () => {},
    roll: async () => ({ rollId: randomUUID(), slot: 0, groups: [], reused: false }),
  });
  assert.deepEqual(
    fallback.definitions.map((definition) => definition.name),
    ['roll_dice']
  );
  await assert.rejects(fallback.call('rules_map', {}, 'foreign'), /outside/);
});

test('explicit opt-in limits independently bound invalid rule requests, dice and combined calls without charging transport replays', async () => {
  let reads = 0,
    rolls = 0;
  const registry = new GameplayTools({
    book: true,
    limits: { ruleCalls: 12, diceCalls: 12, combinedCalls: 24, promptBytes: 16000 },
    assertActive: async () => {},
    read: async () => {
      reads++;
      return { error: { code: 'rules_request_invalid' } };
    },
    roll: async () => {
      rolls++;
      return { rollId: randomUUID(), slot: 0, groups: [], reused: false };
    },
  });
  for (let index = 0; index < 12; index++)
    await registry.call('rules_map', { foreign: true }, `invalid-${index}`);
  await registry.call('rules_map', { foreign: true }, 'invalid-0');
  assert.equal(reads, 12);
  await assert.rejects(registry.call('rules_map', {}, 'extra-rule'), /call limit/);
  for (let index = 0; index < 12; index++) await registry.call('roll_dice', {}, `dice-${index}`);
  assert.equal(rolls, 12);
  await assert.rejects(registry.call('roll_dice', {}, 'extra-dice'), /Combined/);
});
test('large aggregate tool transcripts are allowed and cancellation still prevents results', async () => {
  const signal = new AbortController();
  const registry = new GameplayTools({
    book: true,
    signal: signal.signal,
    assertActive: async () => {},
    roll: async () => ({ rollId: randomUUID(), slot: 0, groups: [], reused: false }),
    read: async () => ({ text: 'x'.repeat(3000) }),
  });
  await registry.call('rules_get', {}, 'first');
  await registry.call('rules_get', {}, 'second');
  assert.deepEqual(await registry.call('rules_get', {}, 'third'), { text: 'x'.repeat(3000) });
  signal.abort();
  await assert.rejects(registry.call('rules_get', {}, 'first'), /cancelled/);
});
