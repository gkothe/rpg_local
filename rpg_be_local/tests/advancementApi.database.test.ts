import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import type { ProviderService } from '../src/providers/service.js';
import { ADVANCEMENT_OPTIONS, AdvancementStatus as Status } from '../src/domain/advancement.js';
import { AdvancementService } from '../src/services/advancement.js';
import { dbEnabled, openIsolatedStore, sleep } from './journalFixture.js';
import { advancementFixture, advancementProvider } from './advancementFixture.js';

let isolated: Awaited<ReturnType<typeof openIsolatedStore>>;
before(async () => {
  if (dbEnabled) isolated = await openIsolatedStore('advancement_api');
});
after(async () => {
  if (dbEnabled) await isolated.close();
});
const headers = { Host: 'localhost:4100', 'X-RPG-Client': 'local-rpg' };

test('HTTP settings advertise canonical advancement options', { skip: !dbEnabled }, async () => {
  const app = createApp({ store: isolated.store }).app;
  const r = await request(app).get('/api/settings').set(headers).expect(200);
  assert.deepEqual(r.body.data.advancement, ADVANCEMENT_OPTIONS);
  assert.deepEqual(
    r.body.data.advancement.actions.map((x: { id: string }) => x.id),
    ['adjust', 'apply', 'discard', 'cancel', 'resume', 'reverse']
  );
});

test(
  'advancement HTTP rejects unknown fields, malformed identities and invalid page boundaries',
  { skip: !dbEnabled },
  async () => {
    const f = await advancementFixture(isolated.store);
    const ai = advancementProvider(f.characterId);
    const app = createApp({
      store: isolated.store,
      providers: ai.generator as ProviderService,
    }).app;
    const base = `/api/campaigns/${f.campaign.id}/advancement`;
    await request(app)
      .post(`${base}/reviews`)
      .set(headers)
      .send({ requestId: randomUUID(), characterXp: 100 })
      .expect(422);
    await request(app).post(`${base}/reviews`).set(headers).send({ requestId: 'bad' }).expect(422);
    await request(app).get(`${base}/reviews?limit=101`).set(headers).expect(422);
    await request(app).get(`${base}/reviews?cursor=bad`).set(headers).expect(422);
    await request(app)
      .post(`${base}/reviews/${randomUUID()}/apply`)
      .set(headers)
      .send({ requestId: randomUUID() })
      .expect(422);
    await request(app)
      .post(`${base}/reviews/${randomUUID()}/discard`)
      .set(headers)
      .send({ requestId: randomUUID(), proposalDigest: 'a'.repeat(64) })
      .expect(422);
    assert.equal(ai.calls.length, 0);
  }
);

test(
  'HTTP review and Apply expose only public proposal data, cumulative totals and scoped identifiers',
  { skip: !dbEnabled },
  async () => {
    const store = isolated.store;
    const f = await advancementFixture(store);
    const other = await advancementFixture(store);
    const ai = advancementProvider(f.characterId);
    const app = createApp({ store, providers: ai.generator as ProviderService }).app;
    const base = `/api/campaigns/${f.campaign.id}/advancement`;
    const requestId = randomUUID();
    const start = await request(app)
      .post(`${base}/reviews`)
      .set(headers)
      .send({ requestId })
      .expect(202);
    const reviewId = start.body.data.id as string;
    const service = new AdvancementService(store, ai.generator);
    for (
      let i = 0;
      i < 300 && (await service.status(f.campaign.id, reviewId)).status === Status.Running;
      i++
    )
      await sleep(15);
    const status = await request(app).get(`${base}/reviews/${reviewId}`).set(headers).expect(200);
    assert.equal(status.body.data.status, Status.Ready);
    for (const forbidden of ['capture', 'owner', 'lease_until', 'semanticDigest'])
      assert.equal(forbidden in status.body.data, false);
    assert.ok(!status.text.includes('Private notes'));
    await request(app)
      .get(`/api/campaigns/${other.campaign.id}/advancement/reviews/${reviewId}`)
      .set(headers)
      .expect(404);
    const applyId = randomUUID();
    const body = { requestId: applyId, proposalDigest: status.body.data.proposalDigest };
    const applied = await request(app)
      .post(`${base}/reviews/${reviewId}/apply`)
      .set(headers)
      .send(body)
      .expect(200);
    assert.equal(applied.body.data.status, Status.Applied);
    const replay = await request(app)
      .post(`${base}/reviews/${reviewId}/apply`)
      .set(headers)
      .send(body)
      .expect(200);
    assert.deepEqual(replay.body.data, applied.body.data);
    const total = await request(app).get(`${base}/summary`).set(headers).expect(200);
    assert.equal(total.body.data.players[0].totals[0].total, 10);
    assert.equal(total.body.data.ledger.length, 1);
    assert.equal((await store.campaign(f.campaign.id)).characters[0]!.attributes.xp, 321);
    const list = await request(app).get(`${base}/reviews`).set(headers).expect(200);
    assert.equal(list.body.data.outstandingTurnCount, 0);
    const noTurns = await request(app)
      .post(`${base}/reviews`)
      .set(headers)
      .send({ requestId: randomUUID() })
      .expect(202);
    assert.equal(noTurns.body.data, null);
    assert.equal(ai.calls.length, 1);
  }
);
