import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { dbEnabled, openIsolatedStore } from './journalFixture.js';
import { newCampaign } from '../src/domain/campaign.js';
import { TurnService } from '../src/services/turns.js';
import { LibraryService, remapArchive } from '../src/services/library.js';
import { TurnStatus } from '../src/domain/options.js';
import { gmResponse } from './ownedGameplayFixture.js';
import { Problem } from '../src/errors.js';
import type { Generator } from '../src/providers/service.js';
import type { AtlasPrepared } from '../src/domain/atlasPreparation.js';

let db: Awaited<ReturnType<typeof openIsolatedStore>>;
before(async () => {
  if (dbEnabled) db = await openIsolatedStore('atlas_preparation_qa');
});
after(async () => {
  if (dbEnabled && db) await db.close();
});
const args = { localKey: 'warehouse', intent: 'Create a compact dockside warehouse.' };
const draft = () => ({
  places: [
    {
      key: 'warehouse',
      title: 'Warehouse',
      text: 'Compact warehouse.',
      visibility: 'player',
      certainty: 'established',
      origin: 'gm',
      evidence: [],
    },
  ],
  changes: {
    places: [{ value: { placeId: { localKey: 'warehouse' }, visited: false }, expected: null }],
    frames: [
      {
        value: {
          key: 'ground',
          placeId: { localKey: 'warehouse' },
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
  },
});
async function campaign() {
  const c = newCampaign({
    name: 'Cartographer lifecycle QA',
    settings: { provider: 'openrouter', model: 'mock', effort: null },
  });
  await db.store.insert(c);
  return c;
}
async function terminal(campaignId: string, turnId: string) {
  for (let i = 0; i < 300; i++) {
    const turn = await db.store.turn(campaignId, turnId);
    if (![TurnStatus.Pending, TurnStatus.Running].includes(turn.status as TurnStatus)) return turn;
    await delay(20);
  }
  throw new Error('Mocked cartographer turn did not reach a terminal state');
}
function generator(
  gm: NonNullable<Generator['generateOwnedGameplay']>,
  hooks: { child?: Generator['generate']; editor?: Generator['generate'] } = {}
) {
  const counts = { gm: 0, child: 0, editor: 0 };
  const gen: Generator = {
    capacity: async () => 16_000,
    gameplayCapacity: async () => 16_000,
    generateOwnedGameplay: async (...values) => {
      counts.gm++;
      return gm(...values);
    },
    generate: async (...values) => {
      const [, prompt, schema] = values;
      const properties = (schema as { properties?: Record<string, unknown> }).properties ?? {};
      if ('places' in properties && 'changes' in properties) {
        counts.child++;
        if (hooks.child) return hooks.child(...values);
        return draft();
      }
      counts.editor++;
      if (hooks.editor) return hooks.editor(...values);
      return JSON.parse(/^\{"narrative":.*\}$/m.exec(prompt)![0]!);
    },
  };
  return { gen, counts };
}

test(
  'owned preparation replays, rejects changed input, stays unpublished and commits stable IDs through archive/undo',
  { skip: !dbEnabled },
  async () => {
    const c = await campaign();
    let receiptId!: string;
    const f = generator(async (_settings, _prompt, _schema, _system, tools) => {
      const result = (await tools('world_map_prepare', args, 'first')) as { receiptId: string };
      receiptId = result.receiptId;
      assert.deepEqual(
        JSON.parse(JSON.stringify(await tools('world_map_prepare', args, 'replay'))),
        JSON.parse(JSON.stringify(result))
      );
      await assert.rejects(
        tools('world_map_prepare', { ...args, intent: 'Changed intent' }, 'collision'),
        /different input/
      );
      assert.equal((await db.store.campaign(c.id)).knowledge!.length, 0);
      return gmResponse('You discover a warehouse.', [], {
        atlasChanges: { preparedReceiptIds: [receiptId] },
      });
    });
    const turns = new TurnService(db.store, f.gen);
    const request = { requestId: randomUUID(), revision: 0, action: 'Explore the docks' };
    const submitted = await turns.submit(c.id, request);
    const done = await terminal(c.id, submitted.id);
    assert.equal(done.status, TurnStatus.Completed, done.error ?? '');
    assert.deepEqual(f.counts, { gm: 1, child: 1, editor: 1 });
    assert.equal((await turns.submit(c.id, request)).id, submitted.id);
    const prepared = (
      await db.store.pool.query('SELECT result FROM atlas_preparations WHERE id=$1', [receiptId])
    ).rows[0].result as AtlasPrepared;
    const saved = await db.store.campaign(c.id);
    assert.equal(saved.knowledge![0]!.id, prepared.bindings.places.warehouse);
    assert.equal(saved.atlas!.frames[0]!.id, prepared.bindings.frames.ground);
    const library = new LibraryService(db.store),
      archive = await library.export(c.id);
    const remapped = remapArchive(archive);
    assert.equal(
      remapped.atlasData!.preparations[0]!.result!.bindings.places.warehouse,
      remapped.campaign.knowledge![0]!.id
    );
    const imported = await library.import(archive);
    assert.notEqual(imported.knowledge![0]!.id, saved.knowledge![0]!.id);
    assert.equal(imported.atlas!.places[0]!.placeId, imported.knowledge![0]!.id);
    const undone = await turns.undo(c.id, saved.revision);
    assert.equal(undone.knowledge!.length, 0);
    assert.equal(undone.atlas!.places.length, 0);
    assert.equal(undone.atlas!.frames.length, 0);
    remapArchive(await library.export(c.id));
  }
);

test(
  'failed editor resumes by recompiling original wire once with immutable preparation identities',
  { skip: !dbEnabled },
  async () => {
    const c = await campaign();
    let allowEditor = false,
      receiptId!: string;
    const f = generator(
      async (_s, _p, _sc, _sy, tools) => {
        const result = (await tools('world_map_prepare', args, 'prepare')) as { receiptId: string };
        receiptId = result.receiptId;
        return gmResponse('A warehouse stands by the docks.', [], {
          atlasChanges: { preparedReceiptIds: [receiptId] },
        });
      },
      {
        editor: async (_s, prompt) => {
          if (!allowEditor) throw new Problem(429, 'mock_editor', 'Mock editor unavailable');
          return JSON.parse(/^\{"narrative":.*\}$/m.exec(prompt)![0]!);
        },
      }
    );
    const turns = new TurnService(db.store, f.gen);
    const submitted = await turns.submit(c.id, {
      requestId: randomUUID(),
      revision: 0,
      action: 'Explore docks',
    });
    const pending = await terminal(c.id, submitted.id);
    assert.equal(pending.editingPending, true);
    assert.equal((await db.store.campaign(c.id)).knowledge!.length, 0);
    const reserved = (
      await db.store.pool.query('SELECT result FROM atlas_preparations WHERE id=$1', [receiptId])
    ).rows[0].result as AtlasPrepared;
    allowEditor = true;
    const input = { requestId: randomUUID(), revision: 0 };
    await turns.resumeEditing(c.id, submitted.id, input);
    await turns.resumeEditing(c.id, submitted.id, input);
    const done = await terminal(c.id, submitted.id);
    assert.equal(done.status, TurnStatus.Completed, done.error ?? '');
    assert.deepEqual(f.counts, { gm: 1, child: 1, editor: 2 });
    const saved = await db.store.campaign(c.id);
    assert.equal(saved.knowledge!.length, 1);
    assert.equal(saved.knowledge![0]!.id, reserved.bindings.places.warehouse);
    assert.equal(saved.atlas!.frames[0]!.id, reserved.bindings.frames.ground);
    assert.equal(
      (await db.store.pool.query('SELECT count(*) FROM snapshots WHERE campaign_id=$1', [c.id]))
        .rows[0].count,
      '1'
    );
  }
);

test(
  'explicit gameplay retry reuses a ready cartographer receipt without another child call',
  { skip: !dbEnabled },
  async () => {
    const c = await campaign();
    let first = true;
    const f = generator(async (_s, _p, _sc, _sy, tools) => {
      const result = (await tools('world_map_prepare', args, 'prepare')) as { receiptId: string };
      if (first) throw new Problem(502, 'mock_gm', 'Mock GM failed after preparation');
      return gmResponse('The warehouse is ready.', [], {
        atlasChanges: { preparedReceiptIds: [result.receiptId] },
      });
    });
    const turns = new TurnService(db.store, f.gen);
    const initial = await turns.submit(c.id, {
      requestId: randomUUID(),
      revision: 0,
      action: 'Explore docks',
    });
    assert.equal((await terminal(c.id, initial.id)).status, TurnStatus.Failed);
    first = false;
    const retry = await turns.retry(c.id, initial.id, { requestId: randomUUID(), revision: 0 });
    const done = await terminal(c.id, retry.id);
    assert.equal(done.status, TurnStatus.Completed, done.error ?? '');
    assert.equal(f.counts.child, 1);
    assert.equal((await db.store.campaign(c.id)).knowledge!.length, 1);
  }
);

test(
  'late cancelled cartographer completion cannot publish a ready receipt or campaign geography',
  { skip: !dbEnabled },
  async () => {
    const c = await campaign();
    let finish!: (value: unknown) => void, entered!: () => void;
    let signal: AbortSignal | undefined;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const f = generator(
      async (_s, _p, _sc, _sy, tools) => {
        await tools('world_map_prepare', args, 'prepare');
        return gmResponse('No geography committed.', []);
      },
      {
        child: async (_s, _p, _sc, abort) => {
          signal = abort;
          entered();
          return new Promise((resolve) => {
            finish = resolve;
          });
        },
      }
    );
    const turns = new TurnService(db.store, f.gen);
    const submitted = await turns.submit(c.id, {
      requestId: randomUUID(),
      revision: 0,
      action: 'Explore docks',
    });
    await started;
    await turns.cancel(c.id, submitted.id);
    assert.equal(signal!.aborted, true);
    finish(draft());
    for (let i = 0; i < 100; i++) {
      const row = await db.store.pool.query(
        'SELECT status FROM atlas_preparations WHERE turn_id=$1',
        [submitted.id]
      );
      if (row.rows[0]!.status !== 'running') break;
      await delay(20);
    }
    const row = (
      await db.store.pool.query('SELECT status,result FROM atlas_preparations WHERE turn_id=$1', [
        submitted.id,
      ])
    ).rows[0];
    assert.notEqual(row.status, 'ready');
    assert.equal(row.result, null);
    assert.equal((await db.store.campaign(c.id)).knowledge!.length, 0);
  }
);
