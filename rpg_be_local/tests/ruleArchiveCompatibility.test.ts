import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { newCampaign } from '../src/domain/campaign.js';
import { remapArchive } from '../src/services/library.js';
import {
  RULE_ARCHIVE_FORMAT_VERSION,
  DICE_ARCHIVE_FORMAT_VERSION,
  LEGACY_ARCHIVE_FORMAT_VERSION,
  ARCHIVE_FORMAT_VERSION,
  KNOWLEDGE_ARCHIVE_FORMAT_VERSION,
} from '../src/domain/versions.js';

test('named legacy, dice and rules archive versions retain instructions-only compatibility', () => {
  for (const version of [
    LEGACY_ARCHIVE_FORMAT_VERSION,
    DICE_ARCHIVE_FORMAT_VERSION,
    RULE_ARCHIVE_FORMAT_VERSION,
  ]) {
    const original = newCampaign({ name: 'Original archive fixture' });
    delete original.knowledge;
    const output = remapArchive({
      format: 'local-rpg',
      version,
      campaign: { ...original, ruleSystemId: null },
      turns: [],
      snapshots: [],
      memories: [],
    });
    assert.notEqual(output.campaign.id, original.id);
    assert.equal(output.campaign.ruleSystemId, null);
    assert.deepEqual(output.campaign.knowledge ?? [], []);
    assert.equal(
      output.campaign.knowledge !== undefined,
      ARCHIVE_FORMAT_VERSION >= KNOWLEDGE_ARCHIVE_FORMAT_VERSION
    );
  }
});
test('v3 rejects a local book ID without its portable reference and preserves unresolved references', () => {
  const campaign = {
    ...newCampaign({ name: 'Book reference fixture' }),
    ruleSystemId: randomUUID(),
  };
  delete campaign.knowledge;
  assert.throws(
    () =>
      remapArchive({
        format: 'local-rpg',
        version: RULE_ARCHIVE_FORMAT_VERSION,
        campaign,
        turns: [],
        snapshots: [],
        memories: [],
      }),
    /portable rule reference/
  );
  const reference = {
    systemKey: 'missing-book',
    systemName: 'Original fixture',
    kind: 'library',
    contentHash: 'a'.repeat(64),
  };
  const result = remapArchive({
    format: 'local-rpg',
    version: RULE_ARCHIVE_FORMAT_VERSION,
    campaign: { ...campaign, ruleReference: reference },
    turns: [],
    snapshots: [],
    memories: [],
  });
  assert.equal(result.campaign.ruleSystemId, null);
  assert.deepEqual(result.campaign.ruleResolution, { status: 'unresolved', reference });
});

test('v4 archives preserve legacy retry metadata absence and exact legacy prompts', () => {
  const campaign = newCampaign({ name: 'Legacy retry in a new archive' });
  campaign.knowledge = [];
  const turnId = randomUUID();
  const sessionId = randomUUID();
  const userPrompt = `legacy audit ${campaign.id}`;
  const output = remapArchive({
    format: 'local-rpg',
    version: KNOWLEDGE_ARCHIVE_FORMAT_VERSION,
    campaign,
    turns: [
      {
        id: turnId,
        campaignId: campaign.id,
        requestId: randomUUID(),
        status: 'failed',
        action: 'Wait',
        narrative: null,
        changes: [],
        error: 'Legacy failed attempt',
        undone: false,
        settings: campaign.settings,
        context: null,
        createdAt: campaign.createdAt,
        completedAt: campaign.createdAt,
        diceSessionId: sessionId,
      },
    ],
    snapshots: [],
    memories: [],
    diceRecords: [],
    diceSessions: [
      {
        id: sessionId,
        campaignId: campaign.id,
        rootTurnId: turnId,
        contextDigest: 'b'.repeat(64),
        frozenPrompt: userPrompt,
        frozenRevision: 0,
        characterIds: [],
        newFaces: 0,
        imported: false,
        createdAt: campaign.createdAt,
      },
    ],
  });
  const session = output.diceSessions![0]!;
  assert.equal(session.imported, true);
  assert.equal(session.frozenPrompt, userPrompt);
  assert.equal(session.contextDigest, 'b'.repeat(64));
  for (const key of [
    'systemPrompt',
    'promptContractVersion',
    'digestVersion',
    'frozenKnowledge',
    'toolDefinitions',
  ])
    assert.equal(key in session, false);
  assert.deepEqual(output.campaign.knowledge, []);
});
