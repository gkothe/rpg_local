import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Store } from '../src/store.js';
import { appRoot, databaseUrl } from '../src/config.js';
import { newCampaign } from '../src/domain/campaign.js';
import { TurnService } from '../src/services/turns.js';
import { MemoryRebuildService } from '../src/services/memoryRebuild.js';
import { MemoryRebuildAction, MemoryRebuildStatus } from '../src/domain/memoryRebuild.js';
import { TurnStatus } from '../src/domain/options.js';
import { Problem } from '../src/errors.js';
import type { Generator } from '../src/providers/service.js';

const enabled = process.env.NODE_ENV === 'test' && !!process.env.RPG_TEST_DATABASE_URL;
const schema = `rebuild_fixture_${randomUUID().replaceAll('-', '')}`;
let store: Store;
before(async () => {
  if (!enabled) return;
  const bootstrap = new Store();
  await bootstrap.pool.query(`CREATE SCHEMA ${schema}`);
  await bootstrap.close();
  const url = new URL(databaseUrl());
  url.searchParams.set('options', `-c search_path=${schema}`);
  store = new Store(url.toString());
  for (const file of (await readdir(path.join(appRoot, 'migrationssql')))
    .filter((name) => name.endsWith('.sql'))
    .sort())
    await store.pool.query(await readFile(path.join(appRoot, 'migrationssql', file), 'utf8'));
});
after(async () => {
  if (!enabled) return;
  await store.pool.query(`DROP SCHEMA ${schema} CASCADE`);
  await store.close();
});

const SCENE = 'The arena crowd roars while the Embrace takes hold. '.repeat(24);
type Rebuild = { earlierSummary: string; turns: { id: string; player: string }[] };

