import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { Store } from '../src/store.js';
import { createApp } from '../src/app.js';
import type { ProviderService } from '../src/providers/service.js';
import { HistoryStore } from '../src/services/historyStore.js';
import {
  HistoryFragmentKind,
  correctionDigestOf,
  type HistoryFragmentPayload,
} from '../src/domain/historyRecall.js';
import { KnowledgeVisibility as V } from '../src/domain/knowledge.js';
import {
  dbEnabled,
  fakeGenerator,
  knowledgeRecord,
  openIsolatedStore,
  seedCampaign,
} from './journalFixture.js';

let isolated: Awaited<ReturnType<typeof openIsolatedStore>>;
let store: Store;
before(async () => {
  if (!dbEnabled) return;
  isolated = await openIsolatedStore('history_api');
  store = isolated.store;
});
after(async () => {
  if (dbEnabled) await isolated.close();
});

const app = () =>
  createApp({ store, providers: fakeGenerator(() => ({})) as unknown as ProviderService }).app;
const call = (method: 'get' | 'patch', url: string, client = true) => {
  const r = request(app())[method](url).set('Host', 'localhost:4100');
  return method === 'patch' && client ? r.set('X-RPG-Client', 'local-rpg') : r;
};
const hex = (n: number) => n.toString(16).padStart(64, '0');

