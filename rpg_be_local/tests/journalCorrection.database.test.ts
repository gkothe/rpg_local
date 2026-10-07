import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Store } from '../src/store.js';
import { JournalService, type JournalJobView } from '../src/services/journal.js';
import { TurnService } from '../src/services/turns.js';
import {
  JournalCheckOutcome,
  JournalDecision,
  JournalJobKind,
  JournalJobStatus,
} from '../src/domain/journal.js';
import { KnowledgeCertainty as C, KnowledgeVisibility as V } from '../src/domain/knowledge.js';
import { Problem } from '../src/errors.js';
import type { Turn } from '../src/domain/types.js';
import {
  dbEnabled,
  excerptTurn,
  fakeGenerator,
  knowledgeRecord,
  openIsolatedStore,
  saveSnapshot,
  seedCampaign,
  waitForJob,
} from './journalFixture.js';

let isolated: Awaited<ReturnType<typeof openIsolatedStore>>;
let store: Store;
before(async () => {
  if (!dbEnabled) return;
  isolated = await openIsolatedStore('journal_correction');
  store = isolated.store;
});
after(async () => {
  if (dbEnabled) await isolated.close();
});

const OLD = 'Mira works for Ada at the inn';
const NEW = 'sister of the temple';
const CORRECTED = 'Mira is a sister of the temple.';
const turnPairs = [
  { action: 'I ask about her job', narrative: `${OLD}, she says.` },
  { action: 'I listen', narrative: `Mira admits she is a ${NEW}.` },
];

/** Gather quotes the newer statement; the decision proposes the correction (or whatever `decide` says). */
const checker = (
  decide: (evidence: { index: number; quote: string }[]) => Record<string, unknown> | null
) =>
  fakeGenerator((prompt) => {
    if (prompt.excerpts) {
      const newer = excerptTurn(prompt, NEW);
      const older = excerptTurn(prompt, OLD);
      return {
        excerpts: [
          ...(older
            ? [{ turnId: older.turnId, field: 'narrative', quote: OLD, relation: 'supports' }]
            : []),
          ...(newer
            ? [{ turnId: newer.turnId, field: 'narrative', quote: NEW, relation: 'contradicts' }]
            : []),
        ],
      };
    }
    return decide(prompt.evidence as { index: number; quote: string }[]);
  });
const propose = (evidence: { index: number; quote: string }[]) => ({
  outcome: 'proposed',
  reason: 'She says so herself.',
  changes: { text: CORRECTED },
  evidenceIndexes: evidence.filter((e) => e.quote === NEW).map((e) => e.index),
});

async function fixture() {
  const mira = knowledgeRecord('Mira', 'Mira is the innkeeper, employed by Ada.');
  const seeded = await seedCampaign(store, turnPairs, [mira]);
  return { ...seeded, mira };
}
async function runCheck(
  journal: JournalService,
  campaignId: string,
  entryId: string
): Promise<JournalJobView> {
  const job = await journal.start(campaignId, JournalJobKind.Check, randomUUID(), {
    entryId,
    explanation: 'Mira said she is a sister, not an innkeeper.',
  });
  const done = await waitForJob(journal, campaignId, job.id);
  assert.equal(done.status, JournalJobStatus.Completed, done.error?.message);
  return done;
}
const reject = (code: string) => (e: unknown) => e instanceof Problem && e.code === code;

