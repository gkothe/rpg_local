import { ruleReadCoverage, type RuleOriginalRead } from '../domain/ruleReadCoverage.js';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { Problem } from '../errors.js';
import {
  compareRuleMatches,
  rankRuleNode,
  ruleCorpusTerms,
  ruleTokens,
  ruleQueryTerms,
  RULE_SEARCH_SNIPPET_CHARS,
} from '../domain/ruleSearch.js';
import {
  RULE_COLUMNS,
  RULE_LIMITS,
  serializedBytes,
  ruleSlugSchema,
  type RuleSystem,
  type RuleNode,
  type RuleTool,
} from '../domain/rules.js';

const token = z
  .string()
  .min(1)
  .max(RULE_LIMITS.tokenChars)
  .regex(/^[A-Za-z0-9_-]+$/);
const pathSchema = z.string().min(1).max(RULE_LIMITS.pathChars);
const filter = z
  .object({
    field: ruleSlugSchema,
    op: z.enum(['eq', 'gte', 'lte']),
    value: z.union([z.string(), z.number().finite(), z.boolean()]),
  })
  .strict();
export const ruleToolSchemas = {
  rules_map: z
    .object({ column: z.enum(RULE_COLUMNS).optional(), cursor: token.optional() })
    .strict(),
  rules_search: z
    .object({
      query: z
        .string()
        .trim()
        .min(1)
        .max(RULE_LIMITS.queryChars)
        .refine((query) => query.split(/\s+/).length <= RULE_LIMITS.queryTerms),
      columns: z.array(z.enum(RULE_COLUMNS)).min(1).max(RULE_COLUMNS.length).optional(),
      source: ruleSlugSchema.optional(),
      cursor: token.optional(),
    })
    .strict(),
  rules_get: z
    .object({
      path: pathSchema,
      view: z.enum(['text', 'fields']).default('text'),
      cursor: token.optional(),
      locator: token.optional(),
    })
    .strict()
    .refine(
      (input) => !(input.cursor && input.locator),
      'Cursor and locator are mutually exclusive'
    ),
  rules_list: z
    .object({ path: pathSchema, filter: filter.optional(), cursor: token.optional() })
    .strict(),
} as const;
type Position = {
  systemId: string;
  revision: number;
  hash: string;
  argumentHash: string;
  offset: number;
  locator: boolean;
};
const MAX_LOOKUP_TOKENS = 4096;
type SearchHit = { path: string; node: RuleNode } & ReturnType<typeof rankRuleNode>;
// Only immutable, bounded Store snapshots enter this cache. Cursor/receipt creation stays fresh.
const searchCaches = new WeakMap<RuleSystem, Map<string, SearchHit[]>>();
const MAX_SEARCH_CACHE_QUERIES = 8;
const MAX_SEARCH_CACHE_HITS = 4096;
const immutableSystems = new WeakSet<RuleSystem>();
const corpusCaches = new WeakMap<
  RuleSystem,
  Map<
    string,
    {
      candidates: { path: string; node: RuleNode; index: ReturnType<typeof ruleTokens> }[];
      weights: Map<string, number>;
    }
  >
