import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Store } from '../src/store.js';
import { appRoot, databaseUrl } from '../src/config.js';
import { RuleStore, ruleContent, ruleContext } from '../src/services/ruleStore.js';
import { RuleLibrary } from '../src/services/ruleLibrary.js';
import { RulePreview } from '../src/services/rulePreview.js';
import { RuleBackup } from '../src/services/ruleBackup.js';
import { generateRuleMapping } from '../src/domain/ruleMapping.js';
import { buildContext } from '../src/domain/context.js';
import { newCampaign } from '../src/domain/campaign.js';
import { DEFAULT_RULE_SYSTEM_ID, RuleSystemKind, serializedBytes } from '../src/domain/rules.js';
import {
  SHEET_WIDGET_OPTIONS,
  SHEET_LAYOUT_LIMITS,
  EMPTY_SHEET_LAYOUT,
  sheetLayoutSchema,
} from '../src/domain/sheetLayout.js';

const enabled = process.env.NODE_ENV === 'test' && !!process.env.RPG_TEST_DATABASE_URL;
const schema = `sheet_layouts_${randomUUID().replaceAll('-', '')}`;
const headers = { Host: 'localhost:4100', 'X-RPG-Client': 'local-rpg' };
const vtm = sheetLayoutSchema.parse({
  fields: [
    { path: ['attributes', 'skills'], widget: 'dots', max: 5, label: 'Skills' },
    {
      path: ['attributes', 'health', 'current'],
      widget: 'track',
      maxPath: ['attributes', 'health', 'max'],
    },
  ],
});
let store: Store;
const key = () => `sheet-${randomUUID().slice(0, 8)}`;
before(async () => {
  if (!enabled) return;
  const setup = new Store();
  await setup.pool.query(`CREATE SCHEMA ${schema}`);
  await setup.close();
  const url = new URL(databaseUrl());
  url.searchParams.set('options', `-c search_path=${schema}`);
  store = new Store(url.toString());
  for (const name of (await readdir(path.join(appRoot, 'migrationssql')))
    .filter((name) => name.endsWith('.sql'))
    .sort())
    await store.pool.query(await readFile(path.join(appRoot, 'migrationssql', name), 'utf8'));
});
after(async () => {
  if (!enabled) return;
  await store.pool.query(`DROP SCHEMA ${schema} CASCADE`);
  await store.close();
});
const previews = () => new RulePreview(path.join(os.tmpdir(), `sheet-layouts-${randomUUID()}`));
const library = () => new RuleLibrary(new RuleStore(store), previews());
const head = async (id: string) =>
  (
    await store.pool.query(
      'SELECT revision,content_hash,updated_at FROM rule_systems WHERE id=$1',
      [id]
    )
  ).rows[0];

test('migration defaults every rule system to an empty layout', { skip: !enabled }, async () => {
  const rules = new RuleStore(store);
  assert.deepEqual(await rules.sheetLayout(DEFAULT_RULE_SYSTEM_ID), {
    sheetLayout: EMPTY_SHEET_LAYOUT,
    sheetLayoutUpdatedAt: null,
  });
  const created = await rules.create(key(), 'Fresh');
  assert.deepEqual((await rules.sheetLayout(created.systemId)).sheetLayout, EMPTY_SHEET_LAYOUT);
});

test(
  'setSheetLayout leaves revision, hash and updated_at unchanged',
  { skip: !enabled },
  async () => {
    const rules = new RuleStore(store);
    const created = await rules.create(key(), 'Stable');
    const before = await head(created.systemId);
    const started = Date.now();
    const saved = await store.transaction((client) =>
      rules.setSheetLayout(created.systemId, vtm, client)
    );
    console.log(`sheet layout save took ${Date.now() - started} ms`);
    assert.ok(saved.sheetLayoutUpdatedAt);
    assert.deepEqual(await head(created.systemId), before);
    assert.deepEqual(await rules.sheetLayout(created.systemId), saved);
    await assert.rejects(rules.sheetLayout(randomUUID()), /not found/);
  }
);

