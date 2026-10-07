import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { newCampaign } from '../src/domain/campaign.js';
import {
  KnowledgeCertainty as C,
  KnowledgeKind as K,
  KnowledgeOrigin as O,
  KnowledgeStatus as S,
  KnowledgeVisibility as V,
  type CampaignKnowledge,
} from '../src/domain/knowledge.js';
import {
  START_POSITION,
  backfillPrompt,
  captureJournalInput,
  captureTarget,
  decisionPrompt,
  gatherPrompt,
  inputIdentity,
  nextBatch,
  reduceBackfill,
  reduceDecision,
  reduceGather,
  type FrozenJournalInput,
  type Segment,
} from '../src/domain/journalGeneration.js';
import { emptyStaged } from '../src/domain/journalChanges.js';
import { TurnStatus } from '../src/domain/options.js';
import { JournalCheckOutcome } from '../src/domain/journal.js';
import type { Turn } from '../src/domain/types.js';

const turn = (i: number, action: string, narrative: string, over: Partial<Turn> = {}): Turn =>
  ({
    id: randomUUID(),
    campaignId: 'c',
    requestId: randomUUID(),
    status: TurnStatus.Completed,
    action,
    narrative,
    changes: [],
    error: null,
    undone: false,
    context: null,
    createdAt: new Date(2026, 0, 1, 0, i).toISOString(),
    completedAt: null,
    ...over,
  }) as Turn;

function input(turns: Turn[], facts: CampaignKnowledge[] = []): FrozenJournalInput {
  const c = newCampaign({ name: 'Camp' });
  c.knowledge = facts;
  return captureJournalInput(c, turns);
}
const seg = (input: FrozenJournalInput, ...ids: string[]): Segment[] =>
  ids.map((id) => ({
    turnId: id,
    field: 'narrative' as const,
    offset: 0,
    text: input.turns.find((t) => t.id === id)!.narrative,
  }));

test('batching covers more than 100 turns and every character exactly once, in order', () => {
  const turns = Array.from({ length: 130 }, (_, i) =>
    turn(i, `Action ${i} 😀`, `Narrative ${i}. `.repeat(8))
  );
  const frozen = input(turns);
  const rebuilt = new Map<string, string>();
  let position = START_POSITION;
  let batches = 0;
  while (position.turnIndex < frozen.turns.length) {
    const { segments, next } = nextBatch(
      frozen.turns,
      position,
      (candidate) => Buffer.byteLength(JSON.stringify(candidate), 'utf8') <= 1200
    );
    batches++;
    for (const s of segments) {
      const key = `${s.turnId}:${s.field}`;
      assert.equal(s.offset, rebuilt.get(key)?.length ?? 0, 'segments are contiguous');
      rebuilt.set(key, (rebuilt.get(key) ?? '') + s.text);
    }
    position = next;
  }
  assert.ok(batches > 10, 'a long history needs many sequential batches');
  for (const t of frozen.turns) {
    assert.equal(rebuilt.get(`${t.id}:action`), t.action);
    assert.equal(rebuilt.get(`${t.id}:narrative`), t.narrative);
  }
});

test('a single oversized field is split on UTF-16 boundaries without losing text', () => {
  const big = 'Aa 😀 b'.repeat(4000);
  const frozen = input([turn(0, 'go', big)]);
  const parts: string[] = [];
  let position = START_POSITION;
  let guard = 0;
  while (position.turnIndex < frozen.turns.length && guard++ < 1000) {
    const { segments, next } = nextBatch(
      frozen.turns,
      position,
      (candidate) => Buffer.byteLength(JSON.stringify(candidate), 'utf8') <= 3000
    );
    for (const s of segments)
      if (s.field === 'narrative') {
        assert.doesNotMatch(s.text, /[\uD800-\uDBFF]$/, 'no split surrogate pair');
        parts.push(s.text);
      }
    position = next;
  }
  assert.ok(parts.length > 3);
  assert.equal(parts.join(''), big);
});

