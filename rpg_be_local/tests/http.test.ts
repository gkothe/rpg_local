import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { googleDocumentId, textSource } from '../src/services/sources.js';
import { databaseUrl } from '../src/config.js';
import {
  ARCHIVE_FORMAT_VERSION,
  ENABLED_GAMEPLAY_RESPONSE_SCHEMA_VERSION,
} from '../src/domain/versions.js';

test('HTTP boundary serves backend-owned capabilities, rejects foreign Host/Origin and unsolicited writes', async () => {
  const { app } = createApp({ store: null });
  const options = await request(app).get('/api/settings').set('Host', 'localhost:4100').expect(200);
  assert.equal(options.body.data.defaults.characterType, 'player');
  assert.equal(options.body.data.dice.enabled, true);
  assert.equal(options.body.data.dice.limits.requestsPerAttempt, 24);
  const gameplay = options.body.data.gameplay;
  assert.equal(gameplay.responseVersion, ENABLED_GAMEPLAY_RESPONSE_SCHEMA_VERSION);
  assert.equal(gameplay.archiveVersion, ARCHIVE_FORMAT_VERSION);
  assert.equal(options.body.data.combat.enabled, ENABLED_GAMEPLAY_RESPONSE_SCHEMA_VERSION === 6);
  assert.deepEqual(
    options.body.data.combat.fieldKindOptions.map((o: { id: string }) => o.id),
    ['vitality', 'damage', 'condition', 'resource']
  );
  assert.deepEqual(
    options.body.data.combat.rollScopeOptions.map((o: { id: string }) => o.id),
    ['combat', 'character', 'oracle']
  );
  assert.deepEqual(
    options.body.data.combat.rollKindOptions.map((o: { id: string }) => o.id),
    ['attack', 'defense', 'resistance', 'awareness', 'resource', 'other']
  );
  assert.equal(options.body.data.combat.trackingVersion, 1);
  assert.equal(
    options.body.data.turnStatusOptions.find((o: { id: string }) => o.id === 'running').active,
    true
  );
  assert.equal(
    options.body.data.turnStatusOptions.find((o: { id: string }) => o.id === 'completed').terminal,
    true
  );
  await request(app).get('/api/settings').set('Host', 'evil.example:4100').expect(403);
  await request(app)
    .post('/api/campaigns')
    .set('Host', 'localhost:4100')
    .send({ name: 'x' })
    .expect(403);
  await request(app)
    .post('/api/campaigns')
    .set('Host', 'localhost:4100')
    .set('X-RPG-Client', 'local-rpg')
    .set('Origin', 'https://evil.example')
    .send({ name: 'x' })
    .expect(403);
  const blocked = await request(app)
    .post('/api/campaigns')
    .set('Host', 'localhost:4100')
    .set('X-RPG-Client', 'local-rpg')
    .send({ name: 'x' })
    .expect(503);
  assert.equal(blocked.body.code, 'database_setup');
});
test('restricted public source URLs and test database isolation reject unsafe inputs', () => {
  assert.equal(
    googleDocumentId('https://docs.google.com/document/d/abcdefghij/edit'),
    'abcdefghij'
  );
  for (const url of [
    'http://docs.google.com/document/d/abcdefghij',
    'https://127.0.0.1/document/d/abcdefghij',
    'https://docs.google.com.evil.example/document/d/abcdefghij',
    'https://docs.google.com:444/document/d/abcdefghij',
  ])
    assert.throws(() => googleDocumentId(url));
  assert.equal(textSource('Rules', 'Corrected rules').status, 'confirmed');
  assert.throws(() => textSource('Empty', '   '));
  assert.throws(
    () =>
      databaseUrl({
        NODE_ENV: 'test',
        RPG_DATABASE_URL: 'postgresql://user@127.0.0.1/game',
        RPG_TEST_DATABASE_URL: 'postgresql://user@127.0.0.1/game',
      }),
    /distinct/
  );
  assert.throws(
    () => databaseUrl({ RPG_DATABASE_URL: 'postgresql://user@remote.example/game' }),
    /loopback/
  );
});
