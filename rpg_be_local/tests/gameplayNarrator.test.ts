import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_GAMEPLAY_NARRATOR,
  BOOK_GAMEPLAY_NARRATOR,
} from '../src/domain/gameplayNarrator.js';
import { DICE_NARRATOR } from '../src/domain/dice.js';
import { RULE_TOOLS } from '../src/domain/rules.js';
test('default narrator permits model knowledge while preserving genuine dice/native isolation', () => {
  assert.equal(DICE_NARRATOR, DEFAULT_GAMEPLAY_NARRATOR);
  assert.match(DEFAULT_GAMEPLAY_NARRATOR, /campaign memory and model knowledge/);
  assert.match(DEFAULT_GAMEPLAY_NARRATOR, /Only the owned roll_dice tool/);
  assert.match(DEFAULT_GAMEPLAY_NARRATOR, /Native shell, files, network/);
  assert.doesNotMatch(
    DEFAULT_GAMEPLAY_NARRATOR,
    /No other tools, files, instructions, sessions or outside context/
  );
});
test('book narrator scopes the five owned tools, original authority and provisional/contradictory rulings', () => {
  for (const name of RULE_TOOLS) assert.ok(BOOK_GAMEPLAY_NARRATOR.includes(name));
  assert.match(BOOK_GAMEPLAY_NARRATOR, /Published original book text is authoritative/);
  assert.match(BOOK_GAMEPLAY_NARRATOR, /navigation only/);
  assert.match(BOOK_GAMEPLAY_NARRATOR, /contradictory books/);
  assert.match(BOOK_GAMEPLAY_NARRATOR, /Event memory/);
});
