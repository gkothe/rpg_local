import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Store } from '../src/store.js';
import { HistoryReader, HistoryStore } from '../src/services/historyStore.js';
import { TurnService } from '../src/services/turns.js';
import {
  HistoryFragmentKind,
  correctionDigestOf,
  type FrozenHistory,
  type HistoryFragmentPayload,
} from '../src/domain/historyRecall.js';
import type { Generator } from '../src/providers/service.js';
import { Problem } from '../src/errors.js';
import { dbEnabled, openIsolatedStore, seedCampaign, sleep } from './journalFixture.js';

let isolated: Awaited<ReturnType<typeof openIsolatedStore>>;
let store: Store;
before(async () => {
  if (!dbEnabled) return;
  isolated = await openIsolatedStore('history_store');
  store = isolated.store;
});
after(async () => {
  if (dbEnabled) await isolated.close();
});

const hex = (n: number) => n.toString(16).padStart(64, '0');
async function seeded() {
  const { campaign, turns } = await seedCampaign(store, [
    { action: 'enter the arena', narrative: 'The arena crowd roars as the Embrace takes hold.' },
    { action: 'flee the cellar', narrative: 'You escape through the cellar window.' },
    { action: 'rest', narrative: 'You rest at the inn.' },
  ]);
  const history = new HistoryStore(store);
  const versions = await store.transaction((client) =>
    history.captureVersions(client, campaign.id, turns)
  );
  return { campaign, turns, history, versions };
}
const payload = (
  over: Partial<HistoryFragmentPayload> & Pick<HistoryFragmentPayload, 'sources'>
): HistoryFragmentPayload => ({
  kind: HistoryFragmentKind.Section,
  title: 'The arena',
  text: 'A fight in the arena ended with the Embrace.',
  parentIds: [],
  derivationDigest: hex(1),
  correctionDigest: correctionDigestOf([]),
  links: [],
  ...over,
});

test(
  'source versions are idempotent, immutable and verified by hash on read',
  { skip: !dbEnabled },
  async () => {
    const { campaign, history, versions } = await seeded();
    await store.transaction((client) => history.captureVersions(client, campaign.id, []));
    const count = async () =>
      (
        await store.pool.query(
          'SELECT count(*)::int n FROM history_turn_versions WHERE campaign_id=$1',
          [campaign.id]
        )
      ).rows[0].n;
    assert.equal(await count(), 3);
    const again = await store.transaction(async (client) =>
      history.captureVersions(client, campaign.id, await store.activeTurns(campaign.id, client))
    );
    assert.deepEqual(
      again.map((v) => v.contentHash),
      versions.map((v) => v.contentHash)
    );
    assert.equal(await count(), 3);
    await assert.rejects(
      store.pool.query(
        'UPDATE history_turn_versions SET document=document || \'{"gm":"x"}\'::jsonb WHERE campaign_id=$1',
        [campaign.id]
      ),
      /immutable/
    );
    const locators = versions.map(({ turnId, contentHash }) => ({ turnId, contentHash }));
    const docs = await history.versionDocuments(campaign.id, locators);
    assert.equal(docs.size, 3);
    // A missing version is an explicit error, never substituted live text.
    await assert.rejects(
      history.versionDocuments(campaign.id, [{ turnId: randomUUID(), contentHash: hex(9) }]),
      /missing/
    );
  }
);

test(
  'published fragments keep an immutable payload; only selection status changes',
  { skip: !dbEnabled },
  async () => {
    const { campaign, history, versions } = await seeded();
    const sources = versions
      .slice(0, 2)
      .map(({ turnId, contentHash }) => ({ turnId, contentHash }));
    const [section] = await store.transaction((client) =>
      history.publish(client, campaign.id, [payload({ sources })])
    );
    await assert.rejects(
      store.pool.query("UPDATE history_fragments SET body='changed' WHERE id=$1", [section!.id]),
      /immutable/
    );
    await assert.rejects(
      store.pool.query('DELETE FROM history_fragments WHERE id=$1', [section!.id]),
      /retained/
    );
    await store.pool.query("UPDATE history_fragments SET selection_status='stale' WHERE id=$1", [
      section!.id,
    ]);
    assert.equal((await history.list(campaign.id, undefined, true)).length, 0);
    assert.equal((await history.list(campaign.id)).length, 1);
  }
);

