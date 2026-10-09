import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Store } from '../src/store.js';
import type { Generator } from '../src/providers/service.js';
import { newCampaign } from '../src/domain/campaign.js';
import { mutateAtlas } from '../src/domain/atlasMutation.js';
import { freezeAtlas } from '../src/domain/atlasRecall.js';
import { atlasImageInfo } from '../src/providers/atlasVision.js';
import { AtlasImportService } from '../src/services/atlasImport.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=',
  'base64'
);
const geography = () => ({
  geography: {
    places: ['site', 'office'].map((key) => ({
      key,
      title: key === 'site' ? 'Warehouse' : 'Office',
      text: 'Image-derived location.',
      visibility: 'player',
      certainty: 'established',
      origin: 'gm',
      evidence: [],
    })),
    changes: {
      places: [
        { value: { placeId: { localKey: 'site' }, visited: false }, expected: null },
        {
          value: {
            placeId: { localKey: 'office' },
            parentPlaceId: { localKey: 'site' },
            visited: false,
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
            access: 'unknown',
            visibility: 'player',
            certainty: 'rumor',
            origin: 'gm',
            evidence: [],
          },
          expected: null,
        },
      ],
    },
  },
  observations: ['site', 'office'].map((key) => ({
    key,
    region: { x: 0, y: 0, width: 1, height: 1 },
    uncertainty: 'Schematic image.',
  })),
});

function harness(generateImage: Generator['generateImage'] = async () => geography()) {
  let c = newCampaign({ name: 'Map import QA' });
  let idle = true;
  const jobs = new Map<string, Record<string, unknown>>();
  const assets = new Map<
    string,
    {
      campaignId: string;
      mime: string;
      bytes: Buffer;
      playerSafe: boolean;
      observations: unknown[];
    }
  >();
  const query = async (sql: string, args: unknown[]) => {
    if (sql.startsWith('SELECT * FROM atlas_imports')) {
      const row = sql.includes('request_id')
        ? [...jobs.values()].find((j) => j.campaign_id === args[0] && j.request_id === args[1])
        : jobs.get(String(args[0]));
      const allowed = row && (sql.includes('request_id') || row.campaign_id === args[1]);
      return { rows: allowed ? [structuredClone(row)] : [], rowCount: allowed ? 1 : 0 };
    }
    if (sql.startsWith('INSERT INTO atlas_assets')) {
      assets.set(String(args[0]), {
        campaignId: String(args[1]),
        mime: String(args[2]),
        bytes: args[3] as Buffer,
        playerSafe: false,
        observations: [],
      });
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO atlas_imports')) {
      const row = {
        id: args[0],
        campaign_id: args[1],
        request_id: args[2],
        digest: args[3],
        asset_id: args[4],
        frozen_input: args[5],
        settings: args[6],
        owner_id: args[7],
        status: 'running',
        draft: null,
        error: null,
        decision: null,
      };
      jobs.set(String(args[0]), row);
      return { rows: [structuredClone(row)], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE atlas_imports')) {
      const row = jobs.get(String(args[0]));
      const owned = sql.includes('owner_id=$2');
      const matches =
        row &&
        (owned
          ? row.owner_id === args[1] && row.status === 'running'
          : row.campaign_id === args[1]);
      if (
        !matches ||
        (sql.includes("status IN ('running','ready')") &&
          !['running', 'ready'].includes(String(row.status)))
      )
        return { rows: [], rowCount: 0 };
      if (sql.includes("status='ready'")) {
        row.status = 'ready';
        row.draft = structuredClone(args[2]);
        row.owner_id = null;
      } else if (sql.includes("status='applied'")) {
        row.status = 'applied';
        row.decision = structuredClone(args[2]);
      } else if (sql.includes('status=$3')) {
        row.status = args[2];
        row.error = args[3];
        row.owner_id = null;
      } else {
        row.status = 'cancelled';
        row.owner_id = null;
      }
      return { rows: [{ id: row.id }], rowCount: 1 };
    }
    if (sql.startsWith('UPDATE atlas_assets')) {
      const asset = assets.get(String(args[0]))!;
      assert.equal(asset.campaignId, args[1]);
      asset.playerSafe = Boolean(args[2]);
      asset.observations =
        typeof args[3] === 'string'
          ? (JSON.parse(args[3]) as unknown[])
          : (structuredClone(args[3]) as unknown[]);
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('SELECT mime,bytes')) {
      const asset = assets.get(String(args[0]));
      return {
        rows:
          asset && asset.campaignId === args[1] && asset.playerSafe
            ? [{ mime: asset.mime, bytes: asset.bytes }]
            : [],
        rowCount: asset?.playerSafe ? 1 : 0,
      };
    }
    throw new Error(`Unexpected import SQL: ${sql}`);
  };
  const client = { query } as unknown as PoolClient;
  const store = {
    pool: { query },
    async campaign(id: string) {
      assert.equal(id, c.id);
      return structuredClone(c);
    },
    async save(candidate: typeof c) {
      c = structuredClone(candidate);
    },
    async assertIdle() {
      if (!idle) throw new Error('Campaign owned');
    },
    async transaction<T>(work: (db: PoolClient) => Promise<T>) {
      const original = structuredClone(c),
        oldJobs = structuredClone(jobs),
        oldAssets = structuredClone(assets);
      try {
        return await work(client);
      } catch (error) {
        c = original;
        jobs.clear();
        assets.clear();
        for (const [id, row] of oldJobs) jobs.set(id, row);
        for (const [id, asset] of oldAssets) assets.set(id, asset);
        throw error;
      }
    },
  } as unknown as Store;
  const generator = { imageCapacity: async () => ({}), generateImage } as unknown as Generator;
  return {
    service: new AtlasImportService(store, generator),
    id: c.id,
    jobs,
    assets,
    campaign: () => structuredClone(c),
    update: (next: typeof c) => {
      c = structuredClone(next);
    },
    setIdle: (next: boolean) => {
      idle = next;
    },
    seedReady: (draft = geography()) => {
      const id = randomUUID(),
        assetId = randomUUID();
      assets.set(assetId, {
        campaignId: c.id,
        mime: 'image/png',
        bytes: png,
        playerSafe: false,
        observations: [],
      });
      jobs.set(id, {
        id,
        campaign_id: c.id,
        asset_id: assetId,
        status: 'ready',
        owner_id: null,
        frozen_input: { input: { requestId: randomUUID(), legend: '' }, frozen: freezeAtlas(c) },
        draft,
        error: null,
        decision: null,
      });
      return { id, assetId };
    },
  };
}

async function settle() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}
const acceptAll = () => ({
  requestId: randomUUID(),
  selectedKeys: ['site', 'office'],
  matches: {},
  playerSafe: false,
});

