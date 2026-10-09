import { NPC_PREPARATION_LIMITS } from '../src/domain/npcPreparation.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { googleDocumentId, textSource } from '../src/services/sources.js';
import { databaseUrl } from '../src/config.js';
import { characterPatchSchema } from '../src/domain/schemas.js';
import { newCampaign } from '../src/domain/campaign.js';
import { randomUUID } from 'node:crypto';
import type { Store } from '../src/store.js';

test('character PATCH preserves fields omitted by section and item saves', async () => {
  const campaign = newCampaign({ name: 'Sheet preservation' });
  const character = {
    id: randomUUID(),
    name: 'Example',
    type: 'player' as const,
    revision: 0,
    attributes: { health: 8 },
    inventory: { sword: { name: 'Sword' } },
    description: { appearance: 'Traveler' },
    notes: 'Private notes',
  };
  campaign.characters.push(character);
  const store = {
    edit: async (_id: string, _revision: number, edit: (c: typeof campaign) => void) => {
      edit(campaign);
      return campaign;
    },
  } as unknown as Store;
  const { app } = createApp({ store });
  const headers = { Host: 'localhost:4100', 'X-RPG-Client': 'local-rpg' };
  for (const patch of [
    { inventory: {} },
    { attributes: { health: 9 } },
    { description: {} },
    { name: 'Renamed' },
    { notes: '' },
  ]) {
    const before = structuredClone(character);
    const response = await request(app)
      .patch(`/api/campaigns/${campaign.id}/characters/${character.id}`)
      .set(headers)
      .send({ revision: 0, ...patch })
      .expect(200);
    const saved = response.body.data.characters[0];
    for (const field of ['attributes', 'inventory', 'description', 'name', 'notes'] as const)
      assert.deepEqual(
        saved[field],
        field in patch ? patch[field as keyof typeof patch] : before[field],
        field
      );
  }
  assert.deepEqual(characterPatchSchema.parse({ revision: 0, inventory: {} }), {
    revision: 0,
    inventory: {},
  });
  assert.throws(() => characterPatchSchema.parse({ revision: 0, type: 'npc' }));
});

test('HTTP boundary serves backend-owned capabilities, rejects foreign Host/Origin and unsolicited writes', async () => {
  const { app } = createApp({ store: null });
  const options = await request(app).get('/api/settings').set('Host', 'localhost:4100').expect(200);
  assert.equal(options.body.data.defaults.characterType, 'player');
  assert.equal(options.body.data.dice.enabled, true);
  assert.deepEqual(options.body.data.npc.preparation, {
    enabled: true,
    limits: NPC_PREPARATION_LIMITS,
  });
  assert.equal(options.body.data.dice.limits.requestsPerAttempt, 24);
  for (const retired of ['version', 'gameplay'])
    assert.equal(retired in options.body.data, false, retired);
  for (const retired of ['enabled', 'trackingVersion'])
    assert.equal(retired in options.body.data.combat, false, retired);
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
