import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { newCampaign } from '../src/domain/campaign.js';
import { NPC_SHEET_COMPLETION_OPTIONS } from '../src/domain/npcSheetCompletion.js';
import type { ProviderService } from '../src/providers/service.js';
import { dbEnabled, openIsolatedStore } from './journalFixture.js';
import { setTimeout as delay } from 'node:timers/promises';
let isolated: Awaited<ReturnType<typeof openIsolatedStore>>;
before(async () => {
  if (dbEnabled) isolated = await openIsolatedStore('npc_sheet_http');
});
after(async () => {
  if (dbEnabled) await isolated.close();
});
const headers = { Host: 'localhost:4100', 'X-RPG-Client': 'local-rpg' };
test(
  'HTTP start stages a sheet and an idempotent decision applies only reviewed additions',
  { skip: !dbEnabled },
  async () => {
    const campaign = newCampaign({ name: 'HTTP Apply', description: 'Synthetic game edition 1' });
    const id = randomUUID();
    campaign.characters.push({
      id,
      name: 'Keeper',
      type: 'npc',
      attributes: { hp: 8 },
      inventory: {},
      description: {},
      notes: 'Private notes',
      revision: 0,
    });
    await isolated.store.insert(campaign);
    const providers = {
      capacity: async () => 16000,
      generate: async (_settings: unknown, prompt: string) =>
        JSON.parse(prompt).task.startsWith('Establish the COMPLETE')
          ? {
              action: 'finish',
              requirements: {
                version: 1,
                systemName: 'Synthetic game',
                edition: '1',
                category: 'Mortal',
                basis: 'model_knowledge',
                citations: [],
                applicability: ['Compact block'],
                fields: [
                  { path: ['attributes', 'hp'], type: 'number', min: 1, reason: 'Vitality' },
                  {
                    path: ['attributes', 'skills', 'Lore'],
                    type: 'number',
                    min: 0,
                    max: 5,
                    reason: 'Skill catalog',
                  },
                ],
              },
            }
          : {
              attributes: { hp: 8, skills: { Lore: 0 } },
              inventory: {},
              rationales: [
                { path: ['attributes', 'hp'], reason: 'Established' },
                { path: ['attributes', 'skills', 'Lore'], reason: 'Untrained' },
              ],
              conflicts: [],
            },
    };
    const app = createApp({
      store: isolated.store,
      providers: providers as unknown as ProviderService,
    }).app;
    const base = `/api/campaigns/${campaign.id}/characters/${id}/sheet-completions`;
    const body = { requestId: randomUUID() };
    const started = await request(app).post(base).set(headers).send(body).expect(202);
    const jobId = started.body.data.id;
    assert.equal(
      (await request(app).post(base).set(headers).send(body).expect(202)).body.data.id,
      jobId
    );
    let ready;
    for (let n = 0; n < 300; n++) {
      ready = (await request(app).get(`${base}/${jobId}`).set(headers).expect(200)).body.data;
      if (!ready.active) break;
      await delay(10);
    }
    assert.equal(ready.status, 'ready', ready.error ?? '');
    assert.ok(!JSON.stringify(ready).includes('Private notes'));
    assert.deepEqual((await isolated.store.campaign(campaign.id)).characters[0]!.attributes, {
      hp: 8,
    });
    const decision = { requestId: randomUUID(), decision: 'apply' };
    const applied = await request(app)
      .post(`${base}/${jobId}/decisions`)
      .set(headers)
      .send(decision)
      .expect(200);
    assert.deepEqual(
      (
        await request(app)
          .post(`${base}/${jobId}/decisions`)
          .set(headers)
          .send(decision)
          .expect(200)
      ).body,
      applied.body
    );
    assert.deepEqual((await isolated.store.campaign(campaign.id)).characters[0]!.attributes, {
      hp: 8,
      skills: { Lore: 0 },
    });
  }
);
test(
  'HTTP completion validates scope and UUIDs and advertises backend options before inference',
  { skip: !dbEnabled },
  async () => {
    const campaign = newCampaign({ name: 'HTTP fixture' });
    const id = randomUUID();
    campaign.characters.push({
      id,
      name: 'Keeper',
      type: 'npc',
      attributes: {},
      inventory: {},
      description: {},
      notes: '',
      revision: 0,
    });
    await isolated.store.insert(campaign);
    let calls = 0;
    const app = createApp({
      store: isolated.store,
      providers: {
        generate: async () => {
          calls++;
          throw Error('Unexpected inference');
        },
      } as unknown as ProviderService,
    }).app;
    const settings = await request(app).get('/api/settings').set(headers).expect(200);
    assert.deepEqual(settings.body.data.npcSheetCompletionOptions, NPC_SHEET_COMPLETION_OPTIONS);
    const base = `/api/campaigns/${campaign.id}/characters/${id}/sheet-completions`;
    const empty = await request(app).get(base).set(headers).expect(200);
    assert.equal(empty.body.data, null);
    await request(app).post(base).set(headers).send({ requestId: 'bad' }).expect(422);
    await request(app)
      .post(base)
      .set(headers)
      .send({ requestId: randomUUID(), attributes: {} })
      .expect(422);
    await request(app).get(`${base}/${randomUUID()}`).set(headers).expect(404);
    await request(app).get(base.replace(id, randomUUID())).set(headers).expect(404);
    assert.equal(calls, 0);
  }
);
