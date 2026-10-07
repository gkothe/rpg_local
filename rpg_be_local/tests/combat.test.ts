import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { applyResponse, undoSnapshot } from '../src/domain/state.js';
import { newCampaign } from '../src/domain/campaign.js';
import {
  combatPrepareSchema,
  combatEncounterSchema,
  combatTracking,
  assertManualStateEdit,
  assertManualAttributesEdit,
  assertCharacterRemovable,
  CombatFieldKind,
  CombatRollScope,
  CombatRollKind,
  COMBAT_PREPARATION_LIMITS,
  type CombatAuthorization,
  type PreparedDraft,
} from '../src/domain/combat.js';
import { diceInputSchema, diceRecordSchema, type DiceRecord } from '../src/domain/dice.js';
import { gameplayResponseSchema, type GameplayResponse } from '../src/domain/gameplayResponse.js';
import { CharacterType } from '../src/domain/options.js';
import { ExplanationBasis } from '../src/domain/operationExplanations.js';
import { KnowledgeOrigin, KnowledgeVisibility } from '../src/domain/knowledge.js';
import type { Campaign } from '../src/domain/types.js';
import { ResponseFieldProblem } from '../src/domain/responseFields.js';

const health = [{ path: ['health', 'damage'], kind: CombatFieldKind.Damage, label: 'Damage' }];
const soldier = (name: string) => ({
  name,
  type: CharacterType.Npc as const,
  attributes: { health: { max: 6, damage: 0 }, conditions: [] as string[] },
  inventory: {},
  description: { look: 'city guard' },
});
const introduction = {
  origin: KnowledgeOrigin.Gm,
  evidence: [],
  visibility: KnowledgeVisibility.Player,
};
function draft(name: string, receiptId = randomUUID()): PreparedDraft {
  return {
    characterId: randomUUID(),
    receiptId,
    localKey: name.toLowerCase(),
    label: name,
    character: soldier(name),
    introduction,
    trackedFields: health,
  };
}
function authorize(encounterId: string, drafts: PreparedDraft[]): CombatAuthorization {
  return {
    encounterId,
    drafts,
    participants: drafts.map((d) => ({
      characterId: d.characterId,
      label: d.label,
      trackedFields: d.trackedFields,
    })),
  };
}
const encounter = (id: string, drafts: PreparedDraft[], active = true) => ({
  id,
  active,
  round: 1,
  participants: drafts.map((d) => ({
    characterId: d.characterId,
    label: d.label,
    trackedFields: d.trackedFields,
  })),
});
function response(partial: Partial<GameplayResponse>): GameplayResponse {
  return {
    narrative: 'Two guards step forward.\n\nSteel rings out.',
    operations: [],
    rollInterpretations: [],
    ruleCitations: [],
    knowledgeChanges: [],
    operationExplanations: [],
    combatEffects: [],
    participantReferences: [],
    ...partial,
  };
}
const explain = (operationIndex: number) => ({
  operationIndex,
  reason: 'Initial combat state',
  basis: ExplanationBasis.Provisional,
  rollIds: [],
  evidence: [],
  visibility: KnowledgeVisibility.Player,
});
function startEncounter(c: Campaign, a: PreparedDraft, b: PreparedDraft, encounterId: string) {
  return applyResponse(
    c,
    response({
      operations: [
        {
          op: 'create',
          characterId: a.characterId,
          preparationReceiptId: a.receiptId,
          character: a.character,
          introduction,
        },
        {
          op: 'create',
          characterId: b.characterId,
          preparationReceiptId: b.receiptId,
          character: b.character,
          introduction,
        },
        { op: 'state', expected: {}, value: { combat: encounter(encounterId, [a, b]) } },
      ],
      operationExplanations: [explain(0), explain(1), explain(2)],
      participantReferences: [{ afterParagraph: 1, characterIds: [a.characterId, b.characterId] }],
    }),
    randomUUID(),
    {
      campaignId: c.id,
      turnId: randomUUID(),
      combat: { authorization: authorize(encounterId, [a, b]) },
    }
  );
}