test('journal inputs and prompts contain only public facts and transcript', () => {
  const t = turn(0, 'I greet her', 'Mira greets you.');
  const c = newCampaign({ name: 'Camp', instructions: 'PRIVATE instructions' });
  c.notes = 'PRIVATE note';
  c.memory = {
    id: randomUUID(),
    text: 'PRIVATE memory',
    coveredTurnIds: [],
    valid: true,
    createdAt: '',
  };
  const now = new Date().toISOString();
  const rec = (title: string, over: Partial<CampaignKnowledge>): CampaignKnowledge => ({
    id: randomUUID(),
    kind: K.Npc,
    title,
    text: `${title} text`,
    certainty: C.Established,
    status: S.Active,
    characterIds: [],
    characterNames: {},
    origin: O.Gm,
    evidence: [],
    createdTurnId: null,
    updatedTurnId: null,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    attributions: [],
    visibility: V.Player,
    ...over,
  });
  c.knowledge = [
    rec('Visible', {}),
    rec('PRIVATE hidden', { visibility: V.GmOnly }),
    rec('PRIVATE belief', { certainty: C.Belief }),
  ];
  const frozen = captureJournalInput(c, [t, turn(1, 'undone', 'PRIVATE undone', { undone: true })]);
  frozen.target = captureTarget(c, c.knowledge[0]!.id, 'why');
  const all = [
    JSON.stringify(frozen),
    backfillPrompt(frozen, emptyStaged(), seg(frozen, t.id)),
    gatherPrompt(frozen, [], seg(frozen, t.id)),
    decisionPrompt(frozen, []),
  ].join('\n');
  assert.doesNotMatch(all, /PRIVATE/);
  assert.match(all, /Visible text/);
  assert.throws(() => captureTarget(c, c.knowledge![1]!.id, 'x'), /not found/);
});

const out = (over: Record<string, unknown>) => ({
  ref: 'book',
  existingId: null,
  kind: K.Debt,
  title: 'Return the book',
  text: 'Return the healer book.',
  certainty: C.Established,
  status: S.Active,
  characterIds: [],
  related: [],
  quotes: [],
  ...over,
});

test('backfill staging resolves a promise across batches into one entry and keeps ambiguity out', () => {
  const t1 = turn(1, 'ask', 'You borrow the healer book and promise to return it.');
  const filler = Array.from({ length: 40 }, (_, i) => turn(i + 2, 'walk', `You walk, scene ${i}.`));
  const t50 = turn(60, 'return', 'You handed back the book and she thanks you.');
  const frozen = input([t1, ...filler, t50]);
  let staged = reduceBackfill(
    emptyStaged(),
    {
      entries: [
        out({ quotes: [{ turnId: t1.id, field: 'narrative', quote: 'borrow the healer book' }] }),
      ],
    },
    frozen,
    seg(frozen, t1.id)
  );
  assert.equal(staged.entries.length, 1);
  staged = reduceBackfill(
    staged,
    {
      entries: [
        out({
          status: S.Resolved,
          text: 'Returned the healer book; she owes you a favor.',
          quotes: [{ turnId: t50.id, field: 'narrative', quote: 'handed back the book' }],
        }),
      ],
    },
    frozen,
    seg(frozen, t50.id)
  );
  assert.equal(staged.entries.length, 1, 'one resolved entry, not two');
  const entry = staged.entries[0]!;
  assert.equal(entry.fields.status, S.Resolved);
  assert.deepEqual(
    entry.contributions.map((c) => [c.op, c.turnId]),
    [
      ['create', t1.id],
      ['update', t50.id],
    ]
  );
  assert.deepEqual(entry.contributions[1]!.before, entry.contributions[0]!.after);
  assert.equal(staged.skipped, 0);
  // Same title and kind under a different ref without explicit identity is ambiguous and skipped.
  const ambiguous = reduceBackfill(
    staged,
    {
      entries: [
        out({
          ref: 'other',
          quotes: [{ turnId: t50.id, field: 'narrative', quote: 'handed back the book' }],
        }),
      ],
    },
    frozen,
    seg(frozen, t50.id)
  );
  assert.equal(ambiguous.entries.length, 1);
  assert.equal(ambiguous.skipped, 1);
});

test('backfill skips fabricated quotes, quotes outside the batch, recorded facts and own beliefs', () => {
  const t1 = turn(1, 'ask', 'The mayor is said to take bribes, says the baker.');
  const t2 = turn(2, 'walk', 'You walk home.');
  const existing: CampaignKnowledge = {
    id: randomUUID(),
    kind: K.Event,
    title: 'Known event',
    text: 'known',
    certainty: C.Established,
    status: S.Active,
    characterIds: [],
    characterNames: {},
    origin: O.Gm,
    evidence: [],
    createdTurnId: null,
    updatedTurnId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    revision: 1,
    attributions: [],
    visibility: V.Player,
  };
  const frozen = input([t1, t2], [existing]);
  const good = out({
    ref: 'rumor',
    kind: K.Event,
    title: 'Mayor bribes rumor',
    text: 'The baker says the mayor takes bribes.',
    certainty: C.Rumor,
    quotes: [{ turnId: t1.id, field: 'narrative', quote: 'take bribes' }],
  });
  const result = reduceBackfill(
    emptyStaged(),
    {
      entries: [
        good,
        out({
          ref: 'fake',
          title: 'Fake',
          quotes: [{ turnId: t1.id, field: 'narrative', quote: 'never said' }],
        }),
        out({
          ref: 'far',
          title: 'Far',
          quotes: [{ turnId: t2.id, field: 'narrative', quote: 'walk home' }],
        }),
        out({
          ref: 'dup',
          existingId: existing.id,
          quotes: [{ turnId: t1.id, field: 'narrative', quote: 'take bribes' }],
        }),
      ],
    },
    frozen,
    seg(frozen, t1.id)
  );
  assert.deepEqual(
    result.entries.map((e) => e.ref),
    ['rumor']
  );
  assert.equal(result.entries[0]!.fields.certainty, C.Rumor);
  assert.equal(result.skipped, 3);
  assert.throws(
    () =>
      reduceBackfill(
        emptyStaged(),
        { entries: [{ ...good, certainty: C.Belief }] },
        frozen,
        seg(frozen, t1.id)
      ),
    /invalid|certainty/i
  );
});