test(
  'a check proposes without writing; accept updates canon, the ledger and retires every memory',
  { skip: !dbEnabled },
  async () => {
    const { campaign, mira, turns } = await fixture();
    const memory = {
      id: randomUUID(),
      text: 'Mira the innkeeper.',
      coveredTurnIds: [turns[0]!.id],
      valid: true,
      createdAt: new Date().toISOString(),
    };
    await store.transaction(async (client) => {
      const c = await store.campaign(campaign.id, client, true);
      await store.memory(c, memory, client);
      await store.save(c, client);
    });
    const journal = new JournalService(store, checker(propose));
    const found = await runCheck(journal, campaign.id, mira.id);
    assert.equal(found.finding?.outcome, JournalCheckOutcome.Proposed);
    assert.deepEqual(
      found.finding?.changes.map((c) => c.field),
      ['text']
    );
    assert.equal(found.finding?.evidence[0]?.quote, NEW);
    // No canonical mutation before acceptance.
    const before = await store.campaign(campaign.id);
    assert.equal(before.knowledge![0]!.text, mira.text);
    assert.equal(before.journal, undefined);
    assert.equal(before.memory?.id, memory.id);
    const digest = found.finding!.proposalDigest!;
    await assert.rejects(
      () => journal.accept(campaign.id, found.id, randomUUID(), 'f'.repeat(64)),
      reject('journal_proposal_changed')
    );
    // Unrelated notes revisions do not reject acceptance.
    await store.edit(campaign.id, 0, (c) => {
      c.notes = 'unrelated personal notes';
    });
    const requestId = randomUUID();
    const accepted = await journal.accept(campaign.id, found.id, requestId, digest);
    assert.equal(accepted.decision, JournalDecision.Accepted);
    assert.equal(accepted.entry.text, CORRECTED);
    const saved = await store.campaign(campaign.id);
    const record = saved.knowledge![0]!;
    assert.equal(record.id, mira.id);
    assert.equal(record.text, CORRECTED);
    assert.equal(record.revision, 2);
    assert.equal(saved.journal?.events.length, 1);
    assert.equal(saved.memory, null);
    const memories = await store.pool.query('SELECT document FROM memories WHERE campaign_id=$1', [
      campaign.id,
    ]);
    assert.ok(memories.rows.length > 0 && memories.rows.every((r) => r.document.valid === false));
    // Original conversation text is never rewritten.
    const turn = await store.turn(campaign.id, turns[1]!.id);
    assert.equal(turn.narrative, turnPairs[1]!.narrative);
    // Lost acknowledgement: the same request replays the saved result; a different one cannot re-decide.
    const replay = await journal.accept(campaign.id, found.id, requestId, digest);
    assert.equal(replay.entry.text, CORRECTED);
    assert.equal((await store.campaign(campaign.id)).journal?.events.length, 1);
    await assert.rejects(
      () => journal.accept(campaign.id, found.id, randomUUID(), digest),
      reject('journal_request_reused')
    );
    await assert.rejects(
      () => journal.dismiss(campaign.id, found.id, randomUUID()),
      reject('journal_request_reused')
    );
    assert.equal((await journal.status(campaign.id, found.id)).decision, JournalDecision.Accepted);
    // History exposes the correction with its exact before/after and reason.
    const detail = await journal.entry(campaign.id, mira.id);
    const corrected = detail.history!.find((h) => h.kind === 'corrected')!;
    assert.equal(corrected.changes![0]!.before, mira.text);
    assert.equal(corrected.changes![0]!.after, CORRECTED);
    assert.equal(corrected.reason, 'She says so herself.');
  }
);

test('a changed target or invalid evidence rejects acceptance', { skip: !dbEnabled }, async () => {
  const { campaign, mira, turns } = await fixture();
  const journal = new JournalService(store, checker(propose));
  const found = await runCheck(journal, campaign.id, mira.id);
  await store.edit(campaign.id, 0, (c) => {
    c.knowledge![0]!.text = 'Changed by someone else.';
    c.knowledge![0]!.revision++;
  });
  await assert.rejects(
    () => journal.accept(campaign.id, found.id, randomUUID(), found.finding!.proposalDigest!),
    reject('journal_proposal_changed')
  );
  const other = await fixture();
  const j2 = new JournalService(store, checker(propose));
  const f2 = await runCheck(j2, other.campaign.id, other.mira.id);
  await store.pool.query(
    "UPDATE turns SET document=jsonb_set(document,'{undone}','true') WHERE id=$1",
    [other.turns[1]!.id]
  );
  await assert.rejects(
    () => j2.accept(other.campaign.id, f2.id, randomUUID(), f2.finding!.proposalDigest!),
    reject('evidence_invalid')
  );
  assert.equal((await store.campaign(other.campaign.id)).knowledge![0]!.text, other.mira.text);
  assert.ok(turns.length);
});

