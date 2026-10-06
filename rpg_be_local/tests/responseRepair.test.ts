import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { bindResponseCitations } from '../src/domain/citationBinding.js';
import {
  gameplayResponseInputSchema,
  gameplayResponseSchema,
  gameplayResponseWireJsonSchema,
} from '../src/domain/gameplayResponse.js';
import {
  validateKnowledgeEvidence,
  KnowledgeOrigin,
  type KnowledgeValidation,
} from '../src/domain/knowledge.js';
import { ruleCitationSchema, RuleSystemKind, type RuleRead } from '../src/domain/rules.js';
import { validateRuleCitations } from '../src/domain/ruleCitationValidation.js';
import { ResponseFieldProblem, ResponseFieldProblems } from '../src/domain/responseFields.js';
import { Problem } from '../src/errors.js';
import {
  validateWithFieldRepair,
  applyResponseCorrections,
} from '../src/services/responseRepair.js';
import type { Generator } from '../src/providers/service.js';
import { nativeGameplaySchema } from '../src/providers/gameplayContract.js';
import { newCampaign } from '../src/domain/campaign.js';
import { applyResponse } from '../src/domain/state.js';

const campaignId = randomUUID(),
  turnId = randomUUID(),
  sourceId = randomUUID();
const quote = 'The keeper owns the key.';
function response(evidence: unknown) {
  return {
    combatEffects: [],
    participantReferences: [],
    narrative: 'The keeper closes the gate. What do you do?',
    operations: [],
    rollInterpretations: [],
    ruleCitations: [],
    operationExplanations: [],
    knowledgeChanges: [
      {
        op: 'create',
        kind: 'event',
        title: 'The key',
        text: quote,
        certainty: 'established',
        status: 'active',
        characterIds: [],
        origin: 'source',
        visibility: 'gm_only',
        evidence: [evidence],
      },
    ],
  };
}
const sourceEvidence = () => ({
  type: 'campaign_source',
  sourceId,
  sourceName: 'Preparation',
  version: 1,
  quote,
});
const context: KnowledgeValidation = {
  campaignId,
  turnId,
  sourceSpans: [
    {
      id: sourceId,
      version: 1,
      name: 'Preparation',
      text: '🦇 ' + quote,
      start: 500,
      end: 500 + 3 + quote.length,
    },
  ],
};
test('the app computes omitted or wrong source offsets using UTF-16; persisted contracts remain strict', () => {
  for (const evidence of [sourceEvidence(), { ...sourceEvidence(), start: 10, end: 11 }]) {
    const parsed = gameplayResponseInputSchema.parse(response(evidence));
    const bound = bindResponseCitations(parsed, context);
    const item = bound.knowledgeChanges[0]!.evidence[0]!;
    assert.equal(item.type, 'campaign_source');
    if (item.type === 'campaign_source') {
      assert.equal(item.start, 503);
      assert.equal(item.end, 503 + quote.length);
    }
    validateKnowledgeEvidence(bound.knowledgeChanges[0]!, context);
    assert.deepEqual(bound.narrative, parsed.narrative);
    assert.deepEqual(bound.operations, parsed.operations);
    assert.equal(gameplayResponseSchema.safeParse(bound).success, true);
  }
  assert.equal(gameplayResponseSchema.safeParse(response(sourceEvidence())).success, false);
  const schema = JSON.stringify(gameplayResponseWireJsonSchema);
  assert.match(schema, /application calculates offsets/);
  assert.deepEqual(
    nativeGameplaySchema().parse(response(sourceEvidence())),
    response(sourceEvidence())
  );
});
test('quote binding deduplicates overlapping spans but rejects ambiguous, unsupplied and forged evidence', () => {
  const parsed = gameplayResponseInputSchema.parse(response(sourceEvidence()));
  assert.doesNotThrow(() =>
    bindResponseCitations(parsed, {
      ...context,
      sourceSpans: [...context.sourceSpans!, ...context.sourceSpans!],
    })
  );
  for (const invalid of [
    { ...context, sourceSpans: [] },
    { ...context, sourceSpans: [{ ...context.sourceSpans![0]!, text: quote + ' ' + quote }] },
    { ...context, sourceSpans: [{ ...context.sourceSpans![0]!, version: 2 }] },
  ])
    assert.throws(() => bindResponseCitations(parsed, invalid), ResponseFieldProblem);
});
test('book citations bind newer current-rule receipts without requiring the turn-start revision', () => {
  const systemId = randomUUID(),
    receiptId = randomUUID(),
    contentHash = 'a'.repeat(64);
  const captured = {
    systemId,
    revision: 3,
    contentHash,
    kind: RuleSystemKind.Library,
    systemKey: 'test',
    systemName: 'Test rules',
  };
  const read = {
    id: receiptId,
    campaignId,
    turnId,
    transportRequestId: 'read',
    argumentDigest: contentHash,
    resultHash: contentHash,
    createdAt: new Date().toISOString(),
    context: { ...captured, revision: 4, contentHash: 'b'.repeat(64) },
    tool: 'rules_get',
    payload: {
      view: 'text',
      structural: false,
      text: 'Intro. ' + quote,
      start: 100,
      end: 107 + quote.length,
      path: 'core_rules.original.key',
      source: 'original',
      pageSpans: [
        { start: 100, end: 107, pdfPage: 2, printedPage: 'ii' },
        { start: 107, end: 107 + quote.length, pdfPage: 3, printedPage: '1' },
      ],
      pages: { precision: 'exact', pdfPages: [2, 3], printedPages: ['ii', '1'] },
    },
  } as RuleRead;
  const citation = {
    receiptId,
    systemId,
    revision: read.context.revision,
    contentHash: read.context.contentHash,
    path: read.payload.path,
    source: 'original',
    quote,
  };
  const raw = response({ type: 'book', citation });
  raw.ruleCitations = [citation] as never;
  const parsed = gameplayResponseInputSchema.parse(raw);
  const bound = bindResponseCitations(parsed, {
    campaignId,
    turnId,
    ruleContext: captured,
    ruleReads: [read],
  });
  assert.equal(bound.ruleCitations[0]!.start, 107);
  assert.deepEqual(bound.ruleCitations[0]!.pdfPages, [3]);
  assert.deepEqual(bound.ruleCitations[0]!.printedPages, ['1']);
  ruleCitationSchema.parse(bound.ruleCitations[0]);
  validateRuleCitations(bound, [read], campaignId, turnId, captured);
  validateKnowledgeEvidence(bound.knowledgeChanges[0]!, {
    campaignId,
    turnId,
    ruleContext: captured,
    ruleReads: [read],
  });
  assert.throws(
    () =>
      bindResponseCitations(parsed, {
        campaignId,
        turnId,
        ruleContext: captured,
        ruleReads: [{ ...read, turnId: randomUUID() }],
      }),
    ResponseFieldProblem
  );
});

