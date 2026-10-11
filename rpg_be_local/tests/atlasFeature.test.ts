import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { newCampaign } from '../src/domain/campaign.js';
import { buildContext } from '../src/domain/context.js';
import { freezeAtlas } from '../src/domain/atlasRecall.js';
import {
  gameplayResponseInputSchema,
  gameplayResponseSchema,
} from '../src/domain/gameplayResponse.js';
import { atkas_Feature, assertAtlasSessionEnabled } from '../src/domain/features.js';
import { ownedTools, emptyResponse } from './ownedGameplayFixture.js';

test('disabled Atlas leaves no context, policy, frozen map or output-schema branch', () => {
  assert.equal(atkas_Feature, 'disabled');
  const campaign = newCampaign({ name: 'Disabled map' });
  const before = structuredClone(campaign.atlas);
  const context = buildContext(campaign, [], 'Return home and speak to Aldis', []);
  const payload = JSON.parse(context.prompt);
  assert.equal(Object.hasOwn(payload.mandatory, 'atlas'), false);
  assert.equal(context.frozenAtlas, undefined);
  assert.equal(Object.hasOwn(payload.mandatory.schema.properties, 'atlasChanges'), false);
  assert.doesNotMatch(context.systemPrompt!, /Atlas policy|world_map_/);
  assert.deepEqual(campaign.atlas, before);
});

test('disabled Atlas tools cannot be exposed or dispatched from supplied frozen maps', async () => {
  const registry = ownedTools({
    atlas: freezeAtlas(newCampaign({ name: 'Old map session' })),
    prepareAtlas: async () => {
      throw new Error('Must not call cartographer');
    },
  });
  assert.equal(
    registry.definitions.some((tool) => tool.name.startsWith('world_map_')),
    false
  );
  await assert.rejects(registry.call('world_map_get', {}, 'disabled'), {
    code: 'gameplay_tool_invalid',
  });
});

test('live input rejects Atlas mutations while the historical schema stays compatible', () => {
  const response = { ...emptyResponse, atlasChanges: {} };
  assert.equal(gameplayResponseSchema.safeParse(response).success, true);
  assert.equal(gameplayResponseInputSchema.safeParse(response).success, false);
});

test('old Atlas sessions require a new action before generation or editing can resume', () => {
  assert.throws(() => assertAtlasSessionEnabled({ frozen_atlas: {} }), {
    code: 'feature_disabled',
  });
  assert.throws(
    () => assertAtlasSessionEnabled({ tool_definitions: [{ name: 'world_map_get' }] }),
    { code: 'feature_disabled' }
  );
  assert.doesNotThrow(() =>
    assertAtlasSessionEnabled({ tool_definitions: [{ name: 'roll_dice' }] })
  );
});

test('settings and every Atlas HTTP operation are disabled before database/upload work', async () => {
  const { app } = createApp({ store: null });
  const settings = await request(app).get('/api/settings').set('Host', 'localhost:4100');
  assert.equal(settings.status, 200);
  assert.equal(Object.hasOwn(settings.body.data, 'atlas'), false);
  for (const [method, path] of [
    ['get', ''],
    ['post', '/changes'],
    ['get', '/imports'],
    ['post', '/imports'],
    ['get', '/imports/job'],
    ['post', '/imports/job/cancel'],
    ['post', '/imports/job/accept'],
    ['get', '/images/asset'],
  ] as const) {
    const response = await request(app)
      [method](`/api/campaigns/example/atlas${path}`)
      .set('Host', 'localhost:4100')
      .set('X-RPG-Client', 'local-rpg')
      .set('Content-Type', 'application/json');
    assert.equal(response.status, 409, `${method} ${path}`);
    assert.equal(response.body.code, 'feature_disabled');
  }
});