test('identity ignores notes and campaign revision but tracks facts and transcript content', () => {
  const t = turn(1, 'a', 'n');
  const base = input([t]);
  assert.equal(inputIdentity(base), inputIdentity(input([{ ...t, createdAt: 'later' }])));
  assert.notEqual(inputIdentity(base), inputIdentity(input([{ ...t, narrative: 'changed' }])));
  assert.notEqual(inputIdentity(base), inputIdentity(input([t, turn(2, 'b', 'm')])));
});

function checkFixture() {
  const rec = (): CampaignKnowledge => ({
    id: randomUUID(),
    kind: K.Npc,
    title: 'Mira',
    text: 'Mira is the innkeeper, employed by Ada.',
    certainty: C.Established,
    status: S.Active,
    characterIds: [],
    characterNames: {},
    origin: O.Gm,
    evidence: [],
    createdTurnId: null,
    updatedTurnId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    revision: 1,
    attributions: [],
    visibility: V.Player,
  });
  const record = rec();
  const older = turn(1, 'ask', 'Mira works for Ada at the inn.');
  const newer = turn(2, 'ask', 'Mira says she is a sister of the temple.');
  const c = newCampaign({ name: 'Camp' });
  c.knowledge = [record];
  const frozen = captureJournalInput(c, [older, newer]);
  frozen.target = captureTarget(c, record.id, 'Mira is a sister, not an innkeeper');
  return { frozen, older, newer, record };
}

test('check gathers evidence chronologically and proposes only exact, allowed, evidenced changes', () => {
  const { frozen, older, newer } = checkFixture();
  const gathered = reduceGather(
    [],
    {
      excerpts: [
        {
          turnId: newer.id,
          field: 'narrative',
          quote: 'sister of the temple',
          relation: 'contradicts',
        },
        { turnId: older.id, field: 'narrative', quote: 'works for Ada', relation: 'supports' },
        { turnId: newer.id, field: 'narrative', quote: 'invented quote', relation: 'contradicts' },
      ],
    },
    frozen,
    seg(frozen, older.id, newer.id)
  );
  assert.deepEqual(
    gathered.map((g) => g.evidence.turnId),
    [older.id, newer.id]
  );
  const finding = reduceDecision(
    {
      outcome: 'proposed',
      reason: 'She states it herself.',
      changes: { text: 'Mira is a sister of the temple.' },
      evidenceIndexes: [1],
    },
    frozen,
    gathered
  );
  assert.equal(finding.outcome, JournalCheckOutcome.Proposed);
  assert.equal(finding.before.text, 'Mira is the innkeeper, employed by Ada.');
  assert.deepEqual(finding.changes, { text: 'Mira is a sister of the temple.' });
  assert.match(finding.proposalDigest!, /^[0-9a-f]{64}$/);
  assert.equal(finding.evidence[0]!.turnId, newer.id);
  // Ambiguous or unsupported proposals never become corrections.
  for (const bad of [
    { outcome: 'proposed', reason: 'r', changes: { text: 'x' }, evidenceIndexes: [] },
    { outcome: 'proposed', reason: 'r', changes: { text: 'x' }, evidenceIndexes: [9] },
    { outcome: 'proposed', reason: 'r', changes: null, evidenceIndexes: [1] },
    {
      outcome: 'proposed',
      reason: 'r',
      changes: { characterIds: [randomUUID()] },
      evidenceIndexes: [1],
    },
  ]) {
    const f = reduceDecision(bad, frozen, gathered);
    assert.equal(f.outcome, JournalCheckOutcome.Inconclusive);
    assert.equal(f.changes, null);
    assert.equal(f.proposalDigest, null);
  }
  assert.equal(
    reduceDecision(
      {
        outcome: 'proposed',
        reason: 'r',
        changes: { text: frozen.target!.fields.text },
        evidenceIndexes: [1],
      },
      frozen,
      gathered
    ).outcome,
    JournalCheckOutcome.Unchanged
  );
  for (const outcome of ['unchanged', 'inconclusive'])
    assert.equal(
      reduceDecision({ outcome, reason: 'r', changes: null, evidenceIndexes: [] }, frozen, gathered)
        .proposalDigest,
      null
    );
});
