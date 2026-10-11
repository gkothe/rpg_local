import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { newCampaign } from '../src/domain/campaign.js';
import { SourceKind, SourceStatus } from '../src/domain/options.js';
import {
  createCampaignSourceRecall,
  freezeCampaignSources,
  CAMPAIGN_SOURCE_SEARCH_TOOL_NAME,
  CAMPAIGN_SOURCE_GET_TOOL_NAME,
} from '../src/domain/campaignSourceRecall.js';
import {
  restoreGmIndexSourceReads,
  createGmIndexReadTools,
  type GmIndexReadReceipt,
} from '../src/services/gmIndexReadTools.js';
import type { FrozenHistory } from '../src/domain/historyRecall.js';
import type { Store } from '../src/store.js';

function fixture() {
  const campaign = newCampaign({ name: 'Source replay' });
  campaign.sources = Array.from({ length: 35 }, (_, i) => ({
    id: randomUUID(),
    name: `Harbor ledger ${i}`,
    kind: SourceKind.Text,
    status: SourceStatus.Confirmed,
    version: 1,
    text: `Harbor merchant ledger original ${i}.`,
    pages: [],
    warnings: [],
  }));
  const source = createCampaignSourceRecall(freezeCampaignSources(campaign));
  const reads: GmIndexReadReceipt[] = [];
  return { campaign, source, reads };
}

test('ordered source receipt replay restores later-page cursors and delivered spans; fresh readers start unsupplied', () => {
  const f = fixture();
  const query = { query: 'harbor' };
  const first = f.source.search(query);
  assert.ok(first.nextCursor);
  f.reads.push({
    name: CAMPAIGN_SOURCE_SEARCH_TOOL_NAME,
    arguments: query,
    requestId: 'search-1',
    result: first,
  });
  const getArgs = { sourceId: f.campaign.sources[0]!.id, version: 1, sectionIndex: 0 };
  const get = f.source.get(getArgs, randomUUID());
  assert.equal(get.alreadySupplied, false);
  f.reads.push({
    name: CAMPAIGN_SOURCE_GET_TOOL_NAME,
    arguments: getArgs,
    requestId: 'get-1',
    result: get,
  });
  f.source.markSupplied(get.sourceSpan);
  const nextArgs = { query: 'harbor', cursor: first.nextCursor! };
  const second = f.source.search(nextArgs);
  assert.ok(second.nextCursor);
  f.reads.push({
    name: CAMPAIGN_SOURCE_SEARCH_TOOL_NAME,
    arguments: nextArgs,
    requestId: 'search-2',
    result: second,
  });
  const restored = restoreGmIndexSourceReads(f.campaign, f.reads);
  assert.deepEqual(
    restored.search({ query: 'harbor', cursor: second.nextCursor! }),
    f.source.search({ query: 'harbor', cursor: second.nextCursor! })
  );
  assert.equal(restored.get(getArgs, randomUUID()).alreadySupplied, true);
  assert.equal(
    restoreGmIndexSourceReads(f.campaign, []).get(getArgs, randomUUID()).alreadySupplied,
    false
  );
  assert.throws(
    () => restored.search({ query: 'merchant', cursor: second.nextCursor! }),
    /Cursor does not match/
  );
});

test('source replay rejects changed query, frozen corpus or saved output instead of trusting a receipt', () => {
  const f = fixture();
  const args = { query: 'harbor' };
  const result = f.source.search(args);
  const receipt = {
    name: CAMPAIGN_SOURCE_SEARCH_TOOL_NAME,
    arguments: args,
    requestId: 'search',
    result,
  };
  assert.throws(
    () => restoreGmIndexSourceReads(f.campaign, [{ ...receipt, arguments: { query: 'unknown' } }]),
    /no longer matches/
  );
  assert.throws(
    () =>
      restoreGmIndexSourceReads(f.campaign, [
        { ...receipt, result: { ...result, reason: 'Changed result' } },
      ]),
    /no longer matches/
  );
  const changed = structuredClone(f.campaign);
  changed.sources[0]!.text = 'Entirely changed frozen corpus';
  assert.throws(() => restoreGmIndexSourceReads(changed, [receipt]), /no longer matches/);
});

test('failed receipt persistence never marks source text supplied or caches a successful request', async () => {
  const f = fixture();
  const history: FrozenHistory = {
    campaignId: f.campaign.id,
    mode: 'compact',
    turnVersions: [],
    fragments: [],
    correctionGuidance: [],
    protectedLocators: [],
    selectionDiagnostics: {
      targetBytes: 1,
      suppliedBytes: 0,
      mandatoryBytes: 0,
      overflowBytes: 0,
      included: [],
      omitted: { count: 0, reasonCounts: {} },
    },
  };
  let fail = true;
  const observed: boolean[] = [];
  const tools = createGmIndexReadTools(
    {} as Store,
    f.campaign,
    history,
    async () => {},
    async (read) => {
      observed.push(read.result.alreadySupplied as boolean);
      if (fail) {
        fail = false;
        throw new Error('Synthetic receipt write failed');
      }
    }
  );
  const args = { sourceId: f.campaign.sources[0]!.id, version: 1, sectionIndex: 0 };
  await assert.rejects(
    tools(CAMPAIGN_SOURCE_GET_TOOL_NAME, args, 'read-1'),
    /receipt write failed/
  );
  const delivered = await tools(CAMPAIGN_SOURCE_GET_TOOL_NAME, args, 'read-1');
  assert.ok('alreadySupplied' in delivered);
  assert.equal(delivered.alreadySupplied, false);
  const repeated = await tools(CAMPAIGN_SOURCE_GET_TOOL_NAME, args, 'read-1');
  assert.deepEqual(repeated, delivered);
  const next = await tools(CAMPAIGN_SOURCE_GET_TOOL_NAME, args, 'read-2');
  assert.ok('alreadySupplied' in next);
  assert.equal(next.alreadySupplied, true);
  assert.deepEqual(observed, [false, false, true]);
  await assert.rejects(
    tools(CAMPAIGN_SOURCE_GET_TOOL_NAME, { ...args, sectionIndex: 1 }, 'read-1'),
    /changed input/
  );
});
