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
  applyBackfill,
  applyCorrection,
  assertNoCorrectionEvidence,
  assertNoLaterCorrection,
  locateQuote,
  reconcileBackfillUndo,
  validateTranscriptEvidence,
  type StagedBackfill,
} from '../src/domain/journalChanges.js';
import {
  applicableCorrections,
  correctionGuidance,
  frozenContextConflict,
} from '../src/domain/journalCompatibility.js';
import { eventDigest, sha256, type JournalFields } from '../src/domain/journalLedger.js';
import { buildContext, compactionBatch } from '../src/domain/context.js';
import { TurnStatus } from '../src/domain/options.js';
import { CharacterType } from '../src/domain/options.js';
import type { Campaign, Turn } from '../src/domain/types.js';

const turn = (action: string, narrative: string, over: Partial<Turn> = {}): Turn =>
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
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    ...over,
  }) as Turn;
const turnMap = (...turns: Turn[]) => new Map(turns.map((t) => [t.id, t]));
const fields = (over: Partial<JournalFields> = {}): JournalFields => ({
  kind: K.Debt,
  title: 'Return the book',
  text: 'Return the healer book.',
  certainty: C.Established,
  status: S.Active,
  characterIds: [],
  holderId: null,
  ...over,
});
const evidence = (t: Turn, quote: string, field: 'action' | 'narrative' = 'narrative') =>
  locateQuote(t, field, quote)!;

/** One staged promise created in turn A and resolved in turn B. */
function stagedPromise(a: Turn, b: Turn): StagedBackfill {
  const id = randomUUID();
  const created = fields();
  const resolved = fields({
    status: S.Resolved,
    text: 'Returned the healer book; she owes you a favor.',
  });
  return {
    nextOrdinal: 2,
    skipped: 1,
    entries: [
      {
        ref: 'book',
        id,
        fields: resolved,
        contributions: [
          {
            ordinal: 0,
            turnId: a.id,
            knowledgeId: id,
            op: 'create',
            before: null,
            after: created,
            evidence: [evidence(a, 'borrow the healer book')],
            dependsOn: [],
          },
          {
            ordinal: 1,
            turnId: b.id,
            knowledgeId: id,
            op: 'update',
            before: created,
            after: resolved,
            evidence: [evidence(b, 'handed back the book')],
            dependsOn: [],
          },
        ],
      },
    ],
  };
}
const turns2 = () => {
  const a = turn('I ask', 'You borrow the healer book and promise to return it.');
  const b = turn('I return it', 'You handed back the book and she thanks you.');
  return { a, b };
};

test('transcript evidence uses exact UTF-16 coordinates, digests and active turns', () => {
  const t = turn('look', 'A 😀 sister named Mira works for Ada.');
  const e = evidence(t, 'Mira works');
  assert.equal(e.end - e.start, 'Mira works'.length);
  assert.equal(e.digest, sha256(t.narrative!));
  assert.equal(t.narrative!.slice(e.start, e.end), 'Mira works');
  validateTranscriptEvidence(e, turnMap(t));
  assert.equal(locateQuote(t, 'narrative', 'not in the text'), null);
  assert.throws(
    () => validateTranscriptEvidence(e, turnMap({ ...t, narrative: 'edited text' })),
    /no longer matches/
  );
  assert.throws(
    () => validateTranscriptEvidence(e, turnMap({ ...t, undone: true })),
    /no longer part of the active story/
  );
});

test('backfill commits staged records and one digest-checked event atomically', () => {
  const { a, b } = turns2();
  const c = newCampaign({ name: 'Camp' });
  const next = applyBackfill(c, stagedPromise(a, b), turnMap(a, b), [a.id, b.id], randomUUID());
  const record = next.knowledge!.at(-1)!;
  assert.equal(record.status, S.Resolved);
  assert.equal(record.origin, O.Gm);
  assert.equal(record.createdTurnId, null);
  assert.equal(record.attributions[0]!.turnId, null);
  assert.deepEqual(next.journal!.coverageTurnIds, [a.id, b.id]);
  const event = next.journal!.events[0]!;
  assert.equal(event.digest, eventDigest(event as unknown as Record<string, unknown>));
  assert.equal(c.knowledge?.length ?? 0, 0, 'the input campaign is not mutated');
  assert.throws(
    () =>
      applyBackfill(c, stagedPromise(a, b), turnMap(a, { ...b, undone: true }), [], randomUUID()),
    /no longer part of the active story/
  );
});

