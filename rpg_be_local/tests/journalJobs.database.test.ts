import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Store } from '../src/store.js';
import { ownerId } from '../src/store.js';
import { JournalJobStore } from '../src/services/journalJobs.js';
import { JournalJobKind, JournalJobStatus, JournalDecision } from '../src/domain/journal.js';
import { dbEnabled, openIsolatedStore, seedCampaign } from './journalFixture.js';

let isolated: Awaited<ReturnType<typeof openIsolatedStore>>;
let store: Store;
let jobs: JournalJobStore;
before(async () => {
  if (!dbEnabled) return;
  isolated = await openIsolatedStore('journal_jobs');
  store = isolated.store;
  jobs = new JournalJobStore(store);
});
after(async () => {
  if (dbEnabled) await isolated.close();
});

const insert = async (campaignId: string, requestId = randomUUID(), id = randomUUID()) => {
  await store.transaction((client) =>
    jobs.insertRunning(client, {
      id,
      campaignId,
      requestId,
      kind: JournalJobKind.Backfill,
      identityDigest: 'a'.repeat(64),
      frozenInput: { input: {}, settings: {} },
      checkpoint: { processedPairs: 0 },
    })
  );
  return id;
};

test(
  'one active Journal job per campaign and one job per request identity',
  { skip: !dbEnabled },
  async () => {
    const { campaign } = await seedCampaign(store, [{ action: 'a', narrative: 'n' }]);
    const requestId = randomUUID();
    const first = await insert(campaign.id, requestId);
    await assert.rejects(
      () => insert(campaign.id),
      (e: { code?: string }) => e.code === '23505'
    );
    await assert.rejects(
      () => insert(campaign.id, requestId),
      (e: { code?: string }) => e.code === '23505'
    );
    const found = await jobs.find(campaign.id, requestId);
    assert.equal(found?.id, first);
    assert.equal(found?.status, JournalJobStatus.Running);
    // The own-job exemption lets that job's commit through while others stay blocked.
    await assert.rejects(
      () => store.transaction((client) => store.assertIdle(campaign.id, client)),
      (e: { code?: string }) => e.code === 'journal_busy'
    );
    await store.transaction((client) => store.assertIdle(campaign.id, client, first));
    const other = await seedCampaign(store, [{ action: 'a', narrative: 'n' }]);
    await insert(other.campaign.id);
  }
);

test(
  'ownership writes are checked: stale owners and cancelled jobs cannot finish or renew',
  { skip: !dbEnabled },
  async () => {
    const { campaign } = await seedCampaign(store, [{ action: 'a', narrative: 'n' }]);
    const id = await insert(campaign.id);
    assert.equal(await jobs.owned(id), true);
    assert.equal(await jobs.renew(id, { checkpoint: { processedPairs: 1 } }), true);
    await store.transaction((client) => jobs.cancel(client, id));
    assert.equal(await jobs.owned(id), false);
    assert.equal(await jobs.renew(id), false);
    assert.equal(await jobs.finish(id, JournalJobStatus.Completed), false);
    const row = await jobs.get(campaign.id, id);
    assert.equal(row.status, JournalJobStatus.Cancelled);
    assert.equal(row.owner, null);
    // Another process instance cannot adopt a job it does not own.
    const second = await insert(
      (await seedCampaign(store, [{ action: 'a', narrative: 'n' }])).campaign.id
    );
    await store.pool.query('UPDATE journal_jobs SET owner=$2 WHERE id=$1', [second, randomUUID()]);
    assert.equal(await jobs.renew(second), false);
    assert.notEqual(
      (
        await jobs.get(
          (await store.pool.query('SELECT campaign_id FROM journal_jobs WHERE id=$1', [second]))
            .rows[0].campaign_id,
          second
        )
      ).owner,
      ownerId
    );
  }
);

test(
  'an expired lease is recovered as interrupted and unlocks the campaign',
  { skip: !dbEnabled },
  async () => {
    const { campaign } = await seedCampaign(store, [{ action: 'a', narrative: 'n' }]);
    const id = await insert(campaign.id);
    await store.pool.query(
      "UPDATE journal_jobs SET lease_until=now()-interval '1 minute' WHERE id=$1",
      [id]
    );
    assert.ok((await store.recover()) >= 1);
    const row = await jobs.get(campaign.id, id);
    assert.equal(row.status, JournalJobStatus.Interrupted);
    assert.match(row.safeError ?? '', /retry/);
    await store.transaction((client) => store.assertIdle(campaign.id, client));
  }
);

test(
  'a decision is stored once per job and replays by request identity',
  { skip: !dbEnabled },
  async () => {
    const { campaign } = await seedCampaign(store, [{ action: 'a', narrative: 'n' }]);
    const id = await insert(campaign.id);
    const requestId = randomUUID();
    await store.transaction((client) =>
      jobs.recordDecision(client, {
        jobId: id,
        requestId,
        decision: JournalDecision.Dismissed,
        identityDigest: 'b'.repeat(64),
        result: null,
      })
    );
    assert.equal((await jobs.decision(id, requestId))?.decision, JournalDecision.Dismissed);
    assert.equal((await jobs.anyDecision(id))?.requestId, requestId);
    await assert.rejects(
      () =>
        store.transaction((client) =>
          jobs.recordDecision(client, {
            jobId: id,
            requestId: randomUUID(),
            decision: JournalDecision.Accepted,
            identityDigest: 'c'.repeat(64),
            result: null,
          })
        ),
      (e: { code?: string }) => e.code === '23505'
    );
  }
);

test('deleting a campaign removes its jobs and decisions', { skip: !dbEnabled }, async () => {
  const { campaign } = await seedCampaign(store, [{ action: 'a', narrative: 'n' }]);
  const id = await insert(campaign.id);
  await store.pool.query('DELETE FROM campaigns WHERE id=$1', [campaign.id]);
  const left = await store.pool.query('SELECT 1 FROM journal_jobs WHERE id=$1', [id]);
  assert.equal(left.rowCount, 0);
});
