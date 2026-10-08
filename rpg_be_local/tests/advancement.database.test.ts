import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Store } from '../src/store.js';
import type { Generator } from '../src/providers/service.js';
import { AdvancementService, type AdvancementReview } from '../src/services/advancement.js';
import {
  AdvancementBasis as Basis,
  AdvancementKind as Kind,
  AdvancementOutcome as Outcome,
  AdvancementStatus as Status,
  type AdvancementProposal,
} from '../src/domain/advancement.js';
import { CharacterType, SourceKind, SourceStatus } from '../src/domain/options.js';
import { dbEnabled, openIsolatedStore, seedCampaign, sleep, deferred } from './journalFixture.js';

let isolated: Awaited<ReturnType<typeof openIsolatedStore>>;
let store: Store;
before(async () => {
  if (!dbEnabled) return;
  isolated = await openIsolatedStore('advancement');
  store = isolated.store;
});
after(async () => {
  if (dbEnabled) await isolated.close();
});

async function fixture(turnCount = 2) {
  const seeded = await seedCampaign(
    store,
    Array.from({ length: turnCount }, (_, i) => ({
      action: `Complete objective ${i}`,
      narrative: `Objective ${i} completed.`,
    }))
  );
  const characterId = randomUUID();
  seeded.campaign.characters.push({
    id: characterId,
    name: 'Test player',
    type: CharacterType.Player,
    attributes: { xp: 999, nested: { level: 4 } },
    inventory: { coins: 12 },
    description: { custom: 'free-form sheet' },
    notes: 'Private player notes',
    revision: 3,
  });
  await store.transaction(async (client) => store.save(seeded.campaign, client));
  return { ...seeded, characterId };
}

function proposal(
  characterId: string,
  turnIds: string[],
  amount: number | null = 10
): AdvancementProposal {
  return {
    outcome: Outcome.Reviewed,
    rewardSystem: { key: 'test_system_edition', label: 'Test system', editionLabel: 'Edition 1' },
    explanation: 'Completed an objective.',
    progressionBasis: 'Earn progression from completed objectives during continuous play.',
    progressionBasisKind: Basis.HouseRule,
    awards:
      amount === null
        ? []
        : [
            {
              characterId,
              kind: Kind.Resource,
              unitKey: 'xp',
              unitLabel: 'XP',
              amount,
              reason: 'Objective completed',
              basis: 'Continuous play objective reward',
              basisKind: Basis.HouseRule,
              evidenceTurnIds: turnIds,
            },
          ],
    cumulativeSummary: 'The player completed an objective.',
    pendingObjectives: [],
    ruleEvidence: [],
  };
}

function provider(
  respond: (prompt: Record<string, unknown>, signal?: AbortSignal) => unknown | Promise<unknown>
) {
  const calls: Record<string, unknown>[] = [];
  const generator: Generator = {
    capacity: async () => 16000,
    generate: async () => {
      throw new Error('Unexpected fallback generation');
    },
    generateOwnedGameplay: async (_settings, prompt, _schema, _system, _tools, signal) => {
      const parsed = JSON.parse(prompt) as Record<string, unknown>;
      calls.push(parsed);
      return respond(parsed, signal);
    },
  };
  return { generator, calls };
}

async function ready(service: AdvancementService, campaignId: string, id: string) {
  for (let i = 0; i < 300; i++) {
    const review = await service.status(campaignId, id);
    if (review.status !== Status.Running) {
      assert.equal(review.status, Status.Ready, review.safeError ?? 'Expected ready proposal');
      return review;
    }
    await sleep(15);
  }
  throw new Error('Advancement generation did not finish');
}

async function startReady(service: AdvancementService, campaignId: string) {
  const review = await service.start(campaignId, randomUUID());
  assert.ok(review);
  return ready(service, campaignId, review.id);
}

async function apply(
  service: AdvancementService,
  review: AdvancementReview,
  requestId = randomUUID()
) {
  return service.decide(review.campaignId, review.id, 'apply', {
    requestId,
    proposalDigest: review.proposalDigest!,
  });
}

