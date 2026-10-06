import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Store } from '../src/store.js';
import { appRoot, databaseUrl } from '../src/config.js';
import { newCampaign } from '../src/domain/campaign.js';
import { TurnService } from '../src/services/turns.js';
import { DiceService } from '../src/services/dice.js';
import { CombatPreparationService } from '../src/services/combatPreparation.js';
import { CampaignService } from '../src/services/campaigns.js';
import { CharacterType, TurnStatus } from '../src/domain/options.js';
import { Problem } from '../src/errors.js';
import type { Generator } from '../src/providers/service.js';
import type { GameplayToolDispatch } from '../src/providers/gameplayTools.js';
import type { Campaign, Turn } from '../src/domain/types.js';

const enabled = process.env.NODE_ENV === 'test' && !!process.env.RPG_TEST_DATABASE_URL;
const schema = `combat_fixture_${randomUUID().replaceAll('-', '')}`;
let store: Store;
before(async () => {
  if (!enabled) return;
  const bootstrap = new Store();
  await bootstrap.pool.query(`CREATE SCHEMA ${schema}`);
  await bootstrap.close();
  const url = new URL(databaseUrl());
  url.searchParams.set('options', `-c search_path=${schema}`);
  store = new Store(url.toString());
  for (const file of (await readdir(path.join(appRoot, 'migrationssql')))
    .filter((name) => name.endsWith('.sql'))
    .sort())
    await store.pool.query(await readFile(path.join(appRoot, 'migrationssql', file), 'utf8'));
});
after(async () => {
  if (!enabled) return;
  await store.pool.query(`DROP SCHEMA ${schema} CASCADE`);
  await store.close();
});
async function terminal(campaignId: string, turnId: string): Promise<Turn> {
  for (let attempt = 0; attempt < 250; attempt++) {
    const turn = await store.turn(campaignId, turnId);
    if (![TurnStatus.Pending, TurnStatus.Running].includes(turn.status as TurnStatus)) return turn;
    await delay(20);
  }
  throw new Error('Synthetic turn did not reach a terminal status');
}

