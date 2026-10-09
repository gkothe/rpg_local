import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { dbEnabled, openIsolatedStore } from './journalFixture.js';
import { newCampaign } from '../src/domain/campaign.js';
import { AtlasImportService } from '../src/services/atlasImport.js';
import { publicCampaign } from '../src/domain/playerProjection.js';
import type { Generator } from '../src/providers/service.js';

let db: Awaited<ReturnType<typeof openIsolatedStore>>;
before(async () => {
  if (dbEnabled) db = await openIsolatedStore('atlas_import_qa');
});
after(async () => {
  if (dbEnabled && db) await db.close();
});
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=',
  'base64'
);
const draft = () => ({
  geography: {
    places: [
      {
        key: 'office',
        title: 'Office',
        text: 'A public office.',
        certainty: 'established',
        visibility: 'player',
        origin: 'gm',
        evidence: [],
      },
    ],
    changes: {
      places: [{ value: { placeId: { localKey: 'office' }, visited: false }, expected: null }],
    },
  },
  observations: [{ key: 'office', region: { x: 0, y: 0, width: 1, height: 1 }, uncertainty: '' }],
});
async function ready(service: AtlasImportService, campaignId: string, id: string) {
  for (let i = 0; i < 100; i++) {
    const job = await service.get(campaignId, id);
    if (job.status !== 'running') return job;
    await delay(10);
  }
  throw new Error('Mocked map extraction did not reach a terminal status');
}

test(
  'real isolated persistence accepts image findings once and censors provenance from player DTO',
  { skip: !dbEnabled },
  async () => {
    const c = newCampaign({ name: 'Image DB QA' });
    await db.store.insert(c);
    let calls = 0;
    const generator = {
      imageCapacity: async () => ({}),
      generateImage: async () => {
        calls++;
        return draft();
      },
    } as unknown as Generator;
    const service = new AtlasImportService(db.store, generator);
    const request = { requestId: randomUUID() };
    const job = await service.start(c.id, request, png);
    assert.equal((await ready(service, c.id, job.id)).status, 'ready');
    assert.equal((await service.start(c.id, request, png)).id, job.id);
    assert.equal(calls, 1);
    const decision = {
      requestId: randomUUID(),
      selectedKeys: ['office'],
      matches: {},
      selectedRoutes: [],
      selectedFrames: [],
      playerSafe: false,
    };
    await service.accept(c.id, job.id, decision);
    const canonical = await db.store.campaign(c.id);
    assert.equal(canonical.knowledge!.length, 1);
    assert.equal(canonical.knowledge![0]!.evidence[0]!.type, 'map_asset');
    const evidence = canonical.knowledge![0]!.evidence[0]!;
    assert.ok('assetId' in evidence);
    const publicWire = JSON.stringify(publicCampaign(canonical));
    assert.equal(publicWire.includes(evidence.assetId), false);
    assert.equal(publicWire.includes('map_asset'), false);
    await assert.rejects(service.image(c.id, evidence.assetId), { code: 'atlas_image_private' });
    assert.deepEqual(await service.accept(c.id, job.id, decision), { saved: true });
    assert.equal((await db.store.campaign(c.id)).knowledge!.length, 1);
  }
);

test(
  'real isolated ownership refuses a late cancelled vision result',
  { skip: !dbEnabled },
  async () => {
    const c = newCampaign({ name: 'Cancelled image DB QA' });
    await db.store.insert(c);
    let finish!: (value: unknown) => void;
    let signal: AbortSignal | undefined;
    let service!: AtlasImportService;
    const entered = new Promise<void>((resolveEntered) => {
      const generator = {
        imageCapacity: async () => ({}),
        generateImage: async (
          _settings: unknown,
          _prompt: unknown,
          _schema: unknown,
          _bytes: unknown,
          abort: AbortSignal
        ) => {
          signal = abort;
          resolveEntered();
          return new Promise((resolve) => {
            finish = resolve;
          });
        },
      } as unknown as Generator;
      service = new AtlasImportService(db.store, generator);
    });
    const job = await service.start(c.id, { requestId: randomUUID() }, png);
    await entered;
    await service.cancel(c.id, job.id);
    assert.equal(signal!.aborted, true);
    finish(draft());
    await delay(20);
    const cancelled = await service.get(c.id, job.id);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.draft, null);
    assert.equal((await db.store.campaign(c.id)).knowledge!.length, 0);
  }
);