test('library saves are idempotent per requestId and body', { skip: !enabled }, async () => {
  const lib = library();
  const created = await lib.rules.create(key(), 'Idempotent');
  const requestId = randomUUID();
  const first = await lib.sheetLayout(created.systemId, requestId, vtm);
  const stamp = (await lib.rules.sheetLayout(created.systemId)).sheetLayoutUpdatedAt;
  assert.deepEqual(await lib.sheetLayout(created.systemId, requestId, vtm), first);
  assert.equal((await lib.rules.sheetLayout(created.systemId)).sheetLayoutUpdatedAt, stamp);
  await assert.rejects(
    lib.sheetLayout(created.systemId, requestId, EMPTY_SHEET_LAYOUT),
    /changed input/
  );
  assert.deepEqual((await lib.rules.sheetLayout(created.systemId)).sheetLayout, vtm);
  await assert.rejects(lib.sheetLayout(randomUUID(), randomUUID(), vtm), /not found/);
});

test('metadata serves the layout, widget options and limits', { skip: !enabled }, async () => {
  const lib = library();
  const created = await lib.rules.create(key(), 'Metadata');
  await lib.sheetLayout(created.systemId, randomUUID(), vtm);
  const metadata = await lib.metadata(created.systemId);
  assert.deepEqual(metadata.sheetLayout, vtm);
  assert.ok(metadata.sheetLayoutUpdatedAt);
  assert.deepEqual(
    metadata.sheetLayoutOptions.widgets.map((widget) => widget.id),
    [
      'number',
      'dots',
      'checks',
      'track',
      'percentile',
      'score',
      'tags',
      'items',
      'prose',
      'facts',
      'hidden',
    ]
  );
  assert.deepEqual(metadata.sheetLayoutOptions.widgets, SHEET_WIDGET_OPTIONS);
  assert.deepEqual(metadata.sheetLayoutOptions.limits, {
    fields: SHEET_LAYOUT_LIMITS.fields,
    bytes: SHEET_LAYOUT_LIMITS.bytes,
    labelChars: SHEET_LAYOUT_LIMITS.labelChars,
    pathSegments: SHEET_LAYOUT_LIMITS.pathSegments,
  });
});

test('PUT route validates, stores and serves layouts', { skip: !enabled }, async () => {
  const { app } = createApp({ store });
  const created = await request(app)
    .post('/api/rule-systems')
    .set(headers)
    .send({ systemKey: key(), name: 'HTTP layout' })
    .expect(201);
  const id = created.body.data.systemId as string;
  const url = `/api/rule-systems/${id}/sheet-layout`;
  const put = (body: unknown) =>
    request(app)
      .put(url)
      .set(headers)
      .send(body as object);
  await request(app)
    .put(url)
    .set('Host', 'localhost:4100')
    .send({ requestId: randomUUID(), sheetLayout: vtm })
    .expect(403);
  const saved = await put({ requestId: randomUUID(), sheetLayout: vtm }).expect(200);
  assert.deepEqual(saved.body.data.sheetLayout, vtm);
  const read = await request(app)
    .get(`/api/rule-systems/${id}`)
    .set('Host', 'localhost:4100')
    .expect(200);
  assert.deepEqual(read.body.data.sheetLayout, vtm);
  assert.equal(read.body.data.revision, created.body.data.revision);
  assert.equal(read.body.data.contentHash, created.body.data.contentHash);

  const invalid = await put({
    requestId: randomUUID(),
    sheetLayout: { fields: [{ path: ['attributes', 'a'], widget: 'dots' }] },
  }).expect(422);
  assert.equal(invalid.body.code, 'sheet_layout_invalid');
  assert.match(invalid.body.detail, /sheetLayout\.fields\.0\.max/);
  assert.equal(
    (await put({ requestId: 'nope', sheetLayout: vtm }).expect(422)).body.code,
    'validation'
  );
  assert.equal(
    (await put({ requestId: randomUUID(), sheetLayout: vtm, other: 1 }).expect(422)).body.code,
    'validation'
  );
  await request(app)
    .put(`/api/rule-systems/${randomUUID()}/sheet-layout`)
    .set(headers)
    .send({ requestId: randomUUID(), sheetLayout: vtm })
    .expect(404);
  const stored = await request(app)
    .get(`/api/rule-systems/${id}`)
    .set('Host', 'localhost:4100')
    .expect(200);
  assert.deepEqual(stored.body.data.sheetLayout, vtm);

  const forDefault = await request(app)
    .put(`/api/rule-systems/${DEFAULT_RULE_SYSTEM_ID}/sheet-layout`)
    .set(headers)
    .send({ requestId: randomUUID(), sheetLayout: vtm })
    .expect(200);
  assert.deepEqual(forDefault.body.data.sheetLayout, vtm);
  await store.pool.query(
    'UPDATE rule_systems SET sheet_layout=\'{"fields":[]}\',sheet_layout_updated_at=NULL WHERE id=$1',
    [DEFAULT_RULE_SYSTEM_ID]
  );
});

