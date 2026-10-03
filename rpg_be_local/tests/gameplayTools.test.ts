import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { GameplayTools } from '../src/providers/gameplayTools.js';
import { freezeKnowledge } from '../src/domain/knowledgeRecall.js';
import { newCampaign } from '../src/domain/campaign.js';
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