test('image byte inspection rejects spoofed types and excessive dimensions', () => {
  assert.deepEqual(atlasImageInfo(png), { mime: 'image/png', width: 1, height: 1 });
  assert.throws(() => atlasImageInfo(Buffer.from('<html>not an image</html>')), {
    code: 'atlas_image_format',
  });
  const excessive = Buffer.from(png);
  excessive.writeUInt32BE(100_000_001, 16);
  assert.throws(() => atlasImageInfo(excessive), { code: 'atlas_image_dimensions' });
});

test('image import request replay avoids a second vision call and rejects altered legend', async () => {
  let calls = 0;
  const h = harness(async () => {
    calls++;
    return geography();
  });
  const input = { requestId: randomUUID(), legend: 'Warehouse' };
  const first = await h.service.start(h.id, input, png);
  await settle();
  assert.equal((await h.service.get(h.id, first.id)).status, 'ready');
  assert.equal((await h.service.start(h.id, input, png)).id, first.id);
  assert.equal(calls, 1);
  await assert.rejects(h.service.start(h.id, { ...input, legend: 'Different' }, png), {
    code: 'atlas_request_reused',
  });
  assert.equal(h.campaign().knowledge!.length, 0);
});

test('late vision completion after cancellation cannot publish draft or canon', async () => {
  let complete!: (draft: unknown) => void;
  let signal: AbortSignal | undefined;
  const h = harness(async (_settings, _prompt, _schema, _bytes, abort) => {
    signal = abort;
    return new Promise((resolve) => {
      complete = resolve;
    });
  });
  const job = await h.service.start(h.id, { requestId: randomUUID() }, png);
  await settle();
  await h.service.cancel(h.id, job.id);
  assert.equal(signal!.aborted, true);
  complete(geography());
  await settle();
  const result = await h.service.get(h.id, job.id);
  assert.equal(result.status, 'cancelled');
  assert.equal(result.draft, null);
  assert.equal(h.campaign().knowledge!.length, 0);
  await assert.rejects(h.service.accept(h.id, job.id, acceptAll()), { code: 'atlas_import_state' });
});

