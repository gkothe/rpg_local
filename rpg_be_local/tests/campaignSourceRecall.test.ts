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
import { sourceSections } from '../src/domain/sourceSections.js';
import { GameplayTools } from '../src/providers/gameplayTools.js';

test('v5 catalog and lookup agree on retrieved, partial, pinned and seeded originals', () => {
  const c = newCampaign({ name: 'Supplied context' });
  const retrieved = textSource('Retrieved', 'background '.repeat(900));
  const partial = textSource('Partial', 'A partial original remains unread in full.');
  const pinned = textSource('Pinned', 'A complete pinned original.');
  const seeded = textSource('Seeded', 'Opening campaign preparation.');
  retrieved.purpose = partial.purpose = pinned.purpose = SourcePurpose.Character;
  seeded.purpose = SourcePurpose.Campaign;
  c.sources = [retrieved, partial, pinned, seeded];
  c.pinnedSourceIds = [pinned.id];
  const section = sourceSections(retrieved)[0]!;
  const rules = [
    { ...section, id: retrieved.id, name: retrieved.name },
    {
      id: partial.id,
      version: partial.version,
      name: partial.name,
      start: 0,
      end: 9,
      text: partial.text.slice(0, 9),
    },
  ];
  const context = buildContext(c, [], 'look', rules, 1, true, undefined, 5);
  const catalog = JSON.parse(context.prompt).mandatory.campaignSources as ReturnType<
    typeof campaignSourceCatalog
  >;
  const lookup = createCampaignSourceRecall(context.frozenSources!, context.sourceSpans);
  assert.deepEqual(JSON.parse(context.prompt).rules, rules);
  assert.deepEqual(
    catalog.map((source) => source.sections.map((entry) => entry.supplied)),
    [[true, false, false], [false], [true], [true]]
  );
  for (const source of catalog) {
    for (const entry of source.sections) {
      assert.equal(
        lookup.get(
          { sourceId: source.id, version: source.version, sectionIndex: entry.sectionIndex },
          randomUUID()
        ).alreadySupplied,
        entry.supplied
      );
    }
  }
  const search = lookup.search({ query: 'background' }).entries as {
    sectionIndex: number;
    alreadySupplied: boolean;
  }[];
  assert.equal(search.find((entry) => entry.sectionIndex === 0)!.alreadySupplied, true);
});

test('meaningful whole tokens outrank common words and snippets locate the requested phrase', () => {
  const c = newCampaign({ name: 'Relevance' });
  c.sources = [
    textSource('Noise', 'The night is here. An arena opening happens. A prologuesque aside.'),
    textSource(
      'Preparation',
      'The night begins. ' + 'background '.repeat(40) + 'The arena prologue begins at noon.'
    ),
  ];
  const lookup = createCampaignSourceRecall(freezeCampaignSources(c));
  const hits = lookup.search({ query: 'the arena prologue' }).entries as {
    sourceId: string;
    text: string;
    start: number;
    end: number;
  }[];
  assert.equal(hits[0]!.sourceId, c.sources[1]!.id);
  assert.match(hits[0]!.text, /arena prologue/);
  assert.equal(hits[0]!.text, c.sources[1]!.text.slice(hits[0]!.start, hits[0]!.end));
  assert.equal((lookup.search({ query: 'prologue' }).entries as unknown[]).length, 1);
  assert.ok((lookup.search({ query: 'the' }).entries as unknown[]).length);
  assert.equal((lookup.search({ query: '!!!' }).entries as unknown[]).length, 0);
});

test('catalog carries Markdown headings across chunks and supplied means the whole original section', () => {
  const c = newCampaign({ name: 'Index' });
  c.sources = [
    textSource(
      'Preparation',
      '# Opening\n\n' + 'background '.repeat(700) + '\n\n## Arena prologue\n\nA gate at noon.'
    ),
  ];
  const frozen = freezeCampaignSources(c);
  const catalog = campaignSourceCatalog(frozen);
  assert.equal(catalog[0]!.sections[0]!.title, 'Opening');
  assert.ok(catalog[0]!.sections.some((s) => s.headings.includes('Arena prologue')));
  const full = {
    id: c.sources[0]!.id,
    version: 1,
    name: 'Preparation',
    text: c.sources[0]!.text,
    start: 0,
    end: c.sources[0]!.text.length,
  };
  assert.ok(campaignSourceCatalog(frozen, [full])[0]!.sections.every((s) => s.supplied));
  const lookup = createCampaignSourceRecall(frozen, [
    { ...full, text: full.text.slice(0, 20), end: 20 },
  ]);
  const args = { sourceId: full.id, version: 1, sectionIndex: 0 };
  const first = lookup.get(args, 'first');
  assert.equal(first.alreadySupplied, false);
  lookup.markSupplied(first.sourceSpan);
  assert.equal(lookup.get(args, 'second').alreadySupplied, true);
  assert.equal(
    (lookup.search({ query: 'background' }).entries as { alreadySupplied: boolean }[])[0]!
      .alreadySupplied,
    true
  );
  assert.equal(createCampaignSourceRecall(frozen).get(args, 'fresh').alreadySupplied, false);
});

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
  assert.equal(data.campaignSources[0].sections[0].supplied, true);
  assert.equal(data.campaignSources[2].sections[0].supplied, false);
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
