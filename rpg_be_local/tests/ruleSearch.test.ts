import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareRuleMatches, rankRuleNode } from '../src/domain/ruleSearch.js';
import { RuleReview, type RuleNode } from '../src/domain/rules.js';

function rule(name: string, text: string, extra: Partial<RuleNode> = {}): RuleNode {
  return {
    name,
    text,
    aliases: [],
    source: 'synthetic',
    review: RuleReview.Extracted,
    children: {},
    pdfPages: [],
    printedPages: [],
    ...extra,
  };
}

test('query coverage outranks an incidental title word, with exact names and direct evidence preserved', () => {
  const query = 'mending damage rouse check superficial';
  const full = rankRuleNode(
    rule('Recovery', 'Mending damage uses a rouse check for superficial wounds.'),
    query
  );
  const incidental = rankRuleNode(rule('Check In', 'A conversation about comfort.'), query);
  assert.ok(compareRuleMatches(full, incidental) < 0);
  const exact = rankRuleNode(rule('Other', '', { aliases: [query], structural: true }), query);
  assert.ok(compareRuleMatches(exact, full) < 0);
  const summary = rankRuleNode(rule('Navigation', '', { summary: query }), query);
  assert.ok(compareRuleMatches(incidental, summary) < 0);
  assert.equal(summary.derived, true);
  assert.equal(rankRuleNode(rule('Recovery', 'Damage.'), query).found, true);
  assert.equal(rankRuleNode(rule('Unrelated', 'Nothing relevant.'), query).found, false);
});

test('equal coverage prefers titles then readable originals and leaves stable ties to lookup', () => {
  const titled = rankRuleNode(rule('Damage', 'An original.'), 'damage');
  const body = rankRuleNode(rule('Recovery', 'Damage.'), 'damage');
  assert.ok(compareRuleMatches(titled, body) < 0);
  const structural = rankRuleNode(rule('Recovery', 'Damage.', { structural: true }), 'damage');
  assert.ok(compareRuleMatches(body, structural) < 0);
  assert.equal(compareRuleMatches(body, rankRuleNode(rule('Another', 'Damage.'), 'damage')), 0);
});

test('snippet window prefers distinct dense matches, then shortest span and earliest occurrence', () => {
  const text = 'alpha ' + 'padding '.repeat(30) + 'alpha ' + 'x'.repeat(100) + ' beta gamma tail';
  const match = rankRuleNode(rule('Window', text), 'alpha beta gamma');
  const snippet = text.slice(match.snippetStart, match.snippetStart + 160);
  assert.match(snippet, /alpha/);
  assert.match(snippet, /beta gamma/);
  assert.ok(match.snippetStart > 6);
  const repeated = 'alpha '.repeat(35) + 'beta gamma';
  const compact = rankRuleNode(rule('Window', repeated), 'alpha beta gamma');
  assert.match(repeated.slice(compact.snippetStart, compact.snippetStart + 160), /beta gamma/);
  const tied = 'alpha beta ' + 'x'.repeat(200) + ' alpha beta';
  assert.equal(rankRuleNode(rule('Window', tied), 'alpha beta').snippetStart, 0);
  const shorter = 'alpha ' + 'x'.repeat(50) + ' beta ' + 'x'.repeat(200) + ' alpha beta';
  const shortest = rankRuleNode(rule('Window', shorter), 'alpha beta').snippetStart;
  assert.ok(shortest > 150);
  assert.match(shorter.slice(shortest, shortest + 160), /alpha beta/);
  assert.equal(rankRuleNode(rule('Alias', 'Unrelated text.'), 'alias').snippetStart, 0);
});

test('immutable library reuse never hides mutable aliases or replacement originals', () => {
  const mutableAliases = rule('Navigation', 'Original text.');
  Object.freeze(mutableAliases);
  assert.equal(rankRuleNode(mutableAliases, 'recovery').found, false);
  mutableAliases.aliases.push('recovery');
  assert.equal(rankRuleNode(mutableAliases, 'recovery').found, true);
  const frozen = rule('Navigation', 'Recovery.');
  Object.freeze(frozen.aliases);
  Object.freeze(frozen);
  assert.equal(rankRuleNode(frozen, 'recovery').found, true);
  const replacement = rule('Navigation', 'Other text.');
  Object.freeze(replacement.aliases);
  Object.freeze(replacement);
  assert.equal(rankRuleNode(replacement, 'recovery').found, false);
});

test('wake groups, compact windows and phrases rank lexical support without filtering partials', () => {
  const query = 'Rouse Check waking';
  const waking = rankRuleNode(rule('Awakening', 'To awaken, make a Rouse Check.'), query);
  const scattered = rankRuleNode(
    rule('Miscellaneous', 'Rouse ' + 'padding '.repeat(40) + 'check'),
    query
  );
  assert.ok(compareRuleMatches(waking, scattered) < 0);
  assert.equal(waking.matchQuality, 'strong');
  assert.equal(scattered.matchQuality, 'partial');
  assert.equal(
    rankRuleNode(
      rule('Awaken', 'Waking wakes awakening wake awaken.'),
      'wake waking awaken awakening'
    ).matchedTerms.length,
    1
  );
  const phrase = rankRuleNode(rule('Rule', 'A Rouse Check is required.'), '"Rouse Check"');
  const separated = rankRuleNode(rule('Rule', 'Rouse elsewhere; a check later.'), '"Rouse Check"');
  assert.ok(compareRuleMatches(phrase, separated) < 0);
  assert.equal(rankRuleNode(rule('Rule', 'Rouse.'), '"Rouse Check"').found, true);
});

test('distinct rarity weights outrank repeated ubiquitous evidence', () => {
  const weights = new Map([
    ['check', 1],
    ['wound', 4],
  ]);
  const rare = rankRuleNode(rule('Rule', 'Wounds.'), 'check wound', weights);
  const common = rankRuleNode(rule('Rule', 'Check '.repeat(50)), 'check wound', weights);
  assert.ok(compareRuleMatches(rare, common) < 0);
});
