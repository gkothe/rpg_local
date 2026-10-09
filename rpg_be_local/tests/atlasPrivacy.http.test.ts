import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import request from 'supertest';
import { dbEnabled, openIsolatedStore } from './journalFixture.js';
import { newCampaign } from '../src/domain/campaign.js';
import { createApp } from '../src/app.js';
import type { ProviderService } from '../src/providers/service.js';

let db: Awaited<ReturnType<typeof openIsolatedStore>>;
before(async () => {
  if (dbEnabled) db = await openIsolatedStore('atlas_privacy_http_qa');
});
after(async () => {
  if (dbEnabled && db) await db.close();
});
const http = (app: ReturnType<typeof createApp>['app']) => ({
  get: (path: string) => request(app).get(path).set('Host', 'localhost:4100'),
  post: (path: string) =>
    request(app).post(path).set({ Host: 'localhost:4100', 'X-RPG-Client': 'local-rpg' }),
});
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=',
  'base64'
);
const draft = () => ({
  geography: {
    places: ['secret', 'site', 'office'].map((key) => ({
      key,
      title: key === 'secret' ? 'SECRET_CELLAR_LABEL' : key === 'site' ? 'Warehouse' : 'Office',
      text: key === 'secret' ? 'SECRET_PARENT_DESCRIPTION' : 'Public accepted geography.',
      visibility: key === 'secret' ? 'gm_only' : 'player',
      certainty: 'established',
      origin: 'gm',
      evidence: [],
    })),
    changes: {
      places: [
        { value: { placeId: { localKey: 'secret' }, visited: false }, expected: null },
        {
          value: {
            placeId: { localKey: 'site' },
            parentPlaceId: { localKey: 'secret' },
            visited: false,
          },
          expected: null,
        },
        {
          value: {
            placeId: { localKey: 'office' },
            parentPlaceId: { localKey: 'site' },
            visited: false,
            placement: { frameId: { localKey: 'ground' }, x: 1, y: 1, width: 5, height: 5 },
          },
          expected: null,
        },
      ],
      frames: [
        {
          value: {
            key: 'ground',
            placeId: { localKey: 'site' },
            label: 'Warehouse floor',
            floor: 'Ground',
            width: 20,
            height: 20,
            visibility: 'player',
            origin: 'gm',
            evidence: [],
          },
          expected: null,
        },
      ],
      routes: [
        {
          value: {
            from: { localKey: 'site' },
            to: { localKey: 'office' },
            bidirectional: true,
            kind: 'door',
            access: 'open',
            visibility: 'player',
            certainty: 'established',
            origin: 'gm',
            evidence: [],
          },
          expected: null,
        },
        {
          value: {
            from: { localKey: 'site' },
            to: { localKey: 'secret' },
            bidirectional: true,
            kind: 'ladder',
            access: 'locked',
            visibility: 'gm_only',
            certainty: 'established',
            origin: 'gm',
            evidence: [],
          },
          expected: null,
        },
      ],
    },
  },
  observations: ['secret', 'site', 'office'].map((key) => ({
    key,
    region: { x: 0.123456, y: 0.654321, width: 0.1, height: 0.1 },
    uncertainty: '',
  })),
});
async function fixture() {
  const c = newCampaign({ name: 'HTTP atlas privacy QA' });
  await db.store.insert(c);
  let calls = 0;
  const providers = {
    imageCapacity: async () => ({}),
    generateImage: async () => {
      calls++;
      return draft();
    },
  } as unknown as ProviderService;
  const app = createApp({ store: db.store, providers }).app;
  const response = await http(app)
    .post(`/api/campaigns/${c.id}/atlas/imports`)
    .field('requestId', randomUUID())
    .attach('file', png, { filename: 'warehouse.png', contentType: 'image/png' })
    .expect(202);
  const jobId = response.body.data.id;
  for (let i = 0; i < 100; i++) {
    const polled = await http(app).get(`/api/campaigns/${c.id}/atlas/imports/${jobId}`).expect(200);
    if (polled.body.data.status !== 'running') {
      assert.equal(polled.body.data.status, 'ready');
      break;
    }
    await delay(10);
  }
  await http(app)
    .post(`/api/campaigns/${c.id}/atlas/imports/${jobId}/accept`)
    .send({
      requestId: randomUUID(),
      selectedKeys: ['secret', 'site', 'office'],
      selectedRoutes: [0, 1],
      selectedFrames: [0],
      matches: {},
      playerSafe: false,
    })
    .expect(200);
  const canonical = await db.store.campaign(c.id);
  const site = canonical.knowledge!.find((p) => p.title === 'Warehouse')!;
  const secret = canonical.knowledge!.find((p) => p.title === 'SECRET_CELLAR_LABEL')!;
  const rows = await db.store.pool.query(
    'SELECT id,observations FROM atlas_assets WHERE campaign_id=$1',
    [c.id]
  );
  const assetId: string = rows.rows[0].id;
  const observationIds: string[] = rows.rows[0].observations.map(
    (o: { observationId: string }) => o.observationId
  );
  assert.equal(site.attributions[0]!.evidence[0]!.type, 'map_asset');
  return { app, c, site, secret, assetId, observationIds, canonical, calls: () => calls };
}
function assertPrivate(wire: string, f: Awaited<ReturnType<typeof fixture>>) {
  for (const value of [
    f.secret.id,
    f.assetId,
    ...f.observationIds,
    'SECRET_CELLAR_LABEL',
    'SECRET_PARENT_DESCRIPTION',
    '0.123456',
    '0.654321',
    'privateAssetId',
    'playerAssetId',
    png.toString('base64'),
  ])
    assert.equal(wire.includes(value), false, `Private map metadata leaked: ${value}`);
}

