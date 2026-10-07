import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceSections } from '../src/domain/sourceSections.js';
import { textSource } from '../src/services/sources.js';
import { newCampaign } from '../src/domain/campaign.js';
import { buildContext } from '../src/domain/context.js';
import { LibraryService, remapArchive } from '../src/services/library.js';
import type { Store } from '../src/store.js';
import { RuleSystemKind } from '../src/domain/rules.js';
import { createKnowledgeRecall, type FrozenKnowledge } from '../src/domain/knowledgeRecall.js';
import { privateIpv4 } from '../src/security.js';
import { randomUUID } from 'node:crypto';
import { CharacterType } from '../src/domain/options.js';
import { Problem } from '../src/errors.js';

const emptyArchive = (campaign: ReturnType<typeof newCampaign>) => ({
  format: 'local-rpg',
  campaign,
  turns: [],
  snapshots: [],
  memories: [],
  diceSessions: [],
  diceRecords: [],
  combatPreparations: [],
  combatPreparedCharacters: [],
});

test('archives import without a format version; older exports are refused with a clear message', () => {
  const campaign = newCampaign({ name: 'Background', description: 'Keep this description.' });
  const current = remapArchive(emptyArchive(campaign));
  assert.equal(current.campaign.description, campaign.description);
  assert.equal(Object.hasOwn(current, 'version'), false);
  for (const version of [1, 4, 6, 7])
    assert.throws(
      () => remapArchive({ ...emptyArchive(campaign), version }),
      (error: unknown) =>
        error instanceof Problem &&
        error.code === 'archive_unsupported' &&
        error.message === 'This file was exported by an older app and can no longer be imported.'
    );
  assert.throws(() =>
    remapArchive({ ...emptyArchive(campaign), campaign: { ...campaign, pinnedFacts: ['Retired'] } })
  );
  assert.throws(() => remapArchive({ ...emptyArchive(campaign), format: 'other' }));
});

function npcArchive() {
  const input = knowledgeArchive();
  const npcId = input.campaign.knowledge![0]!.characterIds[0]!;
  return {
    ...input,
    diceSessions: input.diceSessions.map((session) => ({
      ...session,
      frozenSources: { campaignId: input.campaign.id, sources: [] },
      frozenKnowledge: {
        ...session.frozenKnowledge,
        npcCharacters: [
          {
            id: npcId,
            name: 'Deleted guard',
            type: CharacterType.Npc,
            revision: 2,
            attributes: { literal: npcId },
            inventory: { coins: 7 },
            description: { role: 'guard' },
          },
        ],
      },
    })),
  };
}

test('NPC archive snapshots remap historical identities but preserve incidental sheet strings', () => {
  const input = npcArchive();
  const out = remapArchive(input);
  const captured: FrozenKnowledge = out.diceSessions![0]!.frozenKnowledge!;
  const npc = captured.npcCharacters![0]!;
  assert.notEqual(npc.id, input.diceSessions[0]!.frozenKnowledge.npcCharacters[0]!.id);
  assert.equal(npc.id, out.campaign.knowledge![0]!.characterIds[0]);
  assert.equal(npc.id, out.diceSessions![0]!.characterIds[0]);
  assert.equal(npc.attributes.literal, input.diceSessions[0]!.frozenKnowledge.npcCharacters[0]!.id);
  assert.equal(npc.inventory.coins, 7);
  assert.equal(npc.revision, 2);
  const reimported = remapArchive(out);
  const restored: FrozenKnowledge = reimported.diceSessions![0]!.frozenKnowledge!;
  assert.equal(restored.npcCharacters![0]!.inventory.coins, 7);
});

test('NPC archives reject duplicate, private, player and foreign snapshot identities', () => {
  for (const corrupt of [
    (input: ReturnType<typeof npcArchive>) =>
      input.diceSessions[0]!.frozenKnowledge.npcCharacters.push(
        structuredClone(input.diceSessions[0]!.frozenKnowledge.npcCharacters[0]!)
      ),
    (input: ReturnType<typeof npcArchive>) =>
      Object.assign(input.diceSessions[0]!.frozenKnowledge.npcCharacters[0]!, { notes: 'private' }),
    (input: ReturnType<typeof npcArchive>) =>
      Object.assign(input.diceSessions[0]!.frozenKnowledge.npcCharacters[0]!, { type: 'player' }),
    (input: ReturnType<typeof npcArchive>) => {
      input.diceSessions[0]!.frozenKnowledge.campaignId = randomUUID();
    },
  ]) {
    const input = npcArchive();
    corrupt(input);
    assert.throws(() => remapArchive(input));
  }
});