>();
const MAX_CORPUS_CACHE_FILTERS = 8;
function immutableSnapshot(system: RuleSystem): boolean {
  if (immutableSystems.has(system)) return true;
  function frozen(value: unknown): boolean {
    if (!value || typeof value !== 'object') return true;
    return Object.isFrozen(value) && Object.values(value).every(frozen);
  }
  if (!frozen(system)) return false;
  immutableSystems.add(system);
  return true;
}
function corpus(
  system: RuleSystem,
  columns: readonly string[] | undefined,
  source: string | undefined,
  immutable: boolean,
  query: string
) {
  const key = JSON.stringify({ columns: columns ? [...columns].sort() : null, source });
  let cache = immutable ? corpusCaches.get(system) : undefined;
  const old = cache?.get(key);
  if (old) return old;
  const queryTerms = ruleQueryTerms(query);
  const selected = new Set(queryTerms);
  const candidates = nodes(system)
    .filter(
      ({ path, node }) =>
        (!columns || columns.includes(path.split('.')[0]!)) && (!source || node.source === source)
    )
    .map((candidate) => ({
      ...candidate,
      index: ruleTokens(candidate.node, immutable ? undefined : selected),
    }));
  const frequencies = new Map<string, number>();
  for (const { node, index } of candidates) {
    const terms = immutable
      ? ruleCorpusTerms(node, index)
      : queryTerms.filter(
          (term) =>
            index.titleTokens.has(term) ||
            index.directTokens.has(term) ||
            index.summaryTokens.has(term)
        );
    for (const term of terms) frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
  }
  const weights = new Map(
    [...frequencies].map(([term, count]) => [
      term,
      1 + Math.log((candidates.length + 1) / (count + 1)),
    ])
  );
  const result = { candidates, weights };
  if (immutable) {
    if (!cache) {
      cache = new Map();
      corpusCaches.set(system, cache);
    }
    if (cache.size >= MAX_CORPUS_CACHE_FILTERS) cache.delete(cache.keys().next().value!);
    cache.set(key, result);
  }
  return result;
}