const damage = [{ path: ['health', 'damage'], kind: 'damage', label: 'Damage' }];
const introduction = { origin: 'gm', evidence: [], visibility: 'player' };
const soldier = (localKey: string) => ({
  localKey,
  label: 'Soldier',
  character: {
    name: 'Soldier',
    type: 'npc',
    attributes: { health: { max: 6, damage: 0 } },
    inventory: {},
    description: { look: 'city guard' },
  },
  introduction,
  trackedFields: damage,
});
type Payload = {
  encounterId: string;
  participants: { characterId: string; label: string; trackedFields: unknown }[];
  createOperations: {
    op: 'create';
    characterId: string;
    preparationReceiptId: string;
    character: { attributes: Record<string, unknown> };
    introduction: unknown;
  }[];
};
const explain = (operationIndex: number, rollIds: string[] = []) => ({
  operationIndex,
  reason: 'Combat consequence',
  basis: rollIds.length ? 'dice' : 'provisional',
  rollIds,
  evidence: [],
  visibility: 'player',
});
async function heroCampaign(): Promise<Campaign> {
  const campaign = newCampaign({ name: 'Ambush' });
  campaign.characters.push({
    id: randomUUID(),
    name: 'Hero',
    type: CharacterType.Player,
    attributes: { health: { max: 7, damage: 0 } },
    inventory: {},
    description: {},
    notes: '',
    revision: 0,
  });
  await store.insert(campaign);
  return campaign;
}
/** Scripted v6 GM: prepares two soldiers, rolls an attack and wounds only the first. */
async function ambush(tools: GameplayToolDispatch, heroId: string, fail?: 'after_dice') {
  const batch = {
    localKey: 'ambush',
    participants: [
      { characterId: heroId, label: 'Hero', trackedFields: damage },
      soldier('soldier-a'),
      soldier('soldier-b'),
    ],
  };
  const payload = (await tools('combat_prepare', batch, 'prepare')) as unknown as Payload;
  // Same key and arguments under another transport identity returns the same reservation.
  assert.deepEqual(await tools('combat_prepare', batch, 'prepare-again'), payload);
  const [a, b] = payload.createOperations;
  assert.notEqual(a!.characterId, b!.characterId);
  const roll = (await tools(
    'roll_dice',
    {
      slot: 0,
      groups: [{ label: 'attack', count: 2, sides: 10 }],
      reason: 'Sword',
      declaration: 'Hero attacks the first soldier',
      scope: 'combat',
      encounterId: payload.encounterId,
      combatKind: 'attack',
      actorId: heroId,
      targetId: a!.characterId,
    },
    'roll'
  )) as { rollId: string };
  if (fail === 'after_dice') throw new Problem(429, 'provider_quota', 'Synthetic GM failure');
  const wounded = { health: { max: 6, damage: 2 } };
  return {
    payload,
    response: {
      version: 6,
      narrative: 'Two soldiers block the gate.\n\nYour blade cuts the first soldier.',
      operations: [
        a!,
        b!,
        {
          op: 'set',
          characterId: a!.characterId,
          field: 'attributes',
          expected: a!.character.attributes,
          value: wounded,
        },
        {
          op: 'state',
          expected: {},
          value: {
            combat: {
              trackingVersion: 1,
              id: payload.encounterId,
              active: true,
              round: 1,
              participants: payload.participants.map(({ characterId, label, trackedFields }) => ({
                characterId,
                label,
                trackedFields,
              })),
            },
          },
        },
      ],
      rollInterpretations: [{ rollId: roll.rollId, explanation: 'Hit', afterParagraph: 2 }],
      ruleCitations: [],
      knowledgeChanges: [],
      operationExplanations: [explain(0), explain(1), explain(2, [roll.rollId]), explain(3)],
      combatEffects: [
        {
          characterId: a!.characterId,
          operationIndex: 2,
          paths: [['health', 'damage']],
          reason: 'Sword hit',
          rollIds: [roll.rollId],
          afterParagraph: 2,
        },
      ],
      participantReferences: [
        { afterParagraph: 1, characterIds: [a!.characterId, b!.characterId] },
        { afterParagraph: 2, characterIds: [heroId, a!.characterId] },
      ],
    },
  };
}
function editor(counts: { editor: number }, failFirst = false): Generator['generate'] {
  return async (_settings, prompt) => {
    counts.editor++;
    if (failFirst && counts.editor === 1)
      throw new Problem(429, 'provider_quota', 'Synthetic editor quota unavailable');
    assert.match(prompt, /character links/);
    // Return the supplied narrative unchanged; this fixture edits nothing.
    return JSON.parse(/^\{"narrative":.*\}$/m.exec(prompt)![0]);
  };
}

