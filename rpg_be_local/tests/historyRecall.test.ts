import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  HistoryFragmentKind,
  HistoryReason,
  HistorySelectionStatus,
  fragmentDigest,
  pageOriginals,
  searchFragments,
  selectHistory,
  turnVersionOf,
  type HistoryFragment,
  type HistorySettings,
  type TurnVersionDocument,
} from '../src/domain/historyRecall.js';
import { buildContext } from '../src/domain/context.js';
import { newCampaign } from '../src/domain/campaign.js';
import { selectRelevantKnowledge } from '../src/domain/knowledgeRecall.js';
import { KnowledgeKind as K } from '../src/domain/knowledge.js';
import type { Turn } from '../src/domain/types.js';
import { knowledgeRecord } from './journalFixture.js';

const CAMPAIGN = randomUUID();
const hex = (n: number) => n.toString(16).padStart(64, '0');
let tick = 0;
function fragment(
  title: string,
  text: string,
  kind = HistoryFragmentKind.Section,
  turns = 1
): HistoryFragment {
  const payload = {
    kind,
    title,
    text,
    sources: Array.from({ length: turns }, () => ({
      turnId: randomUUID(),
      contentHash: hex(++tick),
    })),
    parentIds: [],
    derivationDigest: hex(1),
    correctionDigest: hex(2),
    links: [],
  };
  return {
    ...payload,
    id: randomUUID(),
    campaignId: CAMPAIGN,
    contentDigest: fragmentDigest(payload),
    createdAt: new Date(2026, 0, 1, 0, 0, tick).toISOString(),
    selection: HistorySelectionStatus.Valid,
  };
}
const settings = (over: Partial<HistorySettings> = {}): HistorySettings => ({
  enabled: true,
  activeOverviewId: null,
  protectedKnowledgeIds: [],
  protectedSectionIds: [],
  protectedMemoryIds: [],
  ...over,
});

test('optional history is identical at 40 and 4,000 turns when only irrelevant history grows', () => {
  const overview = fragment('Overview', 'The story so far.', HistoryFragmentKind.Overview);
  const relevant = fragment('The silver key', 'Marta hid the silver key in the cellar.');
  const pinned = fragment('Oath', 'The party swore an oath at the gate.');
  const pick = (extra: number) => {
    const noise = Array.from({ length: extra }, (_, i) =>
      fragment(`Market day ${i}`, `Ordinary trading happened on day ${i}.`)
    );
    return selectHistory(
      [overview, relevant, pinned, ...noise],
      settings({ activeOverviewId: overview.id, protectedSectionIds: [pinned.id] }),
      'where is the silver key'
    );
  };
  const small = pick(5);
  const large = pick(500);
  assert.equal(JSON.stringify(large.relevant), JSON.stringify(small.relevant));
  assert.equal(JSON.stringify(large.protectedItems), JSON.stringify(small.protectedItems));
  assert.equal(large.diagnostics.suppliedBytes, small.diagnostics.suppliedBytes);
  assert.deepEqual(
    small.relevant.map((r) => r.title),
    ['The silver key']
  );
  assert.equal(large.diagnostics.omitted.reasonCounts[HistoryReason.SearchableOnly], 500);
});

test('protected material is kept over the soft target and the overflow is reported', () => {
  const big = fragment('Huge oath', 'oath '.repeat(600));
  const result = selectHistory([big], settings({ protectedSectionIds: [big.id] }), 'anything', 100);
  assert.equal(result.protectedItems.length, 1);
  assert.ok(result.diagnostics.overflowBytes > 0);
  assert.ok(result.diagnostics.mandatoryBytes > 100);
});

test('stale fragments are never selected and whole items are never sliced', () => {
  const stale = { ...fragment('Old key', 'key key key'), selection: HistorySelectionStatus.Stale };
  const big = fragment('Key essay', 'key '.repeat(900));
  const small = fragment('Key note', 'the key note');
  const picked = selectHistory([stale, big, small], settings(), 'key', 600);
  assert.deepEqual(
    picked.relevant.map((r) => r.title),
    ['Key note']
  );
  assert.equal(picked.relevant[0]!.text, 'the key note');
});

test('search pages stably, binds cursors to the frozen corpus and lists chronologically when empty', () => {
  const corpus = Array.from({ length: 7 }, (_, i) => fragment(`Scene ${i}`, `harbor scene ${i}`));
  const frozen = {
    fragments: corpus.map((f) => ({ id: f.id, contentDigest: f.contentDigest })),
    turnVersions: [],
  };
  const first = searchFragments(corpus, frozen, new Map(), { query: '', limit: 3 });
  assert.deepEqual(
    first.items.map((i) => i.title),
    ['Scene 0', 'Scene 1', 'Scene 2']
  );
  const second = searchFragments(corpus, frozen, new Map(), {
    query: '',
    limit: 3,
    cursor: first.nextCursor!,
  });
  assert.deepEqual(
    second.items.map((i) => i.title),
    ['Scene 3', 'Scene 4', 'Scene 5']
  );
  assert.throws(
    () =>
      searchFragments(corpus, frozen, new Map(), {
        query: 'harbor',
        limit: 3,
        cursor: first.nextCursor!,
      }),
    /Cursor does not belong/
  );
  assert.throws(
    () =>
      searchFragments(corpus, { ...frozen, fragments: frozen.fragments.slice(1) }, new Map(), {
        query: '',
        limit: 3,
        cursor: first.nextCursor!,
      }),
    /Cursor does not belong/
  );
});

