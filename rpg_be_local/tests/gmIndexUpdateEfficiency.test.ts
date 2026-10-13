import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { newCampaign } from '../src/domain/campaign.js';
import {
  buildGmIndexUpdateContext,
  validateGmIndexDelivery,
  GM_INDEX_UPDATER_INSTRUCTIONS,
} from '../src/domain/gmIndexUpdate.js';
import {
  gmIndexCanonicalIdentity,
  gmIndexEntryIdentity,
  gmIndexSourceCoverage,
} from '../src/domain/gmIndexCompatibility.js';
import {
  GmIndexEntryKind,
  GmIndexEntryStatus,
  type GmIndexDocument,
} from '../src/domain/gmIndex.js';
import { GmIndexRefKind } from '../src/domain/gmIndexRefs.js';
import {
  validateGmIndexProvenance,
  GmIndexProvenanceError,
} from '../src/domain/gmIndexProvenance.js';
import { knowledgeRecord } from './journalFixture.js';
import { SourceKind, SourceStatus } from '../src/domain/options.js';
import { KnowledgeStatus } from '../src/domain/knowledge.js';
import type { Turn } from '../src/domain/types.js';
import { canonicalJson, sha256 } from '../src/domain/journalLedger.js';
import { gmIndexCheckpointDigest, type GmIndexCheckpoint } from '../src/services/gmIndexUpdater.js';
import { GmIndexUpdater } from '../src/services/gmIndexUpdater.js';
import type { Store } from '../src/store.js';
import type { Generator } from '../src/providers/service.js';
import type { FrozenHistory } from '../src/domain/historyRecall.js';

function fixture() {
  const c = newCampaign({ name: 'Updater delivery' });
  const turn = {
    id: randomUUID(),
    action: 'Look around.',
    narrative: 'A quiet room.',
    rolls: [],
    rollInterpretations: [],
  } as unknown as Turn;
  const record = knowledgeRecord('Unrelated archived fact', 'EXACT_ORIGINAL_KNOWLEDGE_MARKER');
  record.status = KnowledgeStatus.Resolved;
  c.knowledge = [record, knowledgeRecord('Unrelated other', 'Omitted original')];
  c.sources = [
    {
      id: randomUUID(),
      name: 'Campaign source',
      kind: SourceKind.Text,
      status: SourceStatus.Confirmed,
      version: 1,
      text: 'Complete source text.',
      pages: [],
      warnings: [],
    },
  ];
  const doc: GmIndexDocument = {
    generationId: randomUUID(),
    contractVersion: 1,
    campaignFoundation: [],
    entries: [
      {
        id: randomUUID(),
        kind: GmIndexEntryKind.Clue,
        status: GmIndexEntryStatus.Resolved,
        title: 'Resolved note',
        text: 'INDEX_ONCE_MARKER',
        ownerCharacterId: null,
        refs: [{ kind: GmIndexRefKind.Knowledge, id: record.id }],
        direction: null,
      },
    ],
    lastCheckedTurnId: null,
    dependencyState: {
      canonicalHash: gmIndexCanonicalIdentity(c),
      entries: [],
      foundation: [],
      sourceCoverage: [],
      turnCoverage: [],
    },
  };
  doc.dependencyState.entries = [
    {
      entryId: doc.entries[0]!.id,
      contentHash: gmIndexEntryIdentity(doc.entries[0]!, c),
      stale: false,
    },
  ];
  return { c, doc, turn, record };
}

test('updater sends notes once, identifies resolved freshness correctly and delivers indexed inactive originals once', () => {
  const { c, doc, turn, record } = fixture();
  const ctx = buildGmIndexUpdateContext(c, doc, turn, []);
  const p = JSON.parse(ctx.prompt);
  assert.equal(ctx.prompt.split('INDEX_ONCE_MARKER').length - 1, 1);
  assert.equal(ctx.prompt.split('EXACT_ORIGINAL_KNOWLEDGE_MARKER').length - 1, 1);
  assert.deepEqual(p.freshness.staleEntryIds, []);
  assert.deepEqual(p.freshness.activeFreshEntryIds, []);
  assert.equal(p.suppliedKnowledge[0].id, record.id);
  assert.ok(!p.knowledgeNavigation.some((r: { id: string }) => r.id === record.id));
  assert.equal(p.newOrChangedKnowledge, undefined);
  assert.deepEqual(
    validateGmIndexDelivery(ctx.prompt, ctx.deliveredOriginals, c),
    ctx.deliveredOriginals
  );
  assert.equal(ctx.deliveredOriginals.sources.length, 1);
  assert.deepEqual(buildGmIndexUpdateContext(c, doc, turn, []), ctx);
  assert.match(
    GM_INDEX_UPDATER_INSTRUCTIONS,
    /Review the entire foundation and all directions every turn/
  );
  assert.match(GM_INDEX_UPDATER_INSTRUCTIONS, /omit unchanged entries/);
});

