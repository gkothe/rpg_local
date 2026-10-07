import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { newCampaign } from '../src/domain/campaign.js';
import { applyResponse } from '../src/domain/state.js';
import {
  KnowledgeVisibility as V,
  KnowledgeKind as K,
  KnowledgeOrigin as O,
  KnowledgeCertainty as C,
  KnowledgeStatus as S,
} from '../src/domain/knowledge.js';
import { JournalGroup } from '../src/domain/journal.js';
import type { Store } from '../src/store.js';
import { emptyResponse } from './ownedGameplayFixture.js';
import type { Turn } from '../src/domain/types.js';

const create = (
  kind: K,
  title: string,
  text: string,
  extra: Partial<{ certainty: C; status: S; visibility: V }> = {}
) => ({
  op: 'create' as const,
  kind,
  title,
  text,
  characterIds: [],
  origin: O.Gm,
  evidence: [],
  certainty: extra.certainty ?? C.Established,
  status: extra.status ?? S.Active,
  visibility: extra.visibility ?? V.Player,
});

function fixture() {
  const turnId = randomUUID();
  const c = applyResponse(
    newCampaign({ name: 'Example' }),
    {
      ...emptyResponse,
      narrative: 'The inn.',
      knowledgeChanges: [
        create(K.Npc, 'Mira', 'Mira is the innkeeper.'),
        create(K.Objective, 'Missing merchant', 'Find the merchant.'),
        create(K.Debt, 'Book return', 'Returned the healer book.', { status: S.Resolved }),
        create(K.Event, 'Bridge collapse', 'The bridge collapsed.'),
        create(K.Event, 'Mayor rumor', 'The mayor is said to be corrupt.', {
          certainty: C.Rumor,
        }),
        create(K.Other, 'Own suspicion', 'I think the baker lies.', { certainty: C.Belief }),
        create(K.Objective, 'HIDDEN plan', 'HIDDEN secret text', { visibility: V.GmOnly }),
      ],
    },
    turnId
  ).campaign;
  const turn = { id: turnId, status: 'completed', undone: false } as unknown as Turn;
  const store = {
    campaign: async () => structuredClone(c),
    knowledgeSnapshots: async () => [],
    turn: async (_c: string, id: string) => {
      if (id !== turnId) throw Object.assign(new Error('x'), { status: 404 });
      return structuredClone(turn);
    },
  } as unknown as Store;
  return { c, turnId, app: createApp({ store }).app };
}
const get = (app: ReturnType<typeof fixture>['app'], url: string) =>
  request(app).get(url).set('Host', 'localhost:4100');

test('journal lists grouped current entries and hides gm_only and belief records', async () => {
  const { c, app } = fixture();
  const r = await get(app, `/api/campaigns/${c.id}/journal/entries`).expect(200);
  const titles = r.body.data.entries.map((e: { title: string }) => e.title).sort();
  assert.deepEqual(titles, ['Bridge collapse', 'Mayor rumor', 'Mira', 'Missing merchant']);
  assert.equal(r.body.data.counts[JournalGroup.PeoplePlaces], 1);
  assert.equal(r.body.data.counts[JournalGroup.UnfinishedBusiness], 1);
  assert.equal(r.body.data.counts[JournalGroup.Discoveries], 2);
  assert.ok(!r.text.includes('HIDDEN'));
  assert.ok(!r.text.includes('baker'));
  const rumor = r.body.data.entries.find((e: { title: string }) => e.title === 'Mayor rumor');
  assert.equal(rumor.certaintyLabel, 'Rumor');
});

test('past toggle adds completed items and search spans groups without leaking hidden text', async () => {
  const { c, app } = fixture();
  const past = await get(app, `/api/campaigns/${c.id}/journal/entries?includePast=true`).expect(
    200
  );
  const book = past.body.data.entries.find((e: { title: string }) => e.title === 'Book return');
  assert.equal(book.statusLabel, 'Completed');
  const found = await get(app, `/api/campaigns/${c.id}/journal/entries?query=merchant`).expect(200);
  assert.deepEqual(
    found.body.data.entries.map((e: { title: string }) => e.title),
    ['Missing merchant']
  );
  const hidden = await get(app, `/api/campaigns/${c.id}/journal/entries?query=HIDDEN`).expect(200);
  assert.equal(hidden.body.data.total, 0);
});

test('pagination binds the cursor to the view and rejects stale or malformed cursors', async () => {
  const { c, app } = fixture();
  const first = await get(app, `/api/campaigns/${c.id}/journal/entries?limit=2`).expect(200);
  assert.equal(first.body.data.entries.length, 2);
  const cursor = first.body.data.nextCursor as string;
  const next = await get(
    app,
    `/api/campaigns/${c.id}/journal/entries?limit=2&cursor=${cursor}`
  ).expect(200);
  assert.equal(next.body.data.entries.length, 2);
  assert.equal(next.body.data.nextCursor, null);
  await get(app, `/api/campaigns/${c.id}/journal/entries?limit=2&cursor=${cursor}&query=m`).expect(
    409
  );
  await get(app, `/api/campaigns/${c.id}/journal/entries?cursor=zzz`).expect(422);
  await get(app, `/api/campaigns/${c.id}/journal/entries?limit=101`).expect(422);
});

test('detail exposes evidence locators and 404s hidden entries', async () => {
  const { c, turnId, app } = fixture();
  const list = await get(app, `/api/campaigns/${c.id}/journal/entries`).expect(200);
  const mira = list.body.data.entries.find((e: { title: string }) => e.title === 'Mira');
  const detail = await get(app, `/api/campaigns/${c.id}/journal/entries/${mira.id}`).expect(200);
  assert.equal(detail.body.data.evidence[0].turnId, turnId);
  assert.equal(detail.body.data.evidence[0].available, true);
  assert.equal(detail.body.data.history[0].summary, 'Recorded');
  const ev = await get(
    app,
    `/api/campaigns/${c.id}/journal/entries/${mira.id}/evidence/turn-${turnId}`
  ).expect(200);
  assert.equal(ev.body.data.kind, 'turn');
  const hiddenId = c.knowledge!.find((k) => k.title === 'HIDDEN plan')!.id;
  await get(app, `/api/campaigns/${c.id}/journal/entries/${hiddenId}`).expect(404);
  const beliefId = c.knowledge!.find((k) => k.title === 'Own suspicion')!.id;
  await get(app, `/api/campaigns/${c.id}/journal/entries/${beliefId}`).expect(404);
  await get(app, `/api/campaigns/${c.id}/journal/entries/${mira.id}/evidence/evidence-9`).expect(
    404
  );
});

test('settings advertise journal groups and limits', async () => {
  const { app } = fixture();
  const r = await get(app, '/api/settings').expect(200);
  assert.deepEqual(
    r.body.data.journal.groupOptions.map((g: { id: string }) => g.id),
    Object.values(JournalGroup)
  );
  assert.equal(r.body.data.journal.limits.pageSizeMax, 100);
});