test('original pages return whole pairs and one oversized pair uncut', () => {
  const turns = Array.from({ length: 6 }, (_, i) =>
    turnVersionOf({
      id: randomUUID(),
      action: `act ${i}`,
      narrative: i === 2 ? 'x'.repeat(40_000) : `scene ${i}`,
      createdAt: new Date(2026, 0, 1, 0, i).toISOString(),
    })
  );
  const versions = new Map<string, TurnVersionDocument>(
    turns.map((t) => [t.contentHash, t.document])
  );
  const sources = turns.map(({ turnId, contentHash }) => ({ turnId, contentHash }));
  const frozen = { fragments: [], turnVersions: sources };
  const page = (cursor?: string) =>
    pageOriginals(sources, versions, frozen, { fragmentId: 'f', limit: 4, cursor });
  const first = page();
  // The oversized pair would push the page over the soft target, so it starts the next page.
  assert.deepEqual(
    first.originals.map((o) => o.player),
    ['act 0', 'act 1']
  );
  const second = page(first.nextCursor!);
  assert.equal(second.originals.length, 1);
  assert.equal(second.originals[0]!.gm.length, 40_000);
  const third = page(second.nextCursor!);
  assert.deepEqual(
    third.originals.map((o) => o.player),
    ['act 3', 'act 4', 'act 5']
  );
  assert.equal(third.nextCursor, null);
});

test('compact context supplies the overview and relevant history instead of full memory', () => {
  const c = newCampaign({ name: 'Compact' });
  c.memory = {
    id: randomUUID(),
    text: 'FULL ARCHIVAL MEMORY SHOULD STAY OUT',
    coveredTurnIds: [],
    valid: true,
    createdAt: '',
  };
  const overview = fragment('Overview', 'Short overview text.', HistoryFragmentKind.Overview);
  const section = fragment('The harbor deal', 'Marta sold the map at the harbor.');
  c.historyRecall = settings({ activeOverviewId: overview.id });
  const turn = {
    id: randomUUID(),
    status: 'completed',
    undone: false,
    action: 'ask about the harbor',
    narrative: 'n',
  } as unknown as Turn;
  const compact = buildContext(c, [turn], 'go to the harbor', [], undefined, {
    fragments: [overview, section],
    turnVersions: [],
    protectedMemories: [{ id: randomUUID(), text: 'PINNED MANUAL MEMORY' }],
  });
  assert.doesNotMatch(compact.prompt, /FULL ARCHIVAL MEMORY/);
  assert.match(compact.prompt, /Short overview text/);
  assert.match(compact.prompt, /Marta sold the map/);
  assert.match(compact.prompt, /PINNED MANUAL MEMORY/);
  assert.equal(compact.frozenHistory?.fragments.length, 2);
  assert.equal(compact.frozenHistory?.mode, 'compact');
  const legacy = buildContext(c, [turn], 'go to the harbor', []);
  assert.match(legacy.prompt, /FULL ARCHIVAL MEMORY/);
  assert.equal(legacy.frozenHistory, undefined);
});

test('a link to the player no longer makes history mandatory in selective mode', () => {
  const c = newCampaign({ name: 'Knowledge priority' });
  const player = { id: randomUUID(), name: 'Hero', type: 'player' } as never;
  c.characters = [player];
  const old = knowledgeRecord('Tavern brawl', 'A brawl broke out.', {
    kind: K.Event,
    characterIds: [(player as { id: string }).id],
  });
  const debt = knowledgeRecord('Owe Marta', 'Return the key.', { kind: K.Debt });
  const noise = Array.from({ length: 30 }, (_, i) =>
    knowledgeRecord(`Event ${i}`, `Past event ${i}`, {
      kind: K.Event,
      characterIds: [(player as { id: string }).id],
    })
  );
  c.knowledge = [old, debt, ...noise];
  const legacy = selectRelevantKnowledge(c, 'open the door');
  const compact = selectRelevantKnowledge(c, 'open the door', '', { compact: true });
  assert.ok(legacy.length >= 32, 'legacy mode includes every player-linked event');
  assert.deepEqual(
    compact.map((r) => r.title),
    ['Owe Marta']
  );
  const pinned = selectRelevantKnowledge(c, 'open the door', '', {
    compact: true,
    pinnedIds: [old.id],
  });
  assert.ok(pinned.some((r) => r.id === old.id));
});