import {
  KnowledgeKind,
  KnowledgeOrigin,
  KnowledgeCertainty,
  KnowledgeStatus,
  type CampaignKnowledge,
} from '../src/domain/knowledge.js';

function knowledgeArchive() {
  const campaign = newCampaign({ name: 'Historical archive' });
  const turnId = randomUUID();
  const sessionId = randomUUID();
  const characterId = randomUUID();
  const sourceId = randomUUID();
  const evidence = [
    {
      type: 'campaign_source' as const,
      sourceId,
      version: 2,
      sourceName: 'Deleted source',
      quote: '😀 debt',
      start: 12,
      end: 19,
    },
  ];
  const record: CampaignKnowledge = {
    id: randomUUID(),
    kind: KnowledgeKind.Debt,
    title: 'Guard debt',
    text: 'The guard owes a debt.',
    origin: KnowledgeOrigin.Source,
    certainty: KnowledgeCertainty.Rumor,
    status: KnowledgeStatus.Active,
    characterIds: [characterId],
    characterNames: { [characterId]: 'Deleted guard' },
    holderId: characterId,
    holderName: 'Deleted guard',
    createdTurnId: turnId,
    updatedTurnId: turnId,
    createdAt: campaign.createdAt,
    updatedAt: campaign.createdAt,
    revision: 1,
    evidence,
    attributions: [
      {
        origin: KnowledgeOrigin.Source,
        evidence: structuredClone(evidence),
        turnId,
        at: campaign.createdAt,
      },
    ],
  };
  campaign.knowledge = [record];
  return {
    format: 'local-rpg',
    campaign,
    turns: [
      {
        id: turnId,
        campaignId: campaign.id,
        requestId: randomUUID(),
        status: 'completed',
        action: 'Listen',
        narrative: 'A guard claims a debt.',
        changes: ['Debt remembered'],
        error: null,
        undone: false,
        settings: campaign.settings,
        context: null,
        createdAt: campaign.createdAt,
        completedAt: campaign.createdAt,
        diceSessionId: sessionId,
      },
    ],
    snapshots: [
      {
        turnId,
        beforeCharacters: [],
        afterCharacters: [],
        beforeState: {},
        afterState: {},
        beforeMemory: null,
        beforeKnowledge: [],
        afterKnowledge: [structuredClone(record)],
      },
    ],
    memories: [],
    diceRecords: [],
    combatPreparations: [],
    combatPreparedCharacters: [],
    diceSessions: [
      {
        id: sessionId,
        campaignId: campaign.id,
        rootTurnId: turnId,
        contextDigest: 'a'.repeat(64),
        frozenPrompt: campaign.id.repeat(2000),
        frozenRevision: 0,
        characterIds: [characterId],
        newFaces: 0,
        imported: false,
        createdAt: campaign.createdAt,
        systemPrompt: '  Exact instructions\n',
        frozenKnowledge: {
          campaignId: campaign.id,
          records: [structuredClone(record)],
          characters: [],
          sourceIds: [sourceId],
          sourceVersions: [{ id: sourceId, version: 2 }],
        },
        toolDefinitions: [
          {
            name: 'campaign_knowledge_get',
            description: 'Read knowledge',
            inputSchema: { type: 'object' },
          },
        ],
      },
    ],
  };
}

test('archives remap retained source/character links across records, undo and frozen metadata', () => {
  const input = knowledgeArchive();
  const out = remapArchive(input);
  const original = input.campaign.knowledge![0]!;
  const record = out.campaign.knowledge![0]!;
  assert.notEqual(record.id, original.id);
  assert.notEqual(record.characterIds[0], original.characterIds[0]);
  assert.equal(record.characterNames[record.characterIds[0]!], 'Deleted guard');
  assert.equal(record.holderId, record.characterIds[0]);
  assert.equal(record.holderName, 'Deleted guard');
  assert.equal(record.createdTurnId, out.turns[0]!.id);
  assert.equal(record.attributions[0]!.turnId, record.createdTurnId);
  assert.deepEqual(out.snapshots[0]!.afterKnowledge, [record]);
  assert.deepEqual(out.diceSessions![0]!.frozenKnowledge!.records, [record]);
  assert.deepEqual(out.diceSessions![0]!.frozenKnowledge!.sourceIds, [
    record.evidence[0]!.type === 'campaign_source' ? record.evidence[0]!.sourceId : '',
  ]);
  assert.equal(out.diceSessions![0]!.systemPrompt, input.diceSessions[0]!.systemPrompt);
  assert.equal(out.diceSessions![0]!.frozenPrompt, input.diceSessions[0]!.frozenPrompt);
  assert.equal(out.diceSessions![0]!.imported, true);
  assert.equal(record.certainty, KnowledgeCertainty.Rumor);
  assert.equal(out.campaign.characters.length, 0);
  assert.equal(out.campaign.sources.length, 0);
});

