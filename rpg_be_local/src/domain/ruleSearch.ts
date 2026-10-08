import type { RuleNode } from './rules.js';

export const RULE_SEARCH_SNIPPET_CHARS = 160;

const NAVIGATION_WORDS = new Set([
  'find',
  'show',
  'the',
  'a',
  'an',
  'of',
  'for',
  'and',
  'or',
  'to',
  'in',
  'on',
  'rules',
  'rule',
]);
function normalize(word: string): string {
  const folded = word.toLowerCase();
  if (folded.length > 3 && folded.endsWith('s') && !/(ss|us|is)$/.test(folded))
    return folded.slice(0, -1);
  return folded;
}
function tokens(text: string) {
  return [...text.matchAll(/[\p{L}\p{N}]+/gu)].map((match) => ({
    term: normalize(match[0]),
    offset: match.index,
    end: match.index + match[0].length,
  }));
}

function tokenizeRule(node: RuleNode) {
  const original = tokens(node.text);
  return {
    original,
    titleTokens: new Set(
      [node.name, ...node.aliases].flatMap((name) => tokens(name).map((token) => token.term))
    ),
    directTokens: new Set(original.map((token) => token.term)),
    summaryTokens: new Set(tokens(node.summary ?? '').map((token) => token.term)),
  };
}

// Frozen library nodes belong to the current content cache; replacement nodes get new indexes.
const tokenIndexes = new WeakMap<RuleNode, ReturnType<typeof tokenizeRule>>();
function ruleTokens(node: RuleNode) {
  const immutable = Object.isFrozen(node) && Object.isFrozen(node.aliases);
  const cached = immutable ? tokenIndexes.get(node) : undefined;
  if (cached) return cached;
  const index = tokenizeRule(node);
  if (immutable) tokenIndexes.set(node, index);
  return index;
}

function denseSnippetStart(original: ReturnType<typeof tokens>, terms: ReadonlySet<string>) {
  const matches = original.filter((token) => terms.has(token.term));
  const counts = new Map<string, number>();
  let left = 0;
  let bestCoverage = 0;
  let bestSpan = Infinity;
  let bestStart = 0;
  const removeLeft = () => {
    const term = matches[left++]!.term;
    const count = counts.get(term)! - 1;
    if (count) counts.set(term, count);
    else counts.delete(term);
  };
  for (const [right, token] of matches.entries()) {
    counts.set(token.term, (counts.get(token.term) ?? 0) + 1);
    while (left <= right && token.end - matches[left]!.offset > RULE_SEARCH_SNIPPET_CHARS)
      removeLeft();
    // Discard redundant leading occurrences to measure the shortest covering span.
    while (left < right && counts.get(matches[left]!.term)! > 1) removeLeft();
    if (left > right) continue;
    const start = matches[left]!.offset;
    const span = token.end - start;
    if (counts.size > bestCoverage || (counts.size === bestCoverage && span < bestSpan)) {
      bestCoverage = counts.size;
      bestSpan = span;
      bestStart = start;
    }
  }
  if (!bestCoverage) return Math.max(0, (matches[0]?.offset ?? 0) - RULE_SEARCH_SNIPPET_CHARS / 2);
  return Math.max(0, bestStart - Math.floor((RULE_SEARCH_SNIPPET_CHARS - bestSpan) / 2));
}
export function rankRuleNode(node: RuleNode, query: string) {
  const allTerms = [...new Set(tokens(query).map((token) => token.term))];
  const substantive = allTerms.filter((term) => !NAVIGATION_WORDS.has(term));
  const terms = substantive.length ? substantive : allTerms;
  const names = [node.name, ...node.aliases];
  const { original, titleTokens, directTokens, summaryTokens } = ruleTokens(node);
  const titleTerms = terms.filter((term) => titleTokens.has(term));
  const matchedTerms = terms.filter((term) => titleTokens.has(term) || directTokens.has(term));
  const derived = matchedTerms.length === 0;
  const relevantTerms = derived ? terms.filter((term) => summaryTokens.has(term)) : matchedTerms;
  const exactTitle = names.some((name) => name.trim().toLowerCase() === query.trim().toLowerCase());
  return {
    found: relevantTerms.length > 0,
    derived,
    matchedTerms: relevantTerms,
    exactTitle,
    titleTermCount: titleTerms.length,
    readableOriginal: !node.structural && node.text.length > 0,
    snippetStart: denseSnippetStart(original, new Set(matchedTerms)),
  };
}

export function compareRuleMatches(
  a: ReturnType<typeof rankRuleNode>,
  b: ReturnType<typeof rankRuleNode>
) {
  return (
    Number(b.exactTitle) - Number(a.exactTitle) ||
    Number(a.derived) - Number(b.derived) ||
    b.matchedTerms.length - a.matchedTerms.length ||
    b.titleTermCount - a.titleTermCount ||
    Number(b.readableOriginal) - Number(a.readableOriginal)
  );
}
