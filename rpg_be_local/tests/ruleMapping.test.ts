import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateRuleMapping } from '../src/domain/ruleMapping.js';
import {
  emptyRuleColumns,
  RuleReview,
  RULE_LIMITS,
  serializedBytes,
  type RuleContent,
} from '../src/domain/rules.js';
test('mapping derives field/layout metadata without enumerating node paths or book text', () => {
  const content: RuleContent = {
    ...emptyRuleColumns(),
    sources: [],
    instructions: '',
    mapping: {},
  };
  const root = {
    name: 'Synthetic',
    text: '',
    aliases: [],
    source: 'example',
    review: RuleReview.Extracted,
    pdfPages: [],
    printedPages: [],
    children: {},
  };
  content.core_rules.example = root;
  for (let index = 0; index < 9999; index++)
    content.core_rules.example.children[`rule_${index}`] = {
      ...root,
      text: 'PRIVATE SYNTHETIC TEXT',
      fields: { difficulty: 4 },
      children: {},
    };
  const result = generateRuleMapping(content);
  assert.equal(result.mapping.columns[0]!.nodes, 10000);
  assert.deepEqual(result.mapping.columns[0]!.fields, ['difficulty']);
  assert.ok(serializedBytes(result.mapping) < RULE_LIMITS.mappingBytes);
  assert.ok(Buffer.byteLength(result.overview) < RULE_LIMITS.overviewBytes);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE SYNTHETIC TEXT|rule_9998/);
  assert.match(result.mapping.authority, /derived navigation only/);
  content.core_rules.example.children.rule_0!.fields = { latest_navigation_field: 5 };
  const changed = generateRuleMapping(content);
  assert.ok(changed.mapping.columns[0]!.fields.includes('latest_navigation_field'));
  assert.notDeepEqual(changed.mapping, result.mapping);
  content.core_rules.example.children.rule_0!.fields = Object.fromEntries(
    Array.from({ length: 100 }, (_, index) => [`original_${index}_${'x'.repeat(150)}`, index])
  );
  const bounded = generateRuleMapping(content);
  assert.ok(
    Buffer.byteLength(JSON.stringify(bounded.mapping.columns[0]!.fields)) <=
      RULE_LIMITS.mappingFieldBytesPerColumn
  );
  assert.equal(bounded.mapping.columns[0]!.fieldsOmitted, true);
});
