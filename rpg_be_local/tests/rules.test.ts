import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RULE_INSTRUCTIONS,
  emptyRuleColumns,
  ruleContentHash,
  ruleNodeSchema,
  ruleSlugSchema,
  RuleReview,
  RuleSystemKind,
  validateRuleContent,
  type RuleContent,
  type RuleNode,
} from '../src/domain/rules.js';

const node = (text = 'Alpha 🐉 beta'): RuleNode => ({
  name: 'A synthetic rule',
  aliases: [],
  source: 'example-core',
  text,
  review: RuleReview.Extracted,
  pdfPages: [1],
  printedPages: ['i'],
  children: {},
});
const content = (): RuleContent => ({
  ...emptyRuleColumns(),
  instructions: DEFAULT_RULE_INSTRUCTIONS,
  mapping: {},
  sources: [],
});
test('default is instructions-only and canonical hashes ignore object insertion order', () => {
  const original = content();
  validateRuleContent(original, RuleSystemKind.ModelKnowledge);
  assert.equal(ruleContentHash(original), ruleContentHash({ ...original, mapping: {} }));
  const first = { ...original, mapping: { z: 2, a: { y: 1, x: 2 } } };
  const second = { ...original, mapping: { a: { x: 2, y: 1 }, z: 2 } };
  assert.equal(ruleContentHash(first), ruleContentHash(second));
  assert.notEqual(
    ruleContentHash(original),
    ruleContentHash({ ...original, instructions: 'Changed' })
  );
  assert.throws(
    () => validateRuleContent(first, RuleSystemKind.ModelKnowledge),
    /instructions only/
  );
});
test('slugs reject unsafe keys and UTF-8 limits count multibyte text', () => {
  for (const key of [
    '__proto__',
    'constructor',
    'prototype',
    'children',
    '../escape',
    'UPPER',
    'a'.repeat(81),
  ])
    assert.equal(ruleSlugSchema.safeParse(key).success, false);
  assert.equal(ruleSlugSchema.parse('example-core_1'), 'example-core_1');
  assert.equal(ruleNodeSchema.safeParse({ ...node(), summary: '漢'.repeat(342) }).success, false);
  assert.throws(() =>
    validateRuleContent(
      { ...content(), instructions: '漢'.repeat(2731) },
      RuleSystemKind.ModelKnowledge
    )
  );
});
test('evidence uses UTF-16 offsets in direct text and page spans cannot overlap or escape it', () => {
  const valid = {
    ...node(),
    fields: { creature: 'dragon' },
    fieldEvidence: {
      creature: { kind: 'text', quote: '🐉', start: 6, end: 8 },
    },
    pageSpans: [
      { start: 0, end: 8, pdfPage: 1, printedPage: 'i' },
      { start: 8, end: 13, pdfPage: null, printedPage: null },
    ],
  };
  assert.equal(ruleNodeSchema.safeParse(valid).success, true);
  assert.equal(
    ruleNodeSchema.safeParse({
      ...valid,
      fieldEvidence: { creature: { kind: 'text', quote: '🐉', start: 6, end: 7 } },
    }).success,
    false
  );
  assert.equal(
    ruleNodeSchema.safeParse({
      ...valid,
      pageSpans: [
        { start: 0, end: 9, pdfPage: 1, printedPage: null },
        { start: 8, end: 13, pdfPage: 2, printedPage: null },
      ],
    }).success,
    false
  );
  assert.equal(
    ruleNodeSchema.safeParse({
      ...valid,
      pageSpans: [{ start: 0, end: 14, pdfPage: 1, printedPage: null }],
    }).success,
    false
  );
  assert.equal(
    ruleNodeSchema.safeParse({
      ...valid,
      fieldEvidence: {
        creature: {
          kind: 'visual',
          pdfPage: 1,
          reviewNote: 'Manually reviewed image',
          manual: true,
        },
      },
    }).success,
    true
  );
});
test('book partitions preserve structural parents and reject wrong source/page/depth', () => {
  const original = content();
  original.sources = [
    { slug: 'example-core', title: 'Original synthetic book', pageCount: 2, pdfHash: null },
  ];
  original.core_rules['example-core'] = {
    ...node(''),
    structural: true,
    pdfPages: [],
    printedPages: [],
    children: { check: node() },
  };
  validateRuleContent(original, RuleSystemKind.Library);
  original.core_rules['example-core']!.children.check!.pdfPages = [3];
  assert.throws(() => validateRuleContent(original, RuleSystemKind.Library), /Page exceeds/);
  original.core_rules['example-core']!.children.check!.pdfPages = [1];
  original.core_rules['example-core']!.children.check!.source = 'different';
  assert.throws(() => validateRuleContent(original, RuleSystemKind.Library), /source/);
});