test('combat schemas bound paths, require vitality, and reject prototype keys and overlaps', () => {
  const base = { characterId: randomUUID(), label: 'Guard' };
  assert.equal(
    combatPrepareSchema.safeParse({
      localKey: 'fight',
      participants: [{ ...base, trackedFields: health }],
    }).success,
    true
  );
  for (const trackedFields of [
    [{ path: ['conditions'], kind: CombatFieldKind.Condition, label: 'Conditions' }],
    [{ path: ['__proto__', 'x'], kind: CombatFieldKind.Damage, label: 'Bad' }],
    [{ path: [], kind: CombatFieldKind.Damage, label: 'Empty' }],
    [{ path: Array(17).fill('a'), kind: CombatFieldKind.Damage, label: 'Deep' }],
    [...health, { path: ['health'], kind: CombatFieldKind.Vitality, label: 'Overlap' }],
  ])
    assert.equal(
      combatPrepareSchema.safeParse({ localKey: 'f', participants: [{ ...base, trackedFields }] })
        .success,
      false,
      JSON.stringify(trackedFields)
    );
  assert.equal(
    combatPrepareSchema.safeParse({
      localKey: 'f',
      participants: [
        { ...base, trackedFields: health },
        { ...base, trackedFields: health },
      ],
    }).success,
    false
  );
  // Drafts are NPCs explicitly; there is no player default.
  const untyped = { ...soldier('X'), type: undefined };
  assert.equal(
    combatPrepareSchema.safeParse({
      localKey: 'f',
      participants: [
        { localKey: 'x', label: 'X', character: untyped, introduction, trackedFields: health },
      ],
    }).success,
    false
  );
  const big = 'x'.repeat(COMBAT_PREPARATION_LIMITS.requestBytes);
  assert.equal(
    combatPrepareSchema.safeParse({
      localKey: 'f',
      participants: [
        {
          localKey: 'x',
          label: 'X',
          character: { ...soldier('X'), description: { big } },
          introduction,
          trackedFields: health,
        },
      ],
    }).success,
    false
  );
  const duplicate = randomUUID();
  assert.equal(
    combatEncounterSchema.safeParse({
      id: randomUUID(),
      active: true,
      round: 0,
      participants: [
        { characterId: duplicate, label: 'A', trackedFields: health },
        { characterId: duplicate, label: 'B', trackedFields: health },
      ],
    }).success,
    false
  );
  for (const freeForm of [{ enemies: ['soldier'] }, null, 'two raiders'])
    assert.throws(() => combatTracking({ combat: freeForm }), /combatNotes/);
  assert.deepEqual(combatTracking({ combatNotes: { enemies: ['soldier'] } }), { kind: 'none' });
  assert.deepEqual(combatTracking({}), { kind: 'none' });
});

test('dice scopes are required and combat rolls require combat identity', () => {
  const roll = {
    slot: 0,
    groups: [{ label: 'attack', count: 3, sides: 10 }],
    reason: 'Strike',
    declaration: 'Guard attacks',
  };
  const ids = { encounterId: randomUUID(), actorId: randomUUID(), targetId: randomUUID() };
  assert.equal(diceInputSchema.safeParse({ ...roll, scope: 'combat' }).success, false);
  assert.equal(
    diceInputSchema.safeParse({
      ...roll,
      ...ids,
      scope: CombatRollScope.Combat,
      combatKind: CombatRollKind.Attack,
    }).success,
    true
  );
  const noTarget = { ...ids, targetId: undefined };
  assert.equal(
    diceInputSchema.safeParse({
      ...roll,
      ...noTarget,
      scope: CombatRollScope.Combat,
      combatKind: CombatRollKind.Attack,
    }).success,
    false
  );
  assert.equal(
    diceInputSchema.safeParse({
      ...roll,
      ...noTarget,
      scope: CombatRollScope.Combat,
      combatKind: CombatRollKind.Resistance,
    }).success,
    true
  );
  assert.equal(diceInputSchema.safeParse({ ...roll, scope: CombatRollScope.Oracle }).success, true);
  assert.equal(
    diceInputSchema.safeParse({ ...roll, scope: CombatRollScope.Oracle, actorId: ids.actorId })
      .success,
    false
  );
  assert.equal(diceInputSchema.safeParse(roll).success, false);
  // Recorded rolls from before combat tracking have no scope and stay readable.
  const recorded = {
    ...roll,
    id: randomUUID(),
    sessionId: randomUUID(),
    campaignId: randomUUID(),
    createdAt: new Date().toISOString(),
    groups: [{ label: 'attack', sides: 10, faces: [1, 2, 3] }],
  };
  assert.equal(diceRecordSchema.safeParse(recorded).success, true);
  assert.equal(
    diceRecordSchema.safeParse({ ...recorded, scope: CombatRollScope.Combat }).success,
    false
  );
  assert.equal(
    diceRecordSchema.safeParse({ ...recorded, scope: CombatRollScope.Oracle }).success,
    true
  );
});

