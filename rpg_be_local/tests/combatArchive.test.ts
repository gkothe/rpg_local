import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { newCampaign } from '../src/domain/campaign.js';
import {
  LibraryService,
  remapArchive,
  assertCombatArchiveFormat,
} from '../src/services/library.js';
import type { Store } from '../src/store.js';
import { CharacterType } from '../src/domain/options.js';
import type { Archive } from '../src/domain/types.js';
import { RuleSystemKind } from '../src/domain/rules.js';
import { Problem } from '../src/errors.js';
import { ZodError } from 'zod';

const fields = [{ path: ['health', 'damage'], kind: 'damage', label: 'Damage' }];
const introduction = { origin: 'gm', evidence: [], visibility: 'player' };
function combatArchive() {
  const campaign = newCampaign({ name: 'Ambush' });
  const [a, b, session, turnId, encounterId, receiptId, rollId] = Array.from({ length: 7 }, () =>
    randomUUID()
  );
  const sheet = (id: string, damage = 0) => ({
    id: id!,
    name: 'Soldier',
    type: CharacterType.Npc,
    // Free JSON may contain UUID-looking text; it is never rewritten.
    attributes: { health: { max: 6, damage }, note: `twin of ${b}` },
    inventory: {},
    description: {},
    notes: '',
    revision: 1,
  });
  const draft = (id: string) => {
    const { name, type, attributes, inventory, description } = sheet(id);
    const character = { name, type, attributes, inventory, description };
    return { label: 'Soldier', character, introduction, trackedFields: fields };
  };
  const combat = (participants: string[], active = true) => ({
    trackingVersion: 1,
    id: encounterId,
    active,
    round: 1,
    participants: participants.map((characterId) => ({
      characterId,
      label: 'Soldier',
      trackedFields: fields,
    })),
  });
  campaign.characters = [sheet(a!, 2), sheet(b!)];
  campaign.state = { scene: 'gate', combat: combat([a!, b!]) };
  const roll = {
    id: rollId!,
    sessionId: session!,
    campaignId: campaign.id,
    createdAt: campaign.createdAt,
    slot: 0,
    groups: [{ label: 'attack', sides: 10, faces: [7] }],
    reason: 'Sword',
    declaration: 'Hero strikes',
    scope: 'combat',
    encounterId: encounterId!,
    combatKind: 'resistance',
    actorId: a!,
  };
  return {
    format: 'local-rpg',
    version: 7,
    campaign,
    turns: [
      {
        id: turnId!,
        campaignId: campaign.id,
        requestId: randomUUID(),
        status: 'completed',
        action: 'Strike',
        narrative: 'The soldier staggers.',
        changes: [],
        error: null,
        undone: false,
        settings: campaign.settings,
        context: null,
        createdAt: campaign.createdAt,
        completedAt: campaign.createdAt,
        diceSessionId: session!,
        rolls: [structuredClone(roll)],
        rollInterpretations: [{ rollId: rollId!, explanation: 'Hit', afterParagraph: 1 }],
        combatEffects: [
          {
            characterId: a!,
            operationIndex: 2,
            paths: [['health', 'damage']],
            reason: 'Sword',
            rollIds: [rollId!],
            afterParagraph: 1,
          },
        ],
        participantReferences: [{ afterParagraph: 1, characterIds: [a!] }],
      },
    ],
    snapshots: [
      {
        turnId: turnId!,
        beforeCharacters: [],
        afterCharacters: [sheet(a!, 2), sheet(b!)],
        beforeState: {},
        afterState: { scene: 'gate', combat: combat([a!, b!]) },
        beforeMemory: null,
        beforeKnowledge: [],
        afterKnowledge: [],
      },
    ],
    memories: [],
    diceSessions: [
      {
        id: session!,
        campaignId: campaign.id,
        rootTurnId: turnId!,
        contextDigest: 'a'.repeat(64),
        frozenPrompt: '{}',
        frozenRevision: 0,
        characterIds: [],
        newFaces: 1,
        imported: false,
        createdAt: campaign.createdAt,
        promptContractVersion: 6,
        digestVersion: 4,
        systemPrompt: 'Exact instructions',
        frozenKnowledge: {
          campaignId: campaign.id,
          records: [],
          characters: [],
          sourceIds: [],
          sourceVersions: [],
        },
        frozenSources: { campaignId: campaign.id, sources: [] },
        toolDefinitions: [
          { name: 'combat_prepare', description: 'Prepare', inputSchema: { type: 'object' } },
        ],
      },
    ],
    diceRecords: [roll],
    combatPreparations: [
      {
        id: receiptId!,
        campaignId: campaign.id,
        sessionId: session!,
        turnId: turnId!,
        encounterId: encounterId!,
        preparationKey: 'fight',
        argumentDigest: 'b'.repeat(64),
        payload: {
          receiptId: receiptId!,
          encounterId: encounterId!,
          encounter: 'new',
          legacyCombat: false,
          participants: [a!, b!].map((id) => ({
            characterId: id,
            label: 'Soldier',
            trackedFields: fields,
            origin: 'prepared',
            sheet: { id, ...draft(id).character },
          })),
          createOperations: [a!, b!].map((id) => ({
            op: 'create',
            characterId: id,
            preparationReceiptId: receiptId!,
            ...draft(id),
          })),
          guidance: 'Use these IDs',
        },
        createdAt: campaign.createdAt,
      },
    ],
    combatPreparedCharacters: [a!, b!].map((id, index) => ({
      id,
      campaignId: campaign.id,
      sessionId: session!,
      preparationId: receiptId!,
      localKey: `soldier-${index}`,
      specificationDigest: 'c'.repeat(64),
      draft: draft(id),
      createdAt: campaign.createdAt,
    })),
  };
}

