import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Store } from '../src/store.js';
import { LibraryService } from '../src/services/library.js';
import { MemoryRebuildService } from '../src/services/memoryRebuild.js';
import { TurnService } from '../src/services/turns.js';
import { MemoryRebuildStatus } from '../src/domain/memoryRebuild.js';
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
  isolated = await openIsolatedStore('memory_compat');
  store = isolated.store;
});
after(async () => {
  if (dbEnabled) await isolated.close();
});

const generator = fakeGenerator(() => ({ text: '- Rebuilt: the gate and the key.' }));

async function rebuiltCampaign() {
  const { campaign, turns } = await seedCampaign(
    store,
    ['one', 'two', 'three', 'four'].map((word) => ({ action: word, narrative: `Scene ${word}.` }))
  );
  const turnService = new TurnService(store, generator as never);
  // An earlier reviewed checkpoint stays available after the rebuild replaces the active memory.
  const manual = await turnService.manualMemory(campaign.id, {
    revision: 0,
    text: 'Reviewed early summary.',
    coveredTurnIds: turns.slice(0, 2).map((t) => t.id),
    confirm: true,
  });
  const rebuild = new MemoryRebuildService(store, generator as never);
  const started = await rebuild.start(campaign.id, randomUUID());
  let view = started;
  for (let i = 0; i < 400 && view.active; i++) {
    await sleep(15);
    view = await rebuild.status(campaign.id, started.id);
  }
  assert.equal(view.status, MemoryRebuildStatus.Ready);
  const applied = await rebuild.apply(
    campaign.id,
    started.id,
    randomUUID(),
    view.candidate!.proposalDigest
  );
  return { campaign, turns, turnService, manual, applied, rebuild };
}

test(
  'rebuilt memory archives round-trip without serializing operational jobs',
  { skip: !dbEnabled },
  async () => {
    const { campaign, applied } = await rebuiltCampaign();
    const library = new LibraryService(store);
    const archive = JSON.parse(JSON.stringify(await library.export(campaign.id)));
    assert.doesNotMatch(JSON.stringify(archive), /memory_rebuild|frozen_input|proposalDigest/);
    assert.equal(archive.campaign.memory.id, applied.campaign.memory!.id);
    assert.ok(archive.memories.length >= 2);
    const imported = await library.import(archive);
    assert.equal(imported.memory?.text, applied.campaign.memory!.text);
    assert.equal(imported.memory?.coveredTurnIds.length, 4);
  }
);

test(
  'undo after a rebuild retires the covering checkpoint and restores the retained one',
  { skip: !dbEnabled },
  async () => {
    const { campaign, turnService, manual, applied } = await rebuiltCampaign();
    assert.equal(applied.campaign.memory!.coveredTurnIds.length, 4);
    const restored = await turnService.undo(campaign.id, applied.campaign.revision);
    const saved = await store.pool.query('SELECT document FROM memories WHERE id=$1', [
      applied.campaign.memory!.id,
    ]);
    assert.equal(saved.rows[0].document.valid, false);
    assert.equal(restored.memory?.id, manual.memory!.id);
    assert.equal(restored.memory?.text, 'Reviewed early summary.');
  }
);
