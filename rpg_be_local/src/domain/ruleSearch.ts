import type { RuleNode } from './rules.js';

const SEARCH_WEIGHT = {
  exactTitle: 100000,
  original: 10000,
  titleTerm: 1000,
  term: 100,
  unreadable: 1,
} as const;

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
  }));
}
export function rankRuleNode(node: RuleNode, query: string) {
  const allTerms = [...new Set(tokens(query).map((token) => token.term))];
  const substantive = allTerms.filter((term) => !NAVIGATION_WORDS.has(term));
  const terms = substantive.length ? substantive : allTerms;
  const names = [node.name, ...node.aliases];
  const titleTokens = new Set(names.flatMap((name) => tokens(name).map((token) => token.term)));
  const original = tokens(node.text);
  const directTokens = new Set(original.map((token) => token.term));
  const summaryTokens = new Set(tokens(node.summary ?? '').map((token) => token.term));
  const titleTerms = terms.filter((term) => titleTokens.has(term));
  const matchedTerms = terms.filter((term) => titleTokens.has(term) || directTokens.has(term));
  const derived = matchedTerms.length === 0;
  const relevantTerms = derived ? terms.filter((term) => summaryTokens.has(term)) : matchedTerms;
  const exactTitle = names.some((name) => name.trim().toLowerCase() === query.trim().toLowerCase());
  const score =
    relevantTerms.length === 0
      ? -1
      : (exactTitle ? SEARCH_WEIGHT.exactTitle : 0) +
        (derived ? 0 : SEARCH_WEIGHT.original) +
        titleTerms.length * SEARCH_WEIGHT.titleTerm +
        relevantTerms.length * SEARCH_WEIGHT.term -
        (node.structural || !node.text.length ? SEARCH_WEIGHT.unreadable : 0);
  return {
    rank: -score,
    found: score >= 0,
    derived,
    matchedTerms: relevantTerms,
    exactTitle,
    match: original.find((token) => matchedTerms.includes(token.term))?.offset ?? 0,
  };
}
