import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { Store } from '../src/store.js';
import { createApp } from '../src/app.js';
import type { ProviderService } from '../src/providers/service.js';
import { MemoryRebuildService } from '../src/services/memoryRebuild.js';
import { HistoryStore } from '../src/services/historyStore.js';
import { TurnService } from '../src/services/turns.js';
import { MemoryRebuildPurpose, MemoryRebuildStatus } from '../src/domain/memoryRebuild.js';
import { HistoryFragmentKind } from '../src/domain/historyRecall.js';
import { Problem } from '../src/errors.js';
import {
  dbEnabled,
  fakeGenerator,
  openIsolatedStore,
  seedCampaign,
  sleep,
} from './journalFixture.js';

let isolated: Awaited<ReturnType<typeof openIsolatedStore>>;
let store: Store;
before(async () => {
  if (!dbEnabled) return;
  isolated = await openIsolatedStore('history_prep');
  store = isolated.store;
});
after(async () => {
  if (dbEnabled) await isolated.close();
});

function generator() {
  const calls: { kind: string; turns: number }[] = [];
  let failNext = false;
  const fake = fakeGenerator((prompt) => {
    if (failNext) {
      failNext = false;
      throw new Problem(429, 'provider_quota', 'Synthetic quota');
    }
    const turns = (prompt.turns as unknown[] | undefined)?.length ?? 0;
    if (prompt.chapters) {
      calls.push({ kind: 'overview', turns: 0 });
      return { text: 'Overview of the harbor campaign.' };
    }
    const kind = prompt.sectionTitles ? 'chapter' : 'section';
    calls.push({ kind, turns });
    return {
      title: `${kind} ${calls.length}`,
      text: `${kind} covering ${turns} turns at the harbor.`,
    };
  });
  return {
    fake,
    calls,
    failOnce: () => {
      failNext = true;
    },
  };
}
async function seed(count = 12) {
  return seedCampaign(
    store,
    Array.from({ length: count }, (_, i) => ({
      action: `act ${i}`,
      narrative: `Scene ${i} happened at the harbor.`,
    }))
  );
}
async function settle(service: MemoryRebuildService, campaignId: string, jobId: string) {
  for (let i = 0; i < 800; i++) {
    const view = await service.status(campaignId, jobId);
    if (!view.active) return view;
    await sleep(10);
  }
  throw new Error('job did not settle');
}

test(
  'prepare stages a reviewable index without touching memory; apply activates it',
  { skip: !dbEnabled },
  async () => {
    const { campaign, turns } = await seed();
    const g = generator();
    const service = new MemoryRebuildService(store, g.fake);
    const memoryBefore = (await store.campaign(campaign.id)).memory;
    const requestId = randomUUID();
    const started = await service.start(
      campaign.id,
      requestId,
      MemoryRebuildPurpose.CompactHistory
    );
    assert.equal(started.purpose, 'compact_history');
    assert.equal(
      (await service.start(campaign.id, requestId, MemoryRebuildPurpose.CompactHistory)).id,
      started.id
    );
    // The same request ID with another purpose is a conflict, not a replay.
    await assert.rejects(
      service.start(campaign.id, requestId, MemoryRebuildPurpose.Memory),
      /different input/
    );
    const ready = await settle(service, campaign.id, started.id);
    assert.equal(ready.status, MemoryRebuildStatus.Ready, ready.safeError ?? '');
    // 9 older pairs: two sections (8 + 1), one chapter and one overview.
    assert.deepEqual(
      g.calls.map((c) => c.kind),
      ['section', 'section', 'chapter', 'overview']
    );
    assert.deepEqual(ready.compact, { sections: 2, chapters: 1 });
    assert.equal(ready.candidate?.text, 'Overview of the harbor campaign.');
    assert.equal(ready.candidate?.coveredTurnIds.length, 9);
    // A draft is not active: nothing is published and settings are untouched.
    assert.equal((await new HistoryStore(store).list(campaign.id)).length, 0);
    assert.equal((await store.campaign(campaign.id)).historyRecall, undefined);
    assert.deepEqual((await store.campaign(campaign.id)).memory, memoryBefore);
    const applied = await service.apply(
      campaign.id,
      started.id,
      randomUUID(),
      ready.candidate!.proposalDigest
    );
    assert.equal(applied.job.status, MemoryRebuildStatus.Applied);
    assert.equal(applied.campaign.historyRecall?.enabled, true);
    const fragments = await new HistoryStore(store).list(campaign.id, undefined, true);
    assert.equal(fragments.length, 4);
    const overview = fragments.find((f) => f.kind === HistoryFragmentKind.Overview)!;
    assert.equal(applied.campaign.historyRecall?.activeOverviewId, overview.id);
    const chapter = fragments.find((f) => f.kind === HistoryFragmentKind.Chapter)!;
    assert.equal(chapter.parentIds.length, 2);
    assert.ok(chapter.parentIds.every((id) => fragments.some((f) => f.id === id)));
    assert.equal(chapter.sources.length, 9);
    assert.equal(chapter.sources[0]!.turnId, turns[0]!.id);
    assert.deepEqual((await store.campaign(campaign.id)).memory, memoryBefore);
  }
);

