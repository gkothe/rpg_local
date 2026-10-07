import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Store } from '../src/store.js';
import { JournalService } from '../src/services/journal.js';
import { TurnService } from '../src/services/turns.js';
import { JournalJobKind, JournalJobStatus } from '../src/domain/journal.js';
import {
  KnowledgeCertainty as C,
  KnowledgeKind as K,
  KnowledgeStatus as S,
} from '../src/domain/knowledge.js';
import { Problem } from '../src/errors.js';
import {
  deferred,
  dbEnabled,
  excerptTurn,
  fakeGenerator,
  knowledgeRecord,
  openIsolatedStore,
  saveSnapshot,
  seedCampaign,
  sleep,
  waitForJob,
} from './journalFixture.js';

let isolated: Awaited<ReturnType<typeof openIsolatedStore>>;
let store: Store;
before(async () => {
  if (!dbEnabled) return;
  isolated = await openIsolatedStore('journal_backfill');
  store = isolated.store;
});
after(async () => {
  if (dbEnabled) await isolated.close();
});

const BORROW = 'borrow the healer book';
const RETURNED = 'handed back the book';
const pairs = (middle: number) => [
  { action: 'I ask', narrative: `You ${BORROW} and promise to return it.` },
  ...Array.from({ length: middle }, (_, i) => ({ action: `walk ${i}`, narrative: `Scene ${i}.` })),
  { action: 'I return it', narrative: `You ${RETURNED} and she thanks you.` },
];
const entry = (turnId: string, phrase: string, over: Record<string, unknown> = {}) => ({
  ref: 'book',
  existingId: null,
  kind: K.Debt,
  title: 'Return the book',
  text: 'Return the healer book.',
  certainty: C.Established,
  status: S.Active,
  characterIds: [],
  related: [],
  quotes: [{ turnId, field: 'narrative', quote: phrase }],
  ...over,
});
/** Cross-batch promise: introduced in the first turn, kept in the last. */
const promiseGenerator = (hold?: Promise<void>) =>
  fakeGenerator(
    async (prompt, signal) => {
      if (hold) {
        await Promise.race([
          hold,
          new Promise((_, reject) =>
            signal?.addEventListener('abort', () => reject(new Error('aborted')))
          ),
        ]);
      }
      const entries = [];
      const borrow = excerptTurn(prompt, BORROW);
      if (borrow) entries.push(entry(borrow.turnId, BORROW));
      const back = excerptTurn(prompt, RETURNED);
      if (back)
        entries.push(
          entry(back.turnId, RETURNED, {
            status: S.Resolved,
            text: 'Returned the healer book; she owes you a favor.',
          })
        );
      return { entries };
    },
    // Far below the prompt overhead: every field becomes its own sequential batch.
    100
  );

test(
  'whole-history backfill covers more than 100 turns, commits once and replays without duplicates',
  { skip: !dbEnabled },
  async () => {
    const { campaign, turns } = await seedCampaign(store, pairs(104));
    const generator = promiseGenerator();
    const journal = new JournalService(store, generator);
    const requestId = randomUUID();
    const started = await journal.start(campaign.id, JournalJobKind.Backfill, requestId);
    assert.equal(started.status, JournalJobStatus.Running);
    const finished = await waitForJob(journal, campaign.id, started.id, 60_000);
    assert.equal(finished.status, JournalJobStatus.Completed, finished.error?.message);
    assert.deepEqual(finished.progress, {
      processedPairs: turns.length,
      eligiblePairs: turns.length,
      created: 1,
      skipped: 0,
    });
    const seen = new Set(
      generator.calls.flatMap((c) => (c.excerpts as { turnId: string }[]).map((e) => e.turnId))
    );
    assert.equal(seen.size, turns.length, 'no fixed recent-turn cutoff');
    assert.ok(generator.calls.length > 100, 'many sequential batches');
    const saved = await store.campaign(campaign.id);
    assert.equal(saved.knowledge?.length, 1, 'one resolved entry, not two');
    const record = saved.knowledge![0]!;
    assert.equal(record.status, S.Resolved);
    assert.equal(record.createdTurnId, null);
    assert.equal(saved.journal?.events.length, 1);
    assert.equal(saved.journal?.coverageTurnIds.length, turns.length);
    // Exact request replay refers to the original run and starts nothing new.
    const callsBefore = generator.calls.length;
    const replay = await journal.start(campaign.id, JournalJobKind.Backfill, requestId);
    assert.equal(replay.id, started.id);
    assert.equal(generator.calls.length, callsBefore);
    // A distinct later run captures the history again and adds nothing that already exists.
    const again = await journal.start(campaign.id, JournalJobKind.Backfill, randomUUID());
    const second = await waitForJob(journal, campaign.id, again.id, 60_000);
    assert.equal(second.status, JournalJobStatus.Completed, second.error?.message);
    assert.equal((await store.campaign(campaign.id)).knowledge?.length, 1);
    await assert.rejects(
      () =>
        journal.start(campaign.id, JournalJobKind.Check, requestId, {
          entryId: record.id,
          explanation: 'x',
        }),
      (e: Problem) => e.code === 'journal_request_reused'
    );
  }
);