test(
  'direct edits apply final awards once and never mutate the character sheet',
  { skip: !dbEnabled },
  async () => {
    const f = await fixture();
    const ai = provider(() =>
      proposal(
        f.characterId,
        f.turns.map((t) => t.id)
      )
    );
    const service = new AdvancementService(store, ai.generator);
    const review = await startReady(service, f.campaign.id);
    assert.equal((await service.summary(f.campaign.id)).ledger.length, 0);
    const edited = structuredClone(review.proposal!);
    edited.awards[0]!.amount = 17.5;
    edited.awards[0]!.reason = 'Player adjusted the earned reward';
    const adjusted = await service.decide(f.campaign.id, review.id, 'adjust', {
      requestId: randomUUID(),
      proposalDigest: review.proposalDigest!,
      proposal: edited,
      adjustmentReason: 'Correct the objective reward',
    });
    assert.equal(ai.calls.length, 1, 'Direct editing must not invoke the provider again');
    await assert.rejects(apply(service, review), /Proposal changed/);
    const requestId = randomUUID();
    const saved = await apply(service, adjusted, requestId);
    assert.deepEqual(await apply(service, adjusted, requestId), saved);
    assert.equal(saved.originalProposal!.awards[0]!.amount, 10);
    assert.equal(saved.awards[0]!.amount, 17.5);
    const summary = await service.summary(f.campaign.id);
    assert.equal(summary.players[0]!.totals[0]!.total, 17.5);
    assert.equal(summary.ledger.length, 1);
    assert.equal((await service.list(f.campaign.id)).outstandingTurnCount, 0);
    assert.deepEqual((await store.campaign(f.campaign.id)).characters, f.campaign.characters);
    assert.equal(await service.start(f.campaign.id, randomUUID()), null);
    assert.equal(ai.calls.length, 1);
  }
);

test(
  'zero-award Apply covers turns; discard leaves them eligible',
  { skip: !dbEnabled },
  async () => {
    const f = await fixture();
    const ai = provider(() => proposal(f.characterId, [], null));
    const service = new AdvancementService(store, ai.generator);
    const discarded = await startReady(service, f.campaign.id);
    await service.decide(f.campaign.id, discarded.id, 'discard', { requestId: randomUUID() });
    assert.equal((await service.list(f.campaign.id)).outstandingTurnCount, 2);
    const review = await startReady(service, f.campaign.id);
    await apply(service, review);
    assert.equal((await service.list(f.campaign.id)).outstandingTurnCount, 0);
    assert.deepEqual((await service.summary(f.campaign.id)).players[0]!.totals, []);
  }
);

test(
  'future review receives only newly eligible turns plus prior summary and ledger',
  { skip: !dbEnabled },
  async () => {
    const f = await fixture(1);
    const ai = provider((prompt) =>
      proposal(
        f.characterId,
        (prompt.unreviewedTurns as { id: string }[]).map((t) => t.id)
      )
    );
    const service = new AdvancementService(store, ai.generator);
    await apply(service, await startReady(service, f.campaign.id));
    const other = await seedCampaign(store, [
      { action: 'Second action', narrative: 'Second objective completed.' },
    ]);
    const newTurn = other.turns[0]!;
    newTurn.campaignId = f.campaign.id;
    await store.pool.query('UPDATE turns SET campaign_id=$2,document=$3 WHERE id=$1', [
      newTurn.id,
      f.campaign.id,
      newTurn,
    ]);
    const second = await startReady(service, f.campaign.id);
    assert.deepEqual(
      (ai.calls[1]!.unreviewedTurns as { id: string }[]).map((t) => t.id),
      [newTurn.id]
    );
    assert.equal(ai.calls[1]!.previousSummary, 'The player completed an objective.');
    assert.equal((ai.calls[1]!.previousAwards as unknown[]).length, 1);
    await apply(service, second);
    assert.equal((await service.summary(f.campaign.id)).players[0]!.totals[0]!.total, 20);
    await assert.rejects(
      service.decide(
        f.campaign.id,
        (await service.list(f.campaign.id)).reviews.find((r) => r.id !== second.id)!.id,
        'reverse',
        { requestId: randomUUID() }
      ),
      /newest first/
    );
    await service.decide(f.campaign.id, second.id, 'reverse', { requestId: randomUUID() });
    assert.equal((await service.summary(f.campaign.id)).players[0]!.totals[0]!.total, 10);
    assert.equal((await service.list(f.campaign.id)).outstandingTurnCount, 1);
    assert.deepEqual((await store.campaign(f.campaign.id)).characters, f.campaign.characters);
  }
);

