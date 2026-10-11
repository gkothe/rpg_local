import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Store } from '../src/store.js';
import { databaseUrl, appRoot } from '../src/config.js';
import { newCampaign } from '../src/domain/campaign.js';
import { NpcSheetCompletionService } from '../src/services/npcSheetCompletion.js';
import { NpcSheetCompletionAction as Action } from '../src/domain/npcSheetCompletion.js';
import type { Generator } from '../src/providers/service.js';
import { CharacterType } from '../src/domain/options.js';

const enabled = process.env.NODE_ENV === 'test' && !!process.env.RPG_TEST_DATABASE_URL;
const schema = `npc_sheet_${randomUUID().replaceAll('-', '')}`;
let store: Store;
before(async () => {
  if (!enabled) return;
  const boot = new Store();
  await boot.pool.query(`CREATE SCHEMA ${schema}`);
  await boot.close();
  const url = new URL(databaseUrl());
  url.searchParams.set('options', `-c search_path=${schema}`);
  store = new Store(url.toString());
  for (const file of (await readdir(path.join(appRoot, 'migrationssql')))
    .filter((f) => f.endsWith('.sql'))
    .sort())
    await store.pool.query(await readFile(path.join(appRoot, 'migrationssql', file), 'utf8'));
});
after(async () => {
  if (enabled) {
    await store.pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await store.close();
  }
});
const requirements = {
  version: 1,
  systemName: 'Synthetic skill game',
  edition: '1',
  category: 'Mortal',
  basis: 'model_knowledge',
  citations: [],
  applicability: ['No supernatural powers'],
  fields: [
    {
      path: ['attributes', 'skills', 'Athletics'],
      type: 'number',
      min: 0,
      max: 5,
      reason: 'Required skill catalog',
    },
    {
      path: ['attributes', 'skills', 'Lore'],
      type: 'number',
      min: 0,
      max: 5,
      reason: 'Required skill catalog',
    },
    { path: ['attributes', 'health'], type: 'number', min: 1, reason: 'Required health' },
  ],
};
function generator(generateSheet?: Generator['generate']): Generator {
  return {
    capacity: async () => 16000,
    generate: async (...args) =>
      JSON.parse(args[1]).task.startsWith('Establish the COMPLETE')
        ? { action: 'finish', requirements }
        : generateSheet
          ? generateSheet(...args)
          : {
              attributes: { skills: { Athletics: 0, Lore: 2 }, health: 8 },
              inventory: {},
              rationales: requirements.fields.map((f) => ({ path: f.path, reason: f.reason })),
              conflicts: [],
            },
  };
}
async function setup(gen = generator()) {
  const c = newCampaign({ name: 'Sheet fixture', description: 'Synthetic skill game edition 1' });
  const id = randomUUID();
  c.characters.push({
    id,
    name: 'Keeper',
    type: CharacterType.Npc,
    attributes: { skills: { Athletics: 0 } },
    inventory: {},
    description: { role: 'PRIVATE_PROFILE_CANARY' },
    notes: 'PRIVATE_NOTES_CANARY',
    revision: 0,
  });
  await store.insert(c);
  return { c, id, service: new NpcSheetCompletionService(store, gen) };
}
async function finish(
  service: NpcSheetCompletionService,
  campaignId: string,
  characterId: string,
  jobId: string
) {
  for (let n = 0; n < 150; n++) {
    const job = (await service.get(campaignId, characterId, jobId))!;
    if (!job.active) return job;
    await delay(10);
  }
  throw Error('Synthetic job did not finish');
}
test(
  'completion stages a complete independent skill catalog; Apply is explicit, scoped and idempotent',
  { skip: !enabled },
  async () => {
    const { c, id, service } = await setup();
    const request = { requestId: randomUUID() };
    const started = await service.start(c.id, id, request);
    assert.equal((await service.start(c.id, id, request)).id, started.id);
    await assert.rejects(service.start(c.id, randomUUID(), request), /identity/);
    const ready = await finish(service, c.id, id, started.id);
    assert.equal(ready.status, 'ready', ready.error ?? '');
    assert.ok(!JSON.stringify(ready).includes('PRIVATE_'));
    assert.equal(ready.additions.length, 2);
    assert.deepEqual((await store.campaign(c.id)).characters[0]!.attributes, {
      skills: { Athletics: 0 },
    });
    await assert.rejects(service.get(randomUUID(), id, started.id), /not found/);
    // An unrelated campaign/notes update must not block additions.
    await store.transaction(async (client) => {
      const current = await store.campaign(c.id, client, true);
      current.state = { elsewhere: 'changed' };
      current.characters[0]!.notes = 'User draft notes';
      current.revision++;
      await store.save(current, client);
    });
    const apply = { requestId: randomUUID(), decision: 'apply' };
    const applied = await service.decide(c.id, id, started.id, apply);
    assert.equal(applied.status, 'applied');
    assert.deepEqual(await service.decide(c.id, id, started.id, apply), applied);
    const saved = (await store.campaign(c.id)).characters[0]!;
    assert.deepEqual(saved.attributes, { skills: { Athletics: 0, Lore: 2 }, health: 8 });
    assert.equal(saved.notes, 'User draft notes');
  }
);
test(
  'changed established fields reject Apply and discard leaves them unchanged',
  { skip: !enabled },
  async () => {
    const { c, id, service } = await setup();
    const job = await service.start(c.id, id, { requestId: randomUUID() });
    await finish(service, c.id, id, job.id);
    await store.transaction(async (client) => {
      const current = await store.campaign(c.id, client, true);
      current.characters[0]!.attributes = { skills: { Athletics: 4 } };
      await store.save(current, client);
    });
    await assert.rejects(
      service.decide(c.id, id, job.id, { requestId: randomUUID(), decision: 'apply' }),
      /fields changed/
    );
    await service.decide(c.id, id, job.id, { requestId: randomUUID(), decision: 'discard' });
    assert.deepEqual((await store.campaign(c.id)).characters[0]!.attributes, {
      skills: { Athletics: 4 },
    });
  }
);