async function fixture() {
  const secret = knowledgeRecord('Secret', 'SECRET TEXT', { visibility: V.GmOnly });
  const open = knowledgeRecord('Marta', 'Marta runs the harbor.');
  const { campaign, turns } = await seedCampaign(
    store,
    ['one', 'two', 'three', 'four'].map((w) => ({
      action: w,
      narrative: `The ${w} scene at the harbor.`,
    })),
    [open, secret]
  );
  const history = new HistoryStore(store);
  const versions = await store.transaction((client) =>
    history.captureVersions(client, campaign.id, turns)
  );
  const payload = (title: string, i: number): HistoryFragmentPayload => ({
    kind: HistoryFragmentKind.Section,
    title,
    text: `${title} happened at the harbor.`,
    sources: [{ turnId: versions[i]!.turnId, contentHash: versions[i]!.contentHash }],
    parentIds: [],
    derivationDigest: hex(1),
    correctionDigest: correctionDigestOf([]),
    links: [],
  });
  const [a, b] = await store.transaction((client) =>
    history.publish(client, campaign.id, [payload('Harbor fight', 0), payload('Inn night', 1)])
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
  return { campaign, a: a!, b: b!, open, secret, base: `/api/campaigns/${campaign.id}/history` };
}

test(
  'history browsing exposes public items, originals and backend-owned options',
  { skip: !dbEnabled },
  async () => {
    const { a, base } = await fixture();
    const settings = await call('get', '/api/settings').expect(200);
    assert.deepEqual(
      settings.body.data.history.kindOptions.map((o: { id: string }) => o.id),
      ['section', 'chapter', 'overview']
    );
    const list = await call('get', `${base}?query=fight`).expect(200);
    assert.equal(list.body.data.items.length, 1);
    assert.deepEqual(Object.keys(list.body.data.items[0]).sort(), [
      'available',
      'endAt',
      'excerpt',
      'id',
      'kind',
      'protected',
      'sourceTurnIds',
      'startAt',
      'title',
    ]);
    assert.equal(list.body.data.status.enabled, true);
    assert.equal(list.body.data.status.totalTurns, 4);
    await call('get', `${base}?limit=0`).expect(422);
    const detail = await call('get', `${base}/${a.id}?originals=true`).expect(200);
    assert.equal(detail.body.data.originals[0].gm, 'The one scene at the harbor.');
    assert.equal(detail.body.data.item.text, 'Harbor fight happened at the harbor.');
    await call('get', `${base}/${randomUUID()}`).expect(404);
  }
);

test(
  'pins are idempotent, reversible, expected-flag checked and public only',
  { skip: !dbEnabled },
  async () => {
    const { campaign, a, open, secret, base } = await fixture();
    const requestId = randomUUID();
    const pin = (id: string, body: Record<string, unknown>, route = 'knowledge') =>
      call('patch', `${base}/protection/${route}/${id}`).send(body);
    await call('patch', `${base}/protection/knowledge/${open.id}`, false)
      .send({ requestId, expected: false, protected: true })
      .expect(403);
    const first = await pin(open.id, { requestId, expected: false, protected: true }).expect(200);
    assert.deepEqual(first.body.data.status.protectedKnowledgeIds, [open.id]);
    // Lost-response replay returns the stored result; a changed payload conflicts.
    const replay = await pin(open.id, { requestId, expected: false, protected: true }).expect(200);
    assert.deepEqual(replay.body.data, first.body.data);
    await pin(open.id, { requestId, expected: true, protected: false }).expect(409);
    // Stale expectation is rejected under the lock.
    await pin(open.id, { requestId: randomUUID(), expected: false, protected: true }).expect(409);
    // Hidden GM records can neither be pinned nor revealed.
    const hidden = await pin(secret.id, {
      requestId: randomUUID(),
      expected: false,
      protected: true,
    }).expect(404);
    assert.doesNotMatch(JSON.stringify(hidden.body), /SECRET TEXT/);
    const section = await pin(
      a.id,
      { requestId: randomUUID(), expected: false, protected: true },
      'sections'
    ).expect(200);
    assert.deepEqual(section.body.data.status.protectedSectionIds, [a.id]);
    assert.ok(
      section.body.data.status.diagnostics.included.some((i: { id: string }) => i.id === a.id)
    );
    const off = await pin(open.id, {
      requestId: randomUUID(),
      expected: true,
      protected: false,
    }).expect(200);
    assert.deepEqual(off.body.data.status.protectedKnowledgeIds, []);
    const saved = await store.campaign(campaign.id);
    assert.deepEqual(saved.historyRecall?.protectedSectionIds, [a.id]);
    const listed = await call('get', base).expect(200);
    assert.equal(listed.body.data.items.find((i: { id: string }) => i.id === a.id).protected, true);
  }
);

test(
  'a superseded memory pin is reported unavailable and disable keeps pins',
  { skip: !dbEnabled },
  async () => {
    const { campaign, a, base } = await fixture();
    const memory = {
      id: randomUUID(),
      text: 'Reviewed manual memory.',
      coveredTurnIds: [],
      valid: true,
      createdAt: new Date().toISOString(),
    };
    await store.transaction(async (client) => {
      const c = await store.campaign(campaign.id, client, true);
      await store.memory(c, memory, client);
      await store.save(c, client);
    });
    const pinned = await call('patch', `${base}/protection/memories/${memory.id}`)
      .send({ requestId: randomUUID(), expected: false, protected: true })
      .expect(200);
    assert.deepEqual(pinned.body.data.status.unavailableProtectedIds, []);
    await store.pool.query(
      "UPDATE memories SET document=jsonb_set(document,'{valid}','false') WHERE id=$1",
      [memory.id]
    );
    await call('patch', `${base}/protection/sections/${a.id}`)
      .send({ requestId: randomUUID(), expected: false, protected: true })
      .expect(200);
    const disableId = randomUUID();
    await call('patch', `${base}/settings`)
      .send({ requestId: disableId, enabled: true, expectedEnabled: true })
      .expect(422);
    await call('patch', `${base}/settings`)
      .send({ requestId: randomUUID(), enabled: false, expectedEnabled: false })
      .expect(409);
    const off = await call('patch', `${base}/settings`)
      .send({ requestId: disableId, enabled: false, expectedEnabled: true })
      .expect(200);
    assert.equal(off.body.data.status.enabled, false);
    assert.deepEqual(off.body.data.status.protectedSectionIds, [a.id]);
    assert.deepEqual(off.body.data.status.unavailableProtectedIds, [memory.id]);
    const again = await call('patch', `${base}/settings`)
      .send({ requestId: disableId, enabled: false, expectedEnabled: true })
      .expect(200);
    assert.deepEqual(again.body.data, off.body.data);
  }
);