function fixture() {
  const rebuildCalls: Rebuild[] = [];
  const control = {
    failAt: null as number | null,
    holdAt: null as number | null,
    release: null as (() => void) | null,
    held: null as Promise<void> | null,
  };
  let narrative = '';
  const generator: Generator = {
    capacity: async (_settings, ceiling = 16000) => ceiling,
    gameplayCapacity: async () => 16000,
    generate: async (_settings, prompt, schemaArg, signal) => {
      const hasText = !!(schemaArg as { properties?: { text?: unknown } }).properties?.text;
      if (!hasText) return { narrative };
      const input = JSON.parse(prompt);
      if (!('earlierSummary' in input)) return { text: `- automatic: ${input.turns.length} turns` };
      rebuildCalls.push({ earlierSummary: input.earlierSummary, turns: input.turns });
      const call = rebuildCalls.length - 1;
      if (control.failAt === call) {
        control.failAt = null;
        throw new Problem(429, 'provider_quota', 'Synthetic rebuild quota unavailable');
      }
      if (control.holdAt === call) {
        control.holdAt = null;
        await new Promise<void>((resolve, reject) => {
          control.release = resolve;
          signal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
      }
      return {
        text: `- rebuilt: ${input.turns.map((t: { player: string }) => t.player).join(', ')}`,
      };
    },
    generateOwnedGameplay: async (_settings, prompt) => {
      const action = JSON.parse(prompt).mandatory.action as string;
      narrative = `${SCENE} ${action}.`;
      return {
        combatEffects: [],
        participantReferences: [],
        narrative,
        operations: [],
        rollInterpretations: [],
        ruleCitations: [],
        knowledgeChanges: [],
        operationExplanations: [],
      };
    },
  };
  return { generator, rebuildCalls, control };
}

async function play(store: Store, service: TurnService, campaignId: string, action: string) {
  const current = await store.campaign(campaignId);
  const turn = await service.submit(campaignId, {
    revision: current.revision,
    requestId: randomUUID(),
    action,
  });
  for (let poll = 0; poll < 2000; poll++) {
    const saved = await store.turn(campaignId, turn.id);
    if (![TurnStatus.Pending, TurnStatus.Running].includes(saved.status as TurnStatus)) {
      assert.equal(saved.status, 'completed', saved.error ?? 'turn failed');
      return saved;
    }
    await delay(1);
  }
  throw new Error('turn did not settle');
}

async function settle(rebuild: MemoryRebuildService, campaignId: string, jobId: string) {
  for (let poll = 0; poll < 2000; poll++) {
    const view = await rebuild.status(campaignId, jobId);
    if (!view.active) return view;
    await delay(5);
  }
  throw new Error('rebuild did not settle');
}

async function begin(turns = 12) {
  const f = fixture();
  const turnService = new TurnService(store, f.generator);
  const rebuild = new MemoryRebuildService(store, f.generator);
  const c = newCampaign({ name: 'Synthetic rebuild' });
  await store.insert(c);
  for (let i = 0; i < turns; i++) await play(store, turnService, c.id, `Act ${i}`);
  // A small soft target forces several sequential batches; one pair per batch is the floor.
  await store.edit(c.id, 0, (campaign) => {
    campaign.budgets = { compaction: 1500 };
  });
  return { ...f, turnService, rebuild, campaignId: c.id };
}

test(
  'rebuild stages a draft from original turns without old-memory seeding and applies only on request',
  { skip: !enabled },
  async () => {
    const f = await begin();
    const before = await store.campaign(f.campaignId);
    assert.ok(before.memory, 'fixture needs an existing automatic memory');
    const requestId = randomUUID();
    const started = await f.rebuild.start(f.campaignId, requestId);
    assert.equal((await f.rebuild.start(f.campaignId, requestId)).id, started.id);
    const ready = await settle(f.rebuild, f.campaignId, started.id);
    assert.equal(ready.status, MemoryRebuildStatus.Ready, ready.safeError ?? '');
    assert.ok(f.rebuildCalls.length >= 2, 'several sequential batches');
    assert.equal(f.rebuildCalls[0]!.earlierSummary, '');
    assert.doesNotMatch(JSON.stringify(f.rebuildCalls), /automatic:/);
    assert.deepEqual(ready.baseline?.id, before.memory!.id);
    assert.ok(ready.candidate!.text.startsWith('- rebuilt: Act 0'));
    for (let i = 0; i < 12; i++) assert.ok(ready.candidate!.text.includes(`Act ${i}`));
    assert.deepEqual(ready.allowedActions, [
      MemoryRebuildAction.Apply,
      MemoryRebuildAction.Discard,
    ]);
    // Draft is invisible to the active memory until Apply.
    assert.equal((await store.campaign(f.campaignId)).memory!.id, before.memory!.id);
    const applyId = randomUUID();
    const applied = await f.rebuild.apply(
      f.campaignId,
      started.id,
      applyId,
      ready.candidate!.proposalDigest
    );
    const active = await store.activeTurns(f.campaignId);
    assert.equal(applied.campaign.memory!.text, ready.candidate!.text);
    assert.deepEqual(
      applied.campaign.memory!.coveredTurnIds,
      active.map((t) => t.id)
    );
    assert.equal(applied.job.status, MemoryRebuildStatus.Applied);
    const checkpoints = await store.pool.query(
      'SELECT count(*)::int AS n FROM memories WHERE campaign_id=$1',
      [f.campaignId]
    );
    assert.ok(checkpoints.rows[0].n >= 2, 'old checkpoints are retained');
    // Replay after a lost response returns the same result without a second checkpoint.
    const replay = await f.rebuild.apply(
      f.campaignId,
      started.id,
      applyId,
      ready.candidate!.proposalDigest
    );
    assert.equal(replay.job.decision?.memoryId, applied.job.decision?.memoryId);
    const after = await store.pool.query(
      'SELECT count(*)::int AS n FROM memories WHERE campaign_id=$1',
      [f.campaignId]
    );
    assert.equal(after.rows[0].n, checkpoints.rows[0].n);
    await assert.rejects(
      f.rebuild.apply(f.campaignId, started.id, randomUUID(), ready.candidate!.proposalDigest),
      /final decision/
    );
  }
);

test(
  'a failed rebuild keeps its committed batches and a retry resumes without repeating them',
  { skip: !enabled },
  async () => {
    const f = await begin();
    f.control.failAt = 2;
    const started = await f.rebuild.start(f.campaignId, randomUUID());
    const failed = await settle(f.rebuild, f.campaignId, started.id);
    assert.equal(failed.status, MemoryRebuildStatus.Failed);
    assert.equal(failed.candidate, null);
    assert.ok(failed.processedTurns >= 1 && failed.processedTurns < failed.totalTurns);
    const callsBefore = f.rebuildCalls.length;
    const resumeId = randomUUID();
    const resumed = await f.rebuild.resume(f.campaignId, started.id, resumeId);
    assert.ok(resumed.active || resumed.status === MemoryRebuildStatus.Ready);
    const ready = await settle(f.rebuild, f.campaignId, started.id);
    assert.equal(ready.status, MemoryRebuildStatus.Ready, ready.safeError ?? '');
    // The batch accepted before the failure is not asked for again.
    const seen = f.rebuildCalls.slice(callsBefore).flatMap((c) => c.turns.map((t) => t.player));
    assert.ok(!seen.includes('Act 0'));
    assert.ok(f.rebuildCalls.at(-1)!.earlierSummary.startsWith('- rebuilt: Act 0'));
    // Repeating the same resume request never launches another attempt.
    const callsAfter = f.rebuildCalls.length;
    await f.rebuild.resume(f.campaignId, started.id, resumeId);
    await delay(30);
    assert.equal(f.rebuildCalls.length, callsAfter);
  }
);

test(
  'cancelling stops the rebuild without touching memory; a cancelled job cannot resume',
  { skip: !enabled },
  async () => {
    const f = await begin();
    const memoryBefore = (await store.campaign(f.campaignId)).memory;
    f.control.holdAt = 1;
    const started = await f.rebuild.start(f.campaignId, randomUUID());
    for (let i = 0; i < 400 && !f.control.release; i++) await delay(5);
    assert.ok(f.control.release, 'second batch is in flight');
    const cancelled = await f.rebuild.cancel(f.campaignId, started.id);
    assert.equal(cancelled.status, MemoryRebuildStatus.Cancelled);
    await delay(30);
    assert.equal((await f.rebuild.status(f.campaignId, started.id)).status, 'cancelled');
    assert.deepEqual((await store.campaign(f.campaignId)).memory, memoryBefore);
    await assert.rejects(f.rebuild.resume(f.campaignId, started.id, randomUUID()), /cancelled/);
  }
);

test(
  'an active rebuild excludes play and a draft goes stale when the story changes',
  { skip: !enabled },
  async () => {
    const f = await begin();
    f.control.holdAt = 1;
    const started = await f.rebuild.start(f.campaignId, randomUUID());
    for (let i = 0; i < 400 && !f.control.release; i++) await delay(5);
    await assert.rejects(
      f.turnService.submit(f.campaignId, {
        revision: (await store.campaign(f.campaignId)).revision,
        requestId: randomUUID(),
        action: 'blocked',
      }),
      /rebuild/
    );
    await assert.rejects(f.rebuild.start(f.campaignId, randomUUID()), /already running|rebuild/);
    f.control.release!();
    const ready = await settle(f.rebuild, f.campaignId, started.id);
    assert.equal(ready.status, MemoryRebuildStatus.Ready);
    // A ready draft no longer blocks play; the new turn makes the draft stale.
    await play(store, f.turnService, f.campaignId, 'Act later');
    await assert.rejects(
      f.rebuild.apply(f.campaignId, started.id, randomUUID(), ready.candidate!.proposalDigest),
      (e: unknown) => e instanceof Problem && e.code === 'memory_stale'
    );
  }
);

test(
  'recovery marks an expired active rebuild interrupted and keeps it resumable',
  { skip: !enabled },
  async () => {
    const f = await begin();
    f.control.holdAt = 1;
    const started = await f.rebuild.start(f.campaignId, randomUUID());
    for (let i = 0; i < 400 && !f.control.release; i++) await delay(5);
    await store.pool.query(
      "UPDATE memory_rebuild_jobs SET lease_until=now() - interval '1 second' WHERE id=$1",
      [started.id]
    );
    await store.recover();
    const view = await f.rebuild.status(f.campaignId, started.id);
    assert.equal(view.status, MemoryRebuildStatus.Interrupted);
    assert.equal(view.errorCode, 'memory_interrupted');
    // The old attempt finishing late cannot overwrite the recovered job.
    f.control.release!();
    await delay(50);
    assert.equal((await f.rebuild.status(f.campaignId, started.id)).status, 'interrupted');
    const resumed = await f.rebuild.resume(f.campaignId, started.id, randomUUID());
    assert.ok(resumed.active || resumed.status === MemoryRebuildStatus.Ready);
    const ready = await settle(f.rebuild, f.campaignId, started.id);
    assert.equal(ready.status, MemoryRebuildStatus.Ready, ready.safeError ?? '');
  }
);

test('discard leaves memory untouched and is terminal', { skip: !enabled }, async () => {
  const f = await begin(3);
  const memoryBefore = (await store.campaign(f.campaignId)).memory;
  const started = await f.rebuild.start(f.campaignId, randomUUID());
  const ready = await settle(f.rebuild, f.campaignId, started.id);
  assert.equal(ready.status, MemoryRebuildStatus.Ready);
  const discarded = await f.rebuild.discard(f.campaignId, started.id, randomUUID());
  assert.equal(discarded.job.status, MemoryRebuildStatus.Discarded);
  assert.equal(discarded.job.candidate, null);
  assert.deepEqual((await store.campaign(f.campaignId)).memory, memoryBefore);
  const page = await f.rebuild.list(f.campaignId, 20, 0);
  assert.equal(page.jobs.length, 1);
  assert.equal(page.current, null);
});

test('start with no completed turns is rejected explicitly', { skip: !enabled }, async () => {
  const f = fixture();
  const rebuild = new MemoryRebuildService(store, f.generator);
  const c = newCampaign({ name: 'Empty rebuild' });
  await store.insert(c);
  await assert.rejects(
    rebuild.start(c.id, randomUUID()),
    (e: unknown) => e instanceof Problem && e.status === 422 && e.code === 'memory_invalid'
  );
});

test(
  'rebuild gives the model only a bounded background while the stored draft keeps every batch',
  { skip: !enabled },
  async () => {
    const { seedCampaign, fakeGenerator } = await import('./journalFixture.js');
    const { campaign } = await seedCampaign(
      store,
      Array.from({ length: 12 }, (_, i) => ({ action: `act ${i}`, narrative: `${SCENE} ${i}` }))
    );
    await store.edit(campaign.id, 0, (c) => {
      c.budgets = { compaction: 1500 };
    });
    let batch = 0;
    const fake = fakeGenerator(() => ({ text: `- Batch ${batch++}: ${'detail '.repeat(120)}` }));
    const service = new MemoryRebuildService(store, fake);
    const started = await service.start(campaign.id, randomUUID());
    const ready = await settle(service, campaign.id, started.id);
    assert.equal(ready.status, MemoryRebuildStatus.Ready, ready.safeError ?? '');
    const last = fake.calls.at(-1) as { earlierSummary: string };
    const full = ready.candidate!.text;
    assert.ok(Buffer.byteLength(full) > 8000, 'the stored draft keeps every batch');
    for (let i = 0; i < fake.calls.length; i++) assert.ok(full.includes(`- Batch ${i}:`));
    assert.ok(Buffer.byteLength(last.earlierSummary) < Buffer.byteLength(full) / 2);
    assert.ok(last.earlierSummary.includes(`- Batch ${fake.calls.length - 2}:`));
    assert.ok(!last.earlierSummary.includes('- Batch 0:'));
  }
);
