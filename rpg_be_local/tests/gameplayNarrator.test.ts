import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GAMEPLAY_WRITING_GUIDANCE,
  gameplayInstructionEnvelope,
} from '../src/domain/gameplayNarrator.js';

test('NPC guidance is explicitly enabled while legacy envelopes stay identical', () => {
  const legacy = gameplayInstructionEnvelope('System', 'Campaign', false, 5);
  assert.equal(gameplayInstructionEnvelope('System', 'Campaign', false, 5, false), legacy);
  assert.doesNotMatch(legacy, /campaign_npcs_get/);
  assert.match(
    gameplayInstructionEnvelope('System', 'Campaign', false, 5, true),
    /campaign_npcs_get/
  );
  assert.match(gameplayInstructionEnvelope('System', 'Campaign', true, 5, true), /before creating/);
});

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

test('empty optional columns still produce the technical contract and default prose guidance', () => {
  const result = gameplayInstructionEnvelope('', '', false);
  assert.match(result, /Selected system instructions:\n\n\nCampaign instructions:\n\n/);
  assert.match(result, /campaign_knowledge_search/);
  assert.match(result, /roll_dice/);
});

test('book and model-knowledge prompts include one prose block before exact GM instructions', () => {
  for (const book of [false, true]) {
    const result = gameplayInstructionEnvelope(
      'Use terse Portuguese dialogue.',
      'Use gothic prose.',
      book
    );
    assert.equal(result.split(GAMEPLAY_WRITING_GUIDANCE).length, 2);
    assert.ok(
      result.indexOf('Application integration contract:') <
        result.indexOf(GAMEPLAY_WRITING_GUIDANCE)
    );
    assert.ok(
      result.indexOf(GAMEPLAY_WRITING_GUIDANCE) < result.indexOf('Selected system instructions:')
    );
    assert.match(result, /instructions for language, tone and narrative style when they differ/);
    assert.match(
      result,
      /Style never changes rules, established facts, dice faces, citations, exact source quotes, identifiers or the required JSON structure/
    );
    assert.doesNotMatch(GAMEPLAY_WRITING_GUIDANCE, /[\u2013\u2014]/);
  }
});
