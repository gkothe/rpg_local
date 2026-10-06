import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  validateOperationExplanations,
  ExplanationBasis,
} from '../src/domain/operationExplanations.js';
import { gameplayResponseSchema } from '../src/domain/gameplayResponse.js';
import { applyResponse } from '../src/domain/state.js';
import { newCampaign } from '../src/domain/campaign.js';
import { CharacterType } from '../src/domain/options.js';
import { KnowledgeVisibility } from '../src/domain/knowledge.js';
import { emptyResponse } from './ownedGameplayFixture.js';
const explain = (operationIndex = 0) => ({
  operationIndex,
  reason: 'Scene begins at dusk',
  basis: ExplanationBasis.InitialState,
  rollIds: [],
  evidence: [],
  visibility: KnowledgeVisibility.Player,
});
test('every mutation requires exactly one explanation', () => {
  const c = newCampaign({ name: 'Example' });
  const response = {
    ...emptyResponse,
    narrative: 'Dusk.',
    operations: [{ op: 'state' as const, expected: {}, value: { scene: 'dusk' } }],
    operationExplanations: [explain()],
  };
  assert.equal(
    applyResponse(c, response, randomUUID()).changes[0],
    'Campaign state changed: Scene begins at dusk'
  );
  assert.throws(
    () =>
      validateOperationExplanations(
        { ...response, operationExplanations: [] },
        { campaignId: c.id, turnId: randomUUID() }
      ),
    /Every mechanical/
  );
  assert.throws(
    () =>
      validateOperationExplanations(
        { ...response, operationExplanations: [explain(), explain()] },
        { campaignId: c.id, turnId: randomUUID() }
      ),
    /exactly one/
  );
  assert.throws(() =>
    gameplayResponseSchema.parse({ ...response, operationExplanations: undefined })
  );
});
test('fabricated roll and source evidence cannot justify a mechanical change', () => {
  const context = { campaignId: randomUUID(), turnId: randomUUID() };
  const response = {
    operations: [{ op: 'state' as const, expected: {}, value: {} }],
    operationExplanations: [
      { ...explain(), basis: ExplanationBasis.Dice, rollIds: [randomUUID()] },
    ],
  };
  assert.throws(() => validateOperationExplanations(response, context), /saved rolls/);
  assert.throws(
    () =>
      validateOperationExplanations(
        { ...response, operationExplanations: [{ ...explain(), basis: ExplanationBasis.Source }] },
        context
      ),
    /exact source/
  );
  assert.throws(
    () =>
      validateOperationExplanations({ ...response, operationExplanations: [explain(1)] }, context),
    /exactly one/
  );
});

test('description and name edits need no mechanical explanation; private explanation never enters public changes', () => {
  const c = newCampaign({ name: 'Example' });
  const id = randomUUID();
  c.characters = [
    {
      id,
      name: 'Marta',
      type: CharacterType.Npc,
      attributes: {},
      inventory: {},
      description: {},
      notes: '',
      revision: 0,
    },
  ];
  const base = {
    ...emptyResponse,
    narrative: 'Marta looks tired.',
    operations: [
      {
        op: 'set' as const,
        characterId: id,
        field: 'description' as const,
        expected: {},
        value: { appearance: 'tired' },
      },
    ],
  };
  assert.equal(applyResponse(c, base, randomUUID()).changes[0], 'Marta: description changed');
  const privateReason = {
    ...explain(),
    reason: 'SECRET poison',
    visibility: KnowledgeVisibility.GmOnly,
  };
  assert.deepEqual(
    applyResponse(c, { ...base, operationExplanations: [privateReason] }, randomUUID()).changes,
    []
  );
});
