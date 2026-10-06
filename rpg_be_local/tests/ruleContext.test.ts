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
test('book context preserves event memory and captured identity with navigation in data and instructions in the envelope', () => {
  const campaign = newCampaign({ name: 'Original bounded context' });
  campaign.memory = {
    id: randomUUID(),
    text: 'Original event memory',
    coveredTurnIds: [],
    valid: true,
    createdAt: new Date().toISOString(),
  };
  const rules = fixture();
  const manifest = buildContext(campaign, [], 'Original action', [], rules);
  const payload = JSON.parse(manifest.prompt);
  assert.deepEqual(manifest.ruleContext, rules.context);
  assert.deepEqual(payload.mandatory.ruleContext, rules.context);
  assert.equal(payload.memory, campaign.memory.text);
  assert.equal(payload.mandatory.rulesOverview, rules.overview);
  assert.equal(payload.mandatory.systemInstructions, undefined);
  assert.ok(manifest.systemPrompt!.includes(rules.instructions));
  assert.match(manifest.systemPrompt!, /rules_find/);
  assert.equal(Object.hasOwn(payload.mandatory, 'core_rules'), false);
});
test('model-knowledge context has no book overview and asks for provisional adjudication labels', () => {
  const campaign = newCampaign({ name: 'Original default context' });
  const rules = fixture();
  rules.context.kind = RuleSystemKind.ModelKnowledge;
  const manifest = buildContext(campaign, [], 'Original action', [], rules);
  const payload = JSON.parse(manifest.prompt);
  assert.match(manifest.systemPrompt!, /provisional rule adjudications/);
  assert.doesNotMatch(manifest.systemPrompt!, /rules_find/);
  assert.equal(Object.hasOwn(payload.mandatory, 'rulesOverview'), false);
});
test('large instructions, overview and mandatory state remain intact above soft planning targets', () => {
  const campaign = newCampaign({ name: 'Original overflow context' });
  const rules = fixture();
  const instructions = 'x'.repeat(RULE_LIMITS.instructionsBytes + 1);
  assert.ok(
    buildContext(campaign, [], 'Action', [], { ...rules, instructions }).systemPrompt!.includes(
      instructions
    )
  );
  const overview = 'x'.repeat(RULE_LIMITS.overviewBytes + 1);
  assert.equal(
    JSON.parse(buildContext(campaign, [], 'Action', [], { ...rules, overview }).prompt).mandatory
      .rulesOverview,
    overview
  );
  const large = buildContext(campaign, [], 'Action', [], rules);
  assert.ok(large.estimatedTokens > 100);
});
