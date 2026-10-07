import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GAMEPLAY_WRITING_GUIDANCE,
  gameplayInstructionEnvelope,
} from '../src/domain/gameplayNarrator.js';

test('the envelope separates documented knowledge from emergent details', () => {
  const current = gameplayInstructionEnvelope('System', 'Campaign', true);
  assert.match(current, /Use origin source only for claims directly supported/);
  assert.match(
    current,
    /Use origin gm for events or details created during play, with evidence \[\]/
  );
  assert.match(current, /separate records when their origins differ/);
  assert.match(current, /Never change origin merely to make evidence pass validation/);
});

test('every envelope carries NPC retrieval and the combat contract without version labels', () => {
  for (const book of [false, true]) {
    const result = gameplayInstructionEnvelope('System', 'Campaign', book);
    assert.match(result, /campaign_npcs_get/);
    assert.match(result, /before creating/);
    assert.match(result, /combat_prepare/);
    assert.match(result, /state\.combatNotes/);
    assert.doesNotMatch(result, /trackingVersion|[Vv]ersion [0-9]/);
  }
});

test('instruction envelope preserves complete selected and campaign columns once', () => {
  const selected = '  SYSTEM_CANARY\n\n\t' + 'unchanged selected text '.repeat(10000);
  const campaign = '\n CAMPAIGN_CANARY\t\n';
  for (const book of [false, true]) {
    const result = gameplayInstructionEnvelope(selected, campaign, book);
    assert.equal(result.split(selected).length, 2);
    assert.equal(result.split(campaign).length, 2);
    assert.equal(result.split('Application integration contract:').length, 2);
    const builtIn = result.slice(0, result.indexOf('Selected system instructions:'));
    assert.ok(builtIn.split('\n').filter((line) => line.startsWith('- ')).length > 30);
    assert.ok(
      builtIn.split('\n').every((line) => !line || line.startsWith('- ') || line.endsWith(':'))
    );
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
    assert.match(result, /Prefer familiar words and active voice/);
    assert.match(result, /Most sentences under 20 words/);
    assert.match(result, /Usually 80-150 words per turn/);
    assert.match(result, /One or two concrete sensory details per scene/);
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
      /Style never changes rules, established facts, dice faces, citations, exact source quotes, identifiers or required JSON structure/
    );
    assert.doesNotMatch(GAMEPLAY_WRITING_GUIDANCE, /[\u2013\u2014]/);
  }
});

test('every envelope asks for Journal-quality knowledge without adding a response field or stage', () => {
  for (const book of [false, true]) {
    const result = gameplayInstructionEnvelope('System', 'Campaign', book);
    assert.match(result, /significant known people and places, debts, promises, objectives/);
    assert.match(result, /skip incidental mentions/);
    assert.match(result, /update an existing record by id instead of introducing a duplicate/);
    assert.match(result, /rumors attributed and uncertain/);
    assert.match(result, /never turn a player suspicion without support into an established fact/);
    assert.match(result, /set that record to resolved and state the outcome in its text/);
    // Existing provenance, NPC and combat instructions remain in place.
    assert.match(result, /Never change origin merely to make evidence pass validation/);
    assert.match(result, /combat_prepare/);
    assert.match(result, /campaign_npcs_search/);
  }
});
