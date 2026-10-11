import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import {
  GmIndexRefKind,
  gmIndexRefSchema,
  gmIndexWireRefSchema,
  normalizeGmIndexRefs,
  validateGmIndexRefs,
} from '../src/domain/gmIndexRefs.js';
import { newCampaign } from '../src/domain/campaign.js';
import { SourceKind, SourceStatus } from '../src/domain/options.js';

test('saved references reject aliases, arbitrary metadata and invalid locators', () => {
  const id = randomUUID();
  assert.equal(gmIndexRefSchema.safeParse({ kind: GmIndexRefKind.Knowledge, id }).success, true);
  for (const value of [
    { kind: GmIndexRefKind.Turn, turnId: id, contentHash: 'not-a-hash' },
    { kind: GmIndexRefKind.Knowledge, id, text: 'Untrusted extra text' },
    { kind: GmIndexRefKind.Knowledge, knowledgeChangeIndex: 0 },
    { kind: GmIndexRefKind.SourceSection, sourceId: id, version: 0, sectionIndex: 0 },
    { kind: GmIndexRefKind.SourceSection, sourceId: id, version: 1, sectionIndex: -1 },
    { kind: GmIndexRefKind.CampaignField, field: 'notes', contentHash: 'a'.repeat(64) },
  ])
    assert.equal(gmIndexRefSchema.safeParse(value).success, false);
  assert.equal(
    gmIndexWireRefSchema.safeParse({ kind: GmIndexRefKind.Knowledge, knowledgeChangeIndex: 0 })
      .success,
    true
  );
});

test('wire aliases bind only to successful creates and the selected final original', () => {
  const knowledgeId = randomUUID(),
    characterId = randomUUID(),
    turnId = randomUUID();
  const refs = normalizeGmIndexRefs(
    [
      { kind: GmIndexRefKind.Knowledge, knowledgeChangeIndex: 2 },
      { kind: GmIndexRefKind.Character, operationIndex: 3 },
      { kind: GmIndexRefKind.Turn, current: true },
    ],
    {
      characters: new Map([[3, characterId]]),
      knowledge: new Map([[2, knowledgeId]]),
      introductions: new Map(),
    },
    { turnId, contentHash: 'b'.repeat(64) }
  );
  assert.deepEqual(refs, [
    { kind: GmIndexRefKind.Knowledge, id: knowledgeId },
    { kind: GmIndexRefKind.Character, characterId },
    { kind: GmIndexRefKind.Turn, turnId, contentHash: 'b'.repeat(64) },
  ]);
  assert.throws(
    () =>
      normalizeGmIndexRefs(
        [{ kind: GmIndexRefKind.Knowledge, knowledgeChangeIndex: 9 }],
        { characters: new Map(), knowledge: new Map(), introductions: new Map() },
        { turnId, contentHash: 'b'.repeat(64) }
      ),
    /successful create/
  );
});

test('reference ownership and exact original identities are validated against the capture', () => {
  const campaign = newCampaign({ name: 'Capture', description: 'Harbor campaign' });
  const turnId = randomUUID();
  const original = { turnId, contentHash: 'c'.repeat(64) };
  const fieldHash = createHash('sha256').update(campaign.description).digest('hex');
  validateGmIndexRefs(
    [
      { kind: GmIndexRefKind.Turn, ...original },
      { kind: GmIndexRefKind.CampaignField, field: 'description', contentHash: fieldHash },
    ],
    { campaign, turns: [original] }
  );
  for (const ref of [
    { kind: GmIndexRefKind.Turn, turnId, contentHash: 'd'.repeat(64) },
    { kind: GmIndexRefKind.Character, characterId: randomUUID() },
    { kind: GmIndexRefKind.Knowledge, id: randomUUID() },
    {
      kind: GmIndexRefKind.CampaignField,
      field: 'description' as const,
      contentHash: 'e'.repeat(64),
    },
  ] as const)
    assert.throws(() => validateGmIndexRefs([ref], { campaign, turns: [original] }));
});

test('NPC introduction aliases resolve through introduction reservations only', () => {
  const id = randomUUID(),
    turnId = randomUUID();
  const alias = { kind: GmIndexRefKind.Knowledge, npcIntroductionOperationIndex: 1 } as const;
  const maps = {
    characters: new Map(),
    knowledge: new Map([[1, randomUUID()]]),
    introductions: new Map([[1, id]]),
  };
  assert.deepEqual(normalizeGmIndexRefs([alias], maps, { turnId, contentHash: 'a'.repeat(64) }), [
    { kind: GmIndexRefKind.Knowledge, id },
  ]);
  assert.throws(() =>
    normalizeGmIndexRefs(
      [alias],
      { ...maps, introductions: new Map() },
      { turnId, contentHash: 'a'.repeat(64) }
    )
  );
  assert.equal(gmIndexRefSchema.safeParse(alias).success, false);
});

test('source locators require a confirmed owned source, matching version and real section', () => {
  const campaign = newCampaign({ name: 'Original sources' });
  const sourceId = randomUUID();
  campaign.sources.push({
    id: sourceId,
    name: 'Campaign',
    kind: SourceKind.Text,
    text: 'A harbor campaign.',
    status: SourceStatus.Confirmed,
    version: 1,
    pages: [],
    warnings: [],
  });
  const ref = {
    kind: GmIndexRefKind.SourceSection,
    sourceId,
    version: 1,
    sectionIndex: 0,
  } as const;
  const capture = { campaign, turns: [] };
  validateGmIndexRefs([ref], capture);
  for (const invalid of [
    { ...ref, sourceId: randomUUID() },
    { ...ref, version: 2 },
    { ...ref, sectionIndex: 1 },
  ])
    assert.throws(() => validateGmIndexRefs([invalid], capture));
  campaign.sources[0]!.status = SourceStatus.Draft;
  assert.throws(() => validateGmIndexRefs([ref], capture));
});