test('undoing the resolving turn restores the active promise; undoing its first turn removes it', () => {
  const { a, b } = turns2();
  const base = applyBackfill(
    newCampaign({ name: 'Camp' }),
    stagedPromise(a, b),
    turnMap(a, b),
    [a.id, b.id],
    randomUUID()
  );
  const afterB = structuredClone(base);
  reconcileBackfillUndo(afterB, b.id, new Set());
  const active = afterB.knowledge!.at(-1)!;
  assert.equal(active.status, S.Active);
  assert.equal(active.text, 'Return the healer book.');
  assert.ok(afterB.journal!.undoneTurnIds.includes(b.id));
  assert.deepEqual(afterB.journal!.coverageTurnIds, [a.id]);
  reconcileBackfillUndo(afterB, a.id, new Set());
  assert.equal(afterB.knowledge!.length, 0);
});

test('a manual change to a recovered record blocks backfill reconciliation instead of overwriting', () => {
  const { a, b } = turns2();
  const c = applyBackfill(
    newCampaign({ name: 'Camp' }),
    stagedPromise(a, b),
    turnMap(a, b),
    [a.id, b.id],
    randomUUID()
  );
  c.knowledge!.at(-1)!.text = 'Edited later by a correction';
  assert.throws(() => reconcileBackfillUndo(c, b.id, new Set()), /would overwrite/);
  // Records handled by the ordinary snapshot restore are skipped entirely.
  const protectedIds = new Set([c.knowledge!.at(-1)!.id]);
  assert.doesNotThrow(() => reconcileBackfillUndo(c, b.id, protectedIds));
});

function withRecord(): { c: Campaign; id: string; t: Turn } {
  const t = turn('ask', 'Mira says she is a sister of the temple and works for Ada.');
  const c = newCampaign({ name: 'Camp' });
  const id = randomUUID();
  const now = new Date().toISOString();
  const record: CampaignKnowledge = {
    id,
    kind: K.Npc,
    title: 'Mira',
    text: 'Mira is the innkeeper, employed by Ada.',
    certainty: C.Established,
    status: S.Active,
    characterIds: [],
    characterNames: {},
    origin: O.Gm,
    evidence: [],
    createdTurnId: t.id,
    updatedTurnId: t.id,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    attributions: [{ origin: O.Gm, evidence: [], turnId: t.id, at: now, visibility: V.Player }],
    visibility: V.Player,
    introductionVisibility: V.Player,
  };
  c.knowledge = [record];
  return { c, id, t };
}

test('an accepted correction updates the same record, keeps creation provenance and records an event', () => {
  const { c, id, t } = withRecord();
  const proposal = {
    knowledgeId: id,
    changes: { text: 'Mira is a sister of the temple.' },
    reason: 'She says so herself.',
    evidence: [evidence(t, 'sister of the temple')],
  };
  const { campaign, event } = applyCorrection(c, proposal, turnMap(t), randomUUID());
  const record = campaign.knowledge![0]!;
  assert.equal(record.id, id);
  assert.equal(record.text, 'Mira is a sister of the temple.');
  assert.equal(record.revision, 2);
  assert.equal(record.createdTurnId, t.id);
  assert.equal(record.origin, O.Gm);
  assert.equal(record.attributions.at(-1)!.turnId, null);
  assert.deepEqual(event.fields, ['text']);
  assert.equal(event.before.text, 'Mira is the innkeeper, employed by Ada.');
  assert.throws(
    () =>
      applyCorrection(
        c,
        { ...proposal, changes: { characterIds: [randomUUID()] } },
        turnMap(t),
        randomUUID()
      ),
    /does not exist/
  );
  assert.throws(
    () =>
      applyCorrection(
        c,
        { ...proposal, changes: { text: c.knowledge![0]!.text } },
        turnMap(t),
        randomUUID()
      ),
    /does not change/
  );
  // The original record and ledger are untouched until the caller saves the result.
  assert.equal(c.knowledge![0]!.revision, 1);
  assert.equal(c.journal, undefined);
});