test('response schema carries combat links and prepared create identities, never a version', () => {
  const current = response({
    operations: [
      {
        op: 'create',
        characterId: randomUUID(),
        preparationReceiptId: randomUUID(),
        character: soldier('A'),
        introduction,
      },
    ],
  });
  assert.equal(gameplayResponseSchema.safeParse(current).success, true);
  assert.equal(gameplayResponseSchema.safeParse({ ...current, version: 6 }).success, false);
  const missing: Record<string, unknown> = { ...current };
  delete missing.combatEffects;
  assert.equal(gameplayResponseSchema.safeParse(missing).success, false);
});

test('two prepared soldiers from one template keep distinct reserved identities', () => {
  const c = newCampaign({ name: 'Ambush' });
  const encounterId = randomUUID();
  const a = draft('Soldier');
  const b = { ...draft('Soldier'), localKey: 'soldier-2' };
  const started = startEncounter(c, a, b, encounterId);
  const ids = started.campaign.characters.map((x) => x.id);
  assert.deepEqual(ids, [a.characterId, b.characterId]);
  assert.notEqual(a.characterId, b.characterId);
  assert.equal(started.campaign.characters.filter((x) => x.name === 'Soldier').length, 2);
  assert.deepEqual(started.campaign.state.combat, encounter(encounterId, [a, b]));
});

test('prepared create must match its receipt exactly and cannot use a foreign reservation', () => {
  const c = newCampaign({ name: 'Ambush' });
  const encounterId = randomUUID();
  const a = draft('Soldier');
  const attempt = (op: Record<string, unknown>) =>
    applyResponse(
      c,
      response({ operations: [op as never], operationExplanations: [explain(0)] }),
      randomUUID(),
      {
        campaignId: c.id,
        turnId: randomUUID(),
        combat: { authorization: authorize(encounterId, [a]) },
      }
    );
  assert.throws(
    () =>
      attempt({
        op: 'create',
        characterId: a.characterId,
        preparationReceiptId: a.receiptId,
        character: { ...a.character, attributes: { health: { max: 9, damage: 0 } } },
        introduction,
      }),
    /copy the prepared character/
  );
  assert.throws(
    () =>
      attempt({
        op: 'create',
        characterId: randomUUID(),
        preparationReceiptId: a.receiptId,
        character: a.character,
        introduction,
      }),
    /combat_prepare receipt/
  );
  assert.throws(
    () =>
      attempt({ op: 'create', characterId: a.characterId, character: a.character, introduction }),
    /combat_prepare receipt/
  );
  // An ordinary create stays server-identified and cannot claim a reserved ID.
  const plain = attempt({ op: 'create', character: a.character, introduction });
  assert.notEqual(plain.campaign.characters[0]!.id, a.characterId);
});