test(
  'a prepared index goes stale when the story changes and a failed step resumes',
  { skip: !dbEnabled },
  async () => {
    const { campaign } = await seed();
    const g = generator();
    const service = new MemoryRebuildService(store, g.fake);
    g.failOnce();
    const started = await service.start(
      campaign.id,
      randomUUID(),
      MemoryRebuildPurpose.CompactHistory
    );
    const failed = await settle(service, campaign.id, started.id);
    assert.equal(failed.status, MemoryRebuildStatus.Failed);
    assert.equal(failed.processedTurns, 0);
    await service.resume(campaign.id, started.id, randomUUID());
    const ready = await settle(service, campaign.id, started.id);
    assert.equal(ready.status, MemoryRebuildStatus.Ready, ready.safeError ?? '');
    assert.equal(g.calls.length, 4, 'no completed step is generated twice');
    const turnService = new TurnService(store, g.fake as never);
    // Undoing the newest pair changes the transcript: the draft can no longer be applied.
    await turnService.undo(campaign.id, 0);
    await assert.rejects(
      service.apply(campaign.id, started.id, randomUUID(), ready.candidate!.proposalDigest),
      (e: unknown) => e instanceof Problem && e.code === 'memory_stale'
    );
    assert.equal((await store.campaign(campaign.id)).historyRecall, undefined);
  }
);

test(
  'undo retires fragments built from the undone turn and their descendants',
  { skip: !dbEnabled },
  async () => {
    const { campaign, turns } = await seed();
    const g = generator();
    const service = new MemoryRebuildService(store, g.fake);
    const started = await service.start(
      campaign.id,
      randomUUID(),
      MemoryRebuildPurpose.CompactHistory
    );
    const ready = await settle(service, campaign.id, started.id);
    await service.apply(campaign.id, started.id, randomUUID(), ready.candidate!.proposalDigest);
    const history = new HistoryStore(store);
    // The 9th pair (index 8) belongs only to the trailing section, its chapter and the overview.
    await store.transaction((client) =>
      history.invalidateTurns(client, campaign.id, [turns[8]!.id])
    );
    const valid = await history.list(campaign.id, undefined, true);
    assert.deepEqual(
      valid.map((f) => f.kind),
      [HistoryFragmentKind.Section]
    );
    assert.equal(valid[0]!.sources.length, 8);
  }
);

test(
  'full-memory rebuilds keep the original purpose and DTO contract',
  { skip: !dbEnabled },
  async () => {
    const { campaign } = await seed(4);
    const g = generator();
    const g2 = fakeGenerator(() => ({ text: '- rebuilt' }));
    const service = new MemoryRebuildService(store, g2);
    const started = await service.start(campaign.id, randomUUID());
    assert.equal(started.purpose, 'memory');
    const ready = await settle(service, campaign.id, started.id);
    assert.equal(ready.status, MemoryRebuildStatus.Ready);
    assert.equal(ready.compact, null);
    assert.equal(ready.candidate?.text, '- rebuilt');
    void g;
    // A rebuild with too little history for sections is rejected explicitly.
    const small = await seed(3);
    await assert.rejects(
      new MemoryRebuildService(store, g.fake).start(
        small.campaign.id,
        randomUUID(),
        MemoryRebuildPurpose.CompactHistory
      ),
      (e: unknown) => e instanceof Problem && e.code === 'memory_invalid'
    );
  }
);

test(
  'the HTTP start accepts an additive purpose and defaults to full memory',
  { skip: !dbEnabled },
  async () => {
    const { campaign } = await seed(4);
    const app = createApp({
      store,
      providers: fakeGenerator(() => ({ text: '- ok' })) as unknown as ProviderService,
    }).app;
    const post = (body: unknown) =>
      request(app)
        .post(`/api/campaigns/${campaign.id}/memory/rebuilds`)
        .set('Host', 'localhost:4100')
        .set('X-RPG-Client', 'local-rpg')
        .send(body as object);
    await post({ requestId: randomUUID(), purpose: 'nonsense' }).expect(422);
    const started = await post({ requestId: randomUUID() }).expect(202);
    assert.equal(started.body.data.purpose, 'memory');
    const settings = await request(app)
      .get('/api/settings')
      .set('Host', 'localhost:4100')
      .expect(200);
    assert.deepEqual(
      settings.body.data.memoryRebuild.purposeOptions.map((o: { id: string }) => o.id),
      ['memory', 'compact_history']
    );
  }
);