test(
  'v6 turn prepares two soldiers, wounds only A, saves after editing, feeds the next context and undoes fully',
  { skip: !enabled },
  async () => {
    const campaign = await heroCampaign();
    const heroId = campaign.characters[0]!.id;
    const counts = { gm: 0, editor: 0 };
    let payload: Payload | undefined;
    const generator: Generator = {
      capacity: async () => 16000,
      gameplayCapacity: async () => 16000,
      generate: editor(counts),
      generateOwnedGameplay: async (_settings, prompt, _schema, system, tools) => {
        counts.gm++;
        assert.match(system, /combat_prepare/);
        assert.ok(tools.definitions!.some((tool) => tool.name === 'combat_prepare'));
        if (counts.gm === 1) {
          const result = await ambush(tools, heroId);
          payload = result.payload;
          return result.response;
        }
        // Next action: both soldiers are mandatory context by ID.
        const ids = (JSON.parse(prompt).mandatory.characters as { id: string }[]).map((c) => c.id);
        for (const op of payload!.createOperations) assert.ok(ids.includes(op.characterId));
        return {
          version: 6,
          narrative: 'The soldiers circle you.',
          operations: [],
          rollInterpretations: [],
          ruleCitations: [],
          knowledgeChanges: [],
          operationExplanations: [],
          combatEffects: [],
          participantReferences: [
            {
              afterParagraph: 1,
              characterIds: payload!.createOperations.map((op) => op.characterId),
            },
          ],
        };
      },
    };
    const service = new TurnService(store, generator, 6);
    const first = await service.submit(campaign.id, {
      revision: 0,
      requestId: randomUUID(),
      action: 'Two guards attack',
    });
    const done = await terminal(campaign.id, first.id);
    assert.equal(done.status, TurnStatus.Completed, done.error ?? '');
    const saved = await store.campaign(campaign.id);
    const [a, b] = payload!.createOperations.map((op) =>
      saved.characters.find((c) => c.id === op.characterId)
    );
    assert.deepEqual(a!.attributes.health, { max: 6, damage: 2 });
    assert.deepEqual(b!.attributes.health, { max: 6, damage: 0 });
    assert.deepEqual(saved.characters[0]!.attributes.health, { max: 7, damage: 0 });
    assert.equal((saved.state.combat as { id: string }).id, payload!.encounterId);
    assert.deepEqual(done.combatEffects![0]!.characterId, a!.id);
    assert.equal(done.participantReferences!.length, 2);
    assert.equal(done.rolls![0]!.targetId, a!.id);
    assert.equal(done.rolls![0]!.scope, 'combat');
    assert.equal(counts.editor, 1);
    // The frozen session list is unchanged; prepared IDs are authorized by receipt only.
    const session = await store.pool.query('SELECT character_ids FROM dice_sessions WHERE id=$1', [
      done.diceSessionId,
    ]);
    assert.deepEqual(session.rows[0].character_ids, [heroId]);
    const receipts = await new CombatPreparationService(store).authorization(done.diceSessionId!);
    assert.equal(receipts.preparations.length, 1);
    assert.equal(receipts.drafts.length, 2);
    // Active participants cannot be deleted; values can still be edited by hand.
    const campaigns = new CampaignService(store, generator as never);
    await assert.rejects(
      () => campaigns.deleteCharacter(campaign.id, a!.id, saved.revision),
      /end the encounter first/
    );
    const second = await service.submit(campaign.id, {
      revision: saved.revision,
      requestId: randomUUID(),
      action: 'I hold my ground',
    });
    assert.equal((await terminal(campaign.id, second.id)).status, TurnStatus.Completed);
    await service.undo(campaign.id, 0);
    await service.undo(campaign.id, 0);
    const restored = await store.campaign(campaign.id);
    assert.deepEqual(
      restored.characters.map((c) => c.id),
      [heroId]
    );
    assert.deepEqual(restored.state, {});
    // Receipts and dice remain historical audit records.
    assert.equal((await new DiceService(store).records(done.diceSessionId!)).length, 1);
    await assert.rejects(
      () =>
        store.pool.query('DELETE FROM combat_preparations WHERE session_id=$1', [
          done.diceSessionId,
        ]),
      /append-only/
    );
  }
);

test(
  'failure after preparation and dice publishes nothing; retry reuses the reserved IDs and recorded dice',
  { skip: !enabled },
  async () => {
    const campaign = await heroCampaign();
    const heroId = campaign.characters[0]!.id;
    const counts = { gm: 0, editor: 0 };
    const reserved: string[][] = [];
    let retryPrompt = '';
    const generator: Generator = {
      capacity: async () => 16000,
      gameplayCapacity: async () => 16000,
      generate: editor(counts),
      generateOwnedGameplay: async (_settings, prompt, _schema, _system, tools) => {
        counts.gm++;
        if (counts.gm > 1) retryPrompt = prompt;
        const result = await ambush(tools, heroId, counts.gm === 1 ? 'after_dice' : undefined);
        reserved.push(result.payload.createOperations.map((op) => op.characterId));
        return result.response;
      },
    };
    const service = new TurnService(store, generator, 6);
    const first = await service.submit(campaign.id, {
      revision: 0,
      requestId: randomUUID(),
      action: 'Two guards attack',
    });
    const failed = await terminal(campaign.id, first.id);
    assert.equal(failed.status, TurnStatus.Failed);
    assert.equal(failed.diceRetry?.available, true);
    const untouched = await store.campaign(campaign.id);
    assert.equal(untouched.characters.length, 1);
    assert.deepEqual(untouched.state, {});
    const prepared = await new CombatPreparationService(store).authorization(failed.diceSessionId!);
    assert.equal(prepared.drafts.length, 2);
    const firstIds = prepared.drafts.map((d) => d.characterId);
    const originalRolls = await new DiceService(store).records(failed.diceSessionId!);
    const retried = await service.retry(campaign.id, first.id, {
      revision: 0,
      requestId: randomUUID(),
    });
    const done = await terminal(campaign.id, retried.id);
    assert.equal(done.status, TurnStatus.Completed, done.error ?? '');
    assert.match(retryPrompt, /Combat preparations already recorded/);
    assert.deepEqual(reserved.at(-1), firstIds);
    assert.deepEqual(await new DiceService(store).records(failed.diceSessionId!), originalRolls);
    const saved = await store.campaign(campaign.id);
    assert.deepEqual(
      saved.characters.map((c) => c.id),
      [heroId, ...firstIds]
    );
  }
);