const settings = { provider: 'codex', model: 'test', effort: 'high' };
test('mutation repair changes only invalid expected value and retains proposed value and another valid operation', async () => {
  const campaign = newCampaign({ name: 'NPC repair' });
  const id = randomUUID();
  campaign.characters = [
    {
      id,
      name: 'Keeper',
      type: 'npc',
      attributes: {},
      inventory: {},
      description: {},
      notes: '',
      revision: 0,
    },
  ];
  const raw = {
    combatEffects: [],
    participantReferences: [],
    narrative: 'Keeper introduces himself as Mira. What do you do?',
    operations: [
      { op: 'set', characterId: id, field: 'name', expected: 'Incorrect name', value: 'Mira' },
      {
        op: 'set',
        characterId: id,
        field: 'description',
        expected: {},
        value: { appearance: 'A blue cloak' },
      },
    ],
    ruleCitations: [],
    rollInterpretations: [],
    knowledgeChanges: [],
    operationExplanations: [],
  };
  let calls = 0;
  const generator: Generator = {
    capacity: async () => 10000,
    generate: async (_settings, prompt) => {
      calls++;
      assert.deepEqual(JSON.parse(prompt).allowedPaths, [['operations', 0, 'expected']]);
      return { corrections: [{ path: ['operations', 0, 'expected'], value: 'Keeper' }] };
    },
  };
  const repaired = await validateWithFieldRepair(
    raw,
    async (input) => {
      applyResponse(campaign, gameplayResponseInputSchema.parse(input), turnId);
    },
    generator,
    settings
  );
  assert.equal(calls, 1);
  assert.equal(repaired.narrative, raw.narrative);
  assert.equal(repaired.operations[0]!.value, 'Mira');
  assert.deepEqual(repaired.operations[1], raw.operations[1]);
  assert.equal(campaign.characters[0]!.name, 'Keeper');
  assert.equal(
    applyResponse(campaign, gameplayResponseInputSchema.parse(repaired), turnId).campaign
      .characters[0]!.name,
    'Mira'
  );
});
test('field repair corrects one citation and preserves narrative, hidden facts and valid operations', async () => {
  const original = response({ ...sourceEvidence(), quote: 'Invented quotation' });
  const path = ['knowledgeChanges', 0, 'evidence', 0];
  let calls = 0;
  const generator: Generator = {
    capacity: async () => 10000,
    generate: async (_s, prompt) => {
      calls++;
      const input = JSON.parse(prompt);
      assert.deepEqual(input.allowedPaths, [path]);
      assert.deepEqual(input.response.narrative, original.narrative);
      assert.equal(input.evidence.marker, 'frozen');
      return { corrections: [{ path, value: sourceEvidence() }] };
    },
  };
  const result = await validateWithFieldRepair(
    original,
    async (raw) => {
      const parsed = gameplayResponseInputSchema.parse(raw);
      bindResponseCitations(parsed, context);
    },
    generator,
    settings,
    undefined,
    undefined,
    async () => ({ marker: 'frozen' })
  );
  assert.equal(calls, 1);
  assert.equal(result.narrative, original.narrative);
  assert.equal(result.knowledgeChanges[0]!.visibility, 'gm_only');
  assert.deepEqual(result.operations, original.operations);
  assert.deepEqual(original.knowledgeChanges[0]!.evidence[0], {
    ...sourceEvidence(),
    quote: 'Invented quotation',
  });
});
test('repairs all invalid citations together before the retry budget, preserving valid content and dice', async () => {
  const campaign = newCampaign({ name: 'Citation repair' });
  campaign.id = campaignId;
  const rollId = randomUUID();
  const valid = response(sourceEvidence()).knowledgeChanges[0]!;
  const original = {
    ...response(sourceEvidence()),
    knowledgeChanges: [
      { ...valid, evidence: [{ ...sourceEvidence(), quote: 'Incorrect first quotation' }] },
      valid,
      { ...valid, evidence: [{ ...sourceEvidence(), quote: 'Incorrect second quotation' }] },
    ],
    operations: [{ op: 'state', expected: campaign.state, value: { gate: 'closed' } }],
    operationExplanations: [
      {
        operationIndex: 0,
        reason: 'The keeper owns the key and closes the gate.',
        basis: 'source',
        rollIds: [],
        evidence: [{ ...sourceEvidence(), quote: 'Incorrect third quotation' }],
        visibility: 'player',
      },
    ],
    rollInterpretations: [{ rollId, explanation: 'The saved roll remains authoritative.' }],
  };
  const paths = [
    ['knowledgeChanges', 0, 'evidence', 0],
    ['knowledgeChanges', 2, 'evidence', 0],
    ['operationExplanations', 0, 'evidence', 0],
  ];
  const snapshot = structuredClone(original);
  assert.throws(
    () => bindResponseCitations(gameplayResponseInputSchema.parse(original), context),
    (error: unknown) =>
      error instanceof ResponseFieldProblems &&
      JSON.stringify(error.problems.map((problem) => problem.path)) === JSON.stringify(paths)
  );
  let calls = 0;
  const generator: Generator = {
    capacity: async () => 10000,
    generate: async (_settings, prompt) => {
      calls++;
      assert.deepEqual(JSON.parse(prompt).allowedPaths, paths);
      return { corrections: paths.map((path) => ({ path, value: sourceEvidence() })) };
    },
  };
  const result = await validateWithFieldRepair(
    original,
    async (candidate) => {
      const bound = bindResponseCitations(gameplayResponseInputSchema.parse(candidate), context);
      applyResponse(campaign, bound, turnId, context);
    },
    generator,
    settings
  );
  assert.equal(calls, 1);
  assert.deepEqual(original, snapshot);
  assert.equal(result.narrative, original.narrative);
  assert.deepEqual(result.operations, original.operations);
  assert.deepEqual(result.knowledgeChanges[1], valid);
  assert.deepEqual(result.rollInterpretations, original.rollInterpretations);
  assert.equal(result.operationExplanations[0]!.reason, original.operationExplanations[0]!.reason);
  assert.equal(result.knowledgeChanges[0]!.visibility, 'gm_only');
  assert.deepEqual(campaign.state, original.operations[0]!.expected);
});
test('repair rejects narrative edits, unsafe paths and malformed correction output', async () => {
  const original = response(sourceEvidence());
  for (const raw of [
    { corrections: [{ path: ['narrative'], value: 'Different scene' }] },
    { corrections: [{ path: ['knowledgeChanges', 0, '__proto__'], value: {} }] },
    { narrative: 'Different scene' },
  ])
    assert.throws(() =>
      applyResponseCorrections(original, [['knowledgeChanges', 0, 'evidence']], raw)
    );
  assert.throws(() =>
    applyResponseCorrections(original, [['operations', '__proto__']], { corrections: [] })
  );
  let calls = 0;
  const generator: Generator = {
    capacity: async () => 10000,
    generate: async () => {
      calls++;
      return { narrative: 'Different scene' };
    },
  };
  await assert.rejects(
    () =>
      validateWithFieldRepair(
        original,
        async () => {
          throw new ResponseFieldProblem(
            ['knowledgeChanges', 0, 'evidence'],
            new Problem(502, 'knowledge_invalid', 'Invalid evidence')
          );
        },
        generator,
        settings
      ),
    (error: unknown) => error instanceof Problem && error.code === 'response_repair_failed'
  );
  assert.equal(calls, 1);
});
test('batched citation repair retains the two-call limit when corrections remain invalid', async () => {
  const original = response({ ...sourceEvidence(), quote: 'Invalid quote' });
  original.knowledgeChanges.push(structuredClone(original.knowledgeChanges[0]!));
  let calls = 0;
  const generator: Generator = {
    capacity: async () => 10000,
    generate: async (_settings, prompt) => {
      calls++;
      const { allowedPaths } = JSON.parse(prompt);
      assert.equal(allowedPaths.length, 2);
      return {
        corrections: allowedPaths.map((path: (string | number)[]) => ({
          path,
          value: { ...sourceEvidence(), quote: 'Still invalid' },
        })),
      };
    },
  };
  await assert.rejects(
    () =>
      validateWithFieldRepair(
        original,
        async (candidate) => {
          bindResponseCitations(gameplayResponseInputSchema.parse(candidate), context);
        },
        generator,
        settings
      ),
    (error: unknown) => error instanceof Problem && error.code === 'response_repair_failed'
  );
  assert.equal(calls, 2);
});
test('quota, cancellation and ownership failures stop repair; no generated scene is requested', async () => {
  const original = response(sourceEvidence());
  const quota = new Problem(429, 'provider_quota', 'quota');
  const generator: Generator = {
    capacity: async () => 10000,
    generate: async () => {
      throw quota;
    },
  };
  await assert.rejects(
    () =>
      validateWithFieldRepair(
        original,
        async () => {
          throw new ResponseFieldProblem(
            ['ruleCitations'],
            new Problem(502, 'rules_citations_invalid', 'bad')
          );
        },
        generator,
        settings
      ),
    (error) => error === quota
  );
  const ctl = new AbortController();
  ctl.abort();
  await assert.rejects(
    () => validateWithFieldRepair(original, async () => {}, generator, settings, ctl.signal),
    (error: unknown) => error instanceof Problem && error.code === 'cancelled'
  );
  const conflict = new Problem(409, 'conflict', 'ownership changed');
  await assert.rejects(
    () =>
      validateWithFieldRepair(
        original,
        async () => {
          throw conflict;
        },
        generator,
        settings
      ),
    (error) => error === conflict
  );
  assert.equal(KnowledgeOrigin.Source, original.knowledgeChanges[0]!.origin);
});