test('changed and explicit handoff originals remain complete, unique and owned', () => {
  const { c, doc, turn } = fixture();
  c.knowledge![1]!.updatedTurnId = turn.id;
  const ctx = buildGmIndexUpdateContext(c, doc, turn, [
    {
      kind: GmIndexEntryKind.Task,
      text: 'Reminder',
      refs: [{ kind: GmIndexRefKind.Knowledge, id: c.knowledge![1]!.id }],
    },
  ]);
  const p = JSON.parse(ctx.prompt);
  assert.equal(p.suppliedKnowledge.length, 2);
  assert.deepEqual(p.knowledgeInclusion[1].reasons.slice(0, 2), ['changed', 'handoff']);
  assert.deepEqual(p.knowledgeNavigation, []);
});

test('manifest rejects changed hash, foreign IDs, omitted payload evidence and partial source originals', () => {
  const { c, doc, turn } = fixture();
  const ctx = buildGmIndexUpdateContext(c, doc, turn, []);
  for (const mutate of [
    (x: typeof ctx) => {
      x.deliveredOriginals.knowledge[0]!.contentHash = 'a'.repeat(64);
    },
    (x: typeof ctx) => {
      x.deliveredOriginals.knowledge[0]!.id = randomUUID();
    },
    (x: typeof ctx) => {
      x.deliveredOriginals.knowledge.push({
        id: c.knowledge![1]!.id,
        contentHash: sha256(canonicalJson(c.knowledge![1])),
      });
    },
    (x: typeof ctx) => {
      const p = JSON.parse(x.prompt);
      p.changedSourceOriginals[0].text = 'Partial';
      x.prompt = JSON.stringify(p);
      x.deliveredOriginals.promptHash = sha256(x.prompt);
    },
  ]) {
    const altered = structuredClone(ctx);
    mutate(altered);
    assert.throws(
      () => validateGmIndexDelivery(altered.prompt, altered.deliveredOriginals, c),
      /delivery differs/
    );
  }
});

test('delivered old knowledge succeeds without gets; missing refs are complete and precise; legacy retention is preserved', () => {
  const { c, doc, turn, record } = fixture();
  const ctx = buildGmIndexUpdateContext(c, doc, turn, []);
  const prior = {
    ...structuredClone(doc),
    entries: [],
    dependencyState: { ...doc.dependencyState, sourceCoverage: gmIndexSourceCoverage(c) },
  };
  const next = structuredClone(doc);
  assert.doesNotThrow(() =>
    validateGmIndexProvenance(next, prior, c, [], turn.id, ctx.deliveredOriginals)
  );
  assert.throws(
    () => validateGmIndexProvenance(next, prior, c, [], turn.id),
    /Read the exact original/
  );
  const empty = buildGmIndexUpdateContext(c, prior, turn, []).deliveredOriginals;
  assert.doesNotThrow(() => validateGmIndexProvenance(next, doc, c, [], turn.id, empty));
  assert.throws(
    () => validateGmIndexProvenance(next, doc, c, [], turn.id),
    /Read the exact original/
  );
  doc.dependencyState.entries[0]!.stale = true;
  assert.throws(
    () => validateGmIndexProvenance(next, doc, c, [], turn.id, empty),
    /Read the exact original/
  );
  next.entries[0]!.refs = [
    { kind: GmIndexRefKind.Knowledge, id: record.id },
    { kind: GmIndexRefKind.Knowledge, id: c.knowledge![1]!.id },
    { kind: GmIndexRefKind.SourceSection, sourceId: c.sources[0]!.id, version: 1, sectionIndex: 0 },
  ];
  assert.throws(
    () => validateGmIndexProvenance(next, prior, c, [], turn.id),
    (error: unknown) => {
      assert.ok(error instanceof GmIndexProvenanceError);
      assert.equal(error.missingRefs.length, 3);
      assert.match(error.retryFeedback(), /campaign_knowledge_get/);
      assert.match(error.retryFeedback(), /campaign_sources_get/);
      assert.doesNotMatch(error.message, /EXACT_ORIGINAL|INDEX_ONCE/);
      assert.doesNotMatch(error.retryFeedback(), /EXACT_ORIGINAL|INDEX_ONCE/);
      return true;
    }
  );
});

