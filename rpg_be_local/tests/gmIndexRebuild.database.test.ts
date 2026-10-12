import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Problem } from '../src/errors.js';
import type { Generator } from '../src/providers/service.js';
import type { Campaign } from '../src/domain/types.js';
import { SourceKind, SourcePurpose, SourceStatus } from '../src/domain/options.js';
import { KnowledgeVisibility } from '../src/domain/knowledge.js';
import { DEFAULT_HISTORY_SETTINGS, turnVersionOf } from '../src/domain/historyRecall.js';
import { sourceSections } from '../src/domain/sourceSections.js';
import { gmIndexCanonicalIdentity } from '../src/domain/gmIndexCompatibility.js';
import { GmIndexEntryKind, GmIndexEntryStatus } from '../src/domain/gmIndex.js';
import { GmIndexPreparationMode } from '../src/domain/gmIndexGeneration.js';
import { MemoryRebuildPurpose, MemoryRebuildStatus } from '../src/domain/memoryRebuild.js';
import { MemoryRebuildService } from '../src/services/memoryRebuild.js';
import { GmIndexStatusService } from '../src/services/gmIndexStatus.js';
import { CAMPAIGN_SOURCE_GET_TOOL_NAME } from '../src/domain/campaignSourceRecall.js';
import { HISTORY_SEARCH_TOOL_NAME } from '../src/domain/historyRecall.js';
import {
  dbEnabled,
  openIsolatedStore,
  seedCampaign,
  knowledgeRecord,
  sleep,
} from './journalFixture.js';

let isolated: Awaited<ReturnType<typeof openIsolatedStore>>;
before(async () => {
  if (dbEnabled) isolated = await openIsolatedStore('gm_index_rebuild');
});
after(async () => {
  if (dbEnabled) await isolated.close();
});

const PRIVATE_KNOWLEDGE = 'HIDDEN_KNOWLEDGE_MARKER';
const PRIVATE_PROPOSAL = 'PRIVATE_PREPARED_INDEX_MARKER';
const OLD_PLAN = 'OLD_INDEX_PLAN_EXCLUSION_MARKER';

function provider(fail = false) {
  const calls: Record<string, unknown>[] = [];
  const generator: Generator = {
    capacity: async (settings) => {
      assert.ok(
        settings && typeof settings.provider === 'string',
        'Resume must provide the captured campaign provider settings'
      );
      return 16000;
    },
    gameplayCapacity: async (settings) => {
      assert.ok(
        settings && typeof settings.provider === 'string',
        'Resume must preflight the owned tool transport with captured settings'
      );
      return 16000;
    },
    generate: async () => {
      throw new Error('Short campaign preparation must not summarize history');
    },
    generateOwnedGameplay: async (_settings, prompt, _schema, _system, tools) => {
      const input = JSON.parse(prompt) as Record<string, unknown>;
      calls.push(input);
      assert.equal(tools.definitions?.length, 6);
      assert.ok(!tools.definitions?.some((tool) => tool.name === 'roll_dice'));
      if (fail) throw new Problem(429, 'provider_quota', 'Synthetic preparation quota failure');
      if (input.stage === 'scan') return { foundation: [] };
      assert.equal(input.stage, 'synthesize');
      return {
        foundation: [],
        entries: [
          {
            kind: 'task',
            status: 'active',
            title: 'Private task',
            text: PRIVATE_PROPOSAL,
            ownerCharacterId: null,
            refs: [],
            direction: null,
          },
        ],
      };
    },
  };
  return { generator, calls };
}

async function seed(count = 0) {
  return seedCampaign(
    isolated.store,
    Array.from({ length: count }, (_, i) => ({
      action: `Action ${i}`,
      narrative: `Public harbor outcome ${i}.`,
    })),
    [
      knowledgeRecord('Known clue', 'A trader promised armor.'),
      knowledgeRecord('Hidden clue', PRIVATE_KNOWLEDGE, { visibility: KnowledgeVisibility.GmOnly }),
    ]
  );
}

