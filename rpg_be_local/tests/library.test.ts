import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceSections } from '../src/domain/sourceSections.js';
import { textSource } from '../src/services/sources.js';
import { newCampaign } from '../src/domain/campaign.js';
import { buildContext } from '../src/domain/context.js';
import { LibraryService, remapArchive } from '../src/services/library.js';
import type { Store } from '../src/store.js';
import { RuleSystemKind } from '../src/domain/rules.js';
import { createKnowledgeRecall } from '../src/domain/knowledgeRecall.js';
import { privateIpv4 } from '../src/security.js';
import { randomUUID } from 'node:crypto';
import { KNOWLEDGE_ARCHIVE_FORMAT_VERSION } from '../src/domain/versions.js';
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
