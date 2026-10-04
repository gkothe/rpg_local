import test from 'node:test';
import assert from 'node:assert/strict';
import {
  narrativeHumanizerPrompt,
  narrativeHumanizerJsonSchema,
  validateHumanizedNarrative,
} from '../src/domain/narrativeHumanizer.js';

test('editor prompt has only final prose, instructions and narrative schema', () => {
  const text = 'Mira waits by the gate. Hunger is 2.\n\nWhat do you do?';
  const prompt = narrativeHumanizerPrompt(text);
  assert.ok(prompt.includes(JSON.stringify({ narrative: text })));
  assert.ok(prompt.includes(JSON.stringify(narrativeHumanizerJsonSchema)));
  assert.ok(prompt.includes('No tools are available'));
  assert.ok(!prompt.includes('knowledgeChanges'));
});

test('conservative anchors reject changed numbers, names, dialogue and player question', () => {
  const original =
    'You see Mira by the gate. Hunger is 2. "Stay here," she says.\n\nWhat do you do?';
  assert.equal(validateHumanizedNarrative(original, { narrative: original }, ['Mira']), original);
  for (const changed of [
    original.replace('2', '3'),
    original.replace('Mira', 'Elda'),
    original.replace('Stay here,', 'Go away,'),
    original.replace('What do you do?', 'What next?'),
  ])
    assert.throws(() => validateHumanizedNarrative(original, { narrative: changed }, ['Mira']));
  assert.throws(() =>
    validateHumanizedNarrative(original, { narrative: original, operations: [] })
  );
});

test('valid prose edit preserves all protected anchors and does not claim semantic certainty', () => {
  const original = 'You see Mira, whose position is by the gate. Hunger is 2.\n\nWhat do you do?';
  const edited = 'Mira stands by the gate. Hunger is 2.\n\nWhat do you do?';
  assert.equal(validateHumanizedNarrative(original, { narrative: edited }, ['Mira']), edited);
});

test('capitalized ordinary words and prose before the last question are not false proper-name anchors', () => {
  const original =
    'The scene unfolds: Suddenly the door closes. Its hinges are ancient. What do you do?';
  const edit = 'The old door shuts. What do you do?';
  assert.equal(validateHumanizedNarrative(original, { narrative: edit }), edit);
});