test(
  'stale evidence blocks Apply while unrelated sheet edits remain valid',
  { skip: !dbEnabled },
  async () => {
    const f = await fixture(1);
    const ai = provider(() => proposal(f.characterId, [f.turns[0]!.id]));
    const service = new AdvancementService(store, ai.generator);
    const review = await startReady(service, f.campaign.id);
    await store.transaction(async (client) => {
      const campaign = await store.campaign(f.campaign.id, client, true);
      campaign.characters[0]!.attributes.xp = 1000;
      campaign.characters[0]!.revision++;
      await store.save(campaign, client);
    });
    await apply(service, review);
    assert.equal((await store.campaign(f.campaign.id)).characters[0]!.attributes.xp, 1000);
    await service.decide(f.campaign.id, review.id, 'reverse', { requestId: randomUUID() });
    const stale = await startReady(service, f.campaign.id);
    const turn = await store.turn(f.campaign.id, f.turns[0]!.id);
    turn.narrative = 'Changed objective result';
    await store.pool.query('UPDATE turns SET document=$2 WHERE id=$1', [turn.id, turn]);
    await assert.rejects(apply(service, stale), /gameplay changed/);
    assert.equal((await service.summary(f.campaign.id)).ledger.length, 0);
    assert.equal((await service.list(f.campaign.id)).outstandingTurnCount, 1);
  }
);

test(
  'cancelled execution cannot publish a late proposal and retains unreviewed turns',
  { skip: !dbEnabled },
  async () => {
    const f = await fixture(1);
    const gate = deferred<AdvancementProposal>();
    const entered = deferred();
    const ai = provider(async () => {
      entered.resolve();
      return gate.promise;
    });
    const service = new AdvancementService(store, ai.generator);
    const started = await service.start(f.campaign.id, randomUUID());
    assert.ok(started);
    await entered.promise;
    const requestId = randomUUID();
    const cancelled = await service.decide(f.campaign.id, started.id, 'cancel', { requestId });
    assert.equal(cancelled.status, Status.Cancelled);
    assert.deepEqual(
      await service.decide(f.campaign.id, started.id, 'cancel', { requestId }),
      cancelled
    );
    gate.resolve(proposal(f.characterId, [f.turns[0]!.id]));
    await sleep(60);
    assert.equal((await service.status(f.campaign.id, started.id)).status, Status.Cancelled);
    assert.equal((await service.list(f.campaign.id)).outstandingTurnCount, 1);
    assert.equal((await service.summary(f.campaign.id)).ledger.length, 0);
  }
);

test(
  'campaign scoping and decision request identity prevent cross-campaign or changed replay',
  { skip: !dbEnabled },
  async () => {
    const f = await fixture(1);
    const other = await fixture(1);
    const ai = provider(() => proposal(f.characterId, [f.turns[0]!.id]));
    const service = new AdvancementService(store, ai.generator);
    const review = await startReady(service, f.campaign.id);
    await assert.rejects(service.status(other.campaign.id, review.id), /not found/);
    await assert.rejects(
      service.decide(other.campaign.id, review.id, 'apply', {
        requestId: randomUUID(),
        proposalDigest: review.proposalDigest!,
      }),
      /not found/
    );
    const requestId = randomUUID();
    await apply(service, review, requestId);
    await assert.rejects(
      service.decide(f.campaign.id, review.id, 'reverse', { requestId }),
      /identity reused/
    );
    assert.equal((await service.summary(other.campaign.id)).ledger.length, 0);
  }
);

