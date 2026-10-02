import { createHash } from 'node:crypto';
import { z } from 'zod';
import { RULE_BOOK_PACKAGE_VERSION } from './versions.js';

export enum RuleSystemKind {
  Library = 'library',
  ModelKnowledge = 'model_knowledge',
}
export enum RuleReview {
  Extracted = 'extracted',
  Verified = 'verified',
}
export const RULE_COLUMNS = [
  'core_rules',
  'lore',
  'archetypes',
  'abilities',
  'traits',
  'items',
  'creatures',
  'procedures',
  'glossary',
  'gm_guidance',
  'others',
] as const;
export type RuleColumn = (typeof RULE_COLUMNS)[number];
export const RULE_LIMITS = {
  slugChars: 80,
  nameChars: 200,
  converterChars: 120,
  instructionsBytes: 8192,
  summaryBytes: 1024,
  aliases: 20,
  aliasChars: 120,
  books: 20,
  nodes: 10000,
  systemBytes: 20 * 1024 * 1024,
  pagesPerBook: 2000,
  textBytes: 512 * 1024,
  enrichmentBytes: 16 * 1024,
  fieldDepth: 4,
  arrayElements: 1000,
  pathChars: 512,
  contentDepth: 12,
  importFiles: 12,
  importFileBytes: 10 * 1024 * 1024,
  importBytes: 20 * 1024 * 1024,
  previewTtlMs: 30 * 60 * 1000,
  previewsPerSystem: 2,
  previewsPerServer: 8,
  backupBytes: 32 * 1024 * 1024,
  stagedBytes: 256 * 1024 * 1024,
  validationDeadlineMs: 30000,
  mappingBytes: 32 * 1024,
  mappingFieldsPerColumn: 40,
  mappingFieldBytesPerColumn: 512,
  overviewBytes: 1024,
  requestBytes: 1024,
  tokenChars: 192,
  queryChars: 240,
  queryTerms: 12,
  searchHits: 10,
  childDescriptors: 20,
  resultBytes: 4096,
  transcriptBytes: 8192,
  calls: 12,
  combinedCalls: 36,
  gameplayDeadlineMs: 180000,
  outputBytes: 2000000,
  citationChars: 600,
  historicalResponseBytes: 16 * 1024,
} as const;
export const DEFAULT_RULE_SYSTEM_KEY = 'model-knowledge';
export const RULE_TOOLS = ['rules_map', 'rules_search', 'rules_get', 'rules_list'] as const;
export type RuleTool = (typeof RULE_TOOLS)[number];
export const DEFAULT_RULE_SYSTEM_ID = '00000000-0000-4000-8000-000000000001';
export const DEFAULT_RULE_INSTRUCTIONS =
  'Use campaign memory and model knowledge. Clearly label provisional rules. Request real dice through the owned dice tool.';
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype', 'children']);
export const ruleSlugSchema = z
  .string()
  .max(RULE_LIMITS.slugChars)
  .regex(/^[a-z0-9][a-z0-9_-]*$/)
  .refine((key) => !RESERVED_KEYS.has(key), 'Reserved content key');
export const ruleHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const serializedBytes = (value: unknown): number =>
  Buffer.byteLength(JSON.stringify(value), 'utf8');
const byteString = (bytes: number) =>
  z.string().refine((s) => Buffer.byteLength(s, 'utf8') <= bytes, 'UTF-8 byte limit exceeded');
const page = z.number().int().min(1).max(RULE_LIMITS.pagesPerBook);
export const rulePageSpanSchema = z
  .object({
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    pdfPage: page.nullable(),
    printedPage: z.string().max(RULE_LIMITS.aliasChars).nullable(),
  })
  .strict();
