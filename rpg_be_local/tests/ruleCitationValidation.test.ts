import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { validateRuleCitations } from '../src/domain/ruleCitationValidation.js';
import {
  RuleSystemKind,
  ruleCitationSchema,
  type RuleContext,
  type RuleRead,
} from '../src/domain/rules.js';
test('rule citations must match an original-text receipt and canonical quote pages', () => {
  const campaignId = randomUUID();
  const turnId = randomUUID();
  const receiptId = randomUUID();
  const context: RuleContext = {
    systemId: randomUUID(),
    systemKey: 'synthetic',
    systemName: 'Original',
    revision: 1,
    kind: RuleSystemKind.Library,
    contentHash: 'a'.repeat(64),
  };
  const receipt: RuleRead = {
    id: receiptId,
    campaignId,
    turnId,
    context,
    tool: 'rules_get',
    transportRequestId: 'original',
    argumentDigest: 'b'.repeat(64),
    resultHash: 'c'.repeat(64),
    createdAt: new Date().toISOString(),
    payload: {
      view: 'text',
      path: 'core_rules.original.check',
      source: 'original',
      start: 100,
      end: 113,
      text: 'Alpha 🐉 beta',
      pages: { precision: 'exact', pdfPages: [1, 2], printedPages: ['3', '4'] },
      pageSpans: [
        { start: 100, end: 108, pdfPage: 1, printedPage: '3' },
        { start: 108, end: 113, pdfPage: 2, printedPage: '4' },
      ],
    },
  };
  const response = {
    ruleCitations: [
      ruleCitationSchema.parse({
        receiptId,
        path: 'core_rules.original.check',
        source: 'original',
        systemId: context.systemId,
        revision: context.revision,
        contentHash: context.contentHash,
        start: 106,
        end: 108,
        quote: '🐉',
        precision: 'exact',
        pdfPages: [1],
        printedPages: ['3'],
      }),
    ],
  };
  validateRuleCitations(response, [receipt], campaignId, turnId, context);
  for (const invalid of [
    { ...response.ruleCitations[0]!, pdfPages: [2] },
    { ...response.ruleCitations[0]!, contentHash: 'd'.repeat(64) },
    { ...response.ruleCitations[0]!, path: 'core_rules.original.other' },
    { ...response.ruleCitations[0]!, quote: 'xx' },
  ])
    assert.throws(
      () =>
        validateRuleCitations(
          { ...response, ruleCitations: [invalid] },
          [receipt],
          campaignId,
          turnId,
          context
        ),
      /Citations/
    );
  for (const invalid of [
    { ...receipt, tool: 'rules_search' as const },
    { ...receipt, turnId: randomUUID() },
    { ...receipt, payload: { ...receipt.payload, view: 'fields' } },
    { ...receipt, payload: { ...receipt.payload, structural: true } },
  ])
    assert.throws(
      () => validateRuleCitations(response, [invalid], campaignId, turnId, context),
      /Citations/
    );
});
