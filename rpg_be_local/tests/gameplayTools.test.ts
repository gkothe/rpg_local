import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  GAMEPLAY_ENVELOPE_BYTES,
  gameplayToolRequestBytes,
} from '../src/providers/gameplayTools.js';
import { freezeKnowledge } from '../src/domain/knowledgeRecall.js';
import { newCampaign } from '../src/domain/campaign.js';
import { CharacterType } from '../src/domain/options.js';
import { ownedTools } from './ownedGameplayFixture.js';

const DEFAULT_TOOLS = [
  'campaign_npcs_search',
  'campaign_npcs_get',
  'combat_prepare',
  'roll_dice',
  'campaign_sources_search',
  'campaign_sources_get',
  'campaign_knowledge_search',
  'campaign_knowledge_get',
];
const BOOK_TOOLS = ['rules_map', 'rules_search', 'rules_get', 'rules_list', 'rules_find'];

test('rule tool descriptions distinguish complete sections from pages and preserve intentional verification', () => {
  const registry = ownedTools({ book: true, read: async () => ({}) });
  const find = registry.definitions.find((definition) => definition.name === 'rules_find')!;
  assert.match(find.description, /originalComplete/);
  assert.match(find.description, /specific missing fact/);
  assert.match(find.description, /Intentional verification/);
  assert.match(find.description, /matchSupplied/);
  assert.match(find.description, /matchWindow/);
  assert.match(find.description, /lexical support/);
  assert.match(find.description, /known paths/);
});

test('owned NPC tools read the frozen roster, list an empty one and enforce replay/ownership', async () => {
  const c = newCampaign({ name: 'NPC tools' });
  c.characters.push({
    id: randomUUID(),
    name: 'Marcus',
    type: CharacterType.Npc,
    attributes: { strength: 3 },
    inventory: {},
    description: { role: 'merchant' },
    notes: 'SECRET',
    revision: 1,
  });
  for (const book of [false, true]) {
    let active = true;
    const options = {
      book,
      roll: async () => ({ rollId: randomUUID(), slot: 0, groups: [], reused: false }),
      read: async () => ({}),
      assertActive: async () => {
        if (!active) throw new Error('Lost ownership');
      },
    };
    const registry = ownedTools({ ...options, knowledge: freezeKnowledge(c, true) });
    assert.equal(registry.definitions.filter((d) => d.name.startsWith('campaign_npcs_')).length, 2);
    const found = await registry.call('campaign_npcs_search', { query: 'merchant' }, 'search');
    assert.deepEqual(
      await registry.call('campaign_npcs_search', { query: 'merchant' }, 'search'),
      found
    );
    await assert.rejects(
      registry.call('campaign_npcs_search', { query: 'guard' }, 'search'),
      /changed tool arguments/
    );
    const sheet = await registry.call('campaign_npcs_get', { id: c.characters[0]!.id }, 'get');
    assert.doesNotMatch(JSON.stringify(sheet), /SECRET|notes/);
    await assert.rejects(
      registry.call('campaign_npcs_get', { id: randomUUID() }, 'missing'),
      /NPC is not/
    );
    await assert.rejects(
      registry.call('campaign_npcs_get', { id: c.characters[0]!.id, campaignId: c.id }, 'invalid'),
      /registered schema/
    );
    active = false;
    await assert.rejects(
      registry.call('campaign_npcs_search', { query: '' }, 'search'),
      /Lost ownership/
    );
    c.characters = [];
    active = true;
    const empty = ownedTools({ ...options, knowledge: freezeKnowledge(c, true) });
    assert.deepEqual(
      ((await empty.call('campaign_npcs_search', { query: '' }, 'empty')) as { npcs: unknown[] })
        .npcs,
      []
    );
    c.characters.push({
      id: randomUUID(),
      name: 'Marcus',
      type: CharacterType.Npc,
      attributes: {},
      inventory: {},
      description: {},
      notes: '',
      revision: 1,
    });
  }
});

