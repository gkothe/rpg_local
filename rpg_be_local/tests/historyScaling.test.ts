import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildContext, compactionBatch } from '../src/domain/context.js';
import { newCampaign } from '../src/domain/campaign.js';
import { boundedBackground } from '../src/domain/memoryRebuildGeneration.js';
import {
  HistoryFragmentKind,
  HistorySelectionStatus,
  fragmentDigest,
  type HistoryFragment,
  type HistorySettings,
} from '../src/domain/historyRecall.js';
import type { Turn } from '../src/domain/types.js';

const hex = (n: number) => n.toString(16).padStart(64, '0');

test('bounded background keeps the newest whole lines and always the last one', () => {
  const lines = Array.from({ length: 200 }, (_, i) => `- Event ${i}: ${'detail '.repeat(10)}`);
  const text = lines.join('\n');
  const bounded = boundedBackground(text);
  assert.ok(Buffer.byteLength(bounded) <= 4096);
  assert.ok(bounded.endsWith(lines.at(-1)!));
  assert.ok(
    bounded.split('\n').every((line) => lines.includes(line)),
    'no line is cut mid-fact'
  );
  assert.ok(!bounded.includes('- Event 0:'));
  assert.equal(boundedBackground('- short\n- list'), '- short\n- list');
  const huge = `- ${'x'.repeat(10_000)}`;
  assert.equal(boundedBackground(`- early\n${huge}`), huge);
  assert.equal(boundedBackground(''), '');
});

test('selective compaction supplies the short background while legacy mode keeps the full memory', () => {
  const c = newCampaign({ name: 'Background' });
  const turn = (id: string): Turn =>
    ({ id, status: 'completed', undone: false, action: 'a', narrative: 'n' }) as unknown as Turn;
  c.memory = {
    id: randomUUID(),
    text: 'FULL ARCHIVE '.repeat(2000),
    coveredTurnIds: [],
    valid: true,
    createdAt: '',
  };
  const history = ['a', 'b', 'c', 'd', 'e', 'f'].map(turn);
  const legacy = JSON.parse(compactionBatch(c, history).prompt);
  assert.equal(legacy.priorMemory, c.memory.text);
  const selective = JSON.parse(compactionBatch(c, history, undefined, 'Short overview.').prompt);
  assert.equal(selective.priorMemory, 'Short overview.');
  assert.equal(JSON.parse(compactionBatch(c, history, undefined, '').prompt).priorMemory, '');
});

function corpus(turnCount: number) {
  const campaignId = randomUUID();
  const recent = ['r1', 'r2', 'r3'].map(
    (w, i): Turn =>
      ({
        id: `00000000-0000-4000-8000-00000000000${i}`,
        status: 'completed',
        undone: false,
        action: `recent ${w}`,
        narrative: `Recent scene ${w}.`,
      }) as unknown as Turn
  );
  const older = Array.from(
    { length: turnCount - 3 },
    (_, i): Turn =>
      ({
        id: randomUUID(),
        status: 'completed',
        undone: false,
        action: `old ${i}`,
        narrative: `Ordinary day ${i}.`,
      }) as unknown as Turn
  );
  const turns = [...older, ...recent];
  const fragments: HistoryFragment[] = [];
  let tick = 0;
  const add = (title: string, text: string, kind: HistoryFragmentKind, turnIds: string[]) => {
    const payload = {
      kind,
      title,
      text,
      sources: turnIds.map((turnId) => ({ turnId, contentHash: hex(++tick) })),
      parentIds: [],
      derivationDigest: hex(1),
      correctionDigest: hex(2),
      links: [],
    };
    const fragment: HistoryFragment = {
      ...payload,
      id: `10000000-0000-4000-8000-${String(fragments.length).padStart(12, '0')}`,
      campaignId,
      contentDigest: fragmentDigest(payload),
      createdAt: new Date(2026, 0, 1, 0, 0, fragments.length).toISOString(),
      selection: HistorySelectionStatus.Valid,
    };
    fragments.push(fragment);
    return fragment;
  };
  // The same relevant and protected content exists at any size; only unrelated history grows.
  const key = add(
    'The silver key',
    'Marta hid the silver key in the cellar.',
    HistoryFragmentKind.Section,
    [older[0]!.id]
  );
  const oath = add(
    'The oath',
    'The party swore an oath at the gate.',
    HistoryFragmentKind.Section,
    [older[1]!.id]
  );
  for (let i = 2; i < older.length; i += 8)
    add(
      `Market ${i}`,
      `Ordinary trading happened around day ${i}.`,
      HistoryFragmentKind.Section,
      older.slice(i, i + 8).map((t) => t.id)
    );
  const overview = add('Story so far', 'A short overview.', HistoryFragmentKind.Overview, [
    older[0]!.id,
  ]);
  const c = newCampaign({ name: 'Scaling' });
  c.id = campaignId;
  const settings: HistorySettings = {
    enabled: true,
    activeOverviewId: overview.id,
    protectedKnowledgeIds: [],
    protectedSectionIds: [oath.id],
    protectedMemoryIds: [],
  };
  c.historyRecall = settings;
  void key;
  return { c, turns, fragments };
}

test('the prompt is the same size class at 40 and 4,000 turns; omitted history stays searchable', () => {
  const build = (count: number) => {
    const { c, turns, fragments } = corpus(count);
    const manifest = buildContext(c, turns, 'where is the silver key', [], undefined, {
      fragments,
      turnVersions: turns.map((t, i) => ({ turnId: t.id, contentHash: hex(i + 1) })),
      protectedMemories: [],
    });
    return { manifest, payload: JSON.parse(manifest.prompt), fragments, c };
  };
  const small = build(40);
  const large = build(4000);
  const optional = (p: { historyRecall: Record<string, unknown> }) => ({
    protectedHistory: p.historyRecall.protectedHistory,
    relevantHistory: p.historyRecall.relevantHistory,
  });
  assert.deepEqual(optional(large.payload), optional(small.payload));
  assert.deepEqual(
    large.payload.historyRecall.relevantHistory.map((r: { title: string }) => r.title),
    ['The silver key']
  );
  assert.deepEqual(
    large.payload.historyRecall.protectedHistory.map((r: { title: string }) => r.title),
    ['The oath']
  );
  // Only the three newest pairs are raw; everything else is summarized and recallable.
  assert.equal(large.payload.history.length, 3);
  assert.equal(small.payload.history.length, 3);
  assert.equal(large.payload.memory, small.payload.memory);
  const size = (m: { prompt: string }) => Buffer.byteLength(m.prompt);
  assert.ok(Math.abs(size(large.manifest) - size(small.manifest)) < 64, 'only counters differ');
  assert.ok(large.payload.historyRecall.searchable.turns === 4000);
  // The frozen corpus covers every fragment, so omitted events remain findable.
  assert.equal(large.manifest.frozenHistory!.fragments.length, large.fragments.length);
  assert.equal(large.manifest.frozenHistory!.turnVersions.length, 4000);
});