test('damage to A changes only A, needs an effect and a narrative reference, and undo restores it', () => {
  const c = newCampaign({ name: 'Ambush' });
  const encounterId = randomUUID();
  const a = draft('Soldier');
  const b = { ...draft('Soldier'), localKey: 'soldier-2' };
  const started = startEncounter(c, a, b, encounterId).campaign;
  const roll: DiceRecord = {
    id: randomUUID(),
    sessionId: randomUUID(),
    campaignId: started.id,
    createdAt: new Date().toISOString(),
    slot: 0,
    groups: [{ label: 'attack', sides: 10, faces: [8] }],
    reason: 'Sword',
    declaration: 'Hero strikes the first soldier',
    scope: CombatRollScope.Combat,
    encounterId,
    combatKind: CombatRollKind.Resistance,
    actorId: a.characterId,
  };
  const before = started.characters.find((x) => x.id === a.characterId)!.attributes;
  const wound = {
    op: 'set' as const,
    characterId: a.characterId,
    field: 'attributes' as const,
    expected: before,
    value: { ...before, health: { max: 6, damage: 2 }, conditions: ['bleeding'] },
  };
  const effect = {
    characterId: a.characterId,
    operationIndex: 0,
    paths: [['health', 'damage']],
    reason: 'Sword hit for two',
    rollIds: [roll.id],
    afterParagraph: 2,
  };
  const evidence = {
    campaignId: started.id,
    turnId: randomUUID(),
    rolls: [roll],
    combat: { authorization: authorize(encounterId, []) },
  };
  const turn = (partial: Partial<GameplayResponse>) =>
    applyResponse(
      started,
      response({
        operations: [wound],
        operationExplanations: [
          { ...explain(0), basis: ExplanationBasis.Dice, rollIds: [roll.id] },
        ],
        rollInterpretations: [{ rollId: roll.id, explanation: 'Hit', afterParagraph: 2 }],
        combatEffects: [effect],
        participantReferences: [{ afterParagraph: 2, characterIds: [a.characterId] }],
        ...partial,
      }),
      evidence.turnId,
      evidence
    );
  const applied = turn({});
  const A = applied.campaign.characters.find((x) => x.id === a.characterId)!;
  const B = applied.campaign.characters.find((x) => x.id === b.characterId)!;
  assert.deepEqual(A.attributes.health, { max: 6, damage: 2 });
  assert.deepEqual(
    B.attributes,
    started.characters.find((x) => x.id === b.characterId)!.attributes
  );
  assert.deepEqual(
    applied.snapshot.afterCharacters.map((x) => x.id),
    [a.characterId]
  );

  assert.throws(() => turn({ combatEffects: [] }), /needs a combat effect/);
  assert.throws(
    () => turn({ combatEffects: [{ ...effect, characterId: b.characterId }] }),
    /same character/
  );
  assert.throws(
    () => turn({ combatEffects: [{ ...effect, paths: [['conditions']] }] }),
    /not a tracked field/
  );
  assert.throws(
    () => turn({ combatEffects: [{ ...effect, operationIndex: 3 }] }),
    /attributes set operation/
  );
  assert.throws(
    () => turn({ combatEffects: [{ ...effect, rollIds: [randomUUID()] }] }),
    /saved rolls/
  );
  assert.throws(() => turn({ participantReferences: [] }), /Reference each affected participant/);
  assert.throws(
    () =>
      turn({
        participantReferences: [{ afterParagraph: 2, characterIds: [a.characterId, randomUUID()] }],
      }),
    /encounter participants/
  );
  assert.throws(
    () => turn({ participantReferences: [{ afterParagraph: 3, characterIds: [a.characterId] }] }),
    /existing narrative paragraph/
  );
  // Overwriting the ancestor object that holds a tracked field is a tracked change too.
  assert.throws(
    () =>
      turn({
        operations: [{ ...wound, value: { conditions: [] } }],
        combatEffects: [],
      }),
    /combat effect|remain present/
  );
  // A condition can change without dice when it is not a tracked field.
  const conditionOnly = turn({
    operations: [{ ...wound, value: { ...before, conditions: ['prone'] } }],
    operationExplanations: [explain(0)],
    rollInterpretations: [],
    combatEffects: [],
    participantReferences: [{ afterParagraph: 1, characterIds: [a.characterId] }],
  });
  assert.deepEqual(
    conditionOnly.campaign.characters.find((x) => x.id === a.characterId)!.attributes.conditions,
    ['prone']
  );
  const restored = undoSnapshot(applied.campaign, applied.snapshot);
  assert.deepEqual(
    restored.characters.map(({ id, attributes }) => ({ id, attributes })),
    started.characters.map(({ id, attributes }) => ({ id, attributes }))
  );
  assert.deepEqual(restored.state, started.state);
});

test('encounter transitions: active encounters end explicitly and new IDs come from preparation', () => {
  const c = newCampaign({ name: 'Ambush' });
  const encounterId = randomUUID();
  const a = draft('Soldier');
  const b = { ...draft('Soldier'), localKey: 'soldier-2' };
  const started = startEncounter(c, a, b, encounterId).campaign;
  const state = (value: Record<string, unknown>, authorization = authorize(encounterId, [])) =>
    applyResponse(
      started,
      response({
        operations: [{ op: 'state', expected: started.state, value }],
        operationExplanations: [explain(0)],
      }),
      randomUUID(),
      { campaignId: started.id, turnId: randomUUID(), combat: { authorization } }
    );
  assert.throws(() => state({}), /End the active encounter explicitly/);
  assert.throws(() => state({ combat: encounter(randomUUID(), [a]) }), /End the active encounter/);
  assert.throws(
    () =>
      state({
        combat: {
          ...encounter(encounterId, [a, b]),
          participants: [{ characterId: randomUUID(), label: 'Ghost', trackedFields: health }],
        },
      }),
    /not a character sheet/
  );
  assert.throws(
    () =>
      state({
        combat: {
          ...encounter(encounterId, [a, b]),
          participants: [
            {
              characterId: a.characterId,
              label: 'A',
              trackedFields: [
                { path: ['health', 'max'], kind: CombatFieldKind.Vitality, label: 'Max' },
              ],
            },
          ],
        },
      }),
    /must come from the existing encounter/
  );
  // Withdrawing B and ending the fight keeps both sheets and A's wounds.
  const ended = state({ combat: { ...encounter(encounterId, [a]), active: false } }).campaign;
  assert.equal(ended.characters.length, 2);
  assert.throws(
    () =>
      applyResponse(
        ended,
        response({
          operations: [
            { op: 'state', expected: ended.state, value: { combat: encounter(encounterId, [a]) } },
          ],
          operationExplanations: [explain(0)],
        }),
        randomUUID(),
        {
          campaignId: ended.id,
          turnId: randomUUID(),
          combat: { authorization: authorize(encounterId, []) },
        }
      ),
    /cannot be reopened/
  );
  // Free-form combat notes are preserved and never converted implicitly.
  const noted = newCampaign({ name: 'Old' });
  noted.state = { combatNotes: { soldiers: 2 } };
  const kept = applyResponse(noted, response({ narrative: 'Quiet.' }), randomUUID(), {
    campaignId: noted.id,
    turnId: randomUUID(),
  });
  assert.deepEqual(kept.campaign.state, { combatNotes: { soldiers: 2 } });
  // A GM state write cannot put free-form data into state.combat.
  assert.throws(
    () =>
      applyResponse(
        noted,
        response({
          operations: [{ op: 'state', expected: noted.state, value: { combat: { soldiers: 3 } } }],
          operationExplanations: [explain(0)],
        }),
        randomUUID(),
        { campaignId: noted.id, turnId: randomUUID() }
      ),
    /combatNotes/
  );
});