test(
  'editor failure keeps reservations unpublished; cancel never creates NPCs; resume commits once',
  { skip: !enabled },
  async () => {
    for (const mode of ['cancel', 'resume'] as const) {
      const campaign = await heroCampaign();
      const heroId = campaign.characters[0]!.id;
      const counts = { gm: 0, editor: 0 };
      const generator: Generator = {
        capacity: async () => 16000,
        gameplayCapacity: async () => 16000,
        generate: editor(counts, true),
        generateOwnedGameplay: async (_settings, _prompt, _schema, _system, tools) => {
          counts.gm++;
          return (await ambush(tools, heroId)).response;
        },
      };
      const service = new TurnService(store, generator, 6);
      const submitted = await service.submit(campaign.id, {
        revision: 0,
        requestId: randomUUID(),
        action: 'Two guards attack',
      });
      const pending = await terminal(campaign.id, submitted.id);
      assert.equal(pending.editingPending, true);
      assert.equal((await store.campaign(campaign.id)).characters.length, 1);
      if (mode === 'cancel') {
        await service.cancel(campaign.id, submitted.id);
        const after = await store.campaign(campaign.id);
        assert.equal(after.characters.length, 1);
        assert.deepEqual(after.state, {});
        continue;
      }
      await service.resumeEditing(campaign.id, submitted.id, {
        revision: 0,
        requestId: randomUUID(),
      });
      const done = await terminal(campaign.id, submitted.id);
      assert.equal(done.status, TurnStatus.Completed, done.error ?? '');
      assert.equal(counts.gm, 1);
      assert.equal((await store.campaign(campaign.id)).characters.length, 3);
    }
  }
);

