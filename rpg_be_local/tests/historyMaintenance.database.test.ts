import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Store } from '../src/store.js';
import { HistoryStore } from '../src/services/historyStore.js';
import { TurnService } from '../src/services/turns.js';
import {
  HistoryFragmentKind,
  correctionDigestOf,
  type HistoryFragmentPayload,
} from '../src/domain/historyRecall.js';
import { derivationDigest } from '../src/domain/historyGeneration.js';
import { Problem } from '../src/errors.js';
import type { Generator } from '../src/providers/service.js';
import { dbEnabled, openIsolatedStore, seedCampaign, sleep } from './journalFixture.js';

let isolated: Awaited<ReturnType<typeof openIsolatedStore>>;
let store: Store;
before(async () => {
  if (!dbEnabled) return;
  isolated = await openIsolatedStore('history_maint');
  store = isolated.store;
});
after(async () => {
  if (dbEnabled) await isolated.close();
});

function generator() {
  const calls: string[] = [];
  const prompts: string[] = [];
  const control = { failSection: false };
  const gen: Generator = {
    capacity: async () => 16000,
    gameplayCapacity: async () => 16000,
    generate: async (_settings, prompt, schema) => {
      const props = (schema as { properties?: Record<string, unknown> }).properties ?? {};
      if (props.narrative) return { narrative: 'Quiet.' };
      const input = JSON.parse(prompt);
      if (props.title) {
        const kind = input.sectionTitles ? 'chapter' : 'section';
        if (kind === 'section' && control.failSection)
          throw new Problem(429, 'provider_quota', 'Synthetic quota');
        calls.push(kind);
        return {
          title: `${kind} ${calls.length}`,
          text: `${kind} over ${input.turns.length} turns.`,
        };
      }
      if (input.chapters) {
        calls.push('overview');
        return { text: `Overview after ${calls.length} calls.` };
      }
      return { text: '- automatic' };
    },
    generateOwnedGameplay: async (_s, prompt) => {
      prompts.push(prompt);
      return {
        combatEffects: [],
        participantReferences: [],
        narrative: 'Quiet.',
        operations: [],
        rollInterpretations: [],
        ruleCitations: [],
        knowledgeChanges: [],
        operationExplanations: [],
      };
    },
  };
  return { gen, calls, prompts, control };
}

/** `count` seeded pairs with the first `indexed` turns already summarized in 8-turn sections. */
async function indexed(count: number, indexed: number) {
  const { campaign, turns } = await seedCampaign(
    store,
    Array.from({ length: count }, (_, i) => ({
      action: `act ${i}`,
      narrative: `Scene ${i} unfolded.`,
    }))
  );
  const history = new HistoryStore(store);
  const versions = await store.transaction((client) =>
    history.captureVersions(client, campaign.id, turns)
  );
  const locator = (i: number) => ({
    turnId: versions[i]!.turnId,
    contentHash: versions[i]!.contentHash,
  });
  const base = (
    kind: HistoryFragmentKind,
    sources: ReturnType<typeof locator>[],
    parentIds: string[] = []
  ): HistoryFragmentPayload => ({
    kind,
    title: `${kind} ${sources.length}`,
    text: `${kind} text`,
    sources,
    parentIds,
    derivationDigest: derivationDigest(kind, sources, []),
    correctionDigest: correctionDigestOf([]),
    links: [],
  });
  const sections: Awaited<ReturnType<HistoryStore['publish']>> = [];
  for (let start = 0; start < indexed; start += 8) {
    const sources = Array.from({ length: 8 }, (_, i) => locator(start + i));
    const [section] = await store.transaction((client) =>
      history.publish(client, campaign.id, [base(HistoryFragmentKind.Section, sources)])
    );
    sections.push(section!);
  }
  const [overview] = await store.transaction((client) =>
    history.publish(client, campaign.id, [
      base(
        HistoryFragmentKind.Overview,
        sections.flatMap((s) => s.sources),
        sections.map((s) => s.id)
      ),
    ])
  );
  await store.edit(campaign.id, 0, (c) => {
    c.historyRecall = {
      enabled: true,
      activeOverviewId: overview!.id,
      protectedKnowledgeIds: [],
      protectedSectionIds: [],
      protectedMemoryIds: [],
    };
  });
  return { campaign, sections, overview: overview!, history };
}
async function play(service: TurnService, campaignId: string, action: string) {
  const turn = await service.submit(campaignId, {
    revision: (await store.campaign(campaignId)).revision,
    requestId: randomUUID(),
    action,
  });
  for (let i = 0; i < 600; i++) {
    const saved = await store.turn(campaignId, turn.id);
    if (saved.status !== 'pending' && saved.status !== 'running') return saved;
    await sleep(10);
  }
  throw new Error('turn did not settle');
}