test(
  'invalidating a turn retires its fragments and everything derived from them',
  { skip: !dbEnabled },
  async () => {
    const { campaign, history, versions } = await seeded();
    const all = versions.map(({ turnId, contentHash }) => ({ turnId, contentHash }));
    const [a, b] = await store.transaction((client) =>
      history.publish(client, campaign.id, [
        payload({ sources: [all[0]!], title: 'Arena' }),
        payload({ sources: [all[2]!], title: 'Inn' }),
      ])
    );
    const [chapter] = await store.transaction((client) =>
      history.publish(client, campaign.id, [
        payload({
          kind: HistoryFragmentKind.Chapter,
          sources: all,
          parentIds: [a!.id, b!.id],
          title: 'Chapter',
        }),
      ])
    );
    await store.transaction((client) =>
      history.invalidateTurns(client, campaign.id, [all[0]!.turnId])
    );
    const status = new Map((await history.list(campaign.id)).map((f) => [f.id, f.selection]));
    assert.equal(status.get(a!.id), 'stale');
    assert.equal(status.get(chapter!.id), 'stale');
    assert.equal(status.get(b!.id), 'valid');
  }
);

test(
  'the frozen reader returns exact originals and detects a changed fragment',
  { skip: !dbEnabled },
  async () => {
    const { campaign, history, versions } = await seeded();
    const sources = versions
      .slice(0, 2)
      .map(({ turnId, contentHash }) => ({ turnId, contentHash }));
    const [section] = await store.transaction((client) =>
      history.publish(client, campaign.id, [payload({ sources })])
    );
    const frozen: FrozenHistory = {
      campaignId: campaign.id,
      mode: 'compact',
      turnVersions: versions.map(({ turnId, contentHash }) => ({ turnId, contentHash })),
      fragments: [{ id: section!.id, contentDigest: section!.contentDigest }],
      correctionGuidance: [],
      protectedLocators: [],
      selectionDiagnostics: {
        targetBytes: 0,
        suppliedBytes: 0,
        mandatoryBytes: 0,
        overflowBytes: 0,
        included: [],
        omitted: { count: 0, reasonCounts: {} },
      },
    };
    const reader = new HistoryReader(store, frozen);
    const found = await reader.search({ query: 'embrace' });
    assert.equal((found.items as unknown[]).length, 1);
    const detail = (await reader.get({ id: section!.id, includeOriginals: true })) as {
      originals: { player: string; gm: string }[];
      correctionGuidance: { sourceSuperseded: boolean };
    };
    assert.deepEqual(
      detail.originals.map((o) => o.gm),
      ['The arena crowd roars as the Embrace takes hold.', 'You escape through the cellar window.']
    );
    assert.equal(detail.correctionGuidance.sourceSuperseded, false);
    await assert.rejects(
      new HistoryReader(store, {
        ...frozen,
        fragments: [{ id: section!.id, contentDigest: hex(7) }],
      }).search({ query: '' }),
      /missing or changed/
    );
    await assert.rejects(reader.get({ id: randomUUID() }), /not in this frozen campaign/);
  }
);

test(
  'a selective turn uses history tools, freezes metadata and survives a storage round trip',
  { skip: !dbEnabled },
  async () => {
    const { campaign, turns, history, versions } = await seeded();
    const sources = versions
      .slice(0, 1)
      .map(({ turnId, contentHash }) => ({ turnId, contentHash }));
    const [section] = await store.transaction((client) =>
      history.publish(client, campaign.id, [payload({ sources })])
    );
    await store.edit(campaign.id, 0, (c) => {
      c.memory = {
        id: randomUUID(),
        text: 'FULL ARCHIVAL MEMORY',
        coveredTurnIds: [turns[0]!.id],
        valid: true,
        createdAt: new Date().toISOString(),
      };
      c.historyRecall = {
        enabled: true,
        activeOverviewId: null,
        protectedKnowledgeIds: [],
        protectedSectionIds: [],
        protectedMemoryIds: [],
      };
    });
    let prompt = '';
    let toolNames: string[] = [];
    const generator: Generator = {
      capacity: async () => 16000,
      gameplayCapacity: async () => 16000,
      generate: async () => ({ narrative: 'You stand in the square.' }),
      generateOwnedGameplay: async (_settings, userPrompt, _schema, _system, tools) => {
        prompt = userPrompt;
        toolNames = (tools.definitions ?? []).map((d) => d.name);
        const detail = (await tools(
          'campaign_history_get',
          { id: section!.id, includeOriginals: true },
          'h1'
        )) as { originals: { gm: string }[] };
        assert.match(detail.originals[0]!.gm, /Embrace/);
        return {
          combatEffects: [],
          participantReferences: [],
          narrative: 'You stand in the square.',
          operations: [],
          rollInterpretations: [],
          ruleCitations: [],
          knowledgeChanges: [],
          operationExplanations: [],
        };
      },
    };
    const service = new TurnService(store, generator);
    const turn = await service.submit(campaign.id, {
      revision: (await store.campaign(campaign.id)).revision,
      requestId: randomUUID(),
      action: 'look around',
    });
    for (let i = 0; i < 400; i++) {
      const saved = await store.turn(campaign.id, turn.id);
      if (saved.status !== 'pending' && saved.status !== 'running') {
        assert.equal(saved.status, 'completed', saved.error ?? '');
        break;
      }
      await sleep(10);
    }
    assert.doesNotMatch(prompt, /FULL ARCHIVAL MEMORY/);
    assert.ok(
      toolNames.includes('campaign_history_search') && toolNames.includes('campaign_history_get')
    );
    const session = await store.pool.query(
      'SELECT frozen_history FROM dice_sessions WHERE campaign_id=$1 AND root_turn_id=$2',
      [campaign.id, turn.id]
    );
    const frozen = session.rows[0].frozen_history as FrozenHistory;
    assert.equal(frozen.fragments[0]!.id, section!.id);
    assert.equal(frozen.turnVersions.length, 3);
    await assert.rejects(
      store.pool.query("UPDATE dice_sessions SET frozen_history='{}' WHERE root_turn_id=$1", [
        turn.id,
      ]),
      /immutable/
    );
    // The saved turn context keeps the metadata through storage round-trips.
    const context = await store.turnContext(campaign.id, turn.id);
    assert.equal(context?.frozenHistory?.fragments[0]!.id, section!.id);
  }
);

