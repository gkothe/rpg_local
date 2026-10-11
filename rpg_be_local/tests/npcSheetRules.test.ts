import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  emptyRuleColumns,
  RuleSystemKind,
  RuleReview,
  type RuleSystem,
} from '../src/domain/rules.js';
import {
  executeNpcSheetLookup,
  deriveNpcSheetRequirements,
} from '../src/services/npcSheetRules.js';
import { bindNpcSheetEvidence } from '../src/domain/npcSheetEvidence.js';
import { npcSheetRequirementsSchema } from '../src/domain/npcSheet.js';
import { ruleContext } from '../src/services/ruleStore.js';

function system(): RuleSystem {
  return {
    ...emptyRuleColumns(),
    systemId: randomUUID(),
    systemKey: 'fixture',
    systemName: 'Synthetic skill game',
    revision: 1,
    contentHash: 'a'.repeat(64),
    kind: RuleSystemKind.Library,
    instructions: 'Use complete mortal sheets',
    sources: [],
    mapping: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    core_rules: {
      sheet: {
        name: 'NPC sheet',
        aliases: [],
        text: 'Mortal skills: Athletics and Lore, rated zero to five. Health is eight.',
        source: 'book',
        review: RuleReview.Verified,
        pdfPages: [],
        printedPages: [],
        children: {},
      },
    },
  };
}
test('logical original pagination can be reconstructed after losing lookup cursor state', () => {
  const sys = system();
  sys.core_rules.sheet!.text = 'Words about the NPC sheet. '.repeat(1000) + 'Final rule.';
  const first = executeNpcSheetLookup(
    sys,
    { tool: 'rules_get', arguments: { path: 'core_rules.sheet', view: 'text' }, page: 0 },
    randomUUID()
  );
  assert.equal(first.nextPage, 1);
  assert.equal(first.cursor, undefined);
  const next = executeNpcSheetLookup(
    sys,
    { tool: 'rules_get', arguments: { path: 'core_rules.sheet', view: 'text' }, page: 1 },
    randomUUID()
  );
  assert.equal(next.start, first.end);
  assert.throws(
    () =>
      executeNpcSheetLookup(
        sys,
        { tool: 'rules_get', arguments: { path: 'core_rules.sheet', cursor: 'stale' }, page: 0 },
        randomUUID()
      ),
    /logical pages/
  );
});
test('job-owned original evidence binds exact offsets and cannot cross campaign, job or character scope', () => {
  const sys = system(),
    campaignId = randomUUID(),
    ownerId = randomUUID(),
    characterId = randomUUID(),
    id = randomUUID();
  const payload = executeNpcSheetLookup(
    sys,
    { tool: 'rules_get', arguments: { path: 'core_rules.sheet', view: 'text' }, page: 0 },
    id
  );
  const req = npcSheetRequirementsSchema.parse({
    version: 1,
    systemName: sys.systemName,
    edition: '1',
    category: 'Mortal',
    basis: 'book',
    fields: [
      {
        path: ['attributes', 'skills', 'Athletics'],
        type: 'number',
        min: 0,
        max: 5,
        reason: 'Catalog',
      },
      { path: ['attributes', 'skills', 'Lore'], type: 'number', min: 0, max: 5, reason: 'Catalog' },
    ],
    applicability: [],
    citations: [
      {
        receiptId: id,
        path: payload.path,
        source: payload.source,
        quote: 'Mortal skills: Athletics and Lore, rated zero to five.',
        systemId: sys.systemId,
        revision: 1,
        contentHash: sys.contentHash,
      },
    ],
  });
  const read = {
    id,
    campaignId,
    ownerId,
    characterId,
    context: ruleContext(sys),
    tool: 'rules_get',
    payload,
  };
  const scope = { campaignId, ownerId, characterId, systemId: sys.systemId };
  const bound = bindNpcSheetEvidence(req, [read], scope);
  assert.equal(bound.citations[0]!.start, 0);
  assert.equal(bound.citations[0]!.end, req.citations[0]!.quote.length);
  for (const changed of [
    { ...scope, campaignId: randomUUID() },
    { ...scope, ownerId: randomUUID() },
    { ...scope, characterId: randomUUID() },
  ])
    assert.throws(() => bindNpcSheetEvidence(req, [read], changed), /owned/);
});
test('library requirements cannot silently use model knowledge or empty catalog contracts', async () => {
  const sys = system();
  const requirements = {
    version: 1,
    systemName: sys.systemName,
    edition: '1',
    category: 'Mortal',
    basis: 'model_knowledge',
    fields: [{ path: ['attributes', 'hp'], type: 'number', reason: 'Health' }],
    applicability: [],
    citations: [],
  };
  await assert.rejects(
    deriveNpcSheetRequirements({
      generator: {
        capacity: async () => 10000,
        generate: async () => ({ action: 'finish', requirements }),
      },
      settings: { provider: 'test', model: 'test', effort: null },
      system: sys,
      context: {},
      scope: { campaignId: randomUUID(), ownerId: randomUUID(), systemId: sys.systemId },
      reads: async () => [],
      read: async () => ({}),
      save: async () => {},
      alive: async () => {},
    }),
    /original rules/
  );
});
