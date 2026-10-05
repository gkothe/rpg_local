import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceSections } from '../src/domain/sourceSections.js';
import { textSource } from '../src/services/sources.js';
import { newCampaign } from '../src/domain/campaign.js';
import { buildContext } from '../src/domain/context.js';
import { LibraryService, remapArchive, assertNpcArchiveFormat } from '../src/services/library.js';
import type { Store } from '../src/store.js';
import { RuleSystemKind } from '../src/domain/rules.js';
import { createKnowledgeRecall, type FrozenKnowledge } from '../src/domain/knowledgeRecall.js';
import { privateIpv4 } from '../src/security.js';
import { randomUUID } from 'node:crypto';
import { KNOWLEDGE_ARCHIVE_FORMAT_VERSION } from '../src/domain/versions.js';
import { CharacterType } from '../src/domain/options.js';

test('new archives omit pinned facts and older archives discard the retired field', () => {
  const campaign = newCampaign({ name: 'Background', description: 'Keep this description.' });
  const archive = {
    format: 'local-rpg',
    version: 6,
    campaign,
    turns: [],
    snapshots: [],
    memories: [],
    diceSessions: [],
    diceRecords: [],
  };
  const current = remapArchive(archive);
  assert.equal(current.campaign.description, campaign.description);
  assert.equal(Object.hasOwn(current.campaign, 'pinnedFacts'), false);
  const old = remapArchive({
    ...archive,
    campaign: { ...campaign, pinnedFacts: ['Retired fact'] },
  });
  assert.equal(old.campaign.description, campaign.description);
  assert.equal(Object.hasOwn(old.campaign, 'pinnedFacts'), false);
});

function npcArchive() {
  const input = knowledgeArchive();
  const npcId = input.campaign.knowledge![0]!.characterIds[0]!;
  return {
    ...input,
    version: 6,
    diceSessions: input.diceSessions.map((session) => ({
      ...session,
      promptContractVersion: 5,
      digestVersion: 3,
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
  assert.equal(out.version, 6);
  const captured: FrozenKnowledge = out.diceSessions![0]!.frozenKnowledge!;
  const npc = captured.npcCharacters![0]!;
  assert.notEqual(npc.id, input.diceSessions[0]!.frozenKnowledge.npcCharacters[0]!.id);
  assert.equal(npc.id, out.campaign.knowledge![0]!.characterIds[0]);
  assert.equal(npc.id, out.diceSessions![0]!.characterIds[0]);
  assert.equal(npc.attributes.literal, input.diceSessions[0]!.frozenKnowledge.npcCharacters[0]!.id);
  assert.equal(npc.inventory.coins, 7);
  assert.equal(npc.revision, 2);
  assert.throws(() => assertNpcArchiveFormat(5, captured), /version 6/);
  assert.doesNotThrow(() => assertNpcArchiveFormat(6, captured));
  assert.doesNotThrow(() => assertNpcArchiveFormat(5, { ...captured, npcCharacters: undefined }));
  assert.throws(() => remapArchive({ ...input, version: 5 }), /version 6/);
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

test('NPC snapshots cannot be attached to a historical v4 turn context', () => {
  const input = npcArchive();
  const context = buildContext(input.campaign, [], 'Continue', [], 16000, true, undefined, 4);
  Object.assign(input.turns[0]!, {
    context: { ...context, frozenKnowledge: input.diceSessions[0]!.frozenKnowledge },
  });
  assert.throws(() => remapArchive(input), /NPC sheets require version 5 gameplay/);
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
    version: KNOWLEDGE_ARCHIVE_FORMAT_VERSION,
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
        promptContractVersion: 4,
        digestVersion: 2,
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

test('v4 archives remap retained source/character links across records, undo and frozen metadata', () => {
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

test('v4 archives reject dangling attribution, malformed evidence and partial frozen metadata', () => {
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
  assert.throws(() => remapArchive(partial), /complete version 4/);
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

test('legacy archives reject knowledge and new frozen metadata without inventing historical origins', () => {
  for (const version of [1, 2, 3]) {
    const input = knowledgeArchive();
    input.version = version;
    assert.throws(() => remapArchive(input));
    delete input.campaign.knowledge;
    input.snapshots = [];
    input.turns[0]!.status = 'failed';
    assert.throws(() => remapArchive(input), /version 4/);
  }
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
  const context = buildContext(c, [], 'Sneak', [], 16000);
  assert.match(context.prompt, /move silently/);
  assert.doesNotMatch(context.prompt, /😀/);
  const large = buildContext({ ...c, instructions: 'x'.repeat(16000) }, [], 'Sneak', [], 16000);
  assert.equal(JSON.parse(large.prompt).mandatory.campaignInstructions, 'x'.repeat(16000));
});
test('archive remaps only schema references and preserves UUID-looking narrative/private text', () => {
  const c = newCampaign({ name: 'Archive' });
  delete c.knowledge;
  c.notes = c.id;
  c.description = c.id;
  c.state = { literal: c.id };
  const source = textSource(c.id, c.id);
  delete source.purpose;
  c.sources = [source];
  const out = remapArchive({
    format: 'local-rpg',
    version: 1,
    campaign: c,
    turns: [],
    snapshots: [],
    memories: [],
  });
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
  delete c.knowledge;
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
    format: 'local-rpg',
    version: 1,
    campaign: c,
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
    memories: [],
  };
  assert.throws(() => remapArchive(archive), /Unresolved changed-field/);
  archive.snapshots[0]!.changedFields = [];
  archive.snapshots[0]!.afterCharacters[0]!.id = c.id;
  assert.throws(() => remapArchive(archive), /collides with another entity/);
});

test('v5 archive retains secret metadata, source purpose and remaps frozen source receipts', () => {
  const input = knowledgeArchive();
  const source = textSource('Preparation', 'A public corridor. A secret room.');
  input.campaign.sources = [{ ...source, purpose: 'campaign' } as typeof source];
  const data = { ...input, version: 5 } as unknown as import('../src/domain/types.js').Archive;
  const r = data.campaign.knowledge![0]!;
  r.visibility = 'gm_only' as import('../src/domain/knowledge.js').KnowledgeVisibility;
  r.introductionVisibility = r.visibility;
  r.attributions[0]!.visibility = r.visibility;
  data.snapshots[0]!.afterKnowledge = [structuredClone(r)];
  const session = data.diceSessions![0]!;
  session.promptContractVersion = 5;
  session.digestVersion = 3;
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
  assert.throws(() => remapArchive({ ...data, version: 4 }));
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