test(
  'a legacy attempt without frozen history keeps the original tool registry',
  { skip: !dbEnabled },
  async () => {
    const { campaign } = await seeded();
    let names: string[] = [];
    const generator: Generator = {
      capacity: async () => 16000,
      gameplayCapacity: async () => 16000,
      generate: async () => ({ narrative: 'Quiet.' }),
      generateOwnedGameplay: async (_s, _p, _sc, _sys, tools) => {
        names = (tools.definitions ?? []).map((d) => d.name);
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
    const service = new TurnService(store, generator);
    const turn = await service.submit(campaign.id, {
      revision: (await store.campaign(campaign.id)).revision,
      requestId: randomUUID(),
      action: 'wait',
    });
    for (let i = 0; i < 400; i++) {
      const saved = await store.turn(campaign.id, turn.id);
      if (saved.status !== 'pending' && saved.status !== 'running') break;
      await sleep(10);
    }
    assert.ok(names.length > 0);
    assert.ok(!names.some((n) => n.startsWith('campaign_history_')));
    const row = await store.pool.query(
      'SELECT frozen_history FROM dice_sessions WHERE root_turn_id=$1',
      [turn.id]
    );
    assert.equal(row.rows[0].frozen_history, null);
  }
);

test(
  'a retry reuses the frozen history session and the same history tools',
  { skip: !dbEnabled },
  async () => {
    const { campaign, history, versions } = await seeded();
    const sources = versions
      .slice(0, 1)
      .map(({ turnId, contentHash }) => ({ turnId, contentHash }));
    const [section] = await store.transaction((client) =>
      history.publish(client, campaign.id, [payload({ sources })])
    );
    await store.edit(campaign.id, 0, (c) => {
      c.historyRecall = {
        enabled: true,
        activeOverviewId: null,
        protectedKnowledgeIds: [],
        protectedSectionIds: [],
        protectedMemoryIds: [],
      };
    });
    let attempt = 0;
    const seen: string[][] = [];
    const generator: Generator = {
      capacity: async () => 16000,
      gameplayCapacity: async () => 16000,
      generate: async () => ({ narrative: 'Quiet.' }),
      generateOwnedGameplay: async (_s, _p, _sc, _sys, tools) => {
        seen.push((tools.definitions ?? []).map((d) => d.name));
        attempt++;
        await tools('campaign_history_get', { id: section!.id }, `h${attempt}`);
        if (attempt === 1) throw new Problem(429, 'provider_quota', 'Synthetic quota');
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
    const service = new TurnService(store, generator);
    const settle = async (id: string) => {
      for (let i = 0; i < 400; i++) {
        const saved = await store.turn(campaign.id, id);
        if (saved.status !== 'pending' && saved.status !== 'running') return saved;
        await sleep(10);
      }
      throw new Error('turn did not settle');
    };
    const first = await service.submit(campaign.id, {
      revision: (await store.campaign(campaign.id)).revision,
      requestId: randomUUID(),
      action: 'look',
    });
    assert.notEqual((await settle(first.id)).status, 'completed');
    const retried = await service.retry(campaign.id, first.id, {
      revision: (await store.campaign(campaign.id)).revision,
      requestId: randomUUID(),
    });
    assert.equal((await settle(retried.id)).status, 'completed');
    assert.deepEqual(seen[1], seen[0]);
    assert.ok(seen[0]!.includes('campaign_history_get'));
    const sessions = await store.pool.query(
      'SELECT count(*)::int n FROM dice_sessions WHERE campaign_id=$1',
      [campaign.id]
    );
    assert.equal(sessions.rows[0].n, 1, 'the retry did not create a second session');
  }
);
