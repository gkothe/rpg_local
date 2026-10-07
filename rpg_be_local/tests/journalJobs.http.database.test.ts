import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { Store } from '../src/store.js';
import { createApp } from '../src/app.js';
import type { ProviderService } from '../src/providers/service.js';
import { Problem } from '../src/errors.js';
import { JournalJobStatus } from '../src/domain/journal.js';
import { KnowledgeVisibility as V } from '../src/domain/knowledge.js';
import {
  dbEnabled,
  excerptTurn,
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
  isolated = await openIsolatedStore('journal_http');
  store = isolated.store;
});
after(async () => {
  if (dbEnabled) await isolated.close();
});

const generator = fakeGenerator((prompt) => {
  if (prompt.excerpts) {
    const hit = excerptTurn(prompt, 'sister of the temple');
    return {
      excerpts: hit
        ? [
            {
              turnId: hit.turnId,
              field: 'narrative',
              quote: 'sister of the temple',
              relation: 'contradicts',
            },
          ]
        : [],
    };
  }
  if (prompt.recordedFacts) return { entries: [] };
  return {
    outcome: 'proposed',
    reason: 'She says so.',
    changes: { text: 'Mira is a sister of the temple.' },
    evidenceIndexes: [0],
  };
}, 100);
const app = () => createApp({ store, providers: generator as unknown as ProviderService }).app;
const call = (method: 'get' | 'post', url: string) => {
  const r = request(app())[method](url).set('Host', 'localhost:4100');
  return method === 'post' ? r.set('X-RPG-Client', 'local-rpg') : r;
};
async function poll(base: string, jobId: string) {
  for (let i = 0; i < 400; i++) {
    const r = await call('get', `${base}/jobs/${jobId}`).expect(200);
    if (!r.body.data.active) return r.body.data;
    await sleep(15);
  }
  throw new Error('job did not finish');
}
async function fixture() {
  const mira = knowledgeRecord('Mira', 'Mira is the innkeeper.');
  const seeded = await seedCampaign(
    store,
    [{ action: 'ask', narrative: 'Mira admits she is a sister of the temple.' }],
    [mira, knowledgeRecord('Secret', 'SECRET TEXT', { visibility: V.GmOnly })]
  );
  return { ...seeded, mira, base: `/api/campaigns/${seeded.campaign.id}/journal` };
}

test('start, poll, decide: statuses, bodies and safe progress', { skip: !dbEnabled }, async () => {
  const { mira, base } = await fixture();
  const requestId = randomUUID();
  const started = await call('post', `${base}/entries/${mira.id}/checks`)
    .send({ requestId, explanation: 'She is a sister, not an innkeeper.' })
    .expect(202);
  assert.equal(started.body.data.jobId, started.body.data.id);
  const job = await poll(base, started.body.data.id);
  assert.equal(job.status, JournalJobStatus.Completed);
  assert.equal(job.finding.outcome, 'proposed');
  assert.deepEqual(Object.keys(job).sort(), [
    'active',
    'createdAt',
    'decision',
    'error',
    'finding',
    'id',
    'kind',
    'progress',
    'status',
    'statusLabel',
    'updatedAt',
  ]);
  assert.ok(!JSON.stringify(job).includes('SECRET'));
  // Replay with the same identity returns the original job.
  const replay = await call('post', `${base}/entries/${mira.id}/checks`)
    .send({ requestId, explanation: 'She is a sister, not an innkeeper.' })
    .expect(202);
  assert.equal(replay.body.data.id, started.body.data.id);
  await call('post', `${base}/entries/${mira.id}/checks`)
    .send({ requestId, explanation: 'different' })
    .expect(409);
  const accepted = await call('post', `${base}/jobs/${job.id}/accept`)
    .send({ requestId: randomUUID(), proposalDigest: job.finding.proposalDigest })
    .expect(200);
  assert.equal(accepted.body.data.decision, 'accepted');
  assert.equal(accepted.body.data.entry.text, 'Mira is a sister of the temple.');
  const list = await call('get', `${base}/entries`).expect(200);
  assert.equal(
    list.body.data.entries.find((e: { id: string }) => e.id === mira.id).overview,
    'Mira is a sister of the temple.'
  );
});