export const ruleFieldEvidenceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('text'),
      quote: z.string(),
      start: z.number().int().nonnegative(),
      end: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('visual'),
      pdfPage: page,
      reviewNote: z.string().min(1).max(RULE_LIMITS.nameChars),
      manual: z.literal(true),
    })
    .strict(),
]);
export type RulePageSpan = z.infer<typeof rulePageSpanSchema>;
export type RuleFieldEvidence = z.infer<typeof ruleFieldEvidenceSchema>;
export type RuleNode = {
  name: string;
  aliases: string[];
  source: string;
  text: string;
  summary?: string;
  fields?: Record<string, unknown>;
  fieldEvidence?: Record<string, RuleFieldEvidence>;
  review: RuleReview;
  pdfPages: number[];
  printedPages: string[];
  pageSpans?: RulePageSpan[];
  structural?: boolean;
  children: Record<string, RuleNode>;
};
function boundedFields(value: unknown, depth = 0): boolean {
  if (depth > RULE_LIMITS.fieldDepth) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value))
    return (
      value.length <= RULE_LIMITS.arrayElements && value.every((v) => boundedFields(v, depth + 1))
    );
  return (
    typeof value === 'object' &&
    Object.entries(value).every(([k, v]) => !RESERVED_KEYS.has(k) && boundedFields(v, depth + 1))
  );
}
export const ruleNodeSchema: z.ZodType<RuleNode> = z.lazy(() =>
  z
    .object({
      name: z.string().min(1).max(RULE_LIMITS.nameChars),
      aliases: z
        .array(z.string().min(1).max(RULE_LIMITS.aliasChars))
        .max(RULE_LIMITS.aliases)
        .default([]),
      source: ruleSlugSchema,
      text: byteString(RULE_LIMITS.textBytes),
      summary: byteString(RULE_LIMITS.summaryBytes).optional(),
      fields: z
        .record(z.string(), z.unknown())
        .refine(boundedFields, 'Invalid or deeply nested fields')
        .optional(),
      fieldEvidence: z.record(z.string(), ruleFieldEvidenceSchema).optional(),
      review: z.enum(RuleReview).default(RuleReview.Extracted),
      pdfPages: z.array(page).max(RULE_LIMITS.pagesPerBook).default([]),
      printedPages: z
        .array(z.string().max(RULE_LIMITS.aliasChars))
        .max(RULE_LIMITS.pagesPerBook)
        .default([]),
      pageSpans: z.array(rulePageSpanSchema).optional(),
      structural: z.boolean().optional(),
      children: z.record(ruleSlugSchema, ruleNodeSchema).default({}),
    })
    .strict()
    .superRefine((node, ctx) => {
      const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
      if (node.structural && node.text.length)
        fail('Structural nodes cannot contain original text');
      if (
        serializedBytes({ fields: node.fields, fieldEvidence: node.fieldEvidence }) >
        RULE_LIMITS.enrichmentBytes
      )
        fail('Enrichment byte limit exceeded');
      let previousEnd = 0;
      for (const span of node.pageSpans ?? []) {
        if (span.start < previousEnd || span.end <= span.start || span.end > node.text.length)
          fail('Invalid or overlapping direct-text page span');
        previousEnd = span.end;
      }
      for (const [key, evidence] of Object.entries(node.fieldEvidence ?? {})) {
        if (RESERVED_KEYS.has(key) || !Object.hasOwn(node.fields ?? {}, key))
          fail('Evidence must identify an own field');
        if (
          evidence.kind === 'text' &&
          (evidence.end <= evidence.start ||
            evidence.end > node.text.length ||
            node.text.slice(evidence.start, evidence.end) !== evidence.quote)
        )
          fail('Evidence quote must match direct original text at UTF-16 offsets');
      }
    })
);
export const ruleSourceSchema = z
  .object({
    slug: ruleSlugSchema,
    title: z.string().min(1).max(RULE_LIMITS.nameChars),
    pageCount: page,
    edition: z.string().max(RULE_LIMITS.nameChars).optional(),
    publication: z.string().max(RULE_LIMITS.nameChars).optional(),
    pdfHash: ruleHashSchema.nullable(),
  })
  .strict();
