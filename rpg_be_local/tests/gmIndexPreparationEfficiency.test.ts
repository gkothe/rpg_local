import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { newCampaign } from '../src/domain/campaign.js';
import { CharacterType, SourceKind, SourceStatus } from '../src/domain/options.js';
import { KnowledgeKind } from '../src/domain/knowledge.js';
import {
  GmIndexPreparationMode,
  captureGmIndexGeneration,
  gmIndexScanBatches,
  gmIndexScanPrompt,
} from '../src/domain/gmIndexGeneration.js';
import {
  createGmIndexReadTools,
  restoreGmIndexSourceReads,
  type GmIndexReadReceipt,
} from '../src/services/gmIndexReadTools.js';
import { CAMPAIGN_SOURCE_GET_TOOL_NAME } from '../src/domain/campaignSourceRecall.js';
import { HISTORY_SEARCH_TOOL_NAME, type FrozenHistory } from '../src/domain/historyRecall.js';
import type { Store } from '../src/store.js';
import { knowledgeRecord } from './journalFixture.js';

function fixture() {
  const campaign = newCampaign({ name: 'Efficient preparation' });
  campaign.state = { scene: 'Harbor', time_of_day: 'Night' };
  campaign.sources = ['SUPPLIED_ORIGINAL_MARKER', 'UNRELATED_ORIGINAL_MARKER'].map((text, i) => ({
    id: randomUUID(),
    name: `Source ${i}`,
    kind: SourceKind.Text,
    status: SourceStatus.Confirmed,
    version: 1,
    text,
    pages: [],
    warnings: [],
  }));
  const history: FrozenHistory = {
    campaignId: campaign.id,
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
  return { campaign, history };
}

test('scan prompt extracts only its original batch with compact canonical context instead of a campaign-wide audit', () => {
  const { campaign } = fixture();
  campaign.characters = [
    {
      id: randomUUID(),
      name: 'Mira',
      type: CharacterType.Player,
      attributes: { privateBulk: 'CHARACTER_BULK_MARKER'.repeat(1000) },
      inventory: {},
      description: {},
      notes: '',
      revision: 0,
    },
  ];
  campaign.knowledge = Array.from({ length: 95 }, () =>
    knowledgeRecord('Orchard harvest', 'UNRELATED_FACT_CANARY '.repeat(200), {
      kind: KnowledgeKind.Event,
    })
  );
  const capture = captureGmIndexGeneration(campaign, [], GmIndexPreparationMode.Prepare, []);
  const batch = gmIndexScanBatches(capture)[1];
  const prompt = gmIndexScanPrompt(capture, batch);
  const input = JSON.parse(prompt);
  assert.equal(input.stage, 'scan');
  assert.deepEqual(input.batch, batch);
  assert.deepEqual(input.canonicalContext.state, campaign.state);
  assert.deepEqual(input.canonicalContext.characters, [
    { id: campaign.characters[0]!.id, name: 'Mira', type: 'player' },
  ]);
  assert.deepEqual(input.canonicalContext.relevantFacts, []);
  assert.match(prompt, /SUPPLIED_ORIGINAL_MARKER/);
  assert.doesNotMatch(
    prompt,
    /UNRELATED_ORIGINAL_MARKER|UNRELATED_FACT_CANARY|CHARACTER_BULK_MARKER/
  );
  assert.match(input.task, /ONLY from this supplied batch/);
  assert.match(input.task, /Do not investigate the whole campaign/);
  assert.match(input.task, /Empty arrays are valid/);
  assert.match(input.supplied, /History summaries are not available/);
});

test('whole source batch is marked supplied, other sections stay unsupplied, and durable receipt replay restores its seed', async () => {
  const { campaign, history } = fixture();
  const initial = [{ sourceId: campaign.sources[0]!.id, version: 1, sectionIndex: 0 }];
  const reads: GmIndexReadReceipt[] = [];
  const tools = createGmIndexReadTools(
    {} as Store,
    campaign,
    history,
    async () => {},
    async (read) => {
      reads.push(read);
    },
    [],
    [],
    { originalsOnly: true, suppliedSourceSections: initial }
  );
  const get = await tools(CAMPAIGN_SOURCE_GET_TOOL_NAME, initial[0]!, 'supplied-get');
  assert.ok('alreadySupplied' in get);
  assert.equal(get.alreadySupplied, true);
  const other = await tools(
    CAMPAIGN_SOURCE_GET_TOOL_NAME,
    { sourceId: campaign.sources[1]!.id, version: 1, sectionIndex: 0 },
    'other-get'
  );
  assert.ok('alreadySupplied' in other);
  assert.equal(other.alreadySupplied, false);
  assert.deepEqual(reads[0]!.initialSourceSections, initial);
  const restored = restoreGmIndexSourceReads(campaign, reads);
  assert.equal(restored.get(initial[0]!, randomUUID()).alreadySupplied, true);
  const fresh = restoreGmIndexSourceReads(campaign, []);
  assert.equal(fresh.get(initial[0]!, randomUUID()).alreadySupplied, false);
});

test('preparation history searches original turns by default and rejects fragments; ordinary updater keeps fragment searches', async () => {
  const { campaign, history } = fixture();
  const reads: GmIndexReadReceipt[] = [];
  const started: string[] = [];
  const prepare = createGmIndexReadTools(
    {} as Store,
    campaign,
    history,
    async () => {},
    async (read) => {
      reads.push(read);
    },
    [],
    [],
    {
      originalsOnly: true,
      onReadStarted: async (name) => {
        started.push(name);
      },
    }
  );
  const original = await prepare(HISTORY_SEARCH_TOOL_NAME, { query: '' }, 'original-default');
  assert.ok('corpusTurns' in original);
  assert.equal(original.corpusTurns, 0);
  assert.equal('corpusFragments' in original, false);
  await assert.rejects(
    prepare(HISTORY_SEARCH_TOOL_NAME, { query: '', mode: 'fragments' }, 'denied-fragments')
  );
  assert.deepEqual(started, [HISTORY_SEARCH_TOOL_NAME]);
  assert.equal(reads.length, 1);
  const updater = createGmIndexReadTools(
    {} as Store,
    campaign,
    history,
    async () => {},
    async () => {}
  );
  const fragments = await updater(
    HISTORY_SEARCH_TOOL_NAME,
    { query: '', mode: 'fragments' },
    'ordinary-fragments'
  );
  assert.ok('corpusFragments' in fragments);
  assert.equal(fragments.corpusFragments, 0);
});