test(
  'actual campaign, Journal and atlas HTTP projections omit private originals and nested image provenance',
  { skip: !dbEnabled },
  async () => {
    const f = await fixture();
    const campaign = await http(f.app).get(`/api/campaigns/${f.c.id}`).expect(200);
    assertPrivate(JSON.stringify(campaign.body), f);
    const list = await http(f.app).get(`/api/campaigns/${f.c.id}/journal/entries`).expect(200);
    assertPrivate(JSON.stringify(list.body), f);
    assert.equal(list.body.data.total, 2);
    const entry = await http(f.app)
      .get(`/api/campaigns/${f.c.id}/journal/entries/${f.site.id}`)
      .expect(200);
    assertPrivate(JSON.stringify(entry.body), f);
    assert.ok(
      entry.body.data.evidence.some(
        (e: { kind: string; available: boolean }) => e.kind === 'map_asset' && !e.available
      )
    );
    const evidence = await http(f.app)
      .get(`/api/campaigns/${f.c.id}/journal/entries/${f.site.id}/evidence/evidence-0`)
      .expect(200);
    assertPrivate(JSON.stringify(evidence.body), f);
    assert.equal(evidence.body.data.available, false);
    const atlas = await http(f.app)
      .get(`/api/campaigns/${f.c.id}/atlas`)
      .query({ scope: f.site.id })
      .expect(200);
    assertPrivate(JSON.stringify(atlas.body), f);
    assert.equal(atlas.body.data.routes.length, 1);
    assert.equal(atlas.body.data.frames.length, 1);
    assert.equal(atlas.body.data.breadcrumb.length, 1);
    await http(f.app)
      .get(`/api/campaigns/${f.c.id}/atlas`)
      .query({ scope: f.secret.id })
      .expect(404);
    await http(f.app).get(`/api/campaigns/${f.c.id}/journal/entries/${f.secret.id}`).expect(404);
    assert.equal(f.calls(), 1);
  }
);

test(
  'private image bytes remain inaccessible even when the public atlas has its frame',
  { skip: !dbEnabled },
  async () => {
    const f = await fixture();
    const denied = await http(f.app)
      .get(`/api/campaigns/${f.c.id}/atlas/images/${f.assetId}`)
      .expect(404);
    assertPrivate(JSON.stringify(denied.body), f);
    const other = newCampaign({ name: 'Foreign campaign' });
    await db.store.insert(other);
    await http(f.app).get(`/api/campaigns/${other.id}/atlas/images/${f.assetId}`).expect(404);
    const stored = await db.store.pool.query('SELECT bytes FROM atlas_assets WHERE id=$1', [
      f.assetId,
    ]);
    assert.deepEqual(stored.rows[0].bytes, png);
  }
);