test(
  'malformed input, unknown or hidden targets and foreign jobs are rejected without leaking',
  { skip: !dbEnabled },
  async () => {
    const { mira, base, campaign } = await fixture();
    const hiddenId = campaign.knowledge![1]!.id;
    const ok = { requestId: randomUUID(), explanation: 'x' };
    await call('post', `${base}/entries/${mira.id}/checks`).send({ explanation: 'x' }).expect(422);
    await call('post', `${base}/entries/${mira.id}/checks`)
      .send({ ...ok, explanation: '' })
      .expect(422);
    await call('post', `${base}/entries/${mira.id}/checks`)
      .send({ ...ok, explanation: 'x'.repeat(2001) })
      .expect(422);
    await call('post', `${base}/entries/${mira.id}/checks`)
      .send({ ...ok, extra: true })
      .expect(422);
    await call('post', `${base}/backfills`).send({}).expect(422);
    await call('post', `${base}/backfills`).send({ requestId: 'nope' }).expect(422);
    const hidden = await call('post', `${base}/entries/${hiddenId}/checks`).send(ok).expect(404);
    assert.ok(!hidden.text.includes('SECRET') && !hidden.text.includes('Secret'));
    await call('post', `${base}/entries/${randomUUID()}/checks`).send(ok).expect(404);
    const started = await call('post', `${base}/entries/${mira.id}/checks`).send(ok).expect(202);
    const job = await poll(base, started.body.data.id);
    await call('post', `${base}/jobs/${job.id}/accept`)
      .send({ requestId: randomUUID(), proposalDigest: 'short' })
      .expect(422);
    await call('post', `${base}/jobs/${job.id}/accept`)
      .send({ requestId: randomUUID(), proposalDigest: 'f'.repeat(64) })
      .expect(409);
    await call('get', `${base}/jobs/${randomUUID()}`).expect(404);
    const other = await fixture();
    await call('get', `${other.base}/jobs/${job.id}`).expect(404);
    await call('post', `${other.base}/jobs/${job.id}/cancel`)
      .send({ requestId: randomUUID() })
      .expect(404);
    await call('post', `${base}/jobs/${job.id}/dismiss`).send({}).expect(422);
    await call('post', `${base}/jobs/${job.id}/dismiss`)
      .send({ requestId: randomUUID() })
      .expect(200);
    // Cancelling a finished job is a harmless idempotent request.
    const cancelled = await call('post', `${base}/jobs/${job.id}/cancel`)
      .send({ requestId: randomUUID() })
      .expect(200);
    assert.equal(cancelled.body.data.status, JournalJobStatus.Completed);
  }
);

test(
  'an unavailable provider is a named 503 and starts nothing',
  { skip: !dbEnabled },
  async () => {
    const { base, campaign } = await fixture();
    const broken = {
      capacity: async () => {
        throw new Problem(503, 'provider_unavailable', 'Select an installed supported CLI');
      },
    } as unknown as ProviderService;
    const unavailable = createApp({ store, providers: broken }).app;
    const r = await request(unavailable)
      .post(`${base}/backfills`)
      .set('Host', 'localhost:4100')
      .set('X-RPG-Client', 'local-rpg')
      .send({ requestId: randomUUID() })
      .expect(503);
    assert.equal(r.body.code, 'journal_provider_unavailable');
    const rows = await store.pool.query('SELECT 1 FROM journal_jobs WHERE campaign_id=$1', [
      campaign.id,
    ]);
    assert.equal(rows.rowCount, 0);
  }
);

test('an empty campaign has nothing to backfill', { skip: !dbEnabled }, async () => {
  const { newCampaign } = await import('../src/domain/campaign.js');
  const empty = newCampaign({ name: 'Empty' });
  await store.insert(empty);
  const r = await call('post', `/api/campaigns/${empty.id}/journal/backfills`)
    .send({ requestId: randomUUID() })
    .expect(422);
  assert.equal(r.body.code, 'journal_invalid');
});

test('settings advertise Journal jobs, statuses and outcomes', { skip: !dbEnabled }, async () => {
  const r = await call('get', '/api/settings').expect(200);
  const journal = r.body.data.journal;
  assert.deepEqual(
    journal.jobKindOptions.map((o: { id: string }) => o.id),
    ['backfill', 'check']
  );
  assert.deepEqual(
    journal.jobStatusOptions.map((o: { id: string }) => o.id),
    ['pending', 'running', 'completed', 'failed', 'cancelled', 'interrupted']
  );
  assert.deepEqual(
    journal.checkOutcomeOptions.map((o: { id: string }) => o.id),
    ['proposed', 'unchanged', 'inconclusive']
  );
  assert.equal(journal.limits.explanationMaxChars, 2000);
});
