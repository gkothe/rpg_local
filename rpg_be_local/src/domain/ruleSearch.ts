import type { RuleMatchQuality, RuleNode } from './rules.js';

export const RULE_SEARCH_SNIPPET_CHARS = 160;
const RULE_SEARCH_FEATURE_BONUS = 0.25;
const WAKE_WORDS = new Set(['wake', 'waking', 'awaken', 'awakening']);

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
    return normalize(folded.slice(0, -1));
  return WAKE_WORDS.has(folded) ? 'wake' : folded;
}
function tokens(text: string, selected?: ReadonlySet<string>) {
  const result: { term: string; offset: number; end: number; position: number }[] = [];
  let position = 0;
  for (const match of text.matchAll(/[\p{L}\p{N}]+/gu)) {
    const term = normalize(match[0]);
    if (!selected || selected.has(term))
      result.push({ term, offset: match.index, end: match.index + match[0].length, position });
    position++;
  }
  return result;
}
export function ruleQueryTerms(query: string): string[] {
  return [...new Set(tokens(query).map((token) => token.term))];
}

function tokenizeRule(node: RuleNode, selected?: ReadonlySet<string>) {
  const original = tokens(node.text, selected);
  const names = [node.name, ...node.aliases].map((name) => tokens(name));
  return {
    original,
    names,
    titleTokens: new Set(names.flatMap((name) => name.map((token) => token.term))),
    directTokens: new Set(original.map((token) => token.term)),
    summaryTokens: new Set(tokens(node.summary ?? '').map((token) => token.term)),
  };
}

// Frozen library nodes belong to the current content cache; replacement nodes get new indexes.
const tokenIndexes = new WeakMap<RuleNode, ReturnType<typeof tokenizeRule>>();
/** Mutable lookups keep only query occurrences, with positions to preserve phrase adjacency. */
export function ruleTokens(node: RuleNode, selected?: ReadonlySet<string>) {
  const immutable = Object.isFrozen(node) && Object.isFrozen(node.aliases);
  const cached = immutable ? tokenIndexes.get(node) : undefined;
  if (cached) return cached;
  const index = tokenizeRule(node, immutable ? undefined : selected);
  if (immutable) tokenIndexes.set(node, index);
  return index;
}

function denseSnippetStart(
  original: ReturnType<typeof tokens>,
  terms: ReadonlySet<string>,
  weights: ReadonlyMap<string, number>
) {
  const matches = original.filter((token) => terms.has(token.term));
  const counts = new Map<string, number>();
  let left = 0;
  let bestCoverage = 0;
  let bestWeight = 0;
  let coveredWeight = 0;
  let bestSpan = Infinity;
  let bestStart = 0;
  const removeLeft = () => {
    const term = matches[left++]!.term;
    const count = counts.get(term)! - 1;
    if (count) counts.set(term, count);
    else {
      counts.delete(term);
      coveredWeight -= weights.get(term) ?? 1;
    }
  };
  for (const [right, token] of matches.entries()) {
    if (!counts.has(token.term)) coveredWeight += weights.get(token.term) ?? 1;
    counts.set(token.term, (counts.get(token.term) ?? 0) + 1);
    while (left <= right && token.end - matches[left]!.offset > RULE_SEARCH_SNIPPET_CHARS)
      removeLeft();
    // Discard redundant leading occurrences to measure the shortest covering span.
    while (left < right && counts.get(matches[left]!.term)! > 1) removeLeft();
    if (left > right) continue;
    const start = matches[left]!.offset;
    const span = token.end - start;
    if (
      coveredWeight > bestWeight ||
      (coveredWeight === bestWeight &&
        (counts.size > bestCoverage || (counts.size === bestCoverage && span < bestSpan)))
    ) {
      bestWeight = coveredWeight;
      bestCoverage = counts.size;
      bestSpan = span;
      bestStart = start;
    }
  }
  if (!bestCoverage) return Math.max(0, (matches[0]?.offset ?? 0) - RULE_SEARCH_SNIPPET_CHARS / 2);
  return Math.max(0, bestStart - Math.floor((RULE_SEARCH_SNIPPET_CHARS - bestSpan) / 2));
}
/** One document occurrence per canonical group, shared by ranking and filtered corpus statistics. */
export function ruleCorpusTerms(node: RuleNode, index = ruleTokens(node)): ReadonlySet<string> {
  return new Set([...index.titleTokens, ...index.directTokens, ...index.summaryTokens]);
}

