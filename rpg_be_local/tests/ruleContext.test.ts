import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildContext } from '../src/domain/context.js';
import { newCampaign } from '../src/domain/campaign.js';
import { RuleSystemKind, RULE_LIMITS, type RulePrompt } from '../src/domain/rules.js';

function fixture(): RulePrompt {
  return {
    context: {
      systemId: randomUUID(),
      systemKey: 'original',
      systemName: 'Original rules',
      kind: RuleSystemKind.Library,
      revision: 4,
      contentHash: 'a'.repeat(64),
    },
    instructions: 'Original instructions',
    overview: 'Derived navigation: discover original passages with owned tools.',
  };
}
test('book context preserves event memory and captured identity while injecting only bounded instructions/navigation and the selected v3 contract', () => {
  const campaign = newCampaign({ name: 'Original bounded context' });
  campaign.memory = {
    id: randomUUID(),
    text: 'Original event memory',
    coveredTurnIds: [],
    valid: true,
    createdAt: new Date().toISOString(),
  };
  const rules = fixture();
  const manifest = buildContext(campaign, [], 'Original action', [], 16000, true, rules);
  const payload = JSON.parse(manifest.prompt);
  assert.deepEqual(manifest.ruleContext, rules.context);
  assert.deepEqual(payload.mandatory.ruleContext, rules.context);
  assert.equal(payload.memory, campaign.memory.text);
  assert.equal(payload.mandatory.systemInstructions, rules.instructions);
  assert.equal(payload.mandatory.rulesOverview, rules.overview);
  assert.equal(payload.mandatory.schema.properties.version.const, 3);
  assert.match(payload.mandatory.instructions, /original|Original/);
  assert.equal(Object.hasOwn(payload.mandatory, 'core_rules'), false);
  assert.ok(Buffer.byteLength(manifest.prompt) <= 16000);
});
test('default context permits model knowledge and retains its v2 contract without a book overview', () => {
  const campaign = newCampaign({ name: 'Original default context' });
  const rules = fixture();
  rules.context.kind = RuleSystemKind.ModelKnowledge;
  const payload = JSON.parse(
    buildContext(campaign, [], 'Original action', [], 16000, true, rules).prompt
  );
  assert.match(payload.mandatory.instructions, /model knowledge/);
  assert.equal(payload.mandatory.schema.properties.version.const, 2);
  assert.equal(Object.hasOwn(payload.mandatory, 'rulesOverview'), false);
});
test('instruction/overview and mandatory serialized overflow fail explicitly instead of trimming authority/state', () => {
  const campaign = newCampaign({ name: 'Original overflow context' });
  const rules = fixture();
  for (const invalid of [
    { ...rules, instructions: 'x'.repeat(RULE_LIMITS.instructionsBytes + 1) },
    { ...rules, overview: 'x'.repeat(RULE_LIMITS.overviewBytes + 1) },
  ])
    assert.throws(
      () => buildContext(campaign, [], 'Action', [], 16000, true, invalid),
      /exceeds its context limit/
    );
  assert.throws(
    () => buildContext(campaign, [], 'Action', [], 100, true, rules),
    /Mandatory state/
  );
});
