import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { newCampaign } from '../src/domain/campaign.js';
import { TurnStatus } from '../src/domain/options.js';
import { emptyRuleColumns, RuleReview, type RuleContext } from '../src/domain/rules.js';
import type { Turn } from '../src/domain/types.js';
import { Problem } from '../src/errors.js';
import {
  AdvancementBasis,
  AdvancementOutcome,
  AdvancementStatus,
} from '../src/domain/advancement.js';
import type { Generator } from '../src/providers/service.js';
import { AdvancementService } from '../src/services/advancement.js';
import { RuleLookup } from '../src/services/ruleLookup.js';
import { RuleStore, ruleContent } from '../src/services/ruleStore.js';
import { TurnService } from '../src/services/turns.js';
import { ownerId, type Store } from '../src/store.js';
import { dbEnabled, openIsolatedStore, seedCampaign, sleep } from './journalFixture.js';
import { emptyResponse, syntheticGenerate } from './ownedGameplayFixture.js';

let isolated: Awaited<ReturnType<typeof openIsolatedStore>>;
let store: Store;
before(async () => {
  if (!dbEnabled) return;
  isolated = await openIsolatedStore('directed_rules');
  store = isolated.store;
});
after(async () => {
  if (dbEnabled) await isolated.close();
});

const rulePath = 'core_rules.book.deep';
const originalText =
  'Unrelated world description. '.repeat(2000) + ' Awakening resolves with a spirit check.';
const searchInput = { query: 'awakening' };
type Hit = {
  path: string;
  locator: string;
  matchWindow: { start: number; end: number };
  alreadySupplied: boolean;
  originalComplete: boolean;
  matchSupplied: boolean;
  suppliedOriginals?: { receiptId: string }[];
};
function hit(payload: Record<string, unknown>): Hit {
  assert.equal(payload.error, undefined);
  const entry = (payload.entries as Hit[]).find((entry) => entry.path === rulePath);
  assert.ok(entry, 'Search must locate the deep original rule');
  return entry;
}
const invalidEvidence = (error: unknown) =>
  error instanceof Problem && error.code === 'rules_evidence_invalid';

