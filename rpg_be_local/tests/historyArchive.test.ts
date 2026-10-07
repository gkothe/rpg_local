import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Store } from '../src/store.js';
import { LibraryService } from '../src/services/library.js';
import { HistoryReader, HistoryStore } from '../src/services/historyStore.js';
import { TurnService } from '../src/services/turns.js';
import {
  HistoryFragmentKind,
  correctionDigestOf,
  type FrozenHistory,
} from '../src/domain/historyRecall.js';
import { HISTORY_INSTRUCTION_ID, derivationDigest } from '../src/domain/historyGeneration.js';
import type { Archive } from '../src/domain/types.js';
import type { Generator } from '../src/providers/service.js';
import { dbEnabled, openIsolatedStore, seedCampaign, sleep } from './journalFixture.js';

let isolated: Awaited<ReturnType<typeof openIsolatedStore>>;
let store: Store;
before(async () => {
  if (!dbEnabled) return;
  isolated = await openIsolatedStore('history_archive');
  store = isolated.store;
});
after(async () => {
  if (dbEnabled) await isolated.close();
});

const generator: Generator = {
  capacity: async () => 16000,
  gameplayCapacity: async () => 16000,
  generate: async () => ({ narrative: 'Quiet.' }),
  generateOwnedGameplay: async (_s, _p, _sc, _sys, tools) => {
    const found = (await tools('campaign_history_search', { query: 'embrace' }, 's1')) as {
      items: { id: string }[];
    };
    await tools('campaign_history_get', { id: found.items[0]!.id, includeOriginals: true }, 'g1');
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

/** A campaign with an active index, a pin, and one finished attempt that froze history. */
async function indexedArchive(): Promise<{ archive: Archive; campaignId: string }> {
  const { campaign, turns } = await seedCampaign(
    store,
    ['arena', 'cellar', 'inn', 'road'].map((w) => ({
      action: w,
      narrative: `The ${w} scene: an Embrace was mentioned.`,
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
  const [section] = await store.transaction((client) =>
    history.publish(client, campaign.id, [
      {
        kind: HistoryFragmentKind.Section,
        title: 'Arena',
        text: 'The arena fight and the Embrace.',
        sources: [locator(0), locator(1)],
        parentIds: [],
        derivationDigest: derivationDigest(
          HistoryFragmentKind.Section,
          [locator(0), locator(1)],
          []
        ),
        correctionDigest: correctionDigestOf([]),
        links: [],
      },
    ])
  );
  const [overview] = await store.transaction((client) =>
    history.publish(client, campaign.id, [
      {
        kind: HistoryFragmentKind.Overview,
        title: 'Story so far',
        text: 'A short overview.',
        sources: [locator(0), locator(1)],
        parentIds: [section!.id],
        derivationDigest: derivationDigest(
          HistoryFragmentKind.Overview,
          [locator(0), locator(1)],
          []
        ),
        correctionDigest: correctionDigestOf([]),
        links: [],
      },
    ])
  );
  await store.edit(campaign.id, 0, (c) => {
    c.historyRecall = {
      enabled: true,
      activeOverviewId: overview!.id,
      protectedKnowledgeIds: [],
      protectedSectionIds: [section!.id],
      protectedMemoryIds: [],
    };
  });
  const service = new TurnService(store, generator);
  const turn = await service.submit(campaign.id, {
    revision: (await store.campaign(campaign.id)).revision,
    requestId: randomUUID(),
    action: 'wait',
  });
  for (let i = 0; i < 400; i++) {
    const saved = await store.turn(campaign.id, turn.id);
    if (saved.status !== 'pending' && saved.status !== 'running') {
      assert.equal(saved.status, 'completed', saved.error ?? '');
      break;
    }
    await sleep(10);
  }
  const archive = JSON.parse(JSON.stringify(await new LibraryService(store).export(campaign.id)));
  return { archive, campaignId: campaign.id };
}

test(
  'history versions, fragments, pins and frozen sessions survive export and import',
  { skip: !dbEnabled },
  async () => {
    const { archive } = await indexedArchive();
    assert.equal(archive.historyTurnVersions!.length, 4);
    assert.equal(archive.historyFragments!.length, 2);
    assert.equal(archive.diceSessions.at(-1)!.frozenHistory!.mode, 'compact');
    const library = new LibraryService(store);
    const imported = await library.import(JSON.parse(JSON.stringify(archive)));
    const settings = imported.historyRecall!;
    assert.equal(settings.enabled, true);
    const history = new HistoryStore(store);
    const fragments = await history.list(imported.id, undefined, true);
    assert.equal(fragments.length, 2);
    assert.ok(fragments.every((f) => f.campaignId === imported.id));
    assert.ok(fragments.some((f) => f.id === settings.activeOverviewId));
    assert.deepEqual(settings.protectedSectionIds, [
      fragments.find((f) => f.kind === 'section')!.id,
    ]);
    // IDs and hashes were rewritten consistently, so a second round trip validates again.
    const again = JSON.parse(JSON.stringify(await library.export(imported.id))) as Archive;
    assert.equal(again.historyFragments?.length, 2);
    assert.notEqual(again.historyFragments![0]!.id, archive.historyFragments![0]!.id);
    const second = await library.import(again);
    assert.equal((await history.list(second.id)).length, 2);
    // Exact original reads work against the imported frozen session.
    const row = await store.pool.query(
      'SELECT frozen_history FROM dice_sessions WHERE campaign_id=$1 AND frozen_history IS NOT NULL',
      [imported.id]
    );
    assert.equal(row.rows.length, 1);
    const frozen = row.rows[0].frozen_history as FrozenHistory;
    assert.equal(frozen.campaignId, imported.id);
    const reader = new HistoryReader(store, frozen);
    const found = (await reader.search({ query: 'embrace' })) as { items: { id: string }[] };
    const detail = (await reader.get({ id: found.items[0]!.id, includeOriginals: true })) as {
      originals: { gm: string }[];
    };
    assert.match(detail.originals[0]!.gm, /The arena scene/);
    // Source turns of the imported versions are the imported turns, not the originals.
    const turns = new Set((await store.turns(imported.id)).map((t) => t.id));
    assert.ok(frozen.turnVersions.every((v) => turns.has(v.turnId)));
  }
);

test(
  'altered, missing or foreign history is rejected before anything is imported',
  { skip: !dbEnabled },
  async () => {
    const { archive } = await indexedArchive();
    const library = new LibraryService(store);
    const clone = () => JSON.parse(JSON.stringify(archive)) as Archive;
    const reject = async (mutate: (a: Archive) => void) => {
      const a = clone();
      mutate(a);
      await assert.rejects(
        library.import(a),
        (e: unknown) => (e as { code?: string }).code === 'archive_invalid'
      );
    };
    await reject((a) => {
      a.historyFragments![0]!.text = 'Tampered text.';
    });
    await reject((a) => {
      a.historyTurnVersions![0]!.document.gm = 'Tampered original.';
    });
    await reject((a) => {
      a.historyTurnVersions!.pop();
    });
    await reject((a) => {
      a.diceSessions.at(-1)!.frozenHistory!.campaignId = randomUUID();
    });
    await reject((a) => {
      a.campaign.historyRecall!.protectedSectionIds = [randomUUID()];
    });
    // An archive from before selective history imports with it disabled.
    const legacy = clone();
    delete legacy.historyFragments;
    delete legacy.historyTurnVersions;
    delete legacy.campaign.historyRecall;
    for (const s of legacy.diceSessions) delete s.frozenHistory;
    const imported = await library.import(legacy);
    assert.equal(imported.historyRecall, undefined);
    void HISTORY_INSTRUCTION_ID;
  }
);
