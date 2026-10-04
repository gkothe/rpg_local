import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { newCampaign } from '../src/domain/campaign.js';
import { SourcePurpose, TurnStatus } from '../src/domain/options.js';
import type { Turn } from '../src/domain/types.js';
import { textSource } from '../src/services/sources.js';
import {
  freezeCampaignSources,
  campaignSourceCatalog,
  bootstrapCampaignSources,
  createCampaignSourceRecall,
  CAMPAIGN_SOURCE_GET_TOOL_NAME,
  CAMPAIGN_SOURCE_SEARCH_TOOL_NAME,
} from '../src/domain/campaignSourceRecall.js';
import { buildContext } from '../src/domain/context.js';
import { GameplayTools } from '../src/providers/gameplayTools.js';

test('opening bootstrap includes campaign and legacy references but excludes character documents', () => {
  const c = newCampaign({ name: 'Source opening' });
  c.sources = [
    textSource('Adventure', 'A Roman cell beneath the arena.'),
    textSource('Legacy', 'Known background.'),
    textSource('Character', 'Sigurd the vampire.'),
  ];
  c.sources[0]!.purpose = SourcePurpose.Campaign;
  c.sources[2]!.purpose = SourcePurpose.Character;
  const frozen = freezeCampaignSources(c);
  assert.equal(campaignSourceCatalog(frozen)[1]!.purpose, SourcePurpose.Reference);
  const context = buildContext(c, [], 'start', [], 1, true, undefined, 5);
  const data = JSON.parse(context.prompt).mandatory;
  assert.equal(data.campaignSources.length, 3);
  assert.deepEqual(
    data.campaignSourceSeeds.map((s: { name: string }) => s.name),
    ['Adventure', 'Legacy']
  );
  assert.equal(context.sourceSelection?.bootstrap, true);
  assert.equal(context.promptContractVersion, 5);
  assert.equal(context.frozenSources?.sources.length, 3);
  const legacy = buildContext(c, [], 'start', [], 1, true, undefined, 4);
  assert.equal(JSON.parse(legacy.prompt).mandatory.campaignSources, undefined);
  assert.equal(legacy.frozenSources, undefined);
  assert.equal(legacy.promptContractVersion, 4);
});

test('frozen lookup reads original Unicode spans and rejects changed version/cross-campaign IDs', () => {
  const c = newCampaign({ name: 'Frozen' });
  c.sources = [
    textSource(
      'Long preparation',
      'Opening 🌙.\n\n' + 'background '.repeat(800) + 'hidden sanctuary'
    ),
  ];
  const source = c.sources[0]!;
  const frozen = freezeCampaignSources(c);
  const lookup = createCampaignSourceRecall(frozen);
  source.text = 'Changed after snapshot';
  source.version++;
  const search = lookup.search({ query: 'sanctuary' });
  const hit = (
    search.entries as { sectionIndex: number; start: number; end: number; text: string }[]
  )[0]!;
  assert.equal(frozen.sources[0]!.text.slice(hit.start, hit.end), hit.text);
  const result = lookup.get(
    { sourceId: source.id, version: 1, sectionIndex: hit.sectionIndex },
    randomUUID()
  );
  const span = result.sourceSpan as { text: string; start: number; end: number };
  assert.equal(frozen.sources[0]!.text.slice(span.start, span.end), span.text);
  assert.match(span.text, /sanctuary/);
  assert.throws(
    () => lookup.get({ sourceId: source.id, version: 2, sectionIndex: 0 }, randomUUID()),
    /version/
  );
  assert.throws(
    () => lookup.get({ sourceId: randomUUID(), version: 1, sectionIndex: 0 }, randomUUID()),
    /outside/
  );
  assert.throws(
    () => lookup.get({ sourceId: source.id, version: 1, sectionIndex: 999 }, randomUUID()),
    /does not exist/
  );
  assert.equal(lookup.search({ query: 'unmatched' }).reason, 'no_match');
});

