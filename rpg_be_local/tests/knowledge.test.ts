import { CharacterType } from '../src/domain/options.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { newCampaign } from '../src/domain/campaign.js';
import { applyResponse, undoSnapshot } from '../src/domain/state.js';
import {
  KnowledgeKind as K,
  KnowledgeOrigin as O,
  KnowledgeCertainty as C,
  KnowledgeStatus as S,
  applyKnowledgeChanges,
  validateKnowledgeEvidence,
  type KnowledgeChange,
} from '../src/domain/knowledge.js';
import type { GameplayResponse } from '../src/domain/gameplayResponse.js';
const fact = (
  extra: Partial<Extract<KnowledgeChange, { op: 'create' }>> = {}
): Extract<KnowledgeChange, { op: 'create' }> => ({
  op: 'create',
  kind: K.Debt,
  title: 'Debt',
  text: 'Marta owes the innkeeper ten coins',
  origin: O.Gm,
  certainty: C.Established,
  status: S.Active,
  characterIds: [],
  evidence: [],
  ...extra,
});
const response = (changes: KnowledgeChange[]): GameplayResponse => ({
  version: 4,
  narrative: 'Marta arrives',
  operations: [],
  rollInterpretations: [],
  ruleCitations: [],
  knowledgeChanges: changes,
});
test('v4 stages NPC aliases and mixed provenance with state atomically, undo restores exact records', () => {
  const c = newCampaign({ name: 'Test' });
  const sourceId = randomUUID();
  const turnId = randomUUID();
  const quote = 'Marta is the guide';
  const r = response([fact({ characterIds: [{ operationIndex: 1 }] })]);
  r.operations = [
    { op: 'state', expected: {}, value: { scene: 'inn' } },
    {
      op: 'create',
      character: {
        name: 'Marta',
        type: CharacterType.Npc,
        attributes: {},
        inventory: {},
        description: {},
      },
      introduction: {
        origin: O.Source,
        evidence: [
          {
            type: 'campaign_source',
            sourceId,
            version: 1,
            sourceName: 'Adventure',
            quote,
            start: 6,
            end: 6 + quote.length,
          },
        ],
      },
    },
  ];
  const applied = applyResponse(c, r, turnId, {
    campaignId: c.id,
    turnId,
    sourceSpans: [
      { id: sourceId, version: 1, name: 'Adventure', text: quote, start: 6, end: 6 + quote.length },
    ],
  });
  assert.equal(applied.campaign.knowledge?.length, 2);
  assert.deepEqual(
    applied.campaign.knowledge?.map((k) => k.origin),
    [O.Source, O.Gm]
  );
  assert.deepEqual(applied.campaign.knowledge?.[1]?.characterIds, [
    applied.campaign.characters[0]!.id,
  ]);
  assert.deepEqual(undoSnapshot(applied.campaign, applied.snapshot).knowledge, []);
  assert.deepEqual(c.state, {});
  assert.equal(c.characters.length, 0);
  assert.throws(
    () =>
      applyResponse(
        c,
        { ...r, knowledgeChanges: [fact({ characterIds: [{ operationIndex: 0 }] })] },
        turnId,
        {
          campaignId: c.id,
          turnId,
          sourceSpans: [
            {
              id: sourceId,
              version: 1,
              name: 'Adventure',
              text: quote,
              start: 6,
              end: 6 + quote.length,
            },
          ],
        }
      ),
    /character reference/
  );
  assert.equal(c.characters.length, 0);
  assert.throws(
    () =>
      applyResponse(
        c,
        { ...r, knowledgeChanges: [fact({ kind: K.Npc, characterIds: [{ operationIndex: 1 }] })] },
        turnId,
        {
          campaignId: c.id,
          turnId,
          sourceSpans: [
            {
              id: sourceId,
              version: 1,
              name: 'Adventure',
              text: quote,
              start: 6,
              end: 6 + quote.length,
            },
          ],
        }
      ),
    /duplicate/
  );
});
test('rumor stays explicit; immutable creation origin and audit append; stale revision is informational; touched undo conflicts', () => {
  const c = newCampaign({ name: 'Test' });
  const turn = randomUUID();
  const first = applyResponse(
    c,
    response([fact({ certainty: C.Rumor, text: 'The villagers claim Marta owes ten coins' })]),
    turn
  );
  const record = first.campaign.knowledge![0]!;
  const update: KnowledgeChange = {
    op: 'update',
    id: record.id,
    expectedRevision: 1,
    changes: { certainty: C.Established, status: S.Resolved },
    origin: O.Player,
    evidence: [],
  };
  const second = applyResponse(first.campaign, response([update]), randomUUID());
  assert.equal(second.campaign.knowledge![0]!.origin, O.Gm);
  assert.equal(second.campaign.knowledge![0]!.attributions[1]!.origin, O.Player);
  assert.equal(second.campaign.knowledge![0]!.revision, 2);
  assert.deepEqual(
    undoSnapshot(second.campaign, second.snapshot).knowledge,
    first.campaign.knowledge
  );
  const third = applyResponse(second.campaign, response([update]), randomUUID());
  assert.equal(third.campaign.knowledge![0]!.revision, 3);
  second.campaign.knowledge![0]!.text = 'External change';
  assert.throws(() => undoSnapshot(second.campaign, second.snapshot), /Knowledge changed/);
  const legacy = applyResponse(
    first.campaign,
    { version: 1, narrative: 'old', operations: [] },
    'legacy'
  );
  assert.deepEqual(
    undoSnapshot(legacy.campaign, legacy.snapshot).knowledge,
    first.campaign.knowledge
  );
});
test('holder clearing and unchanged historical deleted links preserve identity without requiring a live character', () => {
  const c = newCampaign({ name: 'Test' });
  const id = randomUUID();
  c.characters.push({
    id,
    name: 'Marta',
    type: 'npc',
    attributes: {},
    inventory: {},
    description: {},
    notes: 'SECRET',
    revision: 0,
  });
  const first = applyResponse(
    c,
    response([
      fact({
        characterIds: [id],
        holderId: id,
        certainty: C.Belief,
        text: 'Marta believes the debt exists',
      }),
    ]),
    randomUUID()
  );
  first.campaign.characters = [];
  const record = first.campaign.knowledge![0]!;
  const second = applyResponse(
    first.campaign,
    response([
      {
        op: 'update',
        id: record.id,
        expectedRevision: 1,
        changes: { holderId: null, status: S.Resolved },
        origin: O.Gm,
        evidence: [],
      },
    ]),
    randomUUID()
  );
  assert.equal(second.campaign.knowledge![0]!.holderId, null);
  assert.equal(second.campaign.knowledge![0]!.holderName, undefined);
  assert.equal(second.campaign.knowledge![0]!.characterNames[id], 'Marta');
  assert.throws(
    () =>
      applyResponse(
        first.campaign,
        response([
          {
            op: 'update',
            id: record.id,
            expectedRevision: 1,
            changes: { characterIds: [id] },
            origin: O.Gm,
            evidence: [],
          },
        ]),
        randomUUID()
      ),
    /character reference/
  );
});
test('campaign source evidence is absolute UTF-16, inside one supplied section; wrong name/version/cross-span rejected', () => {
  const sourceId = randomUUID(),
    turnId = randomUUID(),
    campaignId = randomUUID();
  const source = 'prefix 😀Marta suffix tail';
  const quote = '😀Marta';
  const start = source.indexOf(quote);
  const e = {
    type: 'campaign_source' as const,
    sourceId,
    version: 2,
    sourceName: 'Book',
    quote,
    start,
    end: start + quote.length,
  };
  const context = {
    campaignId,
    turnId,
    sourceSpans: [
      { id: sourceId, version: 2, name: 'Book', text: quote, start, end: start + quote.length },
      {
        id: sourceId,
        version: 2,
        name: 'Book',
        text: 'tail',
        start: source.indexOf('tail'),
        end: source.length,
      },
    ],
  };
  validateKnowledgeEvidence({ origin: O.Source, evidence: [e] }, context);
  for (const invalid of [
    { ...e, start: 0, end: quote.length },
    { ...e, version: 1 },
    { ...e, sourceName: 'Fake' },
    { ...e, end: e.end - 1 },
    { ...e, quote: '😀Marta suffix tail', end: source.length },
  ])
    assert.throws(
      () => validateKnowledgeEvidence({ origin: O.Source, evidence: [invalid] }, context),
      /exact quote/
    );
  assert.throws(
    () => validateKnowledgeEvidence({ origin: O.Source, evidence: [] }, context),
    /requires supporting/
  );
  assert.throws(
    () => validateKnowledgeEvidence({ origin: O.Gm, evidence: [e] }, context),
    /Only source/
  );
});
test('pure knowledge staging never mutates original inputs after invalid later operation', () => {
  const input = [fact(), fact({ characterIds: [randomUUID()] })];
  assert.throws(() =>
    applyKnowledgeChanges([], input, [], new Map(), {
      campaignId: randomUUID(),
      turnId: randomUUID(),
    })
  );
  assert.equal(input[0]!.title, 'Debt');
});
import { RuleSystemKind, type RuleRead, type RuleCitation } from '../src/domain/rules.js';
test('source origin book evidence reuses original receipt validation and rejects discovery/foreign/current-turn mismatches', () => {
  const campaignId = randomUUID(),
    turnId = randomUUID(),
    receiptId = randomUUID();
  const context = {
    systemId: randomUUID(),
    systemKey: 'synthetic',
    systemName: 'Book',
    revision: 1,
    kind: RuleSystemKind.Library,
    contentHash: 'a'.repeat(64),
  };
  const citation: RuleCitation = {
    receiptId,
    path: 'core_rules.book.fact',
    source: 'book',
    systemId: context.systemId,
    revision: 1,
    contentHash: context.contentHash,
    quote: 'Guide',
    start: 50,
    end: 55,
    precision: 'exact',
    pdfPages: [1],
    printedPages: ['1'],
  };
  const receipt: RuleRead = {
    id: receiptId,
    campaignId,
    turnId,
    context,
    tool: 'rules_get',
    transportRequestId: 'read',
    argumentDigest: 'b'.repeat(64),
    resultHash: 'c'.repeat(64),
    createdAt: new Date().toISOString(),
    payload: {
      view: 'text',
      path: citation.path,
      source: 'book',
      text: 'Guide',
      start: 50,
      end: 55,
      pages: { precision: 'exact', pdfPages: [1], printedPages: ['1'] },
      pageSpans: [{ start: 50, end: 55, pdfPage: 1, printedPage: '1' }],
    },
  };
  const provenance = { origin: O.Source, evidence: [{ type: 'book' as const, citation }] };
  validateKnowledgeEvidence(provenance, {
    campaignId,
    turnId,
    ruleContext: context,
    ruleReads: [receipt],
  });
  for (const bad of [
    { ...receipt, turnId: randomUUID() },
    { ...receipt, campaignId: randomUUID() },
    { ...receipt, tool: 'rules_search' as const },
    { ...receipt, payload: { ...receipt.payload, view: 'fields' } },
  ])
    assert.throws(
      () =>
        validateKnowledgeEvidence(provenance, {
          campaignId,
          turnId,
          ruleContext: context,
          ruleReads: [bad],
        }),
      /Citations/
    );
  assert.throws(
    () => validateKnowledgeEvidence(provenance, { campaignId, turnId }),
    /requires a captured/
  );
});
test('undo restores touched records in their prior registry order and preserves unrelated later facts', () => {
  const c = newCampaign({ name: 'Order' });
  const first = applyResponse(
    c,
    response([fact({ title: 'First' }), fact({ title: 'Second' })]),
    randomUUID()
  );
  const initial = structuredClone(first.campaign.knowledge!);
  const second = applyResponse(
    first.campaign,
    response([
      {
        op: 'update',
        id: initial[0]!.id,
        expectedRevision: 1,
        changes: { status: S.Resolved },
        origin: O.Gm,
        evidence: [],
      },
    ]),
    randomUUID()
  );
  assert.deepEqual(undoSnapshot(second.campaign, second.snapshot).knowledge, initial);
  const third = applyResponse(
    second.campaign,
    response([fact({ title: 'Later unrelated' })]),
    randomUUID()
  );
  const restored = undoSnapshot(third.campaign, second.snapshot);
  assert.deepEqual(restored.knowledge!.slice(0, 2), initial);
  assert.equal(restored.knowledge![2]!.title, 'Later unrelated');
});
import { compactionBatch } from '../src/domain/context.js';
import { TurnStatus } from '../src/domain/options.js';
import type { Turn } from '../src/domain/types.js';
test('compaction carries only batch-linked knowledge with its original certainty and provenance', () => {
  const c = newCampaign({ name: 'Compaction' });
  const older = randomUUID(),
    current = randomUUID();
  const old = applyResponse(c, response([fact({ title: 'Unrelated old place' })]), older).campaign;
  const latest = applyResponse(
    old,
    response([
      fact({ title: 'New rumor', certainty: C.Rumor, text: 'Marta claims the guide is missing' }),
    ]),
    current
  ).campaign;
  const turn: Turn = {
    id: current,
    campaignId: c.id,
    requestId: randomUUID(),
    status: TurnStatus.Completed,
    action: 'Ask Marta',
    narrative: 'Marta makes an allegation',
    changes: [],
    error: null,
    undone: false,
    settings: c.settings,
    context: null,
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };
  const before = structuredClone(latest.knowledge);
  const payload = JSON.parse(
    compactionBatch(
      latest,
      [
        turn,
        ...Array.from({ length: 3 }, () => ({
          ...turn,
          id: randomUUID(),
          narrative: 'Later event',
        })),
      ],
      100000
    ).prompt
  );
  assert.equal(payload.knowledge.length, 1);
  assert.equal(payload.knowledge[0].title, 'New rumor');
  assert.equal(payload.knowledge[0].certainty, C.Rumor);
  assert.equal(payload.knowledge[0].origin, O.Gm);
  assert.deepEqual(latest.knowledge, before);
  assert.match(payload.knowledgeInstruction, /canonical/);
});
