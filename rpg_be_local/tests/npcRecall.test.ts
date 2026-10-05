import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  createNpcRecall,
  freezeNpcCharacters,
  npcSnapshotSchema,
} from '../src/domain/npcRecall.js';
import { newCampaign } from '../src/domain/campaign.js';
import { CharacterType } from '../src/domain/options.js';
import { Problem } from '../src/errors.js';
import {
  KnowledgeKind,
  KnowledgeOrigin,
  KnowledgeCertainty,
  KnowledgeStatus,
  KnowledgeVisibility,
} from '../src/domain/knowledge.js';

test('NPC knowledge links retain uncertainty, lifecycle and GM-only visibility separately from saved stats', () => {
  const c = fixture();
  const id = c.characters[1]!.id;
  const record = {
    id: randomUUID(),
    title: 'An old allegation',
    text: 'Someone alleged a debt.',
    kind: KnowledgeKind.Debt,
    origin: KnowledgeOrigin.Gm,
    certainty: KnowledgeCertainty.Rumor,
    status: KnowledgeStatus.Retracted,
    visibility: KnowledgeVisibility.GmOnly,
    characterIds: [id],
    characterNames: { [id]: 'Marcus' },
    evidence: [],
    createdTurnId: null,
    updatedTurnId: null,
    createdAt: c.createdAt,
    updatedAt: c.createdAt,
    revision: 1,
    attributions: [],
  };
  const lookup = createNpcRecall(c.id, freezeNpcCharacters(c), [record]);
  const result = lookup.get({ id });
  assert.deepEqual(result.knowledgeLinks, [
    {
      id: record.id,
      title: 'An old allegation',
      kind: 'debt',
      origin: 'gm',
      certainty: 'rumor',
      status: 'retracted',
      visibility: 'gm_only',
    },
  ]);
  assert.deepEqual(result.npc.attributes, { strength: 3 });
  assert.equal(lookup.get({ id: c.characters[2]!.id }).knowledgeLinks.length, 0);
});

function fixture() {
  const campaign = newCampaign({ name: 'NPC lookup' });
  campaign.characters = [
    {
      id: randomUUID(),
      name: 'Sigurd',
      type: CharacterType.Player,
      attributes: {},
      inventory: {},
      description: {},
      notes: 'PRIVATE_PLAYER',
      revision: 1,
    },
    {
      id: randomUUID(),
      name: 'Marcus',
      type: CharacterType.Npc,
      attributes: { strength: 3 },
      inventory: { coins: 7 },
      description: { background: ['Roman', { occupation: 'silver merchant' }] },
      notes: 'PRIVATE_NPC',
      revision: 2,
    },
    {
      id: randomUUID(),
      name: 'Marcus',
      type: CharacterType.Npc,
      attributes: {},
      inventory: {},
      description: { occupation: 'guard' },
      notes: '',
      revision: 1,
    },
  ];
  return campaign;
}

test('NPC lookup retrieves off-prompt saved sheets without player sheets or private notes', () => {
  const c = fixture();
  const snapshot = freezeNpcCharacters(c);
  const recall = createNpcRecall(c.id, snapshot, []);
  assert.equal(recall.search({ query: 'marcus' }).npcs.length, 2);
  assert.deepEqual(
    recall.search({ query: 'ROMAN silver' }).npcs.map((n) => n.id),
    [c.characters[1]!.id]
  );
  assert.equal(recall.search({ query: 'missing' }).npcs.length, 0);
  assert.equal(recall.search({ query: 'occupation' }).npcs.length, 0);
  const result = recall.get({ id: c.characters[1]!.id });
  assert.deepEqual(result.npc.attributes, { strength: 3 });
  assert.deepEqual(result.npc.inventory, { coins: 7 });
  assert.equal(result.npc.revision, 2);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|notes/);
  c.characters[1]!.attributes.strength = 9;
  snapshot[0]!.attributes.strength = 8;
  result.npc.attributes.strength = 6;
  assert.equal(recall.get({ id: c.characters[1]!.id }).npc.attributes.strength, 3);
  for (const id of [c.characters[0]!.id, randomUUID()])
    assert.throws(
      () => recall.get({ id }),
      (e) => e instanceof Problem && e.code === 'npc_not_found'
    );
  assert.equal(npcSnapshotSchema.safeParse({ ...snapshot[0]!, notes: 'secret' }).success, false);
});

test('NPC search pages deterministic identities and rejects cursors from another query or snapshot', () => {
  const c = fixture();
  c.characters = Array.from({ length: 23 }, (_, i) => ({
    ...c.characters[1]!,
    id: randomUUID(),
    name: `Merchant ${i}`,
  }));
  const snapshot = freezeNpcCharacters(c);
  const recall = createNpcRecall(c.id, snapshot, []);
  const first = recall.search({ query: '' });
  assert.equal(first.npcs.length, 20);
  assert.ok(first.nextCursor);
  const second = recall.search({ query: '  !!! ', cursor: first.nextCursor });
  assert.equal(second.npcs.length, 3);
  assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.npcs, ...second.npcs].map((n) => n.id)).size, 23);
  const changed = createNpcRecall(randomUUID(), snapshot, []);
  for (const run of [
    () => recall.search({ query: 'merchant', cursor: first.nextCursor }),
    () => changed.search({ query: '', cursor: first.nextCursor }),
    () => recall.search({ query: '', cursor: 'garbage' }),
  ])
    assert.throws(run, (e) => e instanceof Problem && e.code === 'npc_cursor');
  assert.throws(() => recall.search({ query: 'x'.repeat(257) }));
  assert.throws(() => recall.search({ query: '', campaignId: c.id }));
});