test('archives reject dangling attribution, malformed evidence and partial frozen metadata', () => {
  const input = knowledgeArchive();
  input.campaign.knowledge![0]!.updatedTurnId = randomUUID();
  assert.throws(() => remapArchive(input), /attribution turn/);
  const badQuote = knowledgeArchive();
  const evidence = badQuote.campaign.knowledge![0]!.evidence[0]!;
  if (evidence.type === 'campaign_source') evidence.end++;
  badQuote.campaign.knowledge![0]!.attributions[0]!.evidence = structuredClone(
    badQuote.campaign.knowledge![0]!.evidence
  );
  assert.throws(() => remapArchive(badQuote), /quote coordinates/);
  const partial = knowledgeArchive();
  delete (partial.diceSessions[0] as { systemPrompt?: string }).systemPrompt;
  assert.throws(() => remapArchive(partial), /metadata is incomplete/);
  const collision = knowledgeArchive();
  collision.campaign.knowledge![0]!.characterIds = [collision.campaign.id];
  collision.campaign.knowledge![0]!.characterNames = { [collision.campaign.id]: 'Invalid' };
  assert.throws(() => remapArchive(collision), /collides/);
});

test('replaced source versions stay historical after frozen lookup and archive remapping', () => {
  const input = knowledgeArchive();
  const captured = input.diceSessions[0]!.frozenKnowledge;
  const replacement = textSource('Replacement', 'A new version contains different information.');
  delete replacement.purpose;
  replacement.id = captured.sourceIds[0]!;
  replacement.version = 3;
  input.campaign.sources = [replacement];
  captured.sourceVersions[0]!.version = 3;
  const prior = createKnowledgeRecall(captured).get({ id: captured.records[0]!.id });
  assert.equal(
    prior.evidence[0]!.type === 'campaign_source' && prior.evidence[0]!.available,
    false
  );
  const output = remapArchive(input);
  const frozen = output.diceSessions![0]!.frozenKnowledge!;
  assert.equal(frozen.sourceVersions![0]!.id, output.campaign.sources[0]!.id);
  assert.equal(frozen.sourceVersions![0]!.version, 3);
  const remembered = createKnowledgeRecall(frozen).get({ id: frozen.records[0]!.id });
  assert.equal(
    remembered.evidence[0]!.type === 'campaign_source' && remembered.evidence[0]!.available,
    false
  );
  assert.equal(
    remembered.evidence[0]!.type === 'campaign_source' && remembered.evidence[0]!.quote,
    '😀 debt'
  );
  const bad = knowledgeArchive();
  bad.diceSessions[0]!.frozenKnowledge.sourceVersions[0]!.id = randomUUID();
  assert.throws(() => remapArchive(bad), /match captured source identities/);
});

test('campaign templates exclude knowledge history and never instantiate transferred facts', async () => {
  const input = knowledgeArchive();
  input.campaign.ruleResolution = {
    status: 'unresolved',
    reference: {
      systemKey: 'absent',
      systemName: 'Missing',
      kind: RuleSystemKind.Library,
      contentHash: 'a'.repeat(64),
    },
  };
  let saved: { setup: Record<string, unknown>; name: string } | undefined;
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
  assert.ok(saved);
  for (const key of ['knowledge', 'state', 'memory', 'turns', 'snapshots', 'diceSessions'])
    assert.equal(key in saved!.setup, false);
  saved!.setup.knowledge = input.campaign.knowledge;
  const instantiated = await service.instantiate(randomUUID());
  assert.deepEqual(instantiated.knowledge ?? [], []);
});