test(
  'cancel commits nothing and a running job blocks other work but not notes',
  { skip: !dbEnabled },
  async () => {
    const { campaign } = await seedCampaign(store, pairs(3));
    const gate = deferred();
    const generator = promiseGenerator(gate.promise);
    const journal = new JournalService(store, generator);
    const job = await journal.start(campaign.id, JournalJobKind.Backfill, randomUUID());
    while (!generator.calls.length) await sleep(10);
    await assert.rejects(
      () => journal.start(campaign.id, JournalJobKind.Backfill, randomUUID()),
      (e: Problem) => e.code === 'journal_busy'
    );
    await assert.rejects(
      () => store.transaction((client) => store.assertIdle(campaign.id, client)),
      (e: Problem) => e.code === 'journal_busy'
    );
    await store.edit(campaign.id, 0, (c) => {
      c.notes = 'Personal notes stay writable';
    });
    const cancelled = await journal.cancel(campaign.id, job.id);
    assert.equal(cancelled.status, JournalJobStatus.Cancelled);
    gate.resolve();
    await sleep(100);
    const saved = await store.campaign(campaign.id);
    assert.equal(saved.journal, undefined);
    assert.equal(saved.knowledge?.length ?? 0, 0);
    assert.equal((await journal.status(campaign.id, job.id)).status, JournalJobStatus.Cancelled);
    // Cancellation is idempotent.
    assert.equal((await journal.cancel(campaign.id, job.id)).status, JournalJobStatus.Cancelled);
  }
);

test(
  'a notes-only change does not reject the commit; changed facts or history do',
  { skip: !dbEnabled },
  async () => {
    const known = knowledgeRecord('Known', 'Known text');
    const { campaign } = await seedCampaign(store, pairs(2), [known]);
    const gate = deferred();
    const generator = promiseGenerator(gate.promise);
    const journal = new JournalService(store, generator);
    const ok = await journal.start(campaign.id, JournalJobKind.Backfill, randomUUID());
    while (!generator.calls.length) await sleep(10);
    await store.edit(campaign.id, 0, (c) => {
      c.notes = 'only notes changed';
    });
    gate.resolve();
    assert.equal(
      (await waitForJob(journal, campaign.id, ok.id)).status,
      JournalJobStatus.Completed
    );

    const gate2 = deferred();
    const generator2 = promiseGenerator(gate2.promise);
    const journal2 = new JournalService(store, generator2);
    const stale = await journal2.start(campaign.id, JournalJobKind.Backfill, randomUUID());
    while (!generator2.calls.length) await sleep(10);
    await store.edit(campaign.id, 0, (c) => {
      c.knowledge!.find((r) => r.id === known.id)!.text = 'Changed canon';
      c.knowledge!.find((r) => r.id === known.id)!.revision++;
    });
    gate2.resolve();
    const failed = await waitForJob(journal2, campaign.id, stale.id);
    assert.equal(failed.status, JournalJobStatus.Failed);
    assert.equal(failed.error?.code, 'journal_changed');
    assert.equal(
      (await store.campaign(campaign.id)).journal?.events.length,
      1,
      'only the first run committed'
    );
  }
);