async function activeTurn(campaignId: string, context: RuleContext): Promise<Turn> {
  const campaign = await store.campaign(campaignId);
  const turn: Turn = {
    id: randomUUID(),
    campaignId,
    requestId: randomUUID(),
    status: TurnStatus.Running,
    action: 'Consult the awakening rule',
    narrative: null,
    changes: [],
    error: null,
    undone: false,
    settings: campaign.settings,
    ruleContext: context,
    context: {
      revision: campaign.revision,
      prompt: '{}',
      estimatedTokens: 2,
      estimator: 'fixture',
      sourceVersions: [],
      historyIds: [],
      memoryId: null,
      ruleContext: context,
    },
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
  await store.pool.query(
    "INSERT INTO turns(id,campaign_id,request_id,payload_hash,status,document,owner,lease_until) VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '5 minutes')",
    [turn.id, campaignId, turn.requestId, 'a'.repeat(64), turn.status, turn, ownerId]
  );
  return turn;
}
async function fixture() {
  const rules = new RuleStore(store);
  const created = await rules.create(
    `directed_${randomUUID().replaceAll('-', '')}`,
    'Synthetic directed rule book'
  );
  const columns = emptyRuleColumns();
  const node = {
    name: 'Deep rule',
    aliases: [],
    source: 'book',
    review: RuleReview.Extracted,
    pdfPages: [],
    printedPages: [],
    children: {},
    text: originalText,
  };
  columns.core_rules.book = {
    ...node,
    name: 'Book',
    text: '',
    structural: true,
    children: { deep: node },
  };
  const context = await rules.publish(created.systemId, created.revision, () => ({
    ...columns,
    instructions: 'Read originals.',
    sources: [{ slug: 'book', title: 'Synthetic rule book', pageCount: 1, pdfHash: null }],
    mapping: {},
  }));
  const campaign = newCampaign({ name: 'Directed retrieval fixture', systemId: context.systemId });
  await store.insert(campaign);
  return {
    rules,
    context,
    campaign,
    turn: await activeTurn(campaign.id, context),
    lookup: new RuleLookup(),
  };
}

test(
  'only authenticated originals delivered in the current execution annotate a persisted search',
  { skip: !dbEnabled },
  async () => {
    const f = await fixture();
    const first = await f.rules.read(
      f.turn,
      'rules_search',
      searchInput,
      'run:search',
      f.lookup,
      undefined,
      { scope: 'run:', receiptIds: [] }
    );
    const entry = hit(first.payload);
    assert.equal(entry.alreadySupplied, undefined);
    assert.ok(
      entry.matchWindow.start > 4096,
      'Synthetic match must lie beyond the first read window'
    );
    const read = await f.rules.read(
      f.turn,
      'rules_get',
      { path: entry.path, locator: entry.locator },
      'run:original',
      f.lookup
    );
    assert.equal(read.payload.error, undefined);
    assert.equal(read.payload.start, entry.matchWindow.start);
    assert.equal(read.payload.complete, true);
    assert.match(read.payload.text as string, /Awakening/);
    const supplied = await f.rules.read(
      f.turn,
      'rules_search',
      searchInput,
      'run:supplied',
      f.lookup,
      undefined,
      { scope: 'run:', receiptIds: [read.id] }
    );
    assert.equal(hit(supplied.payload).matchSupplied, true);
    assert.equal(
      hit(supplied.payload).originalComplete,
      false,
      'A complete tail is not a complete original'
    );
    assert.deepEqual(
      hit(supplied.payload).suppliedOriginals?.map((value) => value.receiptId),
      [read.id]
    );
    const fresh = await f.rules.read(
      f.turn,
      'rules_search',
      searchInput,
      'fresh:search',
      new RuleLookup(),
      undefined,
      { scope: 'fresh:', receiptIds: [] }
    );
    assert.equal(
      hit(fresh.payload).alreadySupplied,
      undefined,
      'Persistence does not establish delivery to a fresh execution'
    );
  }
);

test(
  'delivery authentication rejects duplicate, unknown, foreign-turn and foreign-execution receipts',
  { skip: !dbEnabled },
  async () => {
    const f = await fixture();
    const read = await f.rules.read(
      f.turn,
      'rules_get',
      { path: rulePath },
      'run:original',
      f.lookup
    );
    await store.pool.query("UPDATE turns SET status='completed' WHERE id=$1", [f.turn.id]);
    const otherTurn = await activeTurn(f.campaign.id, f.context);
    const other = await f.rules.read(
      otherTurn,
      'rules_get',
      { path: rulePath },
      'run:original',
      new RuleLookup()
    );
    await store.pool.query("UPDATE turns SET status='completed' WHERE id=$1", [otherTurn.id]);
    await store.pool.query("UPDATE turns SET status='running' WHERE id=$1", [f.turn.id]);
    const foreignCampaign = newCampaign({ name: 'Other campaign', systemId: f.context.systemId });
    await store.insert(foreignCampaign);
    const foreign = await f.rules.read(
      await activeTurn(foreignCampaign.id, f.context),
      'rules_get',
      { path: rulePath },
      'run:original',
      new RuleLookup()
    );
    const cases = [
      { scope: 'run:', receiptIds: [read.id, read.id] },
      { scope: 'run:', receiptIds: [randomUUID()] },
      { scope: 'run:', receiptIds: [other.id] },
      { scope: 'run:', receiptIds: [foreign.id] },
      { scope: 'other:', receiptIds: [read.id] },
      { scope: '', receiptIds: [] },
    ];
    for (const [index, evidence] of cases.entries()) {
      await assert.rejects(
        f.rules.read(
          f.turn,
          'rules_search',
          searchInput,
          `run:bad_${index}`,
          f.lookup,
          undefined,
          evidence
        ),
        invalidEvidence
      );
    }
    await assert.rejects(
      f.rules.read(f.turn, 'rules_search', searchInput, 'fresh:cross_run', f.lookup, undefined, {
        scope: 'fresh:',
        receiptIds: [read.id],
      }),
      invalidEvidence
    );
  }
);

test(
  'search, structural, fields and error receipts cannot authenticate original delivery',
  { skip: !dbEnabled },
  async () => {
    const f = await fixture();
    const receipts = [
      await f.rules.read(f.turn, 'rules_search', searchInput, 'run:metadata', f.lookup),
      await f.rules.read(
        f.turn,
        'rules_get',
        { path: 'core_rules.book' },
        'run:structural',
        f.lookup
      ),
      await f.rules.read(
        f.turn,
        'rules_get',
        { path: rulePath, view: 'fields' },
        'run:fields',
        f.lookup
      ),
      await f.rules.read(
        f.turn,
        'rules_get',
        { path: 'core_rules.missing' },
        'run:error',
        f.lookup
      ),
    ];
    assert.ok(receipts[3]!.payload.error);
    for (const [index, receipt] of receipts.entries()) {
      await assert.rejects(
        f.rules.read(
          f.turn,
          'rules_search',
          searchInput,
          `run:reject_${index}`,
          f.lookup,
          undefined,
          { scope: 'run:', receiptIds: [receipt.id] }
        ),
        invalidEvidence
      );
    }
  }
);

test(
  'same transport replay restores a persisted deep locator in a fresh lookup and keeps captured annotations',
  { skip: !dbEnabled },
  async () => {
    const f = await fixture();
    const search = await f.rules.read(
      f.turn,
      'rules_search',
      searchInput,
      'run:search',
      f.lookup,
      undefined,
      { scope: 'run:', receiptIds: [] }
    );
    const entry = hit(search.payload);
    const original = await f.rules.read(
      f.turn,
      'rules_get',
      { path: rulePath, locator: entry.locator },
      'run:original',
      f.lookup
    );
    const fresh = new RuleLookup();
    const replay = await new RuleStore(store).read(
      f.turn,
      'rules_search',
      searchInput,
      'run:search',
      fresh,
      undefined,
      { scope: 'run:', receiptIds: [original.id] }
    );
    assert.deepEqual(replay, search, 'Uncertain transport retries keep the original response');
    assert.equal(hit(replay.payload).alreadySupplied, undefined);
    const recovered = await f.rules.read(
      f.turn,
      'rules_get',
      { path: rulePath, locator: entry.locator },
      'run:recovered',
      fresh
    );
    assert.equal(recovered.payload.error, undefined);
    assert.equal(recovered.payload.start, entry.matchWindow.start);
    assert.equal(recovered.payload.text, original.payload.text);
    await assert.rejects(
      f.rules.read(f.turn, 'rules_search', { query: 'spirit' }, 'run:search', fresh),
      /reused with changed arguments/
    );
  }
);

test(
  'delivery receipts and replayed locators cannot outlive a rule content change',
  { skip: !dbEnabled },
  async () => {
    const f = await fixture();
    const original = await f.rules.read(
      f.turn,
      'rules_get',
      { path: rulePath },
      'run:original',
      f.lookup
    );
    await f.rules.read(f.turn, 'rules_search', searchInput, 'run:search', f.lookup);
    await f.rules.publish(f.context.systemId, f.context.revision, (current) => {
      const content = structuredClone(ruleContent(current));
      content.core_rules.book!.children.deep!.text += ' New authoritative ending.';
      return content;
    });
    await assert.rejects(
      f.rules.read(
        f.turn,
        'rules_search',
        searchInput,
        'run:new_search',
        new RuleLookup(),
        undefined,
        { scope: 'run:', receiptIds: [original.id] }
      ),
      invalidEvidence
    );
    await assert.rejects(
      f.rules.read(f.turn, 'rules_search', searchInput, 'run:search', new RuleLookup()),
      (error: unknown) => error instanceof Problem && error.code === 'rules_context_changed'
    );
  }
);

test(
  'advancement resume restores persisted search locators before a fresh original read',
  { skip: !dbEnabled },
  async () => {
    const f = await fixture();
    const seeded = await seedCampaign(store, [
      { action: 'Resolve the trial', narrative: 'The trial succeeded.' },
    ]);
    seeded.campaign.ruleSystemId = f.context.systemId;
    await store.transaction((client) => store.save(seeded.campaign, client));
    let calls = 0;
    let savedSearch: Record<string, unknown> | undefined;
    let recoveredOriginal: Record<string, unknown> | undefined;
    let providerFailure: unknown;
    const generator: Generator = {
      capacity: async () => 16000,
      generate: async () => {
        throw new Error('Unexpected provider fallback');
      },
      generateOwnedGameplay: async (_settings, _prompt, _schema, _system, tools) => {
        calls++;
        const search = await tools('rules_search', searchInput, 'search_identity');
        if (calls === 1) {
          savedSearch = search as Record<string, unknown>;
          throw new Error('Synthetic provider interruption after search delivery');
        }
        try {
          assert.deepEqual(search, savedSearch, 'Resume must replay the persisted search response');
          const entry = hit(search as Record<string, unknown>);
          recoveredOriginal = (await tools(
            'rules_get',
            { path: rulePath, locator: entry.locator },
            'original_identity'
          )) as Record<string, unknown>;
          assert.equal(recoveredOriginal.error, undefined);
          assert.equal(recoveredOriginal.start, entry.matchWindow.start);
          assert.match(recoveredOriginal.text as string, /Awakening/);
        } catch (error) {
          providerFailure = error;
          throw error;
        }
        return {
          outcome: AdvancementOutcome.Reviewed,
          rewardSystem: {
            key: 'synthetic',
            label: 'Synthetic fixture',
            editionLabel: 'Fixture edition',
          },
          explanation: 'The trial completed.',
          progressionBasis: 'Award progression for completed trials.',
          progressionBasisKind: AdvancementBasis.HouseRule,
          awards: [],
          cumulativeSummary: 'One trial completed.',
          pendingObjectives: [],
          ruleEvidence: [],
        };
      },
    };
    const service = new AdvancementService(store, generator);
    const started = await service.start(seeded.campaign.id, randomUUID());
    assert.ok(started);
    async function settled() {
      for (let attempt = 0; attempt < 300; attempt++) {
        const review = await service.status(seeded.campaign.id, started!.id);
        if (review.status !== AdvancementStatus.Running) return review;
        await sleep(15);
      }
      throw new Error('Synthetic advancement review did not settle');
    }
    assert.equal((await settled()).status, AdvancementStatus.Failed);
    await service.decide(seeded.campaign.id, started.id, 'resume', { requestId: randomUUID() });
    const resumed = await settled();
    if (providerFailure) throw providerFailure;
    assert.equal(
      resumed.status,
      AdvancementStatus.Ready,
      resumed.safeError ?? 'Expected resumed review'
    );
    assert.equal(calls, 2);
    assert.ok(recoveredOriginal);
    const reads = await store.pool.query(
      'SELECT tool,payload FROM advancement_reads WHERE review_id=$1 ORDER BY created_at',
      [started.id]
    );
    assert.equal(
      reads.rows.filter((read) => read.tool === 'rules_search').length,
      1,
      'Replaying the search must not create another receipt'
    );
    assert.equal(reads.rows.filter((read) => read.tool === 'rules_get').length, 1);
  }
);

test(
  'TurnService scopes delivered originals to each response correction execution',
  { skip: !dbEnabled },
  async () => {
    const f = await fixture();
    const campaign = newCampaign({
      name: 'Turn repair delivery fixture',
      systemId: f.context.systemId,
    });
    await store.insert(campaign);
    let executions = 0;
    let firstReceipt: string | undefined;
    let correctedReceipt: string | undefined;
    let providerAssertion: unknown;
    const generator: Generator = {
      capacity: async () => 16000,
      gameplayCapacity: async () => 16000,
      bookGameplayCapacity: async () => 16000,
      generate: syntheticGenerate(),
      generateOwnedGameplay: async (_settings, prompt, _schema, _system, tools) => {
        executions++;
        try {
          const found = (await tools('rules_find', searchInput, 'first_find')) as {
            search: Record<string, unknown>;
            reads: Record<string, unknown>[];
          };
          assert.equal(
            found.search.suppliedEvidenceCaptured,
            true,
            'The actual turn reader must persist its execution delivery snapshot'
          );
          assert.equal(
            found.reads.length,
            1,
            'Each new correction execution starts with no supplied originals'
          );
          assert.equal(hit(found.search).alreadySupplied, undefined);
          const receipt = found.reads[0]!.receipt as string;
          if (executions === 1) firstReceipt = receipt;
          else {
            assert.match(prompt, /Response correction:/);
            correctedReceipt = receipt;
            assert.notEqual(
              correctedReceipt,
              firstReceipt,
              'The new registry must not reuse a prior correction receipt'
            );
          }
          const repeated = (await tools('rules_find', searchInput, 'second_find')) as {
            search: Record<string, unknown>;
            reads: Record<string, unknown>[];
            suppliedOriginals: { receiptId: string }[];
          };
          assert.equal(repeated.search.suppliedEvidenceCaptured, true);
          assert.equal(
            repeated.reads.length,
            0,
            'A second find in the same execution must reuse its delivered original'
          );
          assert.equal(hit(repeated.search).matchSupplied, true);
          assert.deepEqual(
            repeated.suppliedOriginals.map((value) => value.receiptId),
            [receipt]
          );
        } catch (error) {
          providerAssertion = error;
          throw error;
        }
        // Malformed final provider JSON reaches the real outer response-correction path.
        if (executions === 1)
          throw new Problem(502, 'provider_json', 'Synthetic invalid final JSON');
        return emptyResponse;
      },
    };
    const service = new TurnService(store, generator);
    const submitted = await service.submit(campaign.id, {
      revision: campaign.revision,
      requestId: randomUUID(),
      action: 'Consult the awakening rule',
    });
    let finished: Turn | undefined;
    for (let attempt = 0; attempt < 300; attempt++) {
      const current = await store.turn(campaign.id, submitted.id);
      if (![TurnStatus.Pending, TurnStatus.Running].includes(current.status as TurnStatus)) {
        finished = current;
        break;
      }
      await sleep(15);
    }
    if (providerAssertion) throw providerAssertion;
    assert.ok(finished, 'Synthetic turn must reach a terminal status');
    assert.equal(
      finished.status,
      TurnStatus.Completed,
      finished.error ?? 'Expected completed correction'
    );
    assert.equal(executions, 2);
    const receipts = await store.pool.query(
      'SELECT id,tool_name,transport_request_id,payload FROM turn_rule_reads WHERE turn_id=$1',
      [submitted.id]
    );
    for (const [attempt, originalId] of [
      [0, firstReceipt],
      [1, correctedReceipt],
    ] as const) {
      const reads = receipts.rows.filter((row) =>
        row.transport_request_id.startsWith(`repair:${attempt}:`)
      );
      assert.equal(reads.filter((row) => row.tool_name === 'rules_get').length, 1);
      assert.equal(reads.filter((row) => row.tool_name === 'rules_search').length, 2);
      const reused = reads
        .filter((row) => row.tool_name === 'rules_search')
        .find((row) => hit(row.payload).matchSupplied);
      assert.ok(reused);
      assert.deepEqual(
        hit(reused.payload).suppliedOriginals?.map((value) => value.receiptId),
        [originalId]
      );
    }
  }
);