test('source sections preserve Unicode, original offsets and page boundaries while pins include only selected current sections', () => {
  const source = textSource(
    'Rules',
    '## Page 1\n' + '😀'.repeat(2500) + '\n## Page 2\nStealth: move silently.'
  );
  source.status = 'confirmed';
  const sections = sourceSections(source);
  assert.equal(sections.map((s) => s.text).join(''), source.text);
  assert.ok(sections.every((s) => s.text.length <= 4000 && !/^[\uDC00-\uDFFF]/.test(s.text)));
  assert.equal(sections[0]!.page, 1);
  assert.equal(sections.at(-1)!.page, 2);
  const c = newCampaign({ name: 'Test' });
  c.sources = [source];
  c.pinnedSourceSections = [{ sourceId: source.id, version: 1, index: sections.length - 1 }];
  const context = buildContext(c, [], 'Sneak', []);
  const pinned = JSON.stringify(JSON.parse(context.prompt).mandatory.pinnedRules);
  assert.match(pinned, /move silently/);
  assert.doesNotMatch(pinned, /😀/);
  const large = buildContext({ ...c, instructions: 'x'.repeat(16000) }, [], 'Sneak', []);
  assert.ok(large.systemPrompt!.includes('x'.repeat(16000)));
});
test('archive remaps only schema references and preserves UUID-looking narrative/private text', () => {
  const c = newCampaign({ name: 'Archive' });
  c.notes = c.id;
  c.description = c.id;
  c.state = { literal: c.id };
  const source = textSource(c.id, c.id);
  delete source.purpose;
  c.sources = [source];
  const out = remapArchive(emptyArchive(c));
  assert.notEqual(out.campaign.id, c.id);
  assert.notEqual(out.campaign.sources[0]!.id, source.id);
  assert.equal(out.campaign.notes, c.id);
  assert.equal(out.campaign.description, c.id);
  assert.deepEqual(out.campaign.state, c.state);
  assert.equal(out.campaign.sources[0]!.text, c.id);
  assert.equal(out.campaign.sources[0]!.originalAvailable, false);
});
test('private IPv4 interface validation rejects invalid octets/public/all-interface addresses', () => {
  for (const valid of ['10.0.0.1', '192.168.1.250', '172.16.0.1', '172.31.255.255'])
    assert.ok(privateIpv4(valid));
  for (const invalid of ['192.168.999.1', '172.32.0.1', '0.0.0.0', '8.8.8.8', '127.0.0.1', '::1'])
    assert.equal(privateIpv4(invalid), false);
});

test('archive rejects unresolved undo field references and snapshot entity collisions', () => {
  const c = newCampaign({ name: 'Invalid undo reference' });
  const turnId = randomUUID();
  const char = {
    id: String(randomUUID()),
    name: 'Guard',
    type: 'npc',
    attributes: {},
    inventory: {},
    description: {},
    notes: '',
    revision: 0,
  };
  const archive = {
    ...emptyArchive(c),
    turns: [
      {
        id: turnId,
        campaignId: c.id,
        requestId: randomUUID(),
        status: 'completed',
        action: 'Wait',
        narrative: 'A guard arrives.',
        changes: [],
        error: null,
        undone: false,
        settings: c.settings,
        context: null,
        createdAt: c.createdAt,
        completedAt: c.createdAt,
      },
    ],
    snapshots: [
      {
        turnId,
        beforeCharacters: [],
        afterCharacters: [char],
        beforeState: {},
        afterState: {},
        beforeMemory: null,
        changedFields: [{ characterId: randomUUID(), fields: ['name'] }],
      },
    ],
  };
  assert.throws(() => remapArchive(archive), /Unresolved changed-field/);
  archive.snapshots[0]!.changedFields = [];
  archive.snapshots[0]!.afterCharacters[0]!.id = c.id;
  assert.throws(() => remapArchive(archive), /collides with another entity/);
});

