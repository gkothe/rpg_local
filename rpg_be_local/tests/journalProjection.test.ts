import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { excerptText, listEntries } from '../src/domain/journalProjection.js';
import {
  KnowledgeCertainty as C,
  KnowledgeKind as K,
  KnowledgeOrigin as O,
  KnowledgeStatus as S,
  KnowledgeVisibility as V,
  type CampaignKnowledge,
} from '../src/domain/knowledge.js';
import { CharacterType } from '../src/domain/options.js';
import type { Character } from '../src/domain/types.js';

const at = '2026-01-01T00:00:00.000Z';
const record = (over: Partial<CampaignKnowledge>): CampaignKnowledge => ({
  id: randomUUID(),
  kind: K.Npc,
  title: 'Mira',
  text: 'Mira was introduced.',
  certainty: C.Established,
  status: S.Active,
  characterIds: [],
  characterNames: {},
  origin: O.Gm,
  evidence: [],
  createdTurnId: null,
  updatedTurnId: null,
  createdAt: at,
  updatedAt: at,
  revision: 1,
  attributions: [],
  visibility: V.Player,
  ...over,
});
const query = { query: '', includePast: false, limit: 20 };

test('a generic NPC introduction gains only the linked character public description', () => {
  const id = randomUUID();
  const mira = {
    id,
    name: 'Mira',
    type: CharacterType.Npc,
    attributes: { secret: 'PRIVATE attribute' },
    inventory: {},
    description: { look: 'Tall innkeeper', nested: { mood: ['warm'] } },
    notes: 'PRIVATE note',
    revision: 1,
  } as Character;
  const page = listEntries(
    [record({ characterIds: [id], characterNames: { [id]: 'Mira' } })],
    [mira],
    query
  );
  const overview = page.entries[0]!.overview;
  assert.match(overview, /Character information: Tall innkeeper\. warm/);
  assert.ok(!overview.includes('PRIVATE'));
});

test('a placeholder without a public description stays honest and canonical text wins', () => {
  const plain = listEntries([record({})], [], query).entries[0]!;
  assert.equal(plain.overview, 'Mira was introduced.');
  const id = randomUUID();
  const withText = listEntries(
    [record({ text: 'Mira is the innkeeper.', characterIds: [id] })],
    [{ id, name: 'Mira', description: { x: 'ignored' } } as unknown as Character],
    query
  ).entries[0]!;
  assert.equal(withText.overview, 'Mira is the innkeeper.');
});

test('completed items collapse to a short labeled excerpt and connections need shared characters', () => {
  const id = randomUUID();
  const long = record({
    kind: K.Debt,
    title: 'Debt',
    status: S.Resolved,
    text: 'word '.repeat(100),
    characterIds: [id],
    characterNames: { [id]: 'Mira' },
  });
  const other = record({ title: 'Inn', kind: K.Place, text: 'The inn.', characterIds: [id] });
  const page = listEntries([long, other], [], { ...query, includePast: true });
  const debt = page.entries.find((e) => e.title === 'Debt')!;
  assert.ok(debt.overview.length <= 180);
  assert.equal(debt.excerpt, true);
  assert.deepEqual(
    debt.connections.map((c) => c.title),
    ['Inn']
  );
  assert.equal(
    listEntries([record({ title: 'Solo' })], [], query).entries[0]!.connections.length,
    0
  );
});

test('excerptText cuts on a word boundary', () => {
  assert.deepEqual(excerptText('short text', 50), { text: 'short text', cut: false });
  const r = excerptText('alpha beta gamma delta', 12);
  assert.equal(r.cut, true);
  assert.equal(r.text, 'alpha beta…');
});