test(
  'inconclusive, unchanged and evidence-free checks cannot be accepted and never fabricate a correction',
  { skip: !dbEnabled },
  async () => {
    const { campaign, mira } = await fixture();
    const inconclusive = new JournalService(
      store,
      checker(() => ({
        outcome: 'inconclusive',
        reason: 'Conflicting statements.',
        changes: null,
        evidenceIndexes: [],
      }))
    );
    const a = await runCheck(inconclusive, campaign.id, mira.id);
    assert.equal(a.finding?.outcome, JournalCheckOutcome.Inconclusive);
    assert.equal(a.finding?.proposalDigest, null);
    await assert.rejects(
      () => inconclusive.accept(campaign.id, a.id, randomUUID(), 'a'.repeat(64)),
      reject('journal_invalid')
    );
    const unchanged = new JournalService(
      store,
      checker(() => ({
        outcome: 'unchanged',
        reason: 'Supported.',
        changes: null,
        evidenceIndexes: [],
      }))
    );
    assert.equal(
      (await runCheck(unchanged, campaign.id, mira.id)).finding?.outcome,
      JournalCheckOutcome.Unchanged
    );
    // No relevant evidence at all: no decision call is made.
    const none = fakeGenerator(() => ({ excerpts: [] }));
    const empty = await runCheck(new JournalService(store, none), campaign.id, mira.id);
    assert.equal(empty.finding?.outcome, JournalCheckOutcome.Inconclusive);
    assert.ok(
      none.calls.every((c) => c.excerpts),
      'only scan calls, never a decision call'
    );
    assert.equal((await store.campaign(campaign.id)).journal, undefined);
  }
);

test(
  'dismiss keeps canon, persists across replays and excludes accept',
  { skip: !dbEnabled },
  async () => {
    const { campaign, mira } = await fixture();
    const journal = new JournalService(store, checker(propose));
    const found = await runCheck(journal, campaign.id, mira.id);
    const requestId = randomUUID();
    assert.equal(
      (await journal.dismiss(campaign.id, found.id, requestId)).decision,
      JournalDecision.Dismissed
    );
    assert.equal(
      (await journal.dismiss(campaign.id, found.id, requestId)).decision,
      JournalDecision.Dismissed
    );
    assert.equal((await journal.status(campaign.id, found.id)).decision, JournalDecision.Dismissed);
    await assert.rejects(
      () => journal.accept(campaign.id, found.id, randomUUID(), found.finding!.proposalDigest!),
      reject('journal_request_reused')
    );
    const saved = await store.campaign(campaign.id);
    assert.equal(saved.knowledge![0]!.text, mira.text);
    assert.equal(saved.journal, undefined);
  }
);

test(
  'hidden records and the player own beliefs cannot be checked or leaked',
  { skip: !dbEnabled },
  async () => {
    const hidden = knowledgeRecord('Secret', 'SECRET text', { visibility: V.GmOnly });
    const belief = knowledgeRecord('Suspicion', 'I think so', { certainty: C.Belief });
    const seeded = await seedCampaign(store, turnPairs, [hidden, belief]);
    const gen = checker(propose);
    const journal = new JournalService(store, gen);
    for (const id of [hidden.id, belief.id])
      await assert.rejects(
        () =>
          journal.start(seeded.campaign.id, JournalJobKind.Check, randomUUID(), {
            entryId: id,
            explanation: 'x',
          }),
        reject('journal_not_found')
      );
    assert.equal(gen.calls.length, 0);
    await assert.rejects(
      () =>
        journal.start(seeded.campaign.id, JournalJobKind.Check, randomUUID(), {
          entryId: randomUUID(),
          explanation: 'x',
        }),
      reject('journal_not_found')
    );
  }
);

