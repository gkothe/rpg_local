import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { newCampaign } from '../src/domain/campaign.js';
import { AtlasService } from '../src/services/atlas.js';
import { Problem } from '../src/errors.js';
import type { Store } from '../src/store.js';

function harness() {
  let campaign = newCampaign({ name: 'Warehouse edit QA' });
  let idle = true;
  let saves = 0;
  const receipts = new Map<string, { digest: string; result: unknown }>();
  const client = {
    async query(sql: string, values: unknown[]) {
      const key = `${values[0]}:${values[1]}`;
      if (sql.startsWith('SELECT digest,result')) {
        return { rows: receipts.has(key) ? [receipts.get(key)] : [] };
      }
      if (sql.startsWith('INSERT INTO atlas_edits')) {
        receipts.set(key, { digest: values[2] as string, result: values[4] });
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL in atlas edit test: ${sql}`);
    },
  } as unknown as PoolClient;
  const store = {
    async campaign(id: string, requestedClient?: PoolClient, lock?: boolean) {
      assert.equal(id, campaign.id);
      if (requestedClient) {
        assert.equal(requestedClient, client);
        assert.equal(lock, true);
      }
      return structuredClone(campaign);
    },
    async assertIdle(id: string, requestedClient: PoolClient) {
      assert.equal(id, campaign.id);
      assert.equal(requestedClient, client);
      if (!idle) throw new Problem(409, 'turn_active', 'A gameplay turn owns this campaign');
    },
    async save(next: typeof campaign, requestedClient: PoolClient) {
      assert.equal(requestedClient, client);
      campaign = structuredClone(next);
      saves++;
    },
    async transaction<T>(work: (db: PoolClient) => Promise<T>) {
      const before = structuredClone(campaign);
      const beforeReceipts = structuredClone(receipts);
      try {
        return await work(client);
      } catch (error) {
        campaign = before;
        receipts.clear();
        for (const [key, receipt] of beforeReceipts) receipts.set(key, receipt);
        throw error;
      }
    },
  } as unknown as Store;
  return {
    service: new AtlasService(store),
    id: campaign.id,
    campaign: () => structuredClone(campaign),
    saves: () => saves,
    receipts: () => receipts.size,
    setIdle: (value: boolean) => {
      idle = value;
    },
  };
}

function createEdit() {
  return {
    requestId: randomUUID(),
    changes: {
      createPlaces: [
        {
          key: 'warehouse',
          title: 'Warehouse',
          text: 'A dockside store.',
          visibility: 'player',
          certainty: 'established',
        },
      ],
      places: [{ value: { placeId: { localKey: 'warehouse' }, visited: false }, expected: null }],
    },
  };
}

test('manual edit identical replay preserves allocated Place IDs and does not save twice', async () => {
  const h = harness();
  const input = createEdit();
  const result = await h.service.edit(h.id, input);
  const saved = h.campaign();
  h.setIdle(false);
  assert.deepEqual(await h.service.edit(h.id, input), result);
  assert.deepEqual(h.campaign(), saved);
  assert.equal(saved.knowledge!.length, 1);
  assert.equal(saved.atlas!.places[0]!.placeId, saved.knowledge![0]!.id);
  assert.equal(saved.knowledge![0]!.createdTurnId, null);
  assert.equal(h.saves(), 1);
  assert.equal(h.receipts(), 1);
});

test('manual edit reused request ID with changed input fails without modifying canon', async () => {
  const h = harness();
  const input = createEdit();
  await h.service.edit(h.id, input);
  const before = h.campaign();
  input.changes.createPlaces[0]!.title = 'Different site';
  await assert.rejects(h.service.edit(h.id, input), { code: 'atlas_request_reused', status: 409 });
  assert.deepEqual(h.campaign(), before);
  assert.equal(h.saves(), 1);
});

test('owned active turn rejects a fresh edit; releasing ownership allows same request', async () => {
  const h = harness();
  const input = createEdit();
  h.setIdle(false);
  await assert.rejects(h.service.edit(h.id, input), { code: 'turn_active', status: 409 });
  assert.equal(h.campaign().knowledge!.length, 0);
  assert.equal(h.receipts(), 0);
  assert.equal(h.saves(), 0);
  h.setIdle(true);
  await h.service.edit(h.id, input);
  assert.equal(h.campaign().knowledge!.length, 1);
});

test('stale touched expected value fails atomically and does not record a successful receipt', async () => {
  const h = harness();
  await h.service.edit(h.id, createEdit());
  const before = h.campaign();
  const p = before.atlas!.places[0]!;
  await assert.rejects(
    h.service.edit(h.id, {
      requestId: randomUUID(),
      changes: { places: [{ value: { ...p, visited: true }, expected: null }] },
    }),
    { code: 'atlas_conflict', status: 409 }
  );
  assert.deepEqual(h.campaign(), before);
  assert.equal(h.receipts(), 1);
  assert.equal(h.saves(), 1);
});

test('failed geometry after local Place creation publishes neither Place nor receipt', async () => {
  const h = harness();
  const input = createEdit();
  const original = h.campaign();
  const raw = structuredClone(input) as unknown as {
    requestId: string;
    changes: Record<string, unknown>;
  };
  raw.changes.position = { placeId: randomUUID(), expected: null };
  await assert.rejects(h.service.edit(h.id, raw), { code: 'atlas_invalid', status: 422 });
  assert.deepEqual(h.campaign(), original);
  assert.equal(h.receipts(), 0);
  assert.equal(h.saves(), 0);
  await h.service.edit(h.id, input);
  assert.equal(h.campaign().knowledge!.length, 1);
});

test('manual endpoint refuses gameplay preparation receipts without touching persistence', async () => {
  const h = harness();
  await assert.rejects(
    h.service.edit(h.id, {
      requestId: randomUUID(),
      changes: { preparedReceiptIds: [randomUUID()] },
    }),
    { code: 'atlas_receipt', status: 422 }
  );
  assert.equal(h.saves(), 0);
  assert.equal(h.receipts(), 0);
});
