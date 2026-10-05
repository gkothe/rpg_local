import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diceResponseSchema, validateRollInterpretations } from '../src/domain/diceResponse.js';
import {
  placedRollInterpretationSchema,
  validateRollPlacement,
} from '../src/domain/diceResponse.js';

const rollId = '12345678-1234-4234-8234-123456789012';
const response = {
  version: 2,
  narrative: 'The check succeeds.',
  operations: [],
  rollInterpretations: [{ rollId, explanation: '12 + 3 = 15; target 14.' }],
};

test('placement accepts saved legacy rolls and rejects invalid paragraph indices', () => {
  assert.equal(
    placedRollInterpretationSchema.safeParse({ rollId, explanation: 'Success', afterParagraph: 1 })
      .success,
    true
  );
  for (const afterParagraph of [0, -1, 1.5])
    assert.equal(
      placedRollInterpretationSchema.safeParse({ rollId, explanation: 'Success', afterParagraph })
        .success,
      false
    );
  assert.doesNotThrow(() => validateRollPlacement(response));
  const placed = {
    ...response,
    narrative: 'Action.\r\n\r\nConsequence.',
    rollInterpretations: [{ rollId, explanation: 'Success', afterParagraph: 2 }],
  };
  assert.doesNotThrow(() => validateRollPlacement(placed));
  assert.throws(
    () => validateRollPlacement({ ...placed, narrative: 'Only one paragraph.' }),
    /paragraph/i
  );
  assert.equal(diceResponseSchema.safeParse(placed).success, false);
});
test('dice gameplay preserves operation constraints and excludes AI-authored faces', () => {
  assert.equal(diceResponseSchema.safeParse(response).success, true);
  assert.equal(diceResponseSchema.safeParse({ ...response, faces: [12] }).success, false);
  assert.equal(diceResponseSchema.safeParse({ ...response, version: 1 }).success, false);
  assert.equal(
    diceResponseSchema.safeParse({
      ...response,
      operations: [{ op: 'delete', characterId: rollId }],
    }).success,
    false
  );
  assert.equal(
    diceResponseSchema.safeParse({
      ...response,
      rollInterpretations: [{ ...response.rollInterpretations[0], faces: [12] }],
    }).success,
    false
  );
  assert.equal(
    diceResponseSchema.safeParse({
      ...response,
      rollInterpretations: [
        { rollId, explanation: 'Corrected', corrections: [{ explanation: '' }] },
      ],
    }).success,
    false
  );
});
test('final response must acknowledge exactly all recorded rolls', () => {
  const parsed = diceResponseSchema.parse(response);
  assert.doesNotThrow(() => validateRollInterpretations(parsed, [rollId]));
  assert.throws(() => validateRollInterpretations(parsed, []), /roll/i);
  assert.throws(
    () => validateRollInterpretations({ ...parsed, rollInterpretations: [] }, [rollId]),
    /roll/i
  );
  assert.throws(
    () =>
      validateRollInterpretations(
        {
          ...parsed,
          rollInterpretations: [...parsed.rollInterpretations, ...parsed.rollInterpretations],
        },
        [rollId]
      ),
    /roll/i
  );
});