async function save(c: Campaign) {
  await isolated.store.transaction((client) => isolated.store.save(c, client));
}

function addOldIndex(c: Campaign, enabled: boolean) {
  c.historyRecall = { ...structuredClone(DEFAULT_HISTORY_SETTINGS), enabled };
  c.gmIndex = {
    settings: {
      enabled,
      activationHistoryBaseline: { enabled: false, modeDecisionId: randomUUID() },
    },
    document: {
      generationId: randomUUID(),
      contractVersion: 1,
      campaignFoundation: [],
      entries: [
        {
          id: randomUUID(),
          kind: GmIndexEntryKind.GmPlan,
          status: GmIndexEntryStatus.Active,
          title: 'Old plan',
          text: OLD_PLAN,
          ownerCharacterId: null,
          refs: [],
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
    },
  };
}

async function settle(service: MemoryRebuildService, campaignId: string, jobId: string) {
  for (let i = 0; i < 800; i++) {
    const job = await service.status(campaignId, jobId);
    if (!job.active) return job;
    await sleep(10);
  }
  throw new Error('Synthetic index preparation did not settle');
}

test(
  'zero, one and five-turn index preparations stay private until reviewed Apply',
  { skip: !dbEnabled },
  async () => {
    for (const count of [0, 1, 5]) {
      const { campaign } = await seed(count);
      const ai = provider();
      const service = new MemoryRebuildService(isolated.store, ai.generator);
      const startId = randomUUID();
      const started = await service.start(campaign.id, startId, MemoryRebuildPurpose.GmIndex);
      const ready = await settle(service, campaign.id, started.id);
      assert.equal(ready.status, MemoryRebuildStatus.Ready, ready.safeError ?? '');
      assert.equal((await isolated.store.campaign(campaign.id)).gmIndex, undefined);
      assert.equal(ready.gmIndex?.mode, GmIndexPreparationMode.Prepare);
      assert.equal(ready.gmIndex?.preview?.coverage.turns, count);
      assert.equal(ready.candidate?.text, '');
      assert.equal(ready.baseline, null);
      assert.doesNotMatch(
        JSON.stringify(ready),
        /HIDDEN_KNOWLEDGE_MARKER|PRIVATE_PREPARED_INDEX_MARKER/
      );
      assert.deepEqual(ready.gmIndex?.preview?.topics, [
        { title: 'Known clue', text: 'A trader promised armor.' },
      ]);
      const applyId = randomUUID();
      const applied = await service.apply(
        campaign.id,
        ready.id,
        applyId,
        ready.candidate!.proposalDigest
      );
      const live = await isolated.store.campaign(campaign.id);
      assert.equal(live.gmIndex?.settings.enabled, true);
      assert.equal(live.historyRecall?.enabled, true);
      assert.equal(live.historyRecall?.activeOverviewId, null);
      assert.equal(live.gmIndex?.document.dependencyState.turnCoverage.length, count);
      assert.equal(live.gmIndex?.document.entries[0]?.text, PRIVATE_PROPOSAL);
      assert.doesNotMatch(
        JSON.stringify(applied),
        /HIDDEN_KNOWLEDGE_MARKER|PRIVATE_PREPARED_INDEX_MARKER/
      );
      const callsBeforeReplay = ai.calls.length;
      const replay = await service.apply(
        campaign.id,
        ready.id,
        applyId,
        ready.candidate!.proposalDigest
      );
      assert.equal(replay.job.id, ready.id);
      assert.equal(ai.calls.length, callsBeforeReplay);
      assert.equal(
        (await isolated.store.campaign(campaign.id)).gmIndex?.document.generationId,
        live.gmIndex!.document.generationId
      );
    }
  }
);

test(
  'preparation scans every confirmed source section across all roles and excludes drafts',
  { skip: !dbEnabled },
  async () => {
    const { campaign } = await seed(1);
    campaign.sources = [
      SourcePurpose.Campaign,
      SourcePurpose.Character,
      SourcePurpose.Reference,
    ].map((purpose, i) => ({
      id: randomUUID(),
      purpose,
      name: `Source ${i}`,
      kind: SourceKind.Text,
      status: SourceStatus.Confirmed,
      version: 1,
      text: `${purpose} original text.\n\n${'word '.repeat(1900)}`,
      pages: [],
      warnings: [],
    }));
    campaign.sources.push({
      ...campaign.sources[0]!,
      id: randomUUID(),
      status: SourceStatus.Draft,
      text: 'DRAFT_SOURCE_MARKER',
    });
    await save(campaign);
    const ai = provider();
    const service = new MemoryRebuildService(isolated.store, ai.generator);
    const started = await service.start(campaign.id, randomUUID(), MemoryRebuildPurpose.GmIndex);
    const ready = await settle(service, campaign.id, started.id);
    assert.equal(ready.status, MemoryRebuildStatus.Ready, ready.safeError ?? '');
    const expected = campaign.sources
      .filter((s) => s.status === SourceStatus.Confirmed)
      .flatMap((s) =>
        sourceSections(s).map((section) => ({
          sourceId: s.id,
          sectionIndex: section.index,
          text: section.text,
        }))
      );
    const scanned = ai.calls
      .filter((call) => call.stage === 'scan')
      .map(
        (call) =>
          call.batch as { kind: string; sourceId: string; sectionIndex: number; text: string }
      )
      .filter((batch) => batch.kind === 'source_original')
      .map(({ sourceId, sectionIndex, text }) => ({ sourceId, sectionIndex, text }));
    assert.deepEqual(scanned, expected);
    assert.equal(ready.gmIndex?.preview?.coverage.sourceSections, expected.length);
    assert.doesNotMatch(JSON.stringify(ai.calls), /DRAFT_SOURCE_MARKER/);
  }
);

test(
  'a fresh rebuild without a previous index enables only after reviewed Apply',
  { skip: !dbEnabled },
  async () => {
    const { campaign } = await seed(5);
    const ai = provider();
    const service = new MemoryRebuildService(isolated.store, ai.generator);
    const started = await service.start(
      campaign.id,
      randomUUID(),
      MemoryRebuildPurpose.GmIndex,
      GmIndexPreparationMode.FreshRebuild
    );
    const ready = await settle(service, campaign.id, started.id);
    assert.equal(ready.status, MemoryRebuildStatus.Ready);
    assert.equal((await isolated.store.campaign(campaign.id)).gmIndex, undefined);
    await service.apply(campaign.id, ready.id, randomUUID(), ready.candidate!.proposalDigest);
    const live = await isolated.store.campaign(campaign.id);
    assert.equal(live.gmIndex!.settings.enabled, true);
    assert.equal(live.historyRecall!.enabled, true);
    assert.equal(live.gmIndex!.settings.activationHistoryBaseline.enabled, false);
  }
);

test(
  'fresh rebuild excludes old index prose and replaces its document while preserving activation mode',
  { skip: !dbEnabled },
  async () => {
    for (const enabled of [false, true]) {
      const { campaign } = await seed(1);
      addOldIndex(campaign, enabled);
      await save(campaign);
      const before = structuredClone(campaign.gmIndex!);
      const historyBefore = structuredClone(campaign.historyRecall);
      const ai = provider();
      const service = new MemoryRebuildService(isolated.store, ai.generator);
      const started = await service.start(
        campaign.id,
        randomUUID(),
        MemoryRebuildPurpose.GmIndex,
        GmIndexPreparationMode.FreshRebuild
      );
      const ready = await settle(service, campaign.id, started.id);
      assert.equal(ready.status, MemoryRebuildStatus.Ready, ready.safeError ?? '');
      assert.doesNotMatch(JSON.stringify(ai.calls), /OLD_INDEX_PLAN_EXCLUSION_MARKER/);
      assert.deepEqual((await isolated.store.campaign(campaign.id)).gmIndex, before);
      assert.equal(ready.gmIndex?.mode, GmIndexPreparationMode.FreshRebuild);
      await service.apply(campaign.id, ready.id, randomUUID(), ready.candidate!.proposalDigest);
      const after = await isolated.store.campaign(campaign.id);
      assert.notEqual(after.gmIndex!.document.generationId, before.document.generationId);
      assert.deepEqual(after.gmIndex!.settings, before.settings);
      assert.deepEqual(after.historyRecall, historyBefore);
    }
  }
);

test(
  'stale canonical state or index target prevents Apply without replacing the live document',
  { skip: !dbEnabled },
  async () => {
    for (const changed of ['canonical', 'target']) {
      const { campaign } = await seed(1);
      addOldIndex(campaign, true);
      await save(campaign);
      const ai = provider();
      const service = new MemoryRebuildService(isolated.store, ai.generator);
      const started = await service.start(
        campaign.id,
        randomUUID(),
        MemoryRebuildPurpose.GmIndex,
        GmIndexPreparationMode.FreshRebuild
      );
      const ready = await settle(service, campaign.id, started.id);
      assert.equal(ready.status, MemoryRebuildStatus.Ready, ready.safeError ?? '');
      const live = await isolated.store.campaign(campaign.id);
      if (changed === 'canonical') live.state = { scene: 'Changed after preparation' };
      else live.gmIndex!.document.entries[0]!.text = 'A later edited private plan';
      await save(live);
      await assert.rejects(
        service.apply(campaign.id, ready.id, randomUUID(), ready.candidate!.proposalDigest),
        (error: unknown) => error instanceof Problem && error.code === 'memory_stale'
      );
      assert.deepEqual((await isolated.store.campaign(campaign.id)).gmIndex, live.gmIndex);
      assert.equal((await service.status(campaign.id, ready.id)).status, MemoryRebuildStatus.Ready);
    }
  }
);

test(
  'start request identity preserves preparation mode and refuses another mode on replay',
  { skip: !dbEnabled },
  async () => {
    const { campaign } = await seed();
    const ai = provider();
    const service = new MemoryRebuildService(isolated.store, ai.generator);
    const requestId = randomUUID();
    const first = await service.start(
      campaign.id,
      requestId,
      MemoryRebuildPurpose.GmIndex,
      GmIndexPreparationMode.Prepare
    );
    await settle(service, campaign.id, first.id);
    const calls = ai.calls.length;
    const replay = await service.start(
      campaign.id,
      requestId,
      MemoryRebuildPurpose.GmIndex,
      GmIndexPreparationMode.Prepare
    );
    assert.equal(replay.id, first.id);
    assert.equal(ai.calls.length, calls);
    await assert.rejects(
      service.start(
        campaign.id,
        requestId,
        MemoryRebuildPurpose.GmIndex,
        GmIndexPreparationMode.FreshRebuild
      ),
      /different input/
    );
  }
);

test(
  'failed fresh preparation retains the previous complete index and history settings',
  { skip: !dbEnabled },
  async () => {
    const { campaign } = await seed(1);
    addOldIndex(campaign, true);
    await save(campaign);
    const service = new MemoryRebuildService(isolated.store, provider(true).generator);
    const started = await service.start(
      campaign.id,
      randomUUID(),
      MemoryRebuildPurpose.GmIndex,
      GmIndexPreparationMode.FreshRebuild
    );
    const failed = await settle(service, campaign.id, started.id);
    assert.equal(failed.status, MemoryRebuildStatus.Failed);
    assert.equal(failed.gmIndex?.mode, GmIndexPreparationMode.FreshRebuild);
    assert.equal(failed.gmIndex?.preview, null);
    assert.equal(failed.candidate, null);
    const after = await isolated.store.campaign(campaign.id);
    assert.deepEqual(after.gmIndex, campaign.gmIndex);
    assert.deepEqual(after.historyRecall, campaign.historyRecall);
  }
);

test(
  'disabling index preserves a later explicit compact-history activation and replays its receipt',
  { skip: !dbEnabled },
  async () => {
    const { campaign } = await seed(13);
    addOldIndex(campaign, true);
    assert.equal(campaign.gmIndex!.settings.activationHistoryBaseline.enabled, false);
    await save(campaign);
    const ai = provider();
    ai.generator.generate = async (_settings, _prompt, schema) => {
      const properties = (schema as { properties: Record<string, unknown> }).properties;
      return 'title' in properties
        ? { title: 'Harbor history', text: 'Earlier harbor events and local leads.' }
        : { text: 'Harbor overview and current circumstances.' };
    };
    const service = new MemoryRebuildService(isolated.store, ai.generator);
    const started = await service.start(
      campaign.id,
      randomUUID(),
      MemoryRebuildPurpose.CompactHistory
    );
    const ready = await settle(service, campaign.id, started.id);
    assert.equal(ready.status, MemoryRebuildStatus.Ready, ready.safeError ?? '');
    await service.apply(campaign.id, ready.id, randomUUID(), ready.candidate!.proposalDigest);
    const explicit = await isolated.store.campaign(campaign.id);
    assert.equal(explicit.historyRecall?.enabled, true);
    assert.equal(explicit.gmIndex!.settings.activationHistoryBaseline.enabled, true);
    const requestId = randomUUID();
    const index = new GmIndexStatusService(isolated.store);
    await index.disable(campaign.id, { requestId, expectedEnabled: true });
    const disabled = await isolated.store.campaign(campaign.id);
    assert.equal(disabled.gmIndex!.settings.enabled, false);
    assert.equal(disabled.historyRecall?.enabled, true);
    assert.deepEqual(disabled.gmIndex!.document, explicit.gmIndex!.document);
    const revision = disabled.revision;
    await index.disable(campaign.id, { requestId, expectedEnabled: true });
    assert.equal((await isolated.store.campaign(campaign.id)).revision, revision);
  }
);

test(
  'limit-one listing restores ready or failed attention for every purpose with a safe GM preview',
  { skip: !dbEnabled },
  async () => {
    const { campaign } = await seed(13);
    const ai = provider();
    let failHistory = false;
    ai.generator.generate = async (_settings, _prompt, schema) => {
      const properties = (schema as { properties: Record<string, unknown> }).properties;
      if (failHistory && 'title' in properties)
        throw new Problem(429, 'provider_quota', 'Synthetic history failure');
      return 'title' in properties
        ? { title: 'Harbor section', text: 'Saved harbor history.' }
        : { text: 'Public memory overview.' };
    };
    const service = new MemoryRebuildService(isolated.store, ai.generator);
    const gmStarted = await service.start(campaign.id, randomUUID(), MemoryRebuildPurpose.GmIndex);
    const gm = await settle(service, campaign.id, gmStarted.id);
    assert.equal(gm.status, MemoryRebuildStatus.Ready, gm.safeError ?? '');
    const memoryStarted = await service.start(
      campaign.id,
      randomUUID(),
      MemoryRebuildPurpose.Memory
    );
    const memory = await settle(service, campaign.id, memoryStarted.id);
    assert.equal(memory.status, MemoryRebuildStatus.Ready, memory.safeError ?? '');
    failHistory = true;
    const historyStarted = await service.start(
      campaign.id,
      randomUUID(),
      MemoryRebuildPurpose.CompactHistory
    );
    const history = await settle(service, campaign.id, historyStarted.id);
    assert.equal(history.status, MemoryRebuildStatus.Failed);
    const listed = await service.list(campaign.id, 1, 0);
    assert.equal(listed.jobs.length, 1);
    assert.equal(listed.current?.id, history.id);
    assert.equal(listed.attentionByPurpose?.length, 3);
    const byPurpose = new Map(listed.attentionByPurpose!.map((item) => [item.purpose, item]));
    assert.equal(byPurpose.get(MemoryRebuildPurpose.GmIndex)?.id, gm.id);
    assert.equal(byPurpose.get(MemoryRebuildPurpose.Memory)?.id, memory.id);
    assert.equal(byPurpose.get(MemoryRebuildPurpose.CompactHistory)?.id, history.id);
    assert.equal(
      byPurpose.get(MemoryRebuildPurpose.GmIndex)?.gmIndex?.preview?.topics[0]?.title,
      'Known clue'
    );
    assert.doesNotMatch(
      JSON.stringify(listed),
      /HIDDEN_KNOWLEDGE_MARKER|PRIVATE_PREPARED_INDEX_MARKER/
    );
  }
);

test(
  'old unresolved task survives checkpointed original scanning and resumed synthesis outside the last five turns',
  { skip: !dbEnabled },
  async () => {
    const { campaign, turns } = await seedCampaign(
      isolated.store,
      Array.from({ length: 13 }, (_, i) => ({
        action: i === 0 ? 'Promise to repair the ferryman boat.' : `Later action ${i}`,
        narrative:
          i === 0
            ? 'The ferryman accepts your promise. Repair remains pending.'
            : `Later unrelated public scene ${i}.`,
      }))
    );
    addOldIndex(campaign, false);
    await save(campaign);
    const original = turnVersionOf(turns[0]!);
    const oldTask = {
      kind: 'task',
      status: 'active',
      title: 'Repair the ferryman boat',
      text: 'The promised boat repair remains pending.',
      ownerCharacterId: null,
      refs: [{ kind: 'turn', turnId: original.turnId, contentHash: original.contentHash }],
      direction: null,
    };
    const ai = provider();
    let firstSynthesis = true;
    let scannedOriginalBatches = 0;
    const synthesisInputs: Record<string, unknown>[] = [];
    ai.generator.generate = async (_settings, _prompt, schema) => {
      const properties = (schema as { properties: Record<string, unknown> }).properties;
      return 'title' in properties
        ? { title: 'Earlier scenes', text: 'Unrelated later public scenes.' }
        : { text: 'Public overview.' };
    };
    ai.generator.generateOwnedGameplay = async (_settings, prompt) => {
      const input = JSON.parse(prompt) as Record<string, unknown>;
      ai.calls.push(input);
      assert.doesNotMatch(prompt, /OLD_INDEX_PLAN_EXCLUSION_MARKER/);
      if (input.stage === 'scan') {
        const batch = input.batch as { kind: string; originals?: { turnId: string }[] };
        if (batch.kind === 'original_turns') scannedOriginalBatches++;
        return {
          foundation: [],
          entries: batch.originals?.some((turn) => turn.turnId === original.turnId)
            ? [oldTask]
            : [],
        };
      }
      assert.equal(input.stage, 'synthesize');
      synthesisInputs.push(input);
      assert.deepEqual(input.scannedWorkingEntries, [oldTask]);
      assert.deepEqual(input.scannedFoundation, []);
      assert.doesNotMatch(JSON.stringify(input.lastTurns), /ferryman/);
      if (firstSynthesis) {
        firstSynthesis = false;
        throw new Problem(429, 'provider_quota', 'Synthetic synthesis pause');
      }
      return { foundation: [], entries: input.scannedWorkingEntries };
    };
    const service = new MemoryRebuildService(isolated.store, ai.generator);
    const started = await service.start(
      campaign.id,
      randomUUID(),
      MemoryRebuildPurpose.GmIndex,
      GmIndexPreparationMode.FreshRebuild
    );
    const failed = await settle(service, campaign.id, started.id);
    assert.equal(failed.status, MemoryRebuildStatus.Failed);
    assert.equal(scannedOriginalBatches, 2);
    const persisted = await isolated.store.pool.query(
      'SELECT candidate FROM memory_rebuild_jobs WHERE id=$1',
      [failed.id]
    );
    assert.match(
      JSON.stringify(persisted.rows[0].candidate),
      /promised boat repair remains pending/
    );
    await service.resume(campaign.id, failed.id, randomUUID());
    const ready = await settle(service, campaign.id, failed.id);
    assert.equal(ready.status, MemoryRebuildStatus.Ready, ready.safeError ?? '');
    assert.equal(scannedOriginalBatches, 2);
    assert.equal(synthesisInputs.length, 2);
    await service.apply(campaign.id, ready.id, randomUUID(), ready.candidate!.proposalDigest);
    const result = await isolated.store.campaign(campaign.id);
    assert.equal(result.gmIndex!.document.entries[0]!.title, oldTask.title);
    assert.equal(result.gmIndex!.settings.enabled, false);
  }
);

test(
  'source scans seed supplied originals and persist safe preparation stage/read progress',
  { skip: !dbEnabled },
  async () => {
    const { campaign } = await seed();
    campaign.sources = [
      {
        id: randomUUID(),
        name: 'Private campaign original',
        kind: SourceKind.Text,
        status: SourceStatus.Confirmed,
        version: 1,
        text: `PRIVATE_SOURCE_PROGRESS_MARKER ${'Harbor merchant '.repeat(600)}`,
        pages: [],
        warnings: [],
      },
    ];
    await save(campaign);
    const ai = provider();
    let expectedReads = 0;
    let sections = 0;
    const service = new MemoryRebuildService(isolated.store, ai.generator);
    ai.generator.generateOwnedGameplay = async (_settings, prompt, _schema, _system, tools) => {
      const input = JSON.parse(prompt);
      if (input.stage === 'scan') {
        if (input.batch.kind === 'source_original') {
          sections++;
          assert.match(input.supplied, /complete batch original/);
          const original = await tools(
            CAMPAIGN_SOURCE_GET_TOOL_NAME,
            {
              sourceId: input.batch.sourceId,
              version: input.batch.version,
              sectionIndex: input.batch.sectionIndex,
            },
            `source-${sections}`
          );
          expectedReads++;
          assert.ok('alreadySupplied' in original);
          assert.equal(original.alreadySupplied, true);
          const running = (await service.list(campaign.id, 1, 0)).current!;
          assert.equal(running.gmIndex!.progress!.label, 'Reading campaign source sections');
          assert.equal(running.gmIndex!.progress!.retrievalCalls, expectedReads);
          assert.doesNotMatch(
            JSON.stringify(running),
            /PRIVATE_SOURCE_PROGRESS_MARKER|HIDDEN_KNOWLEDGE_MARKER/
          );
          const empty = await tools(
            HISTORY_SEARCH_TOOL_NAME,
            { query: 'an-exact-missing-passage' },
            `empty-${sections}`
          );
          expectedReads++;
          assert.equal('corpusFragments' in empty, false);
        }
        return { foundation: [], entries: [] };
      }
      return { foundation: [], entries: [] };
    };
    const started = await service.start(campaign.id, randomUUID(), MemoryRebuildPurpose.GmIndex);
    const ready = await settle(service, campaign.id, started.id);
    assert.equal(ready.status, MemoryRebuildStatus.Ready, ready.safeError ?? '');
    assert.equal(sections, sourceSections(campaign.sources[0]!).length);
    const progress = ready.gmIndex!.progress!;
    assert.equal(progress.label, 'Ready for review');
    assert.equal(progress.retrievalCalls, sections * 2);
    assert.equal(progress.emptySearches, sections);
    assert.equal(progress.completedSteps, progress.totalSteps);
    assert.ok(Number.isFinite(Date.parse(progress.lastActivityAt)));
    const reloaded = await new MemoryRebuildService(isolated.store, ai.generator).status(
      campaign.id,
      ready.id
    );
    assert.deepEqual(reloaded.gmIndex!.progress, progress);
    assert.doesNotMatch(
      JSON.stringify(reloaded),
      /PRIVATE_SOURCE_PROGRESS_MARKER|HIDDEN_KNOWLEDGE_MARKER/
    );
    const saved = await isolated.store.pool.query(
      'SELECT candidate FROM memory_rebuild_jobs WHERE id=$1',
      [ready.id]
    );
    assert.match(JSON.stringify(saved.rows[0].candidate), /initialSourceSections/);
  }
);