test('manual edits keep the structured encounter and tracked paths but may change values', () => {
  const a = draft('Soldier');
  const id = randomUUID();
  const active = { scene: 'gate', combat: encounter(id, [a]) };
  assert.doesNotThrow(() => assertManualStateEdit(active, { ...active, scene: 'yard' }));
  assert.throws(
    () => assertManualStateEdit(active, { scene: 'gate' }),
    /changes only through gameplay/
  );
  assert.throws(
    () => assertManualStateEdit(active, { combat: { ...encounter(id, [a]), participants: [] } }),
    /changes only through gameplay/
  );
  assert.throws(
    () => assertManualStateEdit(active, { combat: encounter(randomUUID(), [a]) }),
    /changes only through gameplay/
  );
  const ended = { combat: encounter(id, [a], false) };
  assert.doesNotThrow(() => assertManualStateEdit(ended, {}));
  assert.throws(() => assertManualStateEdit({}, { combat: encounter(id, [a]) }), /combat_prepare/);
  assert.throws(() => assertManualStateEdit({}, { combat: { id: 'fake' } }), /combatNotes/);
  // Free-form notes are ordinary manual state.
  assert.doesNotThrow(() => assertManualStateEdit({}, { combatNotes: { soldiers: 2 } }));
  assert.throws(() => assertManualStateEdit({}, { combat: { soldiers: 2 } }), /combatNotes/);
  assert.doesNotThrow(() =>
    assertManualAttributesEdit(active, a.characterId, { health: { max: 6, damage: 3 } })
  );
  assert.throws(
    () => assertManualAttributesEdit(active, a.characterId, { hp: 3 }),
    /keep the tracked combat fields/
  );
  assert.doesNotThrow(() => assertManualAttributesEdit(ended, a.characterId, { hp: 3 }));
  assert.throws(() => assertCharacterRemovable(active, a.characterId), /end the encounter first/);
  assert.doesNotThrow(() => assertCharacterRemovable(ended, a.characterId));
});

test('stray participant references without an encounter force an empty collection; other reference faults do not', () => {
  const c = newCampaign({ name: 'No encounter' });
  const options = {
    campaignId: c.id,
    turnId: randomUUID(),
    combat: { authorization: { encounterId: null, participants: [], drafts: [] } },
  };
  assert.throws(
    () =>
      applyResponse(
        c,
        response({ participantReferences: [{ afterParagraph: 1, characterIds: [randomUUID()] }] }),
        randomUUID(),
        options
      ),
    (error: unknown) => {
      const problem = error as ResponseFieldProblem;
      assert.ok(problem instanceof ResponseFieldProblem);
      assert.deepEqual(problem.path, ['participantReferences']);
      assert.deepEqual(problem.forced, { value: [] });
      return true;
    }
  );
  const a = draft('Aldric');
  const b = draft('Brun');
  const encounterId = randomUUID();
  const started = startEncounter(newCampaign({ name: 'Encounter' }), a, b, encounterId);
  assert.throws(
    () =>
      applyResponse(
        started.campaign,
        response({ participantReferences: [{ afterParagraph: 9, characterIds: [a.characterId] }] }),
        randomUUID(),
        {
          campaignId: started.campaign.id,
          turnId: randomUUID(),
          combat: { authorization: authorize(encounterId, [a, b]) },
        }
      ),
    (error: unknown) => error instanceof ResponseFieldProblem && error.forced === undefined
  );
});
