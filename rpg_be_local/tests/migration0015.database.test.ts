import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { Store } from '../src/store.js';
import { appRoot, databaseUrl } from '../src/config.js';
import { newCampaign } from '../src/domain/campaign.js';
import { TurnStatus } from '../src/domain/options.js';
import type { JsonObject } from '../src/domain/types.js';

const enabled = process.env.NODE_ENV === 'test' && !!process.env.RPG_TEST_DATABASE_URL;
const schema = `migration_0015_${randomUUID().replaceAll('-', '')}`;
const MIGRATION = '0015_remove_contract_versions.sql';
let store: Store;
const migration = () => readFile(path.join(appRoot, 'migrationssql', MIGRATION), 'utf8');

before(async () => {
  if (!enabled) return;
  const setup = new Store();
  await setup.pool.query(`CREATE SCHEMA ${schema}`);
  await setup.close();
  const url = new URL(databaseUrl());
  url.searchParams.set('options', `-c search_path=${schema}`);
  store = new Store(url.toString());
  for (const file of (await readdir(path.join(appRoot, 'migrationssql')))
    .filter((name) => name.endsWith('.sql') && name < MIGRATION)
    .sort())
    await store.pool.query(await readFile(path.join(appRoot, 'migrationssql', file), 'utf8'));
});
after(async () => {
  if (!enabled) return;
  await store.pool.query(`DROP SCHEMA ${schema} CASCADE`);
  await store.close();
});

async function campaignWith(state: JsonObject) {
  const campaign = newCampaign({ name: 'Upgrade fixture' });
  campaign.state = state;
  await store.insert(campaign);
  return campaign;
}
async function turnFor(campaignId: string, status: string, context: JsonObject | null = null) {
  const id = randomUUID();
  await store.pool.query(
    'INSERT INTO turns(id,campaign_id,request_id,payload_hash,status,document) VALUES($1,$2,$3,$4,$5,$6)',
    [id, campaignId, randomUUID(), 'fixture', status, { id, campaignId, status, context }]
  );
  return id;
}
const read = async (sql: string, values: unknown[]) => (await store.pool.query(sql, values)).rows;
const versionColumns = async () =>
  (
    await read(
      "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='dice_sessions' AND column_name IN ('prompt_contract_version','digest_version')",
      [schema]
    )
  ).length;

test(
  'migration 0015 refuses unfinished turns and note collisions, then moves free-form combat and drops contract columns',
  { skip: !enabled },
  async () => {
    const encounterId = randomUUID();
    const characterId = randomUUID();
    const structured = {
      trackingVersion: 1,
      id: encounterId,
      active: true,
      round: 2,
      participants: [{ characterId, label: 'Guard', trackedFields: [] }],
    };
    const freeForm = await campaignWith({ scene: 'gate', combat: { enemies: ['two raiders'] } });
    const nullCombat = await campaignWith({ scene: 'yard', combat: null });
    const tracked = await campaignWith({ scene: 'hall', combat: structured });
    const quiet = await campaignWith({ scene: 'road' });
    // The latest snapshot afterState equals the campaign state so undo keeps matching.
    const completedTurn = await turnFor(freeForm.id, TurnStatus.Completed, {
      prompt: '{}',
      promptContractVersion: 5,
      digestVersion: 3,
    });
    await store.pool.query('INSERT INTO snapshots(turn_id,campaign_id,document) VALUES($1,$2,$3)', [
      completedTurn,
      freeForm.id,
      {
        turnId: completedTurn,
        beforeState: { scene: 'gate' },
        afterState: freeForm.state,
        beforeCharacters: [],
        afterCharacters: [],
        beforeMemory: null,
      },
    ]);
    const trackedTurn = await turnFor(tracked.id, TurnStatus.Completed);
    await store.pool.query('INSERT INTO snapshots(turn_id,campaign_id,document) VALUES($1,$2,$3)', [
      trackedTurn,
      tracked.id,
      {
        turnId: trackedTurn,
        beforeState: { scene: 'hall' },
        afterState: tracked.state,
        beforeCharacters: [],
        afterCharacters: [],
        beforeMemory: null,
      },
    ]);
    const sessionId = randomUUID();
    await store.pool.query(
      "INSERT INTO dice_sessions(id,campaign_id,root_turn_id,context_digest,frozen_prompt,frozen_revision,character_ids,prompt_contract_version,digest_version,system_prompt,frozen_knowledge,tool_definitions) VALUES($1,$2,$3,$4,'{}',0,'[]',5,3,'Instructions','{}','[]')",
      [sessionId, freeForm.id, completedTurn, 'a'.repeat(64)]
    );

    for (const status of [TurnStatus.Pending, TurnStatus.Running]) {
      const blocking = await turnFor(quiet.id, status);
      await assert.rejects(store.pool.query(await migration()), /Finish or cancel pending turns/);
      await store.pool.query('DELETE FROM turns WHERE id=$1', [blocking]);
    }
    const editing = await turnFor(quiet.id, TurnStatus.Completed);
    await store.pool.query(
      "UPDATE turns SET document=jsonb_set(document,'{editingPending}','true') WHERE id=$1",
      [editing]
    );
    await assert.rejects(store.pool.query(await migration()), /Finish or cancel pending turns/);
    await store.pool.query('DELETE FROM turns WHERE id=$1', [editing]);
    const collision = await campaignWith({ combat: 'Fight', combatNotes: 'Older notes' });
    await assert.rejects(store.pool.query(await migration()), /combatNotes already exists/);
    // A failed migration changes nothing.
    assert.equal(await versionColumns(), 2);
    assert.deepEqual(
      (await read('SELECT document FROM campaigns WHERE id=$1', [freeForm.id]))[0].document.state,
      freeForm.state
    );
    await store.pool.query('DELETE FROM campaigns WHERE id=$1', [collision.id]);

    await store.pool.query(await migration());
    const state = async (id: string) =>
      (await read('SELECT document FROM campaigns WHERE id=$1', [id]))[0].document.state;
    assert.deepEqual(await state(freeForm.id), {
      scene: 'gate',
      combatNotes: { enemies: ['two raiders'] },
    });
    assert.deepEqual(await state(nullCombat.id), { scene: 'yard', combatNotes: null });
    const unversioned: Record<string, unknown> = { ...structured };
    delete unversioned.trackingVersion;
    assert.deepEqual(await state(tracked.id), { scene: 'hall', combat: unversioned });
    assert.deepEqual(await state(quiet.id), { scene: 'road' });
    const snapshot = async (turnId: string) =>
      (await read('SELECT document FROM snapshots WHERE turn_id=$1', [turnId]))[0].document;
    assert.deepEqual((await snapshot(completedTurn)).afterState, await state(freeForm.id));
    assert.deepEqual((await snapshot(completedTurn)).beforeState, { scene: 'gate' });
    assert.deepEqual((await snapshot(trackedTurn)).afterState, await state(tracked.id));
    assert.deepEqual(
      (await read('SELECT document FROM turns WHERE id=$1', [completedTurn]))[0].document.context,
      { prompt: '{}' }
    );
    assert.equal(await versionColumns(), 0);
    assert.equal((await read('SELECT id FROM dice_sessions WHERE id=$1', [sessionId])).length, 1);
    await assert.rejects(
      store.pool.query("UPDATE dice_sessions SET frozen_prompt='changed' WHERE id=$1", [sessionId]),
      /immutable/
    );
    await assert.rejects(
      store.pool.query('DELETE FROM dice_sessions WHERE id=$1', [sessionId]),
      /retained/
    );
  }
);