test(
  'expired completion ownership recovers as interrupted and late results remain unpublished',
  { skip: !enabled },
  async () => {
    let release!: () => void;
    let entered = false;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { c, id, service } = await setup(
      generator(async () => {
        entered = true;
        await gate;
        return {
          attributes: { skills: { Athletics: 0, Lore: 2 }, health: 8 },
          inventory: {},
          rationales: requirements.fields.map((f) => ({ path: f.path, reason: f.reason })),
          conflicts: [],
        };
      })
    );
    const job = await service.start(c.id, id, { requestId: randomUUID() });
    for (let n = 0; n < 300 && !entered; n++) await delay(10);
    assert.ok(entered);
    await store.pool.query(
      "UPDATE npc_sheet_completions SET lease_until=now()-interval '1 second' WHERE id=$1",
      [job.id]
    );
    await store.recover();
    assert.equal((await service.get(c.id, id, job.id))!.status, 'interrupted');
    release();
    await delay(40);
    assert.equal((await service.get(c.id, id, job.id))!.status, 'interrupted');
    assert.deepEqual((await store.campaign(c.id)).characters[0]!.attributes, {
      skills: { Athletics: 0 },
    });
    await store.transaction((client) => store.assertIdle(c.id, client));
  }
);
test(
  'cancellation cannot publish a late response and retry reuses the requirements checkpoint',
  { skip: !enabled },
  async () => {
    let release!: () => void;
    let calls = 0;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { c, id, service } = await setup(
      generator(async () => {
        calls++;
        if (calls === 1) await gate;
        return {
          attributes: { skills: { Athletics: 0, Lore: 2 }, health: 8 },
          inventory: {},
          rationales: requirements.fields.map((f) => ({ path: f.path, reason: f.reason })),
          conflicts: [],
        };
      })
    );
    const job = await service.start(c.id, id, { requestId: randomUUID() });
    for (let n = 0; n < 150 && !calls; n++) await delay(10);
    await assert.rejects(
      store.transaction((client) => store.assertIdle(c.id, client)),
      /sheet completion/
    );
    await service.action(c.id, id, job.id, Action.Cancel);
    assert.equal((await service.get(c.id, id, job.id))!.status, 'cancelled');
    await service.action(c.id, id, job.id, Action.Retry);
    release();
    await delay(40);
    assert.equal((await store.campaign(c.id)).characters[0]!.attributes.health, undefined);
    assert.equal((await finish(service, c.id, id, job.id)).status, 'ready');
  }
);