test(
  'invalid provider evidence fails without coverage and can be discarded',
  { skip: !dbEnabled },
  async () => {
    const f = await fixture(1);
    const ai = provider(() => proposal(f.characterId, [randomUUID()]));
    const service = new AdvancementService(store, ai.generator);
    const started = await service.start(f.campaign.id, randomUUID());
    assert.ok(started);
    for (
      let i = 0;
      i < 300 && (await service.status(f.campaign.id, started.id)).status === Status.Running;
      i++
    )
      await sleep(15);
    assert.equal((await service.status(f.campaign.id, started.id)).status, Status.Failed);
    assert.equal((await service.list(f.campaign.id)).outstandingTurnCount, 1);
    await service.decide(f.campaign.id, started.id, 'discard', { requestId: randomUUID() });
  }
);

test(
  'incompatible system editions remain separate and eligibility is a history count',
  { skip: !dbEnabled },
  async () => {
    const f = await fixture(1);
    let system = 'edition_one';
    let eligibility = false;
    const ai = provider((prompt) => {
      const p = proposal(
        f.characterId,
        (prompt.unreviewedTurns as { id: string }[]).map((t) => t.id)
      );
      p.rewardSystem.key = system;
      p.rewardSystem.editionLabel = system;
      if (eligibility) {
        p.awards[0]!.kind = Kind.Eligibility;
        p.awards[0]!.amount = null;
        p.awards[0]!.unitKey = 'milestone';
        p.awards[0]!.unitLabel = 'Milestone eligibility';
      }
      return p;
    });
    const service = new AdvancementService(store, ai.generator);
    await apply(service, await startReady(service, f.campaign.id));
    async function addTurn() {
      const other = await seedCampaign(store, [
        { action: 'Another achievement', narrative: 'New achievement completed.' },
      ]);
      const t = other.turns[0]!;
      t.campaignId = f.campaign.id;
      await store.pool.query('UPDATE turns SET campaign_id=$2,document=$3 WHERE id=$1', [
        t.id,
        f.campaign.id,
        t,
      ]);
    }
    await addTurn();
    system = 'edition_two';
    await apply(service, await startReady(service, f.campaign.id));
    await addTurn();
    eligibility = true;
    await apply(service, await startReady(service, f.campaign.id));
    const totals = (await service.summary(f.campaign.id)).players[0]!.totals;
    assert.equal(totals.length, 3);
    assert.deepEqual(
      totals.filter((t) => t.kind === Kind.Resource).map((t) => t.total),
      [10, 10]
    );
    assert.equal(totals.find((t) => t.kind === Kind.Eligibility)!.total, 1);
    assert.equal(new Set(totals.map((t) => t.currencyId)).size, 3);
  }
);

test(
  'review reference tools reject mutations and validate saved original campaign spans',
  { skip: !dbEnabled },
  async () => {
    const f = await fixture(1);
    const sourceId = randomUUID();
    const original = 'A completed objective earns ten points.';
    f.campaign.sources.push({
      id: sourceId,
      name: 'House rules',
      kind: SourceKind.Text,
      text: original,
      status: SourceStatus.Confirmed,
      version: 1,
      pages: [],
      warnings: [],
    });
    await store.transaction(async (client) => store.save(f.campaign, client));
    const ai = provider(() => {
      throw new Error('Owned provider override must run');
    });
    ai.generator.generateOwnedGameplay = async (_settings, _prompt, _schema, _system, tools) => {
      assert.ok(tools.definitions?.some((t) => t.name === 'campaign_sources_get'));
      assert.equal(
        tools.definitions?.some((t) => t.name === 'dice_roll'),
        false
      );
      await assert.rejects(tools('dice_roll', {}, randomUUID()), /Only reference lookup tools/);
      const args = { sourceId, version: 1, sectionIndex: 0 };
      const requestId = randomUUID();
      const read = (await tools('campaign_sources_get', args, requestId)) as Record<
        string,
        unknown
      >;
      assert.deepEqual(await tools('campaign_sources_get', args, requestId), read);
      await assert.rejects(
        tools('campaign_sources_get', { ...args, sectionIndex: 1 }, requestId),
        /identity reused/
      );
      const p = proposal(f.characterId, [f.turns[0]!.id]);
      p.progressionBasisKind = Basis.Campaign;
      p.awards[0]!.basisKind = Basis.Campaign;
      p.ruleEvidence = [{ receiptId: read.receiptId as string, quote: original }];
      return p;
    };
    const service = new AdvancementService(store, ai.generator);
    const review = await startReady(service, f.campaign.id);
    await apply(service, review);
    const reads = await store.pool.query('SELECT * FROM advancement_reads WHERE review_id=$1', [
      review.id,
    ]);
    assert.equal(reads.rowCount, 1);
  }
);

