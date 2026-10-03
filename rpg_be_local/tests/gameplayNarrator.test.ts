import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameplayInstructionEnvelope } from '../src/domain/gameplayNarrator.js';

test('instruction envelope preserves complete selected and campaign columns once', () => {
  const selected = '  SYSTEM_CANARY\n\n\t' + 'unchanged selected text '.repeat(10000);
  const campaign = '\n CAMPAIGN_CANARY\t\n';
  for (const book of [false, true]) {
    const result = gameplayInstructionEnvelope(selected, campaign, book);
    assert.equal(result.split(selected).length, 2);
    assert.equal(result.split(campaign).length, 2);
    assert.equal(result.split('Application integration contract:').length, 2);
    assert.doesNotMatch(
      result,
      /flexible tabletop|complete narration|tone\/language|difficulty|pacing/
    );
  }
});

test('empty optional columns still produce the technical contract without invented behavior', () => {
  const result = gameplayInstructionEnvelope('', '', false);
  assert.match(result, /Selected system instructions:\n\n\nCampaign instructions:\n\n/);
  assert.match(result, /campaign_knowledge_search/);
  assert.match(result, /roll_dice/);
});
