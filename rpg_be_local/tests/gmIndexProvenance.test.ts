import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { newCampaign } from '../src/domain/campaign.js';
import { SourceKind, SourceStatus } from '../src/domain/options.js';
import {
  GmIndexEntryKind,
  GmIndexEntryStatus,
  type GmIndexDocument,
} from '../src/domain/gmIndex.js';
import { GmIndexRefKind, type GmIndexRef } from '../src/domain/gmIndexRefs.js';
import { validateGmIndexProvenance } from '../src/domain/gmIndexProvenance.js';
import {
  gmIndexCanonicalIdentity,
  gmIndexEntryIdentity,
  gmIndexSourceCoverage,
} from '../src/domain/gmIndexCompatibility.js';
import {
  CAMPAIGN_SOURCE_GET_TOOL_NAME,
  createCampaignSourceRecall,
  freezeCampaignSources,
} from '../src/domain/campaignSourceRecall.js';
import {
  KNOWLEDGE_GET_TOOL_NAME,
  createKnowledgeRecall,
  freezeKnowledge,
} from '../src/domain/knowledgeRecall.js';
import { HISTORY_GET_TOOL_NAME } from '../src/domain/historyRecall.js';
import { knowledgeRecord } from './journalFixture.js';

function fixture() {
  const campaign = newCampaign({ name: 'Private index provenance' });
  const currentTurnId = randomUUID();
  campaign.sources = [
    {
      id: randomUUID(),
      name: 'Original campaign',
      kind: SourceKind.Text,
      status: SourceStatus.Confirmed,
      version: 1,
      text: 'The merchant faction controls the harbor.',
      pages: [],
      warnings: [],
    },
  ];
  const oldKnowledge = knowledgeRecord('Merchant lead', 'A merchant promises armor.');
  campaign.knowledge = [oldKnowledge];
  const refs: GmIndexRef[] = [
    {
      kind: GmIndexRefKind.SourceSection,
      sourceId: campaign.sources[0]!.id,
      version: 1,
      sectionIndex: 0,
    },
    { kind: GmIndexRefKind.Knowledge, id: oldKnowledge.id },
    { kind: GmIndexRefKind.Turn, turnId: randomUUID(), contentHash: 'a'.repeat(64) },
  ];
  const prior: GmIndexDocument = {
    generationId: randomUUID(),
    contractVersion: 1,
    campaignFoundation: [],
    entries: [],
    lastCheckedTurnId: null,
    dependencyState: {
      canonicalHash: gmIndexCanonicalIdentity(campaign),
      entries: [],
      foundation: [],
      sourceCoverage: gmIndexSourceCoverage(campaign),
      turnCoverage: [],
    },
  };
  const next = (references: GmIndexRef[]): GmIndexDocument => ({
    ...structuredClone(prior),
    entries: [
      {
        id: randomUUID(),
        kind: GmIndexEntryKind.Clue,
        status: GmIndexEntryStatus.Active,
        title: 'Grounded clue',
        text: 'A private clue.',
        ownerCharacterId: null,
        refs: references,
        direction: null,
      },
    ],
  });
  return { campaign, currentTurnId, refs, prior, next };
}

test('new older source, knowledge and original-turn references require delivered gets, not search snippets', () => {
  const f = fixture();
  for (const ref of f.refs) {
    assert.throws(
      () => validateGmIndexProvenance(f.next([ref]), f.prior, f.campaign, [], f.currentTurnId),
      /Read the exact original/
    );
    const search =
      ref.kind === GmIndexRefKind.SourceSection
        ? 'campaign_sources_search'
        : ref.kind === GmIndexRefKind.Knowledge
          ? 'campaign_knowledge_search'
          : 'campaign_history_search';
    assert.throws(
      () =>
        validateGmIndexProvenance(
          f.next([ref]),
          f.prior,
          f.campaign,
          [{ name: search, result: { entries: [{ ...ref, text: 'Search snippet only' }] } }],
          f.currentTurnId
        ),
      /Read the exact original/
    );
  }
  const source = createCampaignSourceRecall(freezeCampaignSources(f.campaign)).get(
    { sourceId: f.campaign.sources[0]!.id, version: 1, sectionIndex: 0 },
    randomUUID()
  );
  const knowledge = createKnowledgeRecall(freezeKnowledge(f.campaign)).get({
    id: f.campaign.knowledge![0]!.id,
  });
  const historical = f.refs[2]!;
  assert.equal(historical.kind, GmIndexRefKind.Turn);
  const reads = [
    { name: CAMPAIGN_SOURCE_GET_TOOL_NAME, result: source },
    { name: KNOWLEDGE_GET_TOOL_NAME, result: knowledge },
    {
      name: HISTORY_GET_TOOL_NAME,
      result: {
        originals: [
          {
            turnId: historical.kind === GmIndexRefKind.Turn ? historical.turnId : '',
            gm: 'Delivered original narration.',
          },
        ],
      },
    },
  ];
  assert.doesNotThrow(() =>
    validateGmIndexProvenance(f.next(f.refs), f.prior, f.campaign, reads, f.currentTurnId)
  );
});

test('wrong-version, partial or changed source text does not supply the captured original section', () => {
  const f = fixture();
  const result = createCampaignSourceRecall(freezeCampaignSources(f.campaign)).get(
    { sourceId: f.campaign.sources[0]!.id, version: 1, sectionIndex: 0 },
    randomUUID()
  );
  const sourceSpan = result.sourceSpan as {
    id: string;
    version: number;
    start: number;
    end: number;
    text: string;
  };
  for (const span of [
    { ...sourceSpan, version: 2 },
    { ...sourceSpan, end: sourceSpan.end - 1 },
    { ...sourceSpan, text: 'Only a snippet' },
    { ...sourceSpan, id: randomUUID() },
  ])
    assert.throws(
      () =>
        validateGmIndexProvenance(
          f.next([f.refs[0]!]),
          f.prior,
          f.campaign,
          [{ name: CAMPAIGN_SOURCE_GET_TOOL_NAME, result: { ...result, sourceSpan: span } }],
          f.currentTurnId
        ),
      /Read the exact original/
    );
});

test('retained prior references need no redundant reads', () => {
  const f = fixture();
  const prior = f.next(f.refs);
  prior.dependencyState.entries = [
    {
      entryId: prior.entries[0]!.id,
      contentHash: gmIndexEntryIdentity(prior.entries[0]!, f.campaign),
      stale: false,
    },
  ];
  assert.doesNotThrow(() =>
    validateGmIndexProvenance(f.next(f.refs), prior, f.campaign, [], f.currentTurnId)
  );
  prior.dependencyState.entries[0]!.stale = true;
  assert.throws(
    () => validateGmIndexProvenance(f.next(f.refs), prior, f.campaign, [], f.currentTurnId),
    /Read the exact original/
  );
});

test('changed section originals, newly updated knowledge and this finalized turn are already supplied', () => {
  const f = fixture();
  f.prior.dependencyState.sourceCoverage = [];
  f.campaign.knowledge![0]!.updatedTurnId = f.currentTurnId;
  const current: GmIndexRef = {
    kind: GmIndexRefKind.Turn,
    turnId: f.currentTurnId,
    contentHash: 'b'.repeat(64),
  };
  assert.doesNotThrow(() =>
    validateGmIndexProvenance(
      f.next([f.refs[0]!, f.refs[1]!, current]),
      f.prior,
      f.campaign,
      [],
      f.currentTurnId
    )
  );
});