function digest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export function ruleNodeAt(system: RuleSystem, path: string): RuleNode {
  const parts = path.split('.');
  if (!(RULE_COLUMNS as readonly string[]).includes(parts[0]!) || parts.length < 2)
    throw new Problem(
      422,
      'rules_path_invalid',
      'Invalid rule path. Copy the exact dotted path returned by rules_find, rules_search, rules_map or rules_list; do not invent slash-separated paths.'
    );
  let value: unknown = system[parts[0] as keyof RuleSystem];
  for (let index = 1; index < parts.length; index++) {
    const part = parts[index]!;
    if (index > 2 && index % 2 === 1) {
      if (part !== 'children')
        throw new Problem(422, 'rules_path_invalid', 'Invalid child separator');
    } else if (!ruleSlugSchema.safeParse(part).success)
      throw new Problem(422, 'rules_path_invalid', 'Invalid content key');
    if (index === 2 && value && typeof value === 'object' && Object.hasOwn(value, 'children'))
      value = (value as RuleNode).children;
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, part))
      throw new Problem(404, 'rules_node_missing', 'Rule node not found');
    value = (value as Record<string, unknown>)[part];
  }
  if (!value || typeof value !== 'object' || !Object.hasOwn(value, 'text'))
    throw new Problem(422, 'rules_path_invalid', 'Path must select one node');
  return value as RuleNode;
}
function nodes(system: RuleSystem): { path: string; node: RuleNode }[] {
  const output: { path: string; node: RuleNode }[] = [];
  function visit(path: string, node: RuleNode) {
    output.push({ path, node });
    for (const [key, child] of Object.entries(node.children))
      visit(`${path}.children.${key}`, child);
  }
  for (const column of RULE_COLUMNS)
    for (const [key, root] of Object.entries(system[column])) {
      output.push({ path: `${column}.${key}`, node: root });
      for (const [childKey, child] of Object.entries(root.children))
        visit(`${column}.${key}.${childKey}`, child);
    }
  return output;
}
export function ruleWindowPages(node: RuleNode, start: number, end: number) {
  const spans = (node.pageSpans ?? []).filter((span) => span.start < end && span.end > start);
  let covered = start;
  for (const span of spans) {
    if (span.start > covered || span.pdfPage === null) break;
    covered = Math.max(covered, span.end);
  }
  if (covered >= end && end > start)
    return {
      precision: 'exact',
      pdfPages: [...new Set(spans.map((span) => span.pdfPage))],
      printedPages: [...new Set(spans.map((span) => span.printedPage))],
    };
  return {
    precision: node.pdfPages.length ? 'approximate' : 'unknown',
    pdfPages: node.pdfPages,
    printedPages: node.printedPages,
  };
}
export class RuleLookup {
  private readonly positions = new Map<string, Position>();
  private issue(system: RuleSystem, argumentHash: string, offset: number, locator = false): string {
    const key = randomBytes(24).toString('base64url');
    this.positions.set(key, {
      systemId: system.systemId,
      revision: system.revision,
      hash: system.contentHash,
      argumentHash,
      offset,
      locator,
    });
    if (this.positions.size > MAX_LOOKUP_TOKENS)
      this.positions.delete(this.positions.keys().next().value!);
    return key;
  }
  /** Authenticated persisted searches may rehydrate their original opaque locator keys. */
  restoreSearch(system: RuleSystem, payload: Record<string, unknown>): void {
    if (payload.error || !Array.isArray(payload.entries)) return;
    if (payload.contentHash !== system.contentHash)
      throw new Problem(409, 'rules_context_changed', 'Rule content changed; restart this lookup');
    for (const entry of payload.entries) {
      if (!entry?.locator || !entry.matchWindow) continue; // Legacy metadata cannot establish an offset.
      const window = entry.matchWindow;
      const node = ruleNodeAt(system, entry.path);
      if (
        !token.safeParse(entry.locator).success ||
        !Number.isInteger(window.start) ||
        !Number.isInteger(window.end) ||
        window.start < 0 ||
        window.end <= window.start ||
        window.end > node.text.length ||
        node.structural ||
        entry.derived ||
        entry.source !== node.source ||
        entry.snippet !== node.text.slice(window.start, window.end) ||
        /[\uDC00-\uDFFF]/.test(node.text[window.start]!) ||
        (window.end < node.text.length && /[\uD800-\uDBFF]/.test(node.text[window.end - 1]!))
      )
        throw new Problem(
          422,
          'rules_locator_invalid',
          'Saved search locator does not match original text'
        );
      this.positions.set(entry.locator, {
        systemId: system.systemId,
        revision: system.revision,
        hash: system.contentHash,
        argumentHash: digest({ tool: 'rules_get', path: entry.path, view: 'text' }),
        offset: window.start,
        locator: true,
      });
      if (this.positions.size > MAX_LOOKUP_TOKENS)
        this.positions.delete(this.positions.keys().next().value!);
    }
  }
  private offset(
    system: RuleSystem,
    key: string | undefined,
    argumentHash: string,
    locator = false
  ): number {
    if (!key) return 0;
    const position = this.positions.get(key);
    if (!position)
      throw new Problem(409, 'cursor_expired', 'Paging token expired; restart this lookup');
    if (position.systemId !== system.systemId)
      throw new Problem(409, 'rules_context_changed', 'Rule system changed; restart this lookup');
    if (position.hash !== system.contentHash)
      throw new Problem(409, 'rules_context_changed', 'Rule content changed; restart this lookup');
    if (position.argumentHash !== argumentHash || position.locator !== locator)
      throw new Problem(422, 'rules_cursor_invalid', 'Token does not match this lookup');
    return position.offset;
  }
  execute(
    system: RuleSystem,
    tool: RuleTool,
    raw: unknown,
    receiptId: string,
    allowance: number = RULE_LIMITS.resultBytes,
    suppliedEvidence?: readonly RuleOriginalRead[]
  ): Record<string, unknown> {
    if (serializedBytes(raw) > RULE_LIMITS.requestBytes)
      throw new Problem(422, 'rules_request_limit', 'Rule request byte limit exceeded');
    const input = ruleToolSchemas[tool].parse(raw);
    const { cursor, ...withoutCursor } = input;
    const normalized = { ...withoutCursor } as Record<string, unknown>;
    delete normalized.locator;
    const argumentHash = digest({ tool, ...normalized });
    const budget = Math.min(allowance, RULE_LIMITS.resultBytes);
    const envelope = {
      ...(tool === 'rules_search' && suppliedEvidence !== undefined
        ? { suppliedEvidenceCaptured: true }
        : {}),
      revision: system.revision,
      contentHash: system.contentHash,
      receipt: receiptId,
      complete: true,
      omitted: false,
      cursor: null as string | null,
    };
    if (tool === 'rules_get') {
      const args = ruleToolSchemas.rules_get.parse(input);
      const node = ruleNodeAt(system, args.path);
      const text = args.view === 'fields' ? JSON.stringify(node.fields ?? {}) : node.text;
      const hash = digest({ tool, path: args.path, view: args.view });
      const start = this.offset(system, args.cursor ?? args.locator, hash, !!args.locator);
      const result = {
        ...envelope,
        path: args.path,
        source: node.source,
        view: args.view,
        structural: node.structural ?? false,
        start,
        end: start,
        text: '',
        pages: ruleWindowPages(node, start, start),
        pageSpans: [] as unknown[],
      };
      let low = start;
      let high = text.length;
      while (low < high) {
        const end = Math.ceil((low + high) / 2);
        const candidate = {
          ...result,
          text: text.slice(start, end),
          end,
          complete: end === text.length,
          omitted: end < text.length,
          cursor: end < text.length ? 'x'.repeat(32) : null,
          pages: ruleWindowPages(node, start, end),
          pageSpans: (node.pageSpans ?? []).filter((span) => span.start < end && span.end > start),
        };
        if (serializedBytes(candidate) <= budget) low = end;
        else high = end - 1;
      }
      let end = low;
      if (end < text.length && end > start && /[\uD800-\uDBFF]/.test(text[end - 1]!)) end--;
      if (end === start && start < text.length)
        throw new Problem(
          422,
          'rules_budget_exhausted',
          'Remaining rule budget cannot fit original text'
        );
      Object.assign(result, {
        end,
        text: text.slice(start, end),
        complete: end === text.length,
        omitted: end < text.length,
        cursor: end < text.length ? this.issue(system, hash, end) : null,
        pages: args.view === 'text' ? ruleWindowPages(node, start, end) : null,
        pageSpans:
          args.view === 'text'
            ? (node.pageSpans ?? []).filter((span) => span.start < end && span.end > start)
            : [],
      });
      if (serializedBytes(result) > budget)
        throw new Problem(
          422,
          'rules_budget_exhausted',
          'Remaining rule budget cannot fit metadata'
        );
      return result;
    }
    let entries: Record<string, unknown>[];
    const locatorOffsets = new Map<string, number>();
    let cap: number = RULE_LIMITS.childDescriptors;
    if (tool === 'rules_map') {
      const args = ruleToolSchemas.rules_map.parse(input);
      entries = Object.entries(system.mapping).flatMap(([key, value]) => {
        if (key === 'columns' && Array.isArray(value))
          return value
            .filter((entry) => !args.column || entry.column === args.column)
            .map((entry) => ({ key: 'column', value: entry }));
        return [{ key, value }];
      });
    } else if (tool === 'rules_list') {
      const args = ruleToolSchemas.rules_list.parse(input);
      if (args.filter && args.filter.op !== 'eq' && typeof args.filter.value !== 'number')
        throw new Problem(422, 'rules_filter_invalid', 'Range filters require numeric values');
      const parent = ruleNodeAt(system, args.path);
      entries = Object.entries(parent.children)
        .filter(([, node]) => {
          if (!args.filter) return true;
          const actual = node.fields?.[args.filter.field];
          if (
            typeof actual !== typeof args.filter.value ||
            actual === null ||
            typeof actual === 'object'
          )
            return false;
          if (args.filter.op === 'eq') return actual === args.filter.value;
          if (typeof actual !== 'number' || typeof args.filter.value !== 'number')
            throw new Problem(422, 'rules_filter_invalid', 'Range filters require numeric values');
          return args.filter.op === 'gte'
            ? actual >= args.filter.value
            : actual <= args.filter.value;
        })
        .map(([key, node]) => ({
          path: `${args.path}${args.path.split('.').length === 2 ? '.' : '.children.'}${key}`,
          name: node.name,
          source: node.source,
          review: node.review,
          pages: ruleWindowPages(node, 0, node.text.length),
        }));
    } else {
      const args = ruleToolSchemas.rules_search.parse(input);
      cap = RULE_LIMITS.searchHits;
      const immutable = immutableSnapshot(system);
      let cache = immutable ? searchCaches.get(system) : undefined;
      if (immutable && !cache) {
        cache = new Map();
        searchCaches.set(system, cache);
      }
      let hits = cache?.get(argumentHash);
      if (!hits) {
        const { candidates, weights } = corpus(
          system,
          args.columns,
          args.source,
          immutable,
          args.query
        );
        hits = candidates
          .map(({ path, node, index }) => ({
            path,
            node,
            ...rankRuleNode(node, args.query, weights, index),
          }))
          .filter((hit) => hit.found)
          .sort(
            (a, b) =>
              compareRuleMatches(a, b) ||
              a.node.source.localeCompare(b.node.source) ||
              a.path.localeCompare(b.path)
          );
        if (cache && hits.length <= MAX_SEARCH_CACHE_HITS) {
          while (
            cache.size >= MAX_SEARCH_CACHE_QUERIES ||
            [...cache.values()].reduce((sum, entries) => sum + entries.length, 0) + hits.length >
              MAX_SEARCH_CACHE_HITS
          )
            cache.delete(cache.keys().next().value!);
          cache.set(argumentHash, hits);
        }
      }
      entries = hits.map(
        ({ path, node, derived, matchedTerms, exactTitle, snippetStart, matchQuality }) => {
          let start = snippetStart;
          if (start && /[\uDC00-\uDFFF]/.test(node.text[start]!)) start--;
          locatorOffsets.set(path, start);
          let end = Math.min(node.text.length, start + RULE_SEARCH_SNIPPET_CHARS);
          if (end < node.text.length && /[\uD800-\uDBFF]/.test(node.text[end - 1]!)) end--;
          return {
            path,
            name: node.name,
            source: node.source,
            review: node.review,
            derived,
            matchedTerms,
            exactTitle,
            matchQuality,
            ...(!derived && !node.structural && node.text.length
              ? { matchWindow: { start, end } }
              : {}),
            readableOriginal: !node.structural && node.text.length > 0,
            snippet: derived ? (node.summary ?? '').slice(0, 120) : node.text.slice(start, end),
            locator: !derived && !node.structural && node.text.length ? 'x'.repeat(32) : null,
            pages: ruleWindowPages(node, start, end),
          };
        }
      );
    }
    if (tool === 'rules_search' && suppliedEvidence !== undefined)
      entries = entries.map((entry) => {
        const coverage = ruleReadCoverage(
          entry,
          system.revision,
          system.contentHash,
          suppliedEvidence
        );
        if (!coverage.alreadySupplied) return entry;
        const annotated = { ...entry, ...coverage };
        return serializedBytes({
          ...envelope,
          entries: [annotated],
          complete: false,
          omitted: true,
          cursor: 'x'.repeat(32),
        }) <= budget
          ? annotated
          : entry;
      });
    const start = this.offset(system, cursor, argumentHash);
    const result = { ...envelope, entries: [] as Record<string, unknown>[] };
    let index = start;
    while (index < entries.length && result.entries.length < cap) {
      const candidate = {
        ...result,
        entries: [...result.entries, entries[index]!],
        complete: index + 1 === entries.length,
        omitted: index + 1 < entries.length,
        cursor: index + 1 < entries.length ? 'x'.repeat(32) : null,
      };
      if (serializedBytes(candidate) > budget) break;
      const entry = entries[index++]!;
      result.entries.push(
        entry.locator && typeof entry.path === 'string'
          ? {
              ...entry,
              locator: this.issue(
                system,
                digest({ tool: 'rules_get', path: entry.path, view: 'text' }),
                locatorOffsets.get(entry.path)!,
                true
              ),
            }
          : entry
      );
    }
    if (index === start && index < entries.length)
      throw new Problem(
        422,
        'rules_budget_exhausted',
        'Remaining budget cannot fit one descriptor'
      );
    Object.assign(result, {
      complete: index === entries.length,
      omitted: index < entries.length,
      cursor: index < entries.length ? this.issue(system, argumentHash, index) : null,
    });
    if (serializedBytes(result) > budget)
      throw new Problem(422, 'rules_budget_exhausted', 'Remaining budget cannot fit metadata');
    return result;
  }
}