test('acceptance persists image evidence privately, replays exactly and creates no fake turn', async () => {
  const h = harness();
  const job = h.seedReady();
  const input = acceptAll();
  const result = await h.service.accept(h.id, job.id, input);
  const saved = h.campaign();
  assert.equal(saved.knowledge!.length, 2);
  for (const p of saved.knowledge!) {
    assert.equal(p.createdTurnId, null);
    assert.equal(p.updatedTurnId, null);
    assert.equal(p.attributions[0]!.turnId, null);
    assert.equal(p.evidence[0]!.type, 'map_asset');
  }
  assert.deepEqual(await h.service.accept(h.id, job.id, input), result);
  assert.deepEqual(h.campaign(), saved);
  await assert.rejects(h.service.image(h.id, job.assetId), { code: 'atlas_image_private' });
  await assert.rejects(h.service.image(randomUUID(), job.assetId), { code: 'atlas_image_private' });
  await assert.rejects(h.service.accept(h.id, job.id, { ...input, playerSafe: true }), {
    code: 'atlas_request_reused',
  });
});

test('unselected parent dependency refuses acceptance atomically', async () => {
  const h = harness();
  const job = h.seedReady();
  const before = h.campaign();
  await assert.rejects(
    h.service.accept(h.id, job.id, { ...acceptAll(), selectedKeys: ['office'] }),
    { code: 'atlas_import_dependency' }
  );
  assert.deepEqual(h.campaign(), before);
  assert.equal((await h.service.get(h.id, job.id)).status, 'ready');
});

test('acceptance preserves existing matched geometry including edits made after extraction', async () => {
  const h = harness();
  const c = mutateAtlas(h.campaign(), {
    createPlaces: [
      {
        key: 'old',
        title: 'Existing office',
        text: 'Existing canon.',
        visibility: 'player',
        certainty: 'established',
      },
    ],
    places: [{ value: { placeId: { localKey: 'old' }, visited: false }, expected: null }],
  });
  h.update(c);
  const job = h.seedReady();
  const later = h.campaign();
  later.atlas!.places[0]!.visited = true;
  h.update(later);
  const before = h.campaign();
  await h.service.accept(h.id, job.id, {
    ...acceptAll(),
    matches: { office: c.atlas!.places[0]!.placeId },
  });
  assert.deepEqual(
    h.campaign().atlas!.places.find((p) => p.placeId === c.atlas!.places[0]!.placeId),
    before.atlas!.places[0]
  );
  assert.equal(
    h.campaign().knowledge!.find((p) => p.title === 'Existing office')!.text,
    'Existing canon.'
  );
});

test('reviewer can reject an uncertain connection while accepting its two Places', async () => {
  const h = harness();
  const job = h.seedReady();
  await h.service.accept(h.id, job.id, { ...acceptAll(), selectedRoutes: [], selectedFrames: [] });
  assert.equal(h.campaign().knowledge!.length, 2);
  assert.equal(h.campaign().atlas!.places.length, 2);
  assert.equal(h.campaign().atlas!.routes.length, 0);
});

test('invalid reviewed route index fails without applying locations or image permission', async () => {
  const h = harness();
  const job = h.seedReady();
  const before = h.campaign();
  await assert.rejects(
    h.service.accept(h.id, job.id, { ...acceptAll(), selectedRoutes: [9], playerSafe: true }),
    /select|indic|index|finding/i
  );
  assert.deepEqual(h.campaign(), before);
  await assert.rejects(h.service.image(h.id, job.assetId), { code: 'atlas_image_private' });
});

test('explicit reviewed player-safe image is available only through its owning campaign', async () => {
  const h = harness();
  const job = h.seedReady();
  await h.service.accept(h.id, job.id, { ...acceptAll(), playerSafe: true });
  assert.deepEqual((await h.service.image(h.id, job.assetId)).bytes, png);
  await assert.rejects(h.service.image(randomUUID(), job.assetId), { code: 'atlas_image_private' });
});

test('image acceptance cannot silently mutate existing Places absent a reviewed local-key match', async () => {
  const h = harness();
  const original = mutateAtlas(h.campaign(), {
    createPlaces: [
      {
        key: 'old',
        title: 'Original office',
        text: 'Existing canon.',
        visibility: 'player',
        certainty: 'established',
      },
    ],
    places: [{ value: { placeId: { localKey: 'old' }, visited: false }, expected: null }],
  });
  h.update(original);
  const imported = geography();
  const old = original.atlas!.places[0]!;
  (imported.geography.changes.places as unknown[]).push({
    value: { ...old, visited: true },
    expected: old,
  });
  const job = h.seedReady(imported);
  try {
    await h.service.accept(h.id, job.id, acceptAll());
  } catch (error) {
    assert.match(
      error instanceof Error ? error.message : String(error),
      /existing|review|match|selection|identity/i
    );
  }
  assert.deepEqual(
    h.campaign().atlas!.places.find((p) => p.placeId === old.placeId),
    old
  );
});