test('archive v7 remaps every structural combat identity consistently and keeps free text', () => {
  const input = combatArchive();
  const out = remapArchive(input);
  assert.equal(out.version, 7);
  const [a, b] = out.campaign.characters.map((c) => c.id);
  assert.notEqual(a, input.campaign.characters[0]!.id);
  const combat = out.campaign.state.combat as {
    id: string;
    participants: { characterId: string }[];
  };
  const encounterId = combat.id;
  assert.notEqual(encounterId, (input.campaign.state.combat as { id: string }).id);
  assert.deepEqual(
    combat.participants.map((p) => p.characterId),
    [a, b]
  );
  const prep = out.combatPreparations![0]!;
  assert.equal(prep.encounterId, encounterId);
  assert.equal(prep.payload.encounterId, encounterId);
  assert.equal(prep.payload.receiptId, prep.id);
  assert.equal(prep.sessionId, out.diceSessions![0]!.id);
  assert.equal(prep.turnId, out.turns[0]!.id);
  assert.deepEqual(
    prep.payload.participants.map((p) => [p.characterId, p.sheet.id]),
    [
      [a, a],
      [b, b],
    ]
  );
  assert.deepEqual(
    prep.payload.createOperations.map((op) => [op.characterId, op.preparationReceiptId]),
    [
      [a, prep.id],
      [b, prep.id],
    ]
  );
  assert.deepEqual(
    out.combatPreparedCharacters!.map((d) => [d.id, d.preparationId]),
    [
      [a, prep.id],
      [b, prep.id],
    ]
  );
  const record = out.diceRecords![0]!;
  assert.equal(record.encounterId, encounterId);
  assert.equal(record.actorId, a);
  const turn = out.turns[0]!;
  assert.equal(turn.rolls![0]!.encounterId, encounterId);
  assert.equal(turn.combatEffects![0]!.characterId, a);
  assert.deepEqual(turn.combatEffects![0]!.rollIds, [record.id]);
  assert.deepEqual(turn.participantReferences![0]!.characterIds, [a]);
  assert.equal(
    (out.snapshots[0]!.afterState.combat as { id: string }).id,
    encounterId,
    'snapshot encounters remap with the campaign'
  );
  assert.equal(out.diceSessions![0]!.imported, true);
  // UUID-looking free text and attributes stay historical.
  assert.equal(
    out.campaign.characters[0]!.attributes.note,
    input.campaign.characters[0]!.attributes.note
  );
  // A second roundtrip remains valid.
  assert.doesNotThrow(() => remapArchive(out));
});