test(
  'combat_prepare rejects conflicting keys, foreign encounters and unknown characters; dice authorize only prepared participants',
  { skip: !enabled },
  async () => {
    const campaign = await heroCampaign();
    const heroId = campaign.characters[0]!.id;
    const checks: string[] = [];
    const generator: Generator = {
      capacity: async () => 16000,
      gameplayCapacity: async () => 16000,
      generate: editor({ editor: 0 }),
      generateOwnedGameplay: async (_settings, _prompt, _schema, _system, tools) => {
        const reject = async (name: string, input: unknown, pattern: RegExp, label: string) => {
          await assert.rejects(() => tools(name, input, randomUUID()), pattern);
          checks.push(label);
        };
        const payload = (await tools(
          'combat_prepare',
          { localKey: 'a', participants: [soldier('soldier-a')] },
          'first'
        )) as unknown as Payload;
        await reject(
          'combat_prepare',
          { localKey: 'a', participants: [soldier('soldier-b')] },
          /different arguments/,
          'key'
        );
        await reject(
          'combat_prepare',
          {
            localKey: 'b',
            participants: [{ ...soldier('soldier-a'), label: 'Renamed' }],
          },
          /different specification/,
          'localKey'
        );
        await reject(
          'combat_prepare',
          { localKey: 'c', encounterId: randomUUID(), participants: [soldier('soldier-c')] },
          /encounterId/,
          'foreign encounter'
        );
        await reject(
          'combat_prepare',
          {
            localKey: 'd',
            participants: [{ characterId: randomUUID(), label: 'Ghost', trackedFields: damage }],
          },
          /frozen context/,
          'unknown character'
        );
        // A second batch continues the same prepared encounter.
        const second = (await tools(
          'combat_prepare',
          {
            localKey: 'e',
            participants: [{ characterId: heroId, label: 'Hero', trackedFields: damage }],
          },
          'second'
        )) as unknown as Payload;
        assert.equal(second.encounterId, payload.encounterId);
        const base = {
          groups: [{ label: 'attack', count: 1, sides: 10 }],
          reason: 'Sword',
          declaration: 'Attack',
        };
        await reject(
          'roll_dice',
          {
            ...base,
            slot: 0,
            scope: 'combat',
            encounterId: randomUUID(),
            combatKind: 'attack',
            actorId: heroId,
            targetId: payload.createOperations[0]!.characterId,
          },
          /dice_input|Combat rolls|encounter/i,
          'roll encounter'
        );
        await reject(
          'roll_dice',
          { ...base, slot: 0, scope: 'character', actorId: heroId },
          /combat scope/,
          'participant scope'
        );
        await reject(
          'roll_dice',
          {
            ...base,
            slot: 0,
            scope: 'combat',
            encounterId: payload.encounterId,
            combatKind: 'attack',
            actorId: heroId,
            targetId: randomUUID(),
          },
          /participants/,
          'unknown target'
        );
        await tools('roll_dice', { ...base, slot: 0, scope: 'oracle' }, 'oracle');
        throw new Problem(429, 'provider_quota', 'Stop after checks');
      },
    };
    const service = new TurnService(store, generator, 6);
    const submitted = await service.submit(campaign.id, {
      revision: 0,
      requestId: randomUUID(),
      action: 'Fight',
    });
    await terminal(campaign.id, submitted.id);
    assert.deepEqual(checks, [
      'key',
      'localKey',
      'foreign encounter',
      'unknown character',
      'roll encounter',
      'participant scope',
      'unknown target',
    ]);
    assert.equal((await store.campaign(campaign.id)).characters.length, 1);
  }
);

test(
  'manual CRUD keeps the active encounter and tracked paths but allows value edits',
  { skip: !enabled },
  async () => {
    const campaign = await heroCampaign();
    const heroId = campaign.characters[0]!.id;
    const encounter = {
      trackingVersion: 1,
      id: randomUUID(),
      active: true,
      round: 1,
      participants: [{ characterId: heroId, label: 'Hero', trackedFields: damage }],
    };
    await store.transaction(async (client) => {
      const c = await store.campaign(campaign.id, client, true);
      c.state = { scene: 'gate', combat: encounter };
      await store.save(c, client);
    });
    const service = new CampaignService(store, {} as never);
    await assert.rejects(
      () => service.patch(campaign.id, 0, { state: { scene: 'gate' } }),
      /gameplay/
    );
    await assert.rejects(
      () =>
        service.patch(campaign.id, 0, { state: { combat: { ...encounter, participants: [] } } }),
      /gameplay/
    );
    const edited = await service.patch(campaign.id, 0, {
      state: { scene: 'yard', combat: encounter },
    });
    assert.equal(edited.state.scene, 'yard');
    await assert.rejects(
      () => service.patchCharacter(campaign.id, heroId, 0, { attributes: { hp: 3 } }),
      /tracked combat fields/
    );
    const healed = await service.patchCharacter(campaign.id, heroId, 0, {
      attributes: { health: { max: 7, damage: 4 } },
    });
    assert.deepEqual(healed.characters[0]!.attributes.health, { max: 7, damage: 4 });
    await assert.rejects(
      () => service.deleteCharacter(campaign.id, heroId, 0),
      /end the encounter/
    );
    // Ending the encounter is a gameplay transition, not a manual state edit.
    await assert.rejects(
      () => service.patch(campaign.id, 0, { state: { combat: { ...encounter, active: false } } }),
      /gameplay/
    );
  }
);
