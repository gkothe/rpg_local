import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { dbEnabled, openIsolatedStore } from './journalFixture.js';
import { newCampaign } from '../src/domain/campaign.js';
import { AtlasImportService } from '../src/services/atlasImport.js';
import { LibraryService, remapArchive } from '../src/services/library.js';
import { publicCampaign } from '../src/domain/playerProjection.js';
import type { Generator } from '../src/providers/service.js';
import { validateAtlasArchive } from '../src/services/atlasArchive.js';
import { applyResponse } from '../src/domain/state.js';
import { gmResponse } from './ownedGameplayFixture.js';

let db: Awaited<ReturnType<typeof openIsolatedStore>>;
before(async () => {
  if (dbEnabled) db = await openIsolatedStore('atlas_archive_qa');
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
    places: ['site', 'office'].map((key) => ({
      key,
      title: key === 'site' ? 'Warehouse' : 'Office',
      text: 'Saved image location.',
      visibility: 'player',
      certainty: 'established',
      origin: 'gm',
      evidence: [],
    })),
    changes: {
      frames: [
        {
          value: {
            key: 'ground',
            placeId: { localKey: 'site' },
            label: 'Ground floor',
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
      places: [
        { value: { placeId: { localKey: 'site' }, visited: false }, expected: null },
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
    },
  },
  observations: ['site', 'office'].map((key) => ({
    key,
    region: { x: 0, y: 0, width: 1, height: 1 },
    uncertainty: '',
  })),
});
async function exported() {
  const c = newCampaign({ name: 'Atlas archive QA' });
  await db.store.insert(c);
  const generator = {
    imageCapacity: async () => ({}),
    generateImage: async () => draft(),
  } as unknown as Generator;
  const service = new AtlasImportService(db.store, generator);
  const job = await service.start(c.id, { requestId: randomUUID() }, png);
  for (let i = 0; i < 100; i++) {
    if ((await service.get(c.id, job.id)).status !== 'running') break;
    await delay(10);
  }
  assert.equal((await service.get(c.id, job.id)).status, 'ready');
  await service.accept(c.id, job.id, {
    requestId: randomUUID(),
    selectedKeys: ['site', 'office'],
    selectedRoutes: [],
    selectedFrames: [0],
    matches: {},
    playerSafe: false,
  });
  return new LibraryService(db.store).export(c.id);
}

test(
  'accepted private map exports/remaps/imports with new asset, observation and frame identities',
  { skip: !dbEnabled },
  async () => {
    const archive = await exported();
    const old = archive.atlasData!.assets[0]!;
    const frame = archive.campaign.atlas!.frames[0]!;
    const remapped = remapArchive(archive);
    assert.notEqual(remapped.campaign.id, archive.campaign.id);
    assert.notEqual(remapped.atlasData!.assets[0]!.id, old.id);
    assert.notEqual(remapped.campaign.atlas!.frames[0]!.id, frame.id);
    assert.notEqual(
      remapped.atlasData!.assets[0]!.observations[0]!.observationId,
      old.observations[0]!.observationId
    );
    assert.equal(
      remapped.campaign.atlas!.frames[0]!.privateAssetId,
      remapped.atlasData!.assets[0]!.id
    );
    const library = new LibraryService(db.store);
    const imported = await library.import(remapped);
    const restored = await library.export(imported.id);
    assert.notEqual(imported.id, remapped.campaign.id);
    const asset = restored.atlasData!.assets[0]!;
    assert.equal(asset.bytes, png.toString('base64'));
    assert.equal(asset.contentHash, old.contentHash);
    assert.equal(asset.playerSafe, false);
    assert.equal(restored.campaign.atlas!.frames[0]!.privateAssetId, asset.id);
    const room = restored.campaign.atlas!.places.find((p) => p.placement)!;
    assert.equal(room.placement!.frameId, restored.campaign.atlas!.frames[0]!.id);
    for (const record of restored.campaign.knowledge!)
      for (const evidence of record.evidence) {
        assert.equal(evidence.type, 'map_asset');
        if (evidence.type !== 'map_asset') throw new Error('Missing accepted image provenance');
        assert.equal(evidence.assetId, asset.id);
        assert.ok(asset.observations.some((o) => o.observationId === evidence.observationId));
      }
    const projection = JSON.stringify(publicCampaign(imported));
    assert.equal(projection.includes(asset.id), false);
    assert.equal(projection.includes('map_asset'), false);
    const service = new AtlasImportService(db.store, {} as Generator);
    await assert.rejects(service.image(imported.id, asset.id), { code: 'atlas_image_private' });
    const stored = await db.store.pool.query(
      'SELECT bytes,player_safe FROM atlas_assets WHERE id=$1 AND campaign_id=$2',
      [asset.id, imported.id]
    );
    assert.deepEqual(stored.rows[0].bytes, png);
    assert.equal(stored.rows[0].player_safe, false);
  }
);

test(
  'spatial-only turn snapshots validate using the complete historical Place corpus',
  { skip: !dbEnabled },
  async () => {
    const archive = await exported();
    const first = archive.campaign.atlas!.places[0]!;
    const applied = applyResponse(
      archive.campaign,
      gmResponse('A place is explored.', [], {
        atlasChanges: { places: [{ value: { ...first, visited: true }, expected: first }] },
      }),
      randomUUID()
    );
    archive.campaign = applied.campaign;
    archive.snapshots = [applied.snapshot];
    assert.equal(applied.snapshot.beforeKnowledge?.length ?? 0, 0);
    assert.equal(applied.snapshot.afterKnowledge?.length ?? 0, 0);
    assert.doesNotThrow(() => validateAtlasArchive(archive));
  }
);

test(
  'archive import rejects corrupt pixels, changed observation bounds and foreign asset references',
  { skip: !dbEnabled },
  async () => {
    const archive = await exported();
    const library = new LibraryService(db.store);
    const before = Number(
      (await db.store.pool.query('SELECT count(*) FROM campaigns')).rows[0].count
    );
    const corrupt = structuredClone(archive);
    corrupt.atlasData!.assets[0]!.bytes = Buffer.from('not a map').toString('base64');
    await assert.rejects(library.import(corrupt));
    const changedObservation = structuredClone(archive);
    changedObservation.atlasData!.assets[0]!.observations[0]!.region.width = 0.5;
    await assert.rejects(library.import(changedObservation), /observation/i);
    const foreign = structuredClone(archive);
    foreign.campaign.atlas!.frames[0]!.privateAssetId = randomUUID();
    await assert.rejects(library.import(foreign), /asset/i);
    const foreignOwner = structuredClone(archive);
    foreignOwner.atlasData!.assets[0]!.campaignId = randomUUID();
    await assert.rejects(library.import(foreignOwner), /asset/i);
    const afterCount = Number(
      (await db.store.pool.query('SELECT count(*) FROM campaigns')).rows[0].count
    );
    assert.equal(afterCount, before);
  }
);