export type RuleSource = z.infer<typeof ruleSourceSchema>;
export const ruleBookManifestSchema = z
  .object({
    format: z.literal('rules-book'),
    version: z.literal(RULE_BOOK_PACKAGE_VERSION),
    source: ruleSourceSchema,
    columns: z
      .array(
        z
          .object({
            column: z.enum(RULE_COLUMNS),
            file: z.string().regex(/^[a-z_]+\.md$/),
            hash: ruleHashSchema,
          })
          .strict()
      )
      .min(1)
      .max(RULE_COLUMNS.length),
    converter: z
      .object({
        id: z.string().min(1).max(RULE_LIMITS.converterChars),
        version: z.string().min(1).max(RULE_LIMITS.converterChars),
      })
      .strict(),
    markerFormatVersion: z.literal(1),
    coverage: z
      .object({
        description: z.string().min(1).max(RULE_LIMITS.nameChars),
        omissions: z.array(z.string().max(RULE_LIMITS.nameChars)).max(RULE_LIMITS.arrayElements),
      })
      .strict(),
    enrichment: z
      .record(
        z.string(),
        z
          .object({
            summary: byteString(RULE_LIMITS.summaryBytes).optional(),
            fields: z.record(z.string(), z.unknown()).refine(boundedFields).optional(),
            fieldEvidence: z.record(z.string(), ruleFieldEvidenceSchema).optional(),
            review: z.enum(RuleReview).optional(),
          })
          .strict()
      )
      .optional(),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const columns = new Set<string>();
    const files = new Set<string>();
    for (const entry of manifest.columns) {
      if (columns.has(entry.column) || files.has(entry.file) || entry.file !== `${entry.column}.md`)
        ctx.addIssue({ code: 'custom', message: 'Duplicate or mismatched column filename' });
      columns.add(entry.column);
      files.add(entry.file);
    }
  });
export type RuleBookManifest = z.infer<typeof ruleBookManifestSchema>;
export type RuleColumns = Record<RuleColumn, Record<string, RuleNode>>;
export type RuleContent = RuleColumns & {
  instructions: string;
  sources: RuleSource[];
  mapping: Record<string, unknown>;
};
export function emptyRuleColumns(): RuleColumns {
  return Object.fromEntries(RULE_COLUMNS.map((column) => [column, {}])) as RuleColumns;
}
export function canonicalRuleJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalRuleJson).join(',') + ']';
  return (
    '{' +
    Object.keys(value)
      .sort()
      .map(
        (key) =>
          JSON.stringify(key) + ':' + canonicalRuleJson((value as Record<string, unknown>)[key])
      )
      .join(',') +
    '}'
  );
}
export function ruleContentHash(content: RuleContent): string {
  const canonical = {
    instructions: content.instructions,
    sources: content.sources,
    mapping: content.mapping,
    ...Object.fromEntries(RULE_COLUMNS.map((column) => [column, content[column]])),
  };
  return createHash('sha256').update(canonicalRuleJson(canonical)).digest('hex');
}
export type RuleContext = {
  systemId: string;
  systemKey: string;
  systemName: string;
  revision: number;
  kind: RuleSystemKind;
  contentHash: string;
};
export type RuleSystem = RuleContext & RuleContent & { createdAt: string; updatedAt: string };
export type RulePrompt = { context: RuleContext; instructions: string; overview: string };
export type RuleReference = {
  systemKey: string;
  contentHash: string;
  systemName: string;
  kind: RuleSystemKind;
};
export type RuleRead = {
  id: string;
  campaignId: string;
  turnId: string;
  context: RuleContext;
  tool: RuleTool;
  transportRequestId: string;
  argumentDigest: string;
  resultHash: string;
  payload: Record<string, unknown>;
  createdAt: string;
};
export type RuleCitation = {
  receiptId: string;
  path: string;
  quote: string;
  start: number;
  end: number;
  source: string;
  systemId: string;
  revision: number;
  contentHash: string;
  precision: 'exact' | 'approximate' | 'unknown';
  pdfPages: number[];
  printedPages: string[];
};
export const ruleContextSchema = z
  .object({
    systemId: z.uuid(),
    systemKey: ruleSlugSchema,
    systemName: z.string().min(1).max(RULE_LIMITS.nameChars),
    revision: z.number().int().positive(),
    kind: z.enum(RuleSystemKind),
    contentHash: ruleHashSchema,
  })
  .strict();
export const ruleReferenceSchema = ruleContextSchema.pick({
  kind: true,
  systemKey: true,
  contentHash: true,
  systemName: true,
});
export const ruleReadSchema = z
  .object({
    id: z.uuid(),
    campaignId: z.uuid(),
    turnId: z.uuid(),
    context: ruleContextSchema,
    tool: z.enum(RULE_TOOLS),
    transportRequestId: z.string().min(1).max(RULE_LIMITS.tokenChars),
    argumentDigest: ruleHashSchema,
    resultHash: ruleHashSchema,
    payload: z
      .record(z.string(), z.unknown())
      .refine((value) => serializedBytes(value) <= RULE_LIMITS.resultBytes),
    createdAt: z.iso.datetime(),
  })
  .strict();