function phraseTerms(source: ReturnType<typeof tokens>, query: readonly string[]): string[] {
  let best: string[] = [];
  for (let i = 0; i < source.length; i++) {
    for (let q = 0; q < query.length - 1; q++) {
      if (source[i]!.term !== query[q]) continue;
      let length = 1;
      while (
        q + length < query.length &&
        source[i + length]?.term === query[q + length] &&
        source[i + length]!.position === source[i]!.position + length
      )
        length++;
      if (length > best.length && length > 1) best = query.slice(q, q + length);
    }
  }
  return best;
}

export function rankRuleNode(
  node: RuleNode,
  query: string,
  weights: ReadonlyMap<string, number> = new Map(),
  index = ruleTokens(node)
) {
  const sequence = tokens(query).map((token) => token.term);
  const allTerms = [...new Set(sequence)];
  const substantive = allTerms.filter((term) => !NAVIGATION_WORDS.has(term));
  const terms = substantive.length ? substantive : allTerms;
  const names = [node.name, ...node.aliases];
  const { original, titleTokens, directTokens, summaryTokens } = index;
  const titleTerms = terms.filter((term) => titleTokens.has(term));
  const matchedTerms = terms.filter((term) => titleTokens.has(term) || directTokens.has(term));
  const derived = matchedTerms.length === 0;
  const relevantTerms = derived ? terms.filter((term) => summaryTokens.has(term)) : matchedTerms;
  const exactTitle = names.some((name) => name.trim().toLowerCase() === query.trim().toLowerCase());
  if (!relevantTerms.length)
    return {
      found: false,
      derived,
      matchedTerms: relevantTerms,
      exactTitle,
      titleTermCount: titleTerms.length,
      readableOriginal: !node.structural && node.text.length > 0,
      snippetStart: 0,
      score: 0,
      matchQuality: 'partial' as RuleMatchQuality,
    };
  let snippetStart = denseSnippetStart(original, new Set(matchedTerms), weights);
  if (snippetStart && /[\uDC00-\uDFFF]/.test(node.text[snippetStart]!)) snippetStart--;
  let snippetEnd = Math.min(node.text.length, snippetStart + RULE_SEARCH_SNIPPET_CHARS);
  if (snippetEnd < node.text.length && /[\uD800-\uDBFF]/.test(node.text[snippetEnd - 1]!))
    snippetEnd--;
  const windowTerms = new Set(
    original
      .filter((token) => token.offset >= snippetStart && token.end <= snippetEnd)
      .map((token) => token.term)
  );
  const coveredWindow = matchedTerms.filter((term) => windowTerms.has(term));
  const weight = (covered: readonly string[]) =>
    [...new Set(covered)].reduce((sum, term) => sum + (weights.get(term) ?? 1), 0);
  const phraseSources = derived ? [tokens(node.summary ?? '')] : [original, ...index.names];
  const quoted = [...query.matchAll(/"([^"\n]+)"/g)].map((match) =>
    tokens(match[1]!).map((token) => token.term)
  );
  const phrases = quoted.length ? quoted : [sequence];
  let phraseWeight = 0;
  for (const source of phraseSources)
    for (const phrase of phrases) {
      const present = phraseTerms(source, phrase);
      // A quoted phrase receives its bonus only when the entire phrase is contiguous.
      if (!quoted.length || present.length === phrase.length)
        phraseWeight = Math.max(
          phraseWeight,
          weight(present.filter((term) => terms.includes(term)))
        );
    }
  const score =
    weight(relevantTerms) +
    RULE_SEARCH_FEATURE_BONUS * (weight(titleTerms) + weight(coveredWindow) + phraseWeight);
  const matchQuality: RuleMatchQuality = exactTitle
    ? 'exact'
    : !derived && (titleTerms.length === terms.length || coveredWindow.length === terms.length)
      ? 'strong'
      : 'partial';
  return {
    found: relevantTerms.length > 0,
    derived,
    matchedTerms: relevantTerms,
    exactTitle,
    titleTermCount: titleTerms.length,
    readableOriginal: !node.structural && node.text.length > 0,
    snippetStart,
    score,
    matchQuality,
  };
}

export function compareRuleMatches(
  a: ReturnType<typeof rankRuleNode>,
  b: ReturnType<typeof rankRuleNode>
) {
  return (
    Number(b.exactTitle) - Number(a.exactTitle) ||
    Number(a.derived) - Number(b.derived) ||
    b.score - a.score ||
    b.matchedTerms.length - a.matchedTerms.length ||
    b.titleTermCount - a.titleTermCount ||
    Number(b.readableOriginal) - Number(a.readableOriginal)
  );
}
