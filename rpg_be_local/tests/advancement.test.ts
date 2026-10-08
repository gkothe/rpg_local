import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  AdvancementBasis as Basis,
  AdvancementKind as Kind,
  AdvancementOutcome as Outcome,
  advancementAwardSchema,
  advancementProposalSchema,
  advancementDigest,
} from '../src/domain/advancement.js';

const award = () => ({
  characterId: randomUUID(),
  kind: Kind.Resource,
  unitKey: 'xp',
  unitLabel: 'XP',
  amount: 4,
  reason: 'Defeated the opponent',
  basis: 'Combat awards under this system',
  basisKind: Basis.ModelKnowledge,
  evidenceTurnIds: [randomUUID()],
});

test('advancement output rejects character mutations and unsupported numeric rewards', () => {
  assert.equal(
    advancementAwardSchema.safeParse({ ...award(), attributes: { xp: 4 } }).success,
    false
  );
  for (const amount of [0, -1, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, null]) {
    assert.equal(advancementAwardSchema.safeParse({ ...award(), amount }).success, false);
  }
  assert.equal(advancementAwardSchema.safeParse({ ...award(), amount: 0.5 }).success, true);
});

test('nonnumeric eligibility stays nonnumeric and duplicate evidence is rejected', () => {
  assert.equal(
    advancementAwardSchema.safeParse({ ...award(), kind: Kind.Eligibility, amount: null }).success,
    true
  );
  assert.equal(
    advancementAwardSchema.safeParse({ ...award(), kind: Kind.Eligibility }).success,
    false
  );
  const id = randomUUID();
  assert.equal(
    advancementAwardSchema.safeParse({ ...award(), evidenceTurnIds: [id, id] }).success,
    false
  );
});

test('needs-guidance proposals cannot contain awards', () => {
  const proposal = {
    outcome: Outcome.NeedsGuidance,
    rewardSystem: {
      key: 'unknown_system',
      label: 'System needs clarification',
      editionLabel: null,
    },
    explanation: 'Please identify the edition.',
    progressionBasis: 'Need the edition first.',
    progressionBasisKind: Basis.Provisional,
    awards: [],
    cumulativeSummary: '',
    pendingObjectives: [],
    ruleEvidence: [],
  };
  assert.equal(advancementProposalSchema.safeParse(proposal).success, true);
  assert.equal(
    advancementProposalSchema.safeParse({ ...proposal, awards: [award()] }).success,
    false
  );
  assert.equal(
    advancementProposalSchema.safeParse({ ...proposal, sheetUpdates: [] }).success,
    false
  );
});

test('advancement digests survive PostgreSQL JSONB key ordering', () => {
  assert.equal(
    advancementDigest({ a: 1, b: { first: 2, second: 3 } }),
    advancementDigest({ b: { second: 3, first: 2 }, a: 1 })
  );
  assert.notEqual(advancementDigest([1, 2]), advancementDigest([2, 1]));
});