test('bootstrap reports soft-target omissions while catalog keeps all documents reachable', () => {
  const c = newCampaign({ name: 'Many documents' });
  c.sources = Array.from({ length: 6 }, (_, i) => textSource(`Book ${i}`, 'x'.repeat(4000)));
  const frozen = freezeCampaignSources(c);
  const seed = bootstrapCampaignSources(frozen);
  assert.equal(seed.spans.length, 3);
  assert.equal(seed.omitted.length, 3);
  assert.equal(campaignSourceCatalog(frozen).length, 6);
});
test('a completed active turn ends bootstrap, while an undone opening permits it again', () => {
  const c = newCampaign({ name: 'Bootstrap lifetime' });
  c.sources = [textSource('Preparation', 'A locked gate.')];
  const previous = {
    id: randomUUID(),
    status: TurnStatus.Completed,
    undone: false,
    action: 'start',
    narrative: 'You see the gate.',
  } as Turn;
  const context = buildContext(c, [previous], 'wait', [], 16000, true, undefined, 5);
  assert.equal(context.sourceSelection?.bootstrap, false);
  assert.ok(context.sourceSelection?.reasons.includes('no_match'));
  assert.deepEqual(JSON.parse(context.prompt).mandatory.campaignSourceSeeds, []);
  previous.undone = true;
  assert.equal(
    buildContext(c, [previous], 'start', [], 16000, true, undefined, 5).sourceSelection?.bootstrap,
    true
  );
});
test('search pagination is frozen-query scoped and Unicode results remain exact original slices', () => {
  const c = newCampaign({ name: 'Paged sources' });
  c.sources = Array.from({ length: 10 }, (_, index) =>
    textSource(`Source ${index}`, 'İ 🌙 '.repeat(35) + 'gate beside the arena')
  );
  const frozen = freezeCampaignSources(c);
  const lookup = createCampaignSourceRecall(frozen);
  const first = lookup.search({ query: 'gate' });
  const cursor = first.nextCursor as string;
  assert.ok(cursor);
  const entries = first.entries as { sourceId: string; start: number; end: number; text: string }[];
  assert.equal(entries.length, 8);
  for (const hit of entries)
    assert.equal(
      frozen.sources.find((source) => source.id === hit.sourceId)!.text.slice(hit.start, hit.end),
      hit.text
    );
  assert.equal((lookup.search({ query: 'gate', cursor }).entries as unknown[]).length, 2);
  assert.throws(() => lookup.search({ query: 'arena', cursor }), /Cursor/);
  assert.throws(
    () => createCampaignSourceRecall(frozen).search({ query: 'gate', cursor }),
    /Cursor/
  );
});

test('source tools require explicit v5 handler and work for both default and library gameplay', async () => {
  for (const book of [false, true]) {
    const calls: string[] = [];
    const tools = new GameplayTools({
      book,
      roll: async () => {
        throw new Error('No dice');
      },
      read: async () => ({}),
      assertActive: async () => {},
      readCampaignSource: async (name) => {
        calls.push(name);
        return { ok: true };
      },
    });
    assert.ok(tools.definitions.some((d) => d.name === CAMPAIGN_SOURCE_SEARCH_TOOL_NAME));
    await tools.call(CAMPAIGN_SOURCE_SEARCH_TOOL_NAME, { query: 'arena' }, 1);
    await tools.call(CAMPAIGN_SOURCE_SEARCH_TOOL_NAME, { query: 'arena' }, 1);
    assert.equal(calls.length, 1);
    await assert.rejects(
      () =>
        tools.call(
          CAMPAIGN_SOURCE_GET_TOOL_NAME,
          { sourceId: randomUUID(), version: 0, sectionIndex: 0 },
          2
        ),
      /schema/
    );
    await assert.rejects(() => tools.call('read_file', {}, 3), /outside/);
  }
  const legacy = new GameplayTools({
    book: false,
    roll: async () => {
      throw new Error('No dice');
    },
    assertActive: async () => {},
  });
  assert.ok(!legacy.definitions.some((d) => d.name === CAMPAIGN_SOURCE_SEARCH_TOOL_NAME));
});