test(
  'a failed run can be retried with its saved capture and then completes',
  { skip: !dbEnabled },
  async () => {
    const { campaign } = await seedCampaign(store, pairs(2));
    let failOnce = true;
    const good = promiseGenerator();
    const generator = fakeGenerator((prompt, signal) => {
      if (failOnce) {
        failOnce = false;
        throw new Problem(502, 'provider_failure', 'Local process failed');
      }
      return (good.generate as (...a: unknown[]) => unknown)(
        {},
        JSON.stringify(prompt),
        {},
        signal
      );
    }, 100);
    const journal = new JournalService(store, generator);
    const job = await journal.start(campaign.id, JournalJobKind.Backfill, randomUUID());
    const failed = await waitForJob(journal, campaign.id, job.id);
    assert.equal(failed.status, JournalJobStatus.Failed);
    assert.equal(failed.error?.code, 'provider_failure');
    assert.equal((await store.campaign(campaign.id)).journal, undefined, 'failure commits nothing');
    const retried = await journal.retry(campaign.id, job.id);
    assert.equal(retried.id, job.id);
    const done = await waitForJob(journal, campaign.id, job.id);
    assert.equal(done.status, JournalJobStatus.Completed, done.error?.message);
    assert.equal((await store.campaign(campaign.id)).knowledge?.length, 1);
  }
);

test(
  'undoing the latest turn rewinds backfill contributions that cite it, one turn at a time',
  { skip: !dbEnabled },
  async () => {
    const { campaign, turns } = await seedCampaign(store, pairs(1));
    const journal = new JournalService(store, promiseGenerator());
    const job = await journal.start(campaign.id, JournalJobKind.Backfill, randomUUID());
    assert.equal(
      (await waitForJob(journal, campaign.id, job.id)).status,
      JournalJobStatus.Completed
    );
    const service = new TurnService(
      store,
      fakeGenerator(() => ({}))
    );
    const [first, , last] = turns;
    // The promise was kept in the latest turn; undoing it makes the promise active again.
    const afterLast = await service.undo(campaign.id, 0);
    const active = afterLast.knowledge![0]!;
    assert.equal(active.status, S.Active);
    assert.equal(active.text, 'Return the healer book.');
    assert.ok(afterLast.journal!.undoneTurnIds.includes(last!.id));
    assert.ok(!afterLast.journal!.coverageTurnIds.includes(last!.id));
    assert.equal(afterLast.journal!.events.length, 1, 'audit event is immutable');
    await service.undo(campaign.id, 0);
    const afterFirst = await service.undo(campaign.id, 0);
    assert.equal(afterFirst.knowledge!.length, 0, 'nothing left to support the recovered promise');
    assert.ok(afterFirst.journal!.undoneTurnIds.includes(first!.id));
    // The audit turn stays marked undone for evidence labelling.
    assert.equal((await store.turn(campaign.id, last!.id)).undone, true);
  }
);

test(
  'a recovered active promise resolved by a later gameplay turn undoes back to the recovered row',
  { skip: !dbEnabled },
  async () => {
    const { campaign, turns } = await seedCampaign(store, pairs(0).slice(0, 1));
    const journal = new JournalService(store, promiseGenerator());
    const job = await journal.start(campaign.id, JournalJobKind.Backfill, randomUUID());
    assert.equal(
      (await waitForJob(journal, campaign.id, job.id)).status,
      JournalJobStatus.Completed
    );
    const recovered = (await store.campaign(campaign.id)).knowledge![0]!;
    assert.equal(recovered.status, S.Active);
    // Gameplay turn 2 resolves the same row (written as the ordinary turn commit would).
    const resolved = {
      ...structuredClone(recovered),
      status: S.Resolved,
      text: 'Returned the book.',
      revision: recovered.revision + 1,
      updatedTurnId: null as string | null,
    };
    const t2 = randomUUID();
    const createdAt = new Date(2026, 5, 1).toISOString();
    await store.pool.query(
      'INSERT INTO turns(id,campaign_id,request_id,payload_hash,status,document,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        t2,
        campaign.id,
        randomUUID(),
        'fixture',
        'completed',
        {
          id: t2,
          campaignId: campaign.id,
          requestId: randomUUID(),
          status: 'completed',
          action: 'x',
          narrative: 'y',
          changes: [],
          error: null,
          undone: false,
          settings: campaign.settings,
          context: null,
          createdAt,
          completedAt: createdAt,
        },
        createdAt,
      ]
    );
    resolved.updatedTurnId = t2;
    await saveSnapshot(store, campaign.id, {
      turnId: t2,
      beforeKnowledge: [recovered],
      afterKnowledge: [resolved],
    });
    await store.edit(campaign.id, 0, (c) => {
      c.knowledge = [resolved];
    });
    const restored = await new TurnService(
      store,
      fakeGenerator(() => ({}))
    ).undo(campaign.id, 0);
    assert.deepEqual(restored.knowledge![0], recovered);
    assert.ok(
      !restored.journal!.undoneTurnIds.includes(t2),
      'gameplay undo is not a ledger rewind'
    );
    assert.ok(turns[0]);
  }
);