test('archive v7 keeps a removed participant as a historical identity', () => {
  const input = combatArchive();
  const removed = input.campaign.characters[1]!.id;
  input.campaign.characters = input.campaign.characters.slice(0, 1);
  input.campaign.state = {
    combat: { ...(input.campaign.state.combat as object), active: false, participants: [] },
  };
  const out = remapArchive(input);
  const mapped = out.combatPreparedCharacters!.find((d) => d.localKey === 'soldier-1')!.id;
  assert.notEqual(mapped, removed);
  assert.equal(out.snapshots[0]!.afterCharacters[1]!.id, mapped);
});

test('older archive versions reject combat sessions, scoped rolls and turn links', () => {
  const input = combatArchive();
  for (const version of [5, 6])
    assert.throws(() =>
      remapArchive({
        ...input,
        version,
        combatPreparations: undefined,
        combatPreparedCharacters: undefined,
      })
    );
  assert.throws(() => assertCombatArchiveFormat(6, 6), /version 7/);
  assert.doesNotThrow(() => assertCombatArchiveFormat(7, 6));
  assert.doesNotThrow(() => assertCombatArchiveFormat(6, 5));
  const legacySession = combatArchive();
  legacySession.diceSessions[0]!.promptContractVersion = 5;
  legacySession.diceSessions[0]!.digestVersion = 3;
  assert.throws(() => remapArchive(legacySession), /scope does not match|Combat/);
});

test('archive v7 rejects forged preparation ownership and unresolved combat links', () => {
  const corrupt: ((input: ReturnType<typeof combatArchive>) => void)[] = [
    (input) => {
      input.combatPreparations[0]!.payload.receiptId = randomUUID();
    },
    (input) => {
      input.combatPreparations[0]!.campaignId = randomUUID();
    },
    (input) => {
      input.combatPreparations[0]!.payload.createOperations[0]!.characterId = randomUUID();
    },
    (input) => {
      input.combatPreparedCharacters[1]!.localKey = 'soldier-0';
    },
    (input) => {
      input.turns[0]!.combatEffects[0]!.rollIds = [randomUUID()];
    },
    (input) => {
      input.turns[0]!.participantReferences[0]!.afterParagraph = 4;
    },
    (input) => {
      (input.campaign.state.combat as { round: number }).round = -1;
    },
    (input) => {
      // An encounter ID may not double as a character identity.
      (input.campaign.state.combat as { id: string }).id = input.campaign.characters[0]!.id;
    },
  ];
  for (const [index, mutate] of corrupt.entries()) {
    const input = combatArchive();
    mutate(input);
    assert.throws(
      () => remapArchive(input),
      (error: unknown) =>
        error instanceof ZodError || (error instanceof Problem && error.code === 'archive_invalid'),
      `case ${index}`
    );
  }
});

test('templates and instantiation never transplant a structured encounter', async () => {
  const input = combatArchive() as unknown as Archive;
  input.campaign.ruleResolution = {
    status: 'unresolved',
    reference: {
      systemKey: 'absent',
      systemName: 'Missing',
      kind: RuleSystemKind.Library,
      contentHash: 'a'.repeat(64),
    },
  };
  let saved: { setup: Record<string, unknown> } | undefined;
  const client = {
    query: async (sql: string, values?: unknown[]) => {
      if (sql.startsWith('INSERT INTO templates')) saved = values![1] as typeof saved;
      return {
        rows: sql.startsWith('SELECT document FROM templates') ? [{ document: saved }] : [],
      };
    },
  };
  const store = {
    transaction: async (callback: (client: unknown) => Promise<unknown>) => callback(client),
    campaign: async () => structuredClone(input.campaign),
    assertIdle: async () => {},
    insert: async () => {},
    reindex: async () => {},
  } as unknown as Store;
  const service = new LibraryService(store);
  await service.template('Reusable', input.campaign.id, input.campaign.revision);
  assert.equal('state' in saved!.setup, false);
  // Even an externally stored template carrying state cannot transplant it.
  saved!.setup.state = structuredClone(input.campaign.state);
  const instantiated = await service.instantiate(randomUUID());
  assert.deepEqual(instantiated.state, {});
  assert.deepEqual(
    instantiated.characters.map((c) => c.attributes.health),
    input.campaign.characters.map((c) => c.attributes.health)
  );
  assert.ok(
    instantiated.characters.every((c) => !input.campaign.characters.some((o) => o.id === c.id))
  );
});