test('checkpoint digest binds new manifest and preserves legacy hash', () => {
  const { c, doc, turn } = fixture();
  const ctx = buildGmIndexUpdateContext(c, doc, turn, []);
  const checkpoint = {
    candidateDigest: 'candidate',
    narrativeDigest: 'narrative',
    canonicalIdentity: 'canonical',
    indexIdentity: 'index',
    reservations: {},
    prompt: ctx.prompt,
  } as GmIndexCheckpoint;
  assert.equal(
    gmIndexCheckpointDigest(checkpoint),
    sha256(
      canonicalJson({
        candidate: 'candidate',
        narrative: 'narrative',
        canonical: 'canonical',
        index: 'index',
        reservations: {},
        prompt: ctx.prompt,
      })
    )
  );
  assert.notEqual(
    gmIndexCheckpointDigest({ ...checkpoint, deliveredOriginals: ctx.deliveredOriginals }),
    gmIndexCheckpointDigest(checkpoint)
  );
});

test('updater verifies manifest before generation and seeds delivered sources on each retry', async () => {
  const { c, doc, turn } = fixture();
  const ctx = buildGmIndexUpdateContext(c, doc, turn, []);
  const history: FrozenHistory = {
    campaignId: c.id,
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
  const checkpoint = {
    contractVersion: 1,
    campaign: c,
    history,
    currentOriginal: { turnId: turn.id },
    prompt: ctx.prompt,
    deliveredOriginals: ctx.deliveredOriginals,
    invocations: [],
  } as unknown as GmIndexCheckpoint;
  let calls = 0;
  const supplied: boolean[] = [];
  const generator: Generator = {
    capacity: async () => 16000,
    generate: async () => {
      throw new Error('Unexpected narrative generation');
    },
    gameplayCapacity: async () => 16000,
    generateOwnedGameplay: async (_settings, _prompt, _schema, _system, tools) => {
      assert.equal(tools.definitions?.length, 5);
      assert.ok(!tools.definitions?.some((tool) => tool.name === 'campaign_knowledge_search'));
      await assert.rejects(
        tools('campaign_knowledge_search', { query: 'merchant' }, 'forbidden-search'),
        /available read-only index tools/
      );
      calls++;
      const result = await tools(
        'campaign_sources_get',
        { sourceId: c.sources[0]!.id, version: 1, sectionIndex: 0 },
        'source-get'
      );
      supplied.push((result as { alreadySupplied: boolean }).alreadySupplied);
      if (calls === 1) throw new SyntaxError('Malformed synthetic output');
      return {
        checked: { notes: true, foundation: true, direction: true },
        gmIndexChanges: [],
        gmFoundationChanges: [],
      };
    },
  } as Generator;
  const updater = new GmIndexUpdater(
    { pool: { query: async () => ({ rows: [{ id: turn.id }] }) } } as unknown as Store,
    generator
  );
  updater.save = async () => {};
  const tampered = structuredClone(checkpoint);
  tampered.deliveredOriginals!.knowledge[0]!.id = randomUUID();
  await assert.rejects(
    updater.generate(turn.id, tampered, new AbortController().signal),
    /delivery differs/
  );
  assert.equal(calls, 0);
  await updater.generate(turn.id, checkpoint, new AbortController().signal);
  assert.equal(calls, 2);
  assert.deepEqual(supplied, [true, true]);
  assert.equal(checkpoint.invocations.length, 2);
  assert.equal(checkpoint.invocations[0]!.reads.length, 1);
});