test(
  'instruction changes and deleted recipients cannot be applied from a stale proposal',
  { skip: !dbEnabled },
  async () => {
    const f = await fixture(1);
    const ai = provider(() => proposal(f.characterId, [f.turns[0]!.id]));
    const service = new AdvancementService(store, ai.generator);
    const review = await startReady(service, f.campaign.id);
    await store.transaction(async (client) => {
      const campaign = await store.campaign(f.campaign.id, client, true);
      campaign.instructions = 'Use a different progression house rule.';
      await store.save(campaign, client);
    });
    await assert.rejects(apply(service, review), /instructions/);
    await service.decide(f.campaign.id, review.id, 'discard', { requestId: randomUUID() });
    const newReview = await startReady(service, f.campaign.id);
    await store.transaction(async (client) => {
      const campaign = await store.campaign(f.campaign.id, client, true);
      campaign.characters = [];
      await store.save(campaign, client);
    });
    await assert.rejects(apply(service, newReview), /no longer a player/);
    assert.equal((await service.list(f.campaign.id)).outstandingTurnCount, 1);
    assert.equal((await service.summary(f.campaign.id)).ledger.length, 0);
  }
);

test(
  'failed reviews resume with the same captured evidence and start identity replays',
  { skip: !dbEnabled },
  async () => {
    const f = await fixture(1);
    let attempts = 0;
    const ai = provider(() => {
      attempts++;
      if (attempts === 1) throw new Error('Mock provider unavailable');
      return proposal(f.characterId, [f.turns[0]!.id]);
    });
    const service = new AdvancementService(store, ai.generator);
    const requestId = randomUUID();
    const review = await service.start(f.campaign.id, requestId);
    assert.ok(review);
    for (
      let i = 0;
      i < 300 && (await service.status(f.campaign.id, review.id)).status === Status.Running;
      i++
    )
      await sleep(15);
    assert.equal((await service.status(f.campaign.id, review.id)).status, Status.Failed);
    assert.equal((await service.start(f.campaign.id, requestId))!.id, review.id);
    assert.equal(attempts, 1);
    await service.decide(f.campaign.id, review.id, 'resume', { requestId: randomUUID() });
    const staged = await ready(service, f.campaign.id, review.id);
    assert.equal(attempts, 2);
    assert.deepEqual(ai.calls[0]!.unreviewedTurns, ai.calls[1]!.unreviewedTurns);
    await apply(service, staged);
  }
);