test(
  'a turn summarizes the newest complete block, refreshes the overview and keeps the rest raw',
  { skip: !dbEnabled },
  async () => {
    const { campaign, overview, history } = await indexed(20, 8);
    const g = generator();
    const service = new TurnService(store, g.gen);
    const saved = await play(service, campaign.id, 'look around');
    assert.equal(saved.status, 'completed', saved.error ?? '');
    assert.deepEqual(g.calls, ['section', 'overview']);
    const all = await history.list(campaign.id);
    const valid = all.filter((f) => f.selection === 'valid');
    assert.equal(valid.filter((f) => f.kind === 'section').length, 2);
    const current = await store.campaign(campaign.id);
    assert.notEqual(current.historyRecall?.activeOverviewId, overview.id);
    assert.equal(
      all.find((f) => f.id === overview.id)?.selection,
      'stale',
      'old overview is retained'
    );
    // Turns 8-15 are now summarized; 16 is a partial block, so it stays in the prompt as raw backlog.
    const prompt = g.prompts[0]!;
    assert.match(prompt, /act 16/);
    assert.doesNotMatch(prompt, /act 9\b/);
    // Nothing new to consolidate on the next turn: no maintenance calls at all.
    const before = g.calls.length;
    assert.equal((await play(service, campaign.id, 'wait')).status, 'completed');
    assert.equal(g.calls.length, before);
  }
);

test(
  'four sections become a chapter regenerated from the originals',
  { skip: !dbEnabled },
  async () => {
    const { campaign, history } = await indexed(35, 24);
    const g = generator();
    const service = new TurnService(store, g.gen);
    assert.equal((await play(service, campaign.id, 'continue')).status, 'completed');
    assert.deepEqual(g.calls, ['section', 'chapter', 'overview']);
    const valid = (await history.list(campaign.id)).filter((f) => f.selection === 'valid');
    const chapter = valid.find((f) => f.kind === 'chapter')!;
    const sections = valid.filter((f) => f.kind === 'section');
    assert.equal(sections.length, 4);
    assert.deepEqual([...chapter.parentIds].sort(), sections.map((s) => s.id).sort());
    assert.equal(chapter.sources.length, 32);
  }
);

test(
  'a failed summary fails the action visibly and keeps the previous index',
  { skip: !dbEnabled },
  async () => {
    const { campaign, overview, history } = await indexed(20, 8);
    const g = generator();
    g.control.failSection = true;
    const service = new TurnService(store, g.gen);
    const saved = await play(service, campaign.id, 'look around');
    assert.notEqual(saved.status, 'completed');
    assert.ok(saved.error);
    const all = await history.list(campaign.id);
    assert.equal(all.filter((f) => f.selection === 'valid').length, 2);
    assert.equal((await store.campaign(campaign.id)).historyRecall?.activeOverviewId, overview.id);
    // Turning selective history off restores the full-memory prompt without any maintenance.
    await store.edit(campaign.id, 0, (c) => {
      c.historyRecall = { ...c.historyRecall!, enabled: false };
    });
    g.control.failSection = false;
    assert.equal((await play(service, campaign.id, 'try again')).status, 'completed');
    assert.deepEqual(g.calls, []);
  }
);

test(
  'an index without a current overview is left to the explicit Prepare flow',
  { skip: !dbEnabled },
  async () => {
    const { campaign } = await indexed(20, 8);
    await store.edit(campaign.id, 0, (c) => {
      c.historyRecall = { ...c.historyRecall!, activeOverviewId: null };
    });
    const g = generator();
    const service = new TurnService(store, g.gen);
    const r4 = await play(service, campaign.id, 'look');
    assert.equal(r4.status, 'completed', r4.error ?? '');
    assert.deepEqual(g.calls, []);
  }
);