test('beliefs and hidden records cannot be corrected through the Journal', () => {
  const { c, id, t } = withRecord();
  const proposal = { knowledgeId: id, changes: { text: 'x' }, reason: 'r', evidence: [] };
  c.knowledge![0]!.certainty = C.Belief;
  assert.throws(() => applyCorrection(c, proposal, turnMap(t), randomUUID()), /not found/);
  c.knowledge![0]!.certainty = C.Established;
  c.knowledge![0]!.visibility = V.GmOnly;
  assert.throws(() => applyCorrection(c, proposal, turnMap(t), randomUUID()), /not found/);
});

test('correction authority follows live canonical values and ends when gameplay supersedes the field', () => {
  const { c, id, t } = withRecord();
  const frozenBefore = { records: structuredClone(c.knowledge!) };
  const { campaign } = applyCorrection(
    c,
    {
      knowledgeId: id,
      changes: { text: 'Mira is a sister of the temple.' },
      reason: 'She says so.',
      evidence: [evidence(t, 'sister of the temple')],
    },
    turnMap(t),
    randomUUID()
  );
  assert.deepEqual(correctionGuidance(campaign)[0]!.correctedFields, {
    text: 'Mira is a sister of the temple.',
  });
  // A saved attempt carrying the old text is incompatible; one built after the correction is not.
  assert.match(frozenContextConflict(frozenBefore, campaign) ?? '', /correction changed facts/);
  assert.equal(
    frozenContextConflict({ records: structuredClone(campaign.knowledge!) }, campaign),
    null
  );
  // Later legitimate gameplay changes the field: the old event value no longer controls anything.
  const later = structuredClone(campaign);
  later.knowledge![0]!.text = 'Mira married Ada and now runs the inn with her.';
  assert.deepEqual(applicableCorrections(later), []);
  assert.deepEqual(correctionGuidance(later), []);
  assert.equal(frozenContextConflict(frozenBefore, later), null);
  // Unrelated resolved status changes keep the text correction applicable.
  const resolved = structuredClone(campaign);
  resolved.knowledge![0]!.status = S.Resolved;
  assert.deepEqual(correctionGuidance(resolved)[0]!.correctedFields, {
    text: 'Mira is a sister of the temple.',
  });
});

test('undo refuses to drop correction evidence or overwrite a later correction', () => {
  const { c, id, t } = withRecord();
  const { campaign } = applyCorrection(
    c,
    {
      knowledgeId: id,
      changes: { text: 'Mira is a sister of the temple.' },
      reason: 'She says so.',
      evidence: [evidence(t, 'sister of the temple')],
    },
    turnMap(t),
    randomUUID()
  );
  assert.throws(() => assertNoCorrectionEvidence(campaign, t.id), /relies on this conversation/);
  assert.doesNotThrow(() => assertNoCorrectionEvidence(campaign, randomUUID()));
  assert.throws(
    () => assertNoLaterCorrection(campaign, c.knowledge!),
    /later accepted Journal correction/
  );
  assert.doesNotThrow(() => assertNoLaterCorrection(c, c.knowledge!));
});

test('new context and compaction carry applicable corrections, including inactive records', () => {
  const { c, id, t } = withRecord();
  const { campaign } = applyCorrection(
    c,
    {
      knowledgeId: id,
      changes: { text: 'Mira is a sister of the temple.', status: S.Resolved },
      reason: 'She says so.',
      evidence: [evidence(t, 'sister of the temple')],
    },
    turnMap(t),
    randomUUID()
  );
  const prompt = JSON.parse(buildContext(campaign, [], 'look around', []).prompt);
  assert.equal(prompt.mandatory.journalCorrections.items[0].correctedFields.status, S.Resolved);
  assert.match(prompt.mandatory.journalCorrections.instruction, /authoritative/);
  const history = Array.from({ length: 6 }, (_, i) => turn(`a${i}`, `n${i}`));
  campaign.characters = [
    {
      id: randomUUID(),
      name: 'P',
      type: CharacterType.Player,
      attributes: {},
      inventory: {},
      description: {},
      notes: '',
      revision: 1,
    },
  ];
  const batch = JSON.parse(compactionBatch(campaign, history, 1_000_000).prompt);
  // The correction has no gameplay turn, yet its record is selected by identity.
  assert.equal(batch.knowledge[0].id, id);
  assert.equal(batch.correctedFacts[0].knowledgeId, id);
  const clean = JSON.parse(compactionBatch(c, history, 1_000_000).prompt);
  assert.equal(clean.correctedFacts, undefined);
});
