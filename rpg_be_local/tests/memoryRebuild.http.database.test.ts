import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { Store } from '../src/store.js';
import { createApp } from '../src/app.js';
import type { ProviderService } from '../src/providers/service.js';
import { KnowledgeVisibility as V } from '../src/domain/knowledge.js';
import { MEMORY_REBUILD_STATUS_OPTIONS } from '../src/domain/memoryRebuild.js';
import {
  dbEnabled,
  fakeGenerator,
  knowledgeRecord,
  openIsolatedStore,
  seedCampaign,
  sleep,
} from './journalFixture.js';

let isolated: Awaited<ReturnType<typeof openIsolatedStore>>;
let store: Store;
before(async () => {
  if (!dbEnabled) return;
  isolated = await openIsolatedStore('memory_rebuild_http');
  store = isolated.store;
});
after(async () => {
  if (dbEnabled) await isolated.close();
});

const generator = fakeGenerator(() => ({ text: '- The innkeeper spoke with the traveller.' }));
const app = () => createApp({ store, providers: generator as unknown as ProviderService }).app;
const call = (method: 'get' | 'post', url: string, client = true) => {
  const r = request(app())[method](url).set('Host', 'localhost:4100');
  return method === 'post' && client ? r.set('X-RPG-Client', 'local-rpg') : r;
};
async function poll(base: string, jobId: string) {
  for (let i = 0; i < 400; i++) {
    const r = await call('get', `${base}/${jobId}`).expect(200);
    if (!r.body.data.active) return r.body.data;
    await sleep(15);
  }
  throw new Error('rebuild did not finish');
}

test(
  'settings advertise backend-owned statuses, actions and limits',
  { skip: !dbEnabled },
  async () => {
    const r = await call('get', '/api/settings').expect(200);
    const rebuild = r.body.data.memoryRebuild;
    assert.deepEqual(
      rebuild.statusOptions.map((o: { id: string }) => o.id),
      MEMORY_REBUILD_STATUS_OPTIONS.map((o) => o.id)
    );
    assert.deepEqual(
      rebuild.actionOptions.map((o: { id: string }) => o.id),
      ['cancel', 'resume', 'apply', 'discard']
    );
    assert.deepEqual(rebuild.limits, { pageSizeDefault: 20, pageSizeMax: 100 });
  }
);

test(
  'start, poll, list, apply: exact DTO, private data excluded, strict bodies',
  { skip: !dbEnabled },
  async () => {
    const secret = knowledgeRecord('Secret', 'SECRET TEXT', { visibility: V.GmOnly });
    const { campaign } = await seedCampaign(
      store,
      [
        { action: 'greet', narrative: 'Mira greets the traveller.' },
        { action: 'ask', narrative: 'Mira tells a story.' },
      ],
      [knowledgeRecord('Mira', 'Mira is the innkeeper.'), secret]
    );
    const base = `/api/campaigns/${campaign.id}/memory/rebuilds`;
    // Mutations require the local client header and a strict body.
    await call('post', base, false).send({ requestId: randomUUID() }).expect(403);
    await call('post', base).send({}).expect(422);
    await call('post', base).send({ requestId: randomUUID(), extra: 1 }).expect(422);
    await call('get', `${base}?limit=0`).expect(422);
    const requestId = randomUUID();
    const started = await call('post', base).send({ requestId }).expect(202);
    const replay = await call('post', base).send({ requestId }).expect(202);
    assert.equal(replay.body.data.id, started.body.data.id);
    const job = await poll(base, started.body.data.id);
    assert.equal(job.status, 'ready');
    assert.deepEqual(Object.keys(job).sort(), [
      'active',
      'allowedActions',
      'baseline',
      'campaignId',
      'candidate',
      'compact',
      'createdAt',
      'decision',
      'errorCode',
      'id',
      'processedTurns',
      'purpose',
      'safeError',
      'status',
      'statusLabel',
      'totalTurns',
      'updatedAt',
    ]);
    assert.deepEqual(Object.keys(job.candidate).sort(), [
      'coveredTurnIds',
      'proposalDigest',
      'text',
    ]);
    assert.equal(job.baseline, null);
    assert.equal(job.processedTurns, 2);
    assert.doesNotMatch(JSON.stringify(generator.calls), /SECRET TEXT/);
    const list = await call('get', base).expect(200);
    assert.equal(list.body.data.jobs.length, 1);
    assert.equal(list.body.data.current.id, job.id);
    assert.equal(list.body.data.nextCursor, null);
    assert.doesNotMatch(JSON.stringify(list.body), /SECRET TEXT|frozen|owner/);
    // The draft is not memory until it is applied.
    assert.equal((await store.campaign(campaign.id)).memory, null);
    await call('post', `${base}/${job.id}/apply`)
      .send({ requestId: randomUUID(), proposalDigest: 'a'.repeat(64) })
      .expect(409);
    const applied = await call('post', `${base}/${job.id}/apply`)
      .send({ requestId: randomUUID(), proposalDigest: job.candidate.proposalDigest })
      .expect(200);
    assert.equal(applied.body.data.campaign.memory.text, job.candidate.text);
    assert.equal(applied.body.data.job.status, 'applied');
    assert.deepEqual(applied.body.data.job.decision.action, 'apply');
    assert.doesNotMatch(JSON.stringify(applied.body), /SECRET TEXT/);
  }
);