test('the layout never enters rule content or the GM context', { skip: !enabled }, async () => {
  const lib = library();
  const created = await lib.rules.create(key(), 'Display only');
  const campaign = newCampaign({ name: 'Context fixture', systemId: created.systemId });
  const snapshot = async () => {
    const system = await lib.rules.get(created.systemId);
    const prompt = {
      context: ruleContext(system),
      instructions: system.instructions,
      overview: system.kind === RuleSystemKind.Library ? generateRuleMapping(system).overview : '',
    };
    return {
      system,
      bytes: serializedBytes(ruleContent(system)),
      prompt: JSON.stringify(buildContext(campaign, [], 'Look around', [], prompt)),
    };
  };
  const before = await snapshot();
  await lib.sheetLayout(created.systemId, randomUUID(), vtm);
  const after = await snapshot();
  assert.equal(Object.hasOwn(after.system, 'sheetLayout'), false);
  assert.equal(Object.hasOwn(ruleContent(after.system), 'sheetLayout'), false);
  assert.equal(after.bytes, before.bytes);
  assert.equal(after.system.contentHash, before.system.contentHash);
  assert.equal(after.system.revision, before.system.revision);
  assert.equal(after.prompt, before.prompt);
});

test('backups carry the layout and older backups still import', { skip: !enabled }, async () => {
  const lib = library();
  const backups = new RuleBackup(lib.rules, lib.previews);
  const created = await lib.rules.create(key(), 'Backup source');
  await lib.sheetLayout(created.systemId, randomUUID(), vtm);
  const backup = await backups.export(created.systemId);
  assert.deepEqual(backup.system.sheetLayout, vtm);
  const copyTo = (systemKey: string, sheetLayout?: unknown) => {
    const { sheetLayout: _omitted, ...system } = backup.system;
    void _omitted;
    return Buffer.from(
      JSON.stringify({
        ...backup,
        system: { ...system, systemKey, ...(sheetLayout ? { sheetLayout } : {}) },
      })
    );
  };
  const restore = async (bytes: Buffer, replace: boolean) =>
    backups.confirm({
      ...(await backups.preview(bytes)),
      requestId: randomUUID(),
      replace,
    });
  const layoutOf = async (id: string) => (await lib.rules.sheetLayout(id)).sheetLayout;

  const restoredKey = key();
  const restored = await restore(copyTo(restoredKey, vtm), false);
  assert.deepEqual(await layoutOf(restored.systemId), vtm);

  const legacy = await restore(copyTo(key()), false);
  assert.deepEqual(await layoutOf(legacy.systemId), EMPTY_SHEET_LAYOUT);

  const withoutField = await backups.preview(copyTo(restoredKey));
  assert.equal(
    withoutField.warnings.some((warning) => /sheet layout/.test(warning)),
    false
  );
  await backups.confirm({ ...withoutField, requestId: randomUUID(), replace: true });
  assert.deepEqual(await layoutOf(restored.systemId), vtm);

  const different = sheetLayoutSchema.parse({
    fields: [{ path: ['attributes', 'x'], widget: 'number' }],
  });
  const changed = await backups.preview(copyTo(restoredKey, different));
  assert.ok(changed.warnings.some((warning) => /sheet layout/.test(warning)));
  await backups.confirm({ ...changed, requestId: randomUUID(), replace: true });
  assert.deepEqual(await layoutOf(restored.systemId), different);

  await assert.rejects(
    backups.preview(copyTo(key(), { fields: [{ path: ['attributes', 'a'], widget: 'dots' }] })),
    /max/
  );
});