export const ruleCitationSchema = z
  .object({
    receiptId: z.uuid(),
    path: z.string().min(1).max(RULE_LIMITS.pathChars),
    quote: z.string().min(1).max(RULE_LIMITS.citationChars),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    source: ruleSlugSchema,
    systemId: z.uuid(),
    revision: z.number().int().positive(),
    contentHash: ruleHashSchema,
    precision: z.enum(['exact', 'approximate', 'unknown']),
    pdfPages: z.array(page).max(RULE_LIMITS.pagesPerBook),
    printedPages: z.array(z.string().max(RULE_LIMITS.aliasChars)).max(RULE_LIMITS.pagesPerBook),
  })
  .strict()
  .refine((value) => value.end > value.start && value.end - value.start === value.quote.length);
export function validateRuleContent(content: RuleContent, kind: RuleSystemKind): RuleContent {
  const pending: { node: RuleNode; depth: number }[] = [];
  for (const column of RULE_COLUMNS)
    for (const node of Object.values(content[column])) pending.push({ node, depth: 0 });
  let boundedCount = 0;
  while (pending.length) {
    const entry = pending.pop()!;
    if (
      entry.depth > RULE_LIMITS.contentDepth ||
      ++boundedCount > RULE_LIMITS.nodes + RULE_LIMITS.books * RULE_COLUMNS.length
    )
      throw new Error('Node count/depth limit exceeded');
    if (
      !entry.node ||
      typeof entry.node !== 'object' ||
      !entry.node.children ||
      typeof entry.node.children !== 'object' ||
      Array.isArray(entry.node.children)
    )
      throw new Error('Invalid node children');
    for (const child of Object.values(entry.node.children))
      pending.push({ node: child, depth: entry.depth + 1 });
  }
  byteString(RULE_LIMITS.instructionsBytes).parse(content.instructions);
  const sources = z.array(ruleSourceSchema).max(RULE_LIMITS.books).parse(content.sources);
  const slugs = new Set(sources.map((source) => source.slug));
  if (slugs.size !== sources.length) throw new Error('Duplicate source slug');
  if (serializedBytes(content.mapping) > RULE_LIMITS.mappingBytes)
    throw new Error('Mapping byte limit exceeded');
  let count = 0;
  function visit(nodes: Record<string, RuleNode>, prefix: string, depth: number, source: string) {
    for (const [key, value] of Object.entries(nodes)) {
      ruleSlugSchema.parse(key);
      const nodePath = `${prefix}.${key}`;
      if (
        depth > RULE_LIMITS.contentDepth ||
        nodePath.length > RULE_LIMITS.pathChars ||
        (depth > 0 && ++count > RULE_LIMITS.nodes)
      )
        throw new Error('Node count/depth/path limit exceeded');
      const node = ruleNodeSchema.parse(value);
      const book = sources.find((entry) => entry.slug === source);
      if (!book || node.source !== source)
        throw new Error('Node source does not match book partition');
      if (
        node.pdfPages.some((p) => p > book.pageCount) ||
        (node.pageSpans ?? []).some(
          (span) => span.pdfPage !== null && span.pdfPage > book.pageCount
        ) ||
        Object.values(node.fieldEvidence ?? {}).some(
          (e) => e.kind === 'visual' && e.pdfPage > book.pageCount
        )
      )
        throw new Error('Page exceeds book page count');
      visit(node.children, depth === 0 ? nodePath : `${nodePath}.children`, depth + 1, source);
    }
  }
  for (const column of RULE_COLUMNS) {
    for (const [slug, root] of Object.entries(content[column])) {
      ruleSlugSchema.parse(slug);
      visit({ [slug]: root }, column, 0, slug);
    }
  }
  if (
    kind === RuleSystemKind.ModelKnowledge &&
    (sources.length || count || Object.keys(content.mapping).length)
  )
    throw new Error('Default accepts instructions only');
  if (Buffer.byteLength(canonicalRuleJson(content), 'utf8') > RULE_LIMITS.systemBytes)
    throw new Error('System byte limit exceeded');
  return content;
}
