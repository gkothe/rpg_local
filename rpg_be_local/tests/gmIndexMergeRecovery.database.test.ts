import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Generator } from '../src/providers/service.js';
import { RESPONSE_RETRY_COUNT } from '../src/domain/responseRetry.js';
import { MemoryRebuildPurpose, MemoryRebuildStatus } from '../src/domain/memoryRebuild.js';
import { MemoryRebuildService } from '../src/services/memoryRebuild.js';
import { dbEnabled, openIsolatedStore, seedCampaign, sleep } from './journalFixture.js';

let isolated: Awaited<ReturnType<typeof openIsolatedStore>>;
before(async () => {
  if (dbEnabled) isolated = await openIsolatedStore('gm_merge_recovery');
});
after(async () => {
  if (dbEnabled) await isolated.close();
});
const validEntry = {
  kind: 'task',
  status: 'active',
  title: 'Saved merge reminder',
  text: 'A pending armor promise.',
  ownerCharacterId: null,
  refs: [],
  direction: null,
};

async function settle(service: MemoryRebuildService, campaignId: string, id: string) {
  for (let i = 0; i < 500; i++) {
    const job = await service.status(campaignId, id);
    if (!job.active) return job;
    await sleep(10);
  }
  throw new Error('Synthetic saved merge did not settle');
}

for (const savedIsValid of [true, false])
  test(
    savedIsValid
      ? 'resume reuses a valid saved raw alias merge without repeating scans or owned synthesis'
      : 'resume rejects invalid saved raw merge and regenerates only synthesis',
    { skip: !dbEnabled },
    async () => {
      const { campaign } = await seedCampaign(
        isolated.store,
        Array.from({ length: 13 }, (_, i) => ({
          action: `Action ${i}`,
          narrative: `Saved public scene ${i}.`,
        }))
      );
      let scanCalls = 0;
      let mergeCalls = 0;
      let ordinaryCalls = 0;
      let resumed = false;
      const generator: Generator = {
        capacity: async () => 16000,
        gameplayCapacity: async () => 16000,
        generate: async (_settings, _prompt, schema) => {
          ordinaryCalls++;
          const properties = (schema as { properties: Record<string, unknown> }).properties;
          return 'title' in properties
            ? { title: 'Public harbor history', text: 'The saved public history.' }
            : { text: 'Public harbor overview.' };
        },
        generateOwnedGameplay: async (_settings, prompt) => {
          const input = JSON.parse(prompt);
          if (input.stage === 'scan') {
            scanCalls++;
            return { foundation: [], entries: [] };
          }
          mergeCalls++;
          if (resumed) {
            assert.equal(savedIsValid, false, 'Valid saved merge must not invoke provider again');
            return { foundation: [], entries: [validEntry] };
          }
          return {
            foundation: [],
            entries: [{ ...validEntry, refs: [{ kind: 'knowledge', id: randomUUID() }] }],
          };
        },
      };
      const service = new MemoryRebuildService(isolated.store, generator);
      const started = await service.start(campaign.id, randomUUID(), MemoryRebuildPurpose.GmIndex);
      const failed = await settle(service, campaign.id, started.id);
      assert.equal(failed.status, MemoryRebuildStatus.Failed);
      assert.equal(scanCalls, 3);
      assert.equal(mergeCalls, RESPONSE_RETRY_COUNT + 1);
      assert.equal(ordinaryCalls, 0);
      const row = await isolated.store.pool.query(
        'SELECT candidate,checkpoint FROM memory_rebuild_jobs WHERE id=$1',
        [failed.id]
      );
      assert.ok(row.rows[0].candidate.gmIndexMergeOutput);
      assert.equal(row.rows[0].checkpoint.nextIndex, 3);
      if (savedIsValid)
        await isolated.store.pool.query(
          "UPDATE memory_rebuild_jobs SET candidate=jsonb_set(candidate,'{gmIndexMergeOutput}',$2::jsonb) WHERE id=$1",
          [failed.id, JSON.stringify({ foundation: [], workingEntries: [validEntry] })]
        );
      resumed = true;
      await service.resume(campaign.id, failed.id, randomUUID());
      const ready = await settle(service, campaign.id, failed.id);
      assert.equal(ready.status, MemoryRebuildStatus.Ready, ready.safeError ?? '');
      assert.equal(scanCalls, 3);
      assert.equal(mergeCalls, RESPONSE_RETRY_COUNT + (savedIsValid ? 1 : 2));
      assert.equal(ordinaryCalls, 3);
      assert.equal((await isolated.store.campaign(campaign.id)).gmIndex, undefined);
      await service.apply(campaign.id, ready.id, randomUUID(), ready.candidate!.proposalDigest);
      assert.equal(
        (await isolated.store.campaign(campaign.id)).gmIndex!.document.entries[0]!.title,
        validEntry.title
      );
    }
  );