test('combined originals identify supplied receipts and exact continuation arguments without blocking rereads', async () => {
  const reads: unknown[] = [];
  const registry = ownedTools({
    book: true,
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
      name: 'core_rules.book.damage',
      originalComplete: false,
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
  const registry = ownedTools({
    book: true,
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
  const registry = ownedTools({
    book: true,
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
  const errors = ownedTools({
    book: true,
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
test('knowledge tools remain owned without a library', async () => {
  const c = newCampaign({ name: 'Frozen recall' });
  const tools = ownedTools({ knowledge: freezeKnowledge(c) });
  assert.deepEqual(
    tools.definitions.map((d) => d.name),
    DEFAULT_TOOLS
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
  const registry = ownedTools({
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
    [...DEFAULT_TOOLS.slice(0, 6), ...BOOK_TOOLS, ...DEFAULT_TOOLS.slice(6)]
  );
  const first = await registry.call('rules_map', {}, 'same');
  assert.deepEqual(await registry.call('rules_map', {}, 'same'), first);
  assert.equal(reads, 1);
  await assert.rejects(registry.call('rules_map', { column: 'lore' }, 'same'), /changed/);
  await assert.rejects(registry.call('shell', {}, 'shell'), /outside/);
  active = false;
  await assert.rejects(registry.call('rules_map', {}, 'same'), /Inactive/);
  const fallback = ownedTools();
  assert.deepEqual(
    fallback.definitions.map((definition) => definition.name),
    DEFAULT_TOOLS
  );
  await assert.rejects(fallback.call('rules_map', {}, 'foreign'), /outside/);
});

test('large aggregate tool transcripts are allowed and cancellation still prevents results', async () => {
  const signal = new AbortController();
  const registry = ownedTools({
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

test('combat_prepare validates before dispatch and replays by transport identity', async () => {
  const prepared: unknown[] = [];
  const tools = ownedTools({
    prepareCombat: async (input) => {
      prepared.push(input);
      return { receiptId: randomUUID() };
    },
  });
  const dice = tools.definitions.find((definition) => definition.name === 'roll_dice')!;
  assert.match(JSON.stringify(dice.inputSchema), /scope/);
  await assert.rejects(
    tools.call('combat_prepare', { localKey: 'fight' }, 'bad'),
    /registered schema/
  );
  assert.equal(prepared.length, 0);
  const batch = {
    localKey: 'fight',
    participants: [
      {
        characterId: randomUUID(),
        label: 'Guard',
        trackedFields: [{ path: ['health'], kind: 'damage', label: 'Health' }],
      },
    ],
  };
  const first = await tools.call('combat_prepare', batch, 'p1');
  assert.deepEqual(await tools.call('combat_prepare', batch, 'p1'), first);
  assert.equal(prepared.length, 1);
  await assert.rejects(
    tools.call('combat_prepare', { ...batch, localKey: 'other' }, 'p1'),
    /changed tool arguments/
  );
  assert.equal(gameplayToolRequestBytes('combat_prepare'), 1_048_576);
  assert.equal(gameplayToolRequestBytes('roll_dice'), 1024);
  assert.equal(GAMEPLAY_ENVELOPE_BYTES, 4_194_304 + 65_536);
});

test('the advertised source search schema offers a single query or a bounded batch', () => {
  const registry = ownedTools({
    book: false,
    roll: async () => ({ rollId: randomUUID(), slot: 0, groups: [], reused: false }),
    read: async () => ({}),
    assertActive: async () => {},
    knowledge: freezeKnowledge(newCampaign({ name: 'Schema' }), true),
  });
  const search = registry.definitions.find((d) => d.name === 'campaign_sources_search')!;
  const schema = search.inputSchema as unknown as {
    properties: Record<string, { maxItems?: number; description?: string }>;
  };
  assert.ok(schema.properties.query && schema.properties.queries && schema.properties.cursor);
  assert.equal(schema.properties.queries.maxItems, 6);
  assert.match(schema.properties.queries.description ?? '', /exactly one of query or queries/);
  assert.match(search.description, /queries/);
});

test('only completed external rule outputs populate delivery evidence and fresh registries start empty', async () => {
  const snapshots: string[][] = [];
  let gets = 0;
  const read = async (
    tool: string,
    _input: unknown,
    _id: string,
    evidence?: { receiptIds: string[] }
  ) => {
    snapshots.push(evidence?.receiptIds ?? []);
    if (tool === 'rules_search')
      return {
        revision: 1,
        contentHash: 'hash',
        entries: [
          { path: 'core_rules.book.a', readableOriginal: true },
          { path: 'core_rules.book.b', readableOriginal: true },
        ],
      };
    gets++;
    if (gets === 2) throw new Error('interrupted find');
    return {
      receipt: 'receipt-' + gets,
      revision: 1,
      contentHash: 'hash',
      path: 'core_rules.book.a',
      view: 'text',
      start: 0,
      end: 8,
      text: 'Original',
      complete: true,
    };
  };
  const registry = ownedTools({ book: true, read });
  await assert.rejects(
    registry.call('rules_find', { query: 'rule' }, 'failed'),
    /interrupted find/
  );
  await registry.call('rules_search', { query: 'rule' }, 'after');
  assert.deepEqual(snapshots.at(-1), []);
  await registry.call('rules_get', { path: 'core_rules.book.a' }, 'delivered');
  await registry.call('rules_search', { query: 'rule' }, 'new');
  assert.deepEqual(snapshots.at(-1), ['receipt-3']);
  await ownedTools({ book: true, read }).call('rules_search', { query: 'rule' }, 'fresh');
  assert.deepEqual(snapshots.at(-1), []);
});