test(
  'sequential batches accept system label variations and resume only unfinished evidence',
  { skip: !dbEnabled },
  async () => {
    const f = await fixture(3);
    let failSecond = true;
    const successfulIds: string[] = [];
    const ai = provider((prompt) => {
      const turns = prompt.unreviewedTurns as { id: string; gm: string }[];
      assert.equal(turns.length, 1, 'Small soft budget should yield one whole turn per batch');
      if (ai.calls.length === 2 && failSecond) {
        failSecond = false;
        throw new Error('Mock second batch failure');
      }
      successfulIds.push(turns[0]!.id);
      const p = proposal(f.characterId, [turns[0]!.id]);
      if (successfulIds.length > 1) p.rewardSystem.label = 'Test system Edition 1';
      p.cumulativeSummary = [prompt.previousSummary, turns[0]!.gm].filter(Boolean).join(' ');
      return p;
    });
    ai.generator.capacity = async () => 100;
    const service = new AdvancementService(store, ai.generator);
    const review = await service.start(f.campaign.id, randomUUID());
    assert.ok(review);
    for (
      let i = 0;
      i < 300 && (await service.status(f.campaign.id, review.id)).status === Status.Running;
      i++
    )
      await sleep(15);
    assert.equal((await service.status(f.campaign.id, review.id)).status, Status.Failed);
    const checkpoint = await store.pool.query(
      'SELECT checkpoint FROM advancement_reviews WHERE id=$1',
      [review.id]
    );
    assert.equal(checkpoint.rows[0].checkpoint.processed, 1);
    assert.equal(checkpoint.rows[0].checkpoint.proposal.awards.length, 1);
    assert.equal((await service.list(f.campaign.id)).outstandingTurnCount, 3);
    assert.equal((await service.summary(f.campaign.id)).ledger.length, 0);
    await service.decide(f.campaign.id, review.id, 'resume', { requestId: randomUUID() });
    const staged = await ready(service, f.campaign.id, review.id);
    assert.equal(ai.calls.length, 4);
    assert.deepEqual(
      successfulIds,
      f.turns.map((t) => t.id)
    );
    const resumedIds = ai.calls
      .slice(2)
      .flatMap((p) => (p.unreviewedTurns as { id: string }[]).map((t) => t.id));
    assert.deepEqual(
      resumedIds,
      f.turns.slice(1).map((t) => t.id)
    );
    assert.equal((ai.calls[2]!.previousAwards as unknown[]).length, 1);
    assert.equal((ai.calls[3]!.previousAwards as unknown[]).length, 2);
    assert.equal(staged.proposal!.awards.length, 3);
    assert.equal(staged.proposal!.cumulativeSummary, f.turns.map((t) => t.narrative).join(' '));
    await apply(service, staged);
    assert.equal((await service.summary(f.campaign.id)).players[0]!.totals[0]!.total, 30);
    assert.equal((await service.list(f.campaign.id)).outstandingTurnCount, 0);
  }
);

test(
  'invalid original-rule claims are not checkpointed as successfully reviewed turns',
  { skip: !dbEnabled },
  async () => {
    const f = await fixture(1);
    const ai = provider(() => {
      const p = proposal(f.characterId, [f.turns[0]!.id]);
      if (ai.calls.length === 1) p.progressionBasisKind = Basis.Original;
      return p;
    });
    const service = new AdvancementService(store, ai.generator);
    const review = await service.start(f.campaign.id, randomUUID());
    assert.ok(review);
    for (
      let i = 0;
      i < 300 && (await service.status(f.campaign.id, review.id)).status === Status.Running;
      i++
    )
      await sleep(15);
    assert.equal((await service.status(f.campaign.id, review.id)).status, Status.Failed);
    await service.decide(f.campaign.id, review.id, 'resume', { requestId: randomUUID() });
    const staged = await ready(service, f.campaign.id, review.id);
    assert.equal(ai.calls.length, 2, 'Invalid source claims must be regenerated on Resume');
    await apply(service, staged);
  }
);

test(
  'resume after cancellation rejects the old execution even if its provider completes late',
  { skip: !dbEnabled },
  async () => {
    const f = await fixture(1);
    const oldResult = deferred<AdvancementProposal>();
    const entered = deferred();
    const ai = provider(async () => {
      if (ai.calls.length === 1) {
        entered.resolve();
        return oldResult.promise;
      }
      return proposal(f.characterId, [f.turns[0]!.id], 20);
    });
    const service = new AdvancementService(store, ai.generator);
    const review = await service.start(f.campaign.id, randomUUID());
    assert.ok(review);
    await entered.promise;
    await service.decide(f.campaign.id, review.id, 'cancel', { requestId: randomUUID() });
    await service.decide(f.campaign.id, review.id, 'resume', { requestId: randomUUID() });
    oldResult.resolve(proposal(f.characterId, [f.turns[0]!.id], 10));
    const staged = await ready(service, f.campaign.id, review.id);
    assert.equal(ai.calls.length, 2, 'Resume must execute a fresh provider attempt');
    assert.equal(
      staged.proposal!.awards[0]!.amount,
      20,
      'Cancelled attempt must not publish its late result'
    );
  }
);
