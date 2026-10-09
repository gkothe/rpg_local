import {
  remapNpcPreparation,
  type NpcPreparationArchive,
} from '../src/services/npcPreparationArchive.js';
import { npcArgumentDigest } from '../src/services/npcPreparation.js';
import { validateProfileKnowledge } from '../src/domain/continuity.js';
import { CharacterType } from '../src/domain/options.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  npcPrepareSchema,
  NPC_PREPARATION_LIMITS,
  NPC_PREPARE_TOOL_NAME,
  preparationOperations,
  npcCreatorOutputSchema,
  validateNpcPreparedCreates,
  stagedNpcSnapshots,
  type NpcPreparationPayload,
} from '../src/domain/npcPreparation.js';
import { npcCreatorPrompt } from '../src/domain/npcCreationGeneration.js';
import { core } from './npcFixture.js';
import { gmIntroduction, ownedTools } from './ownedGameplayFixture.js';
import {
  gameplayToolRequestBytes,
  GAMEPLAY_ENVELOPE_BYTES,
} from '../src/providers/gameplayTools.js';
import { createNpcRecall } from '../src/domain/npcRecall.js';
import { npcProfileSchema } from '../src/domain/continuity.js';

const payload = (): NpcPreparationPayload => {
  const characterId = randomUUID();
  return {
    receiptId: randomUUID(),
    characterId,
    publicCharacter: {
      name: 'Mara',
      type: CharacterType.Npc,
      attributes: {},
      inventory: {},
      description: { role: 'Innkeeper', voice: 'Dry practical humor' },
    },
    profile: { ...core, characterId },
    introduction: gmIntroduction,
  };
};
test('creator asks for short deep fiction while mechanics/history stay separate', () => {
  const prompt = npcCreatorPrompt({
    campaign: 'Flooded crossroads',
    intent: 'Create the innkeeper',
  });
  assert.match(prompt, /80-150/);
  assert.match(prompt, /not a cutoff/);
  assert.match(prompt, /no tools/);
  assert.match(prompt, /subject link/);
  assert.equal(
    npcCreatorOutputSchema.safeParse({
      name: 'Mara',
      description: { role: 'Innkeeper' },
      profile: core,
    }).success,
    true
  );
  assert.equal(
    npcCreatorOutputSchema.safeParse({
      name: 'Mara',
      description: { role: 'Innkeeper', biography: 'Unexpected' },
      profile: core,
    }).success,
    false
  );
  assert.equal(
    npcProfileSchema.safeParse({ ...core, characterId: randomUUID(), secret: undefined }).success,
    true
  );
});
test('tool argument schema and shared transport allow substantive input above rules ceiling', async () => {
  const input = { localKey: 'innkeeper', intent: 'a'.repeat(2000), introduction: gmIntroduction };
  assert.ok(npcPrepareSchema.safeParse(input).success);
  assert.equal(
    gameplayToolRequestBytes(NPC_PREPARE_TOOL_NAME),
    NPC_PREPARATION_LIMITS.requestBytes
  );
  assert.ok(GAMEPLAY_ENVELOPE_BYTES > NPC_PREPARATION_LIMITS.requestBytes);
  let calls = 0;
  const tools = ownedTools({
    prepareNpc: async () => {
      calls++;
      return { staged: true };
    },
  });
  assert.ok(tools.definitions.some((d) => d.name === NPC_PREPARE_TOOL_NAME));
  assert.deepEqual(await tools.call(NPC_PREPARE_TOOL_NAME, input, 'tool1'), { staged: true });
  assert.equal(calls, 1);
  assert.ok(!ownedTools().definitions.some((d) => d.name === NPC_PREPARE_TOOL_NAME));
});
test('exact receipt pairing prevents forged character or private profile mutations', () => {
  const p = payload();
  const ops = preparationOperations(p);
  validateNpcPreparedCreates(
    { operations: [ops.createOperation], continuityChanges: [ops.profileChange] },
    [p]
  );
  assert.throws(
    () =>
      validateNpcPreparedCreates({ operations: [ops.createOperation], continuityChanges: [] }, [p]),
    /exact private profile/
  );
  assert.throws(
    () =>
      validateNpcPreparedCreates(
        {
          operations: [
            {
              ...(ops.createOperation as object),
              character: { ...p.publicCharacter, name: 'Different' },
            },
          ],
          continuityChanges: [ops.profileChange],
        },
        [p]
      ),
    /exact creation/
  );
  validateNpcPreparedCreates({ operations: [], continuityChanges: [] }, [p]);
  for (const roll of [{ actorId: p.characterId }, { targetId: p.characterId }])
    assert.throws(
      () => validateNpcPreparedCreates({ operations: [] }, [p], [roll]),
      /used in dice/
    );
});
test('registry reads refreshed same-attempt drafts without consulting live campaign state', async () => {
  const p = payload();
  let drafts: NpcPreparationPayload[] = [];
  const tools = ownedTools({
    npcReader: async () =>
      createNpcRecall(
        randomUUID(),
        stagedNpcSnapshots(drafts) as Parameters<typeof createNpcRecall>[1],
        []
      ),
  });
  const before = await tools.call('campaign_npcs_search', { query: 'Mara' }, 1);
  assert.equal((before as { npcs: unknown[] }).npcs.length, 0);
  drafts = [p];
  const result = await tools.call('campaign_npcs_get', { id: p.characterId }, 2);
  assert.equal(
    (result as { npc: { privateCore: { secret: string } } }).npc.privateCore.secret,
    core.secret
  );
  const after = await tools.call('campaign_npcs_search', { query: 'Mara' }, 3);
  assert.equal((after as { npcs: unknown[] }).npcs.length, 1);
});

test('creator references reject wrong-kind and unrevealed knowledge before publication', () => {
  const id = randomUUID();
  const profile = { ...core, characterId: randomUUID(), relationshipKnowledgeIds: [id] };
  assert.throws(
    () => validateProfileKnowledge(profile, [{ id, kind: 'event', status: 'active' }] as never),
    /Relationship reference/
  );
  assert.throws(
    () =>
      validateProfileKnowledge(
        { ...profile, relationshipKnowledgeIds: [], revealedTraitKnowledgeIds: [id] },
        [{ id, visibility: 'gm_only', status: 'active' }] as never
      ),
    /Revealed trait/
  );
});
test('archive remaps declared NPC references while preserving UUID-shaped keys, fiction and mechanics', () => {
  const p = payload();
  const literal = randomUUID();
  const id = randomUUID();
  const mappedId = randomUUID();
  const row = {
    id,
    campaignId: id,
    sessionId: id,
    turnId: id,
    ownerTurnId: id,
    reservedCharacterId: p.characterId,
    localKey: literal,
    status: 'ready',
    result: p,
    frozenInput: {
      arguments: {
        localKey: literal,
        intent: literal,
        relevantCharacterIds: [id],
        establishedCharacter: { attributes: { value: id } },
      },
      characters: [{ id, description: { role: literal } }],
      knowledge: [],
    },
  } as unknown as NpcPreparationArchive;
  remapNpcPreparation(row, (value) =>
    value === id ? mappedId : value === p.characterId ? mappedId : value
  );
  assert.equal(row.localKey, literal);
  const args = row.frozenInput.arguments as Record<string, unknown>;
  assert.equal(args.localKey, literal);
  assert.equal(args.intent, literal);
  assert.deepEqual(args.relevantCharacterIds, [mappedId]);
  assert.deepEqual(args.establishedCharacter, { attributes: { value: id } });
  assert.equal(row.argumentDigest, npcArgumentDigest(args));
});