test('archive retains secret metadata, source purpose and remaps frozen source receipts', () => {
  const input = knowledgeArchive();
  const source = textSource('Preparation', 'A public corridor. A secret room.');
  input.campaign.sources = [{ ...source, purpose: 'campaign' } as typeof source];
  const data = input as unknown as import('../src/domain/types.js').Archive;
  const r = data.campaign.knowledge![0]!;
  r.visibility = 'gm_only' as import('../src/domain/knowledge.js').KnowledgeVisibility;
  r.introductionVisibility = r.visibility;
  r.attributions[0]!.visibility = r.visibility;
  data.snapshots[0]!.afterKnowledge = [structuredClone(r)];
  const session = data.diceSessions[0]!;
  session.frozenKnowledge!.records = [structuredClone(r)];
  session.frozenSources = {
    campaignId: data.campaign.id,
    sources: [
      {
        id: source.id,
        version: source.version,
        name: source.name,
        text: source.text,
        purpose: 'campaign' as import('../src/domain/options.js').SourcePurpose,
      },
    ],
  };
  const receiptId = randomUUID();
  data.turns[0]!.sourceReads = [
    {
      id: receiptId,
      campaignId: data.campaign.id,
      turnId: data.turns[0]!.id,
      sessionId: session.id,
      tool: 'campaign_sources_get',
      transportRequestId: 'get-1',
      argumentDigest: 'a'.repeat(64),
      payload: {
        receiptId,
        sourceSpan: {
          id: source.id,
          version: source.version,
          name: source.name,
          text: source.text,
          start: 0,
          end: source.text.length,
        },
      },
      createdAt: data.campaign.createdAt,
    },
  ];
  const searchReceipt = randomUUID();
  const searchEntry = () => ({ sourceId: source.id, version: source.version, sectionIndex: 0 });
  data.turns[0]!.sourceReads.push({
    id: searchReceipt,
    campaignId: data.campaign.id,
    turnId: data.turns[0]!.id,
    sessionId: session.id,
    tool: 'campaign_sources_search',
    transportRequestId: 'search-batch',
    argumentDigest: 'b'.repeat(64),
    payload: {
      results: [
        { query: 'a', entries: [searchEntry()], nextCursor: null, reason: null },
        { query: 'b', entries: [searchEntry()], nextCursor: null, reason: null },
      ],
    },
    createdAt: data.campaign.createdAt,
  });
  const out = remapArchive(data);
  assert.equal(out.campaign.knowledge![0]!.visibility, 'gm_only');
  assert.equal(out.campaign.sources[0]!.purpose, 'campaign');
  assert.equal(out.diceSessions![0]!.frozenSources!.sources[0]!.id, out.campaign.sources[0]!.id);
  assert.equal(
    (out.turns[0]!.sourceReads![0]!.payload.sourceSpan as { id: string }).id,
    out.campaign.sources[0]!.id
  );
  assert.equal(out.turns[0]!.sourceReads![0]!.payload.receiptId, out.turns[0]!.sourceReads![0]!.id);
  assert.notEqual(out.turns[0]!.sourceReads![0]!.id, receiptId);
  const batchedGroups = out.turns[0]!.sourceReads![1]!.payload.results as {
    entries: { sourceId: string }[];
  }[];
  for (const group of batchedGroups)
    assert.equal(group.entries[0]!.sourceId, out.campaign.sources[0]!.id);
  assert.notEqual(batchedGroups[0]!.entries[0]!.sourceId, source.id);
});

test('rolls recorded before combat tracking stay valid without a scope and survive a round-trip', () => {
  const input = knowledgeArchive();
  const session = input.diceSessions[0]!;
  session.newFaces = 1;
  const roll = {
    id: randomUUID(),
    sessionId: session.id,
    campaignId: input.campaign.id,
    createdAt: input.campaign.createdAt,
    slot: 0,
    groups: [{ label: 'check', sides: 6, faces: [4] }],
    reason: 'Listen',
    declaration: 'No modifiers',
  };
  const archive = {
    ...input,
    diceRecords: [roll],
    turns: [
      {
        ...input.turns[0]!,
        rolls: [structuredClone(roll)],
        rollInterpretations: [{ rollId: roll.id, explanation: 'Heard' }],
      },
    ],
  };
  const out = remapArchive(archive);
  assert.equal(out.diceRecords[0]!.scope, undefined);
  assert.notEqual(out.diceRecords[0]!.id, roll.id);
  assert.equal(out.turns[0]!.rolls![0]!.id, out.diceRecords[0]!.id);
  const again = remapArchive(out);
  assert.equal(again.diceRecords[0]!.scope, undefined);
  assert.equal(again.turns[0]!.rollInterpretations![0]!.rollId, again.diceRecords[0]!.id);
});

test('archives preserve memory above the soft campaign target', () => {
  const archive = knowledgeArchive();
  const memory = {
    id: randomUUID(),
    text: 'Established history. '.repeat(1500),
    coveredTurnIds: [archive.turns[0]!.id],
    valid: true,
    createdAt: archive.campaign.createdAt,
  };
  const withMemory = { ...archive, memories: [memory], campaign: { ...archive.campaign, memory } };
  const imported = remapArchive(withMemory);
  assert.equal(imported.campaign.memory?.text, memory.text);
  assert.equal(imported.memories[0]?.text, memory.text);
});

test('legacy archive memory budget is discarded while campaign memory is retained', () => {
  const archive = knowledgeArchive();
  const imported = remapArchive({
    ...archive,
    campaign: { ...archive.campaign, budgets: { ...archive.campaign.budgets, memory: 2000 } },
  });
  assert.deepEqual(Object.keys(imported.campaign.budgets), ['compaction']);
});