test('combat links are correctable but prepared identities and receipts are not', () => {
  const characterId = '11111111-1111-4111-8111-111111111111';
  const receipt = '22222222-2222-4222-8222-222222222222';
  const original = {
    operations: [
      { op: 'create', characterId, preparationReceiptId: receipt, character: { name: 'Guard' } },
    ],
    combatEffects: [],
    participantReferences: [{ afterParagraph: 3, characterIds: [characterId] }],
  };
  const fixed = applyResponseCorrections(original, [['participantReferences', 0]], {
    corrections: [
      {
        path: ['participantReferences', 0],
        value: { afterParagraph: 1, characterIds: [characterId] },
      },
    ],
  });
  assert.equal(fixed.participantReferences[0]!.afterParagraph, 1);
  // Draft content may be corrected back to the receipt, but never the reserved identity.
  const content = applyResponseCorrections(original, [['operations', 0, 'character']], {
    corrections: [{ path: ['operations', 0, 'character'], value: { name: 'Guard 2' } }],
  });
  assert.equal(content.operations[0]!.characterId, characterId);
  for (const [path, value] of [
    [['operations', 0, 'characterId'], '33333333-3333-4333-8333-333333333333'],
    [['operations', 0, 'preparationReceiptId'], '33333333-3333-4333-8333-333333333333'],
    [['operations', 0], { op: 'create', character: { name: 'Guard' } }],
  ] as const)
    assert.throws(
      () =>
        applyResponseCorrections(original, [[...path]], {
          corrections: [{ path: [...path], value }],
        }),
      /prepared character identity/
    );
});