test(
  'undo cannot overwrite an accepted correction or remove its evidence',
  { skip: !dbEnabled },
  async () => {
    // Evidence from the first turn; the last turn's snapshot recorded the pre-correction record.
    const a = await fixture();
    await saveSnapshot(store, a.campaign.id, {
      turnId: a.turns[1]!.id,
      beforeKnowledge: [],
      afterKnowledge: [a.mira],
    });
    const fromFirst = checker((evidence) => ({
      outcome: 'proposed',
      reason: 'First conversation.',
      changes: { text: CORRECTED },
      evidenceIndexes: evidence.filter((e) => e.quote === OLD).map((e) => e.index),
    }));
    const journalA = new JournalService(store, fromFirst);
    const foundA = await runCheck(journalA, a.campaign.id, a.mira.id);
    await journalA.accept(a.campaign.id, foundA.id, randomUUID(), foundA.finding!.proposalDigest!);
    const service = new TurnService(
      store,
      fakeGenerator(() => ({}))
    );
    await assert.rejects(
      () => service.undo(a.campaign.id, 0),
      reject('journal_correction_conflict')
    );
    assert.equal((await store.campaign(a.campaign.id)).knowledge![0]!.text, CORRECTED);
    assert.equal((await store.turn(a.campaign.id, a.turns[1]!.id)).undone, false);
    // Evidence from the last turn: undo would leave the correction unsupported.
    const b = await fixture();
    const journalB = new JournalService(store, checker(propose));
    const foundB = await runCheck(journalB, b.campaign.id, b.mira.id);
    await journalB.accept(b.campaign.id, foundB.id, randomUUID(), foundB.finding!.proposalDigest!);
    await assert.rejects(
      () => service.undo(b.campaign.id, 0),
      reject('journal_correction_evidence')
    );
    assert.equal((await store.turn(b.campaign.id, b.turns[1]!.id)).undone, false);
  }
);

test(
  'a saved failed attempt carrying superseded facts is refused with a context change, dice untouched',
  { skip: !dbEnabled },
  async () => {
    const { campaign, mira, turns } = await fixture();
    const failedId = randomUUID();
    const sessionId = randomUUID();
    const createdAt = new Date(2026, 6, 1).toISOString();
    const failed = {
      id: failedId,
      campaignId: campaign.id,
      requestId: randomUUID(),
      status: 'failed',
      action: 'I press her',
      narrative: null,
      changes: [],
      error: 'CLI failed',
      undone: false,
      settings: campaign.settings,
      context: {
        revision: 0,
        prompt: '{}',
        estimatedTokens: 1,
        estimator: 't',
        sourceVersions: [],
        historyIds: [],
        memoryId: null,
        diceSessionId: sessionId,
      },
      createdAt,
      completedAt: createdAt,
      diceSessionId: sessionId,
    } as unknown as Turn;
    await store.pool.query(
      'INSERT INTO turns(id,campaign_id,request_id,payload_hash,status,document,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [failedId, campaign.id, failed.requestId, 'fixture', 'failed', failed, createdAt]
    );
    await store.pool.query(
      "INSERT INTO dice_sessions(id,campaign_id,root_turn_id,context_digest,frozen_prompt,frozen_revision,character_ids,imported,system_prompt,frozen_knowledge,tool_definitions) VALUES($1,$2,$3,$4,$5,0,'[]',false,'system',$6,'[]')",
      [
        sessionId,
        campaign.id,
        failedId,
        'a'.repeat(64),
        '{}',
        JSON.stringify({ campaignId: campaign.id, records: [mira], characters: [], sourceIds: [] }),
      ]
    );
    assert.equal((await store.turn(campaign.id, failedId)).diceRetry?.available, true);
    const journal = new JournalService(store, checker(propose));
    const found = await runCheck(journal, campaign.id, mira.id);
    await journal.accept(campaign.id, found.id, randomUUID(), found.finding!.proposalDigest!);
    const after = await store.turn(campaign.id, failedId);
    assert.equal(after.diceRetry?.available, false);
    assert.match(after.diceRetry?.reason ?? '', /correction changed facts/);
    const service = new TurnService(
      store,
      fakeGenerator(() => ({}))
    );
    await assert.rejects(
      () => service.retry(campaign.id, failedId, { revision: 0, requestId: randomUUID() }),
      reject('journal_context_changed')
    );
    // Preserved dice session and no new attempt turn were created.
    const sessions = await store.pool.query('SELECT 1 FROM dice_sessions WHERE campaign_id=$1', [
      campaign.id,
    ]);
    assert.equal(sessions.rowCount, 1);
    assert.equal((await store.turns(campaign.id)).length, turns.length + 1);
  }
);
