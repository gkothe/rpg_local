import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Problem } from '../errors.js';
import { SourcePurpose, SourceStatus } from './options.js';
import { sourceSections } from './sourceSections.js';
import type { Campaign, Source } from './types.js';
import type { SourceSpan } from './knowledge.js';

export const CAMPAIGN_SOURCE_SEARCH_TOOL_NAME = 'campaign_sources_search';
export const CAMPAIGN_SOURCE_GET_TOOL_NAME = 'campaign_sources_get';
export type CampaignSourceTool =
  typeof CAMPAIGN_SOURCE_SEARCH_TOOL_NAME | typeof CAMPAIGN_SOURCE_GET_TOOL_NAME;
export const CAMPAIGN_SOURCE_SELECTION = {
  bootstrapChars: 12000,
  searchPageSections: 8,
  excerptChars: 240,
  excerptLeadChars: 60,
} as const;
// Navigation words must not drown out names or scene terms. All-common queries still work.
const SEARCH_COMMON_WORDS = new Set(
  'a an the and or of to in on at is are was were be for with from that this it i you my me de da do das dos e o os as um uma para com em no na nos nas que eu voce você'.split(
    ' '
  )
);
function tokens(text: string) {
  return [...text.matchAll(/[\p{L}\p{N}]+/gu)].map((match) => ({
    word: match[0].toLowerCase(),
    index: match.index,
  }));
}
function searchMatch(text: string, query: string) {
  const requested = tokens(query).map((t) => t.word);
  const meaningful = requested.filter((word) => !SEARCH_COMMON_WORDS.has(word));
  const words = new Set(meaningful.length ? meaningful : requested);
  const original = tokens(text);
  const matches = original.filter((token) => words.has(token.word));
  const coverage = new Set(matches.map((token) => token.word)).size;
  const phrase =
    requested.length > 1
      ? original.findIndex((_token, index) =>
          requested.every((word, offset) => original[index + offset]?.word === word)
        )
      : -1;
  let best = matches[0]?.index ?? 0;
  let bestCoverage = 0;
  const nearby = new Map<string, number>();
  let right = 0;
  for (const match of matches) {
    while (
      right < matches.length &&
      matches[right]!.index <
        match.index +
          CAMPAIGN_SOURCE_SELECTION.excerptChars -
          CAMPAIGN_SOURCE_SELECTION.excerptLeadChars
    ) {
      const word = matches[right++]!.word;
      nearby.set(word, (nearby.get(word) ?? 0) + 1);
    }
    if (nearby.size > bestCoverage) {
      best = match.index;
      bestCoverage = nearby.size;
    }
    const count = nearby.get(match.word)! - 1;
    if (count) nearby.set(match.word, count);
    else nearby.delete(match.word);
  }
  return {
    rank: coverage + (coverage && phrase >= 0 ? words.size + 1 : 0),
    match: phrase >= 0 ? original[phrase]!.index : best,
  };
}
export const campaignSourceSearchSchema = z
  .object({
    query: z.string().trim().min(1),
    sourceId: z.uuid().optional(),
    cursor: z.string().optional(),
  })
  .strict();
export const campaignSourceGetSchema = z
  .object({
    sourceId: z.uuid(),
    version: z.number().int().positive(),
    sectionIndex: z.number().int().nonnegative(),
  })
  .strict();
export const frozenCampaignSourcesSchema = z
  .object({
    campaignId: z.uuid(),
    sources: z.array(
      z
        .object({
          id: z.uuid(),
          version: z.number().int().positive(),
          name: z.string(),
          purpose: z.enum(SourcePurpose),
          text: z.string(),
        })
        .strict()
    ),
  })
  .strict();
export type FrozenCampaignSources = z.infer<typeof frozenCampaignSourcesSchema>;
export type SourceSelectionDiagnostics = {
  bootstrap: boolean;
  reasons: ('no_source' | 'no_match' | 'target_omission')[];
  included: { id: string; version: number; sectionIndex: number }[];
  omitted: { id: string; version: number; sectionIndex: number }[];
};
export type CampaignSourceRead = {
  id: string;
  campaignId: string;
  turnId: string;
  sessionId: string;
  tool: CampaignSourceTool;
  transportRequestId: string;
  argumentDigest: string;
  payload: Record<string, unknown>;
  createdAt: string;
};
export function freezeCampaignSources(c: Campaign): FrozenCampaignSources {
  return frozenCampaignSourcesSchema.parse({
    campaignId: c.id,
    sources: c.sources
      .filter((s) => s.status === SourceStatus.Confirmed)
      .map((s) => ({
        id: s.id,
        version: s.version,
        name: s.name,
        purpose: s.purpose ?? SourcePurpose.Reference,
        text: s.text,
      })),
  });
}
function sections(source: FrozenCampaignSources['sources'][number]) {
  return sourceSections(source as Source);
}
function suppliedSection(
  source: FrozenCampaignSources['sources'][number],
  section: ReturnType<typeof sections>[number],
  spans: readonly SourceSpan[]
) {
  return spans.some(
    (span) =>
      span.id === source.id &&
      span.version === source.version &&
      span.start >= 0 &&
      span.end <= source.text.length &&
      span.start <= section.start &&
      span.end >= section.end &&
      span.text === source.text.slice(span.start, span.end)
  );
}
function sectionNavigation(source: FrozenCampaignSources['sources'][number]) {
  const headings = [...source.text.matchAll(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm)].map((match) => ({
    start: match.index,
    title: match[1]!.replace(/[*_`]/g, '').trim(),
  }));
  return sections(source).map((section) => {
    const inside = headings.filter(
      (heading) => heading.start >= section.start && heading.start < section.end
    );
    const prior = headings.filter((heading) => heading.start <= section.start).at(-1);
    return {
      ...section,
      title: inside[0]?.title ?? prior?.title ?? `Section ${section.index + 1}`,
      headings: [
        ...new Set([...(prior ? [prior.title] : []), ...inside.map((heading) => heading.title)]),
      ],
    };
  });
}
export function campaignSourceCatalog(
  frozen: FrozenCampaignSources,
  supplied: readonly SourceSpan[] = []
) {
  return frozen.sources.map((s) => ({
    id: s.id,
    version: s.version,
    name: s.name,
    purpose: s.purpose,
    sectionCount: sections(s).length,
    sections: sectionNavigation(s).map((section) => ({
      sectionIndex: section.index,
      title: section.title,
      headings: section.headings,
      supplied: suppliedSection(s, section, supplied),
    })),
  }));
}
export function bootstrapCampaignSources(frozen: FrozenCampaignSources) {
  const spans: SourceSpan[] = [];
  const omitted: SourceSelectionDiagnostics['omitted'] = [];
  let chars = 0;
  for (const source of frozen.sources) {
    if (source.purpose === SourcePurpose.Character) continue;
    const section = sections(source)[0];
    if (!section) continue;
    if (chars + section.text.length > CAMPAIGN_SOURCE_SELECTION.bootstrapChars && spans.length) {
      omitted.push({ id: source.id, version: source.version, sectionIndex: 0 });
      continue;
    }
    chars += section.text.length;
    spans.push({
      id: source.id,
      version: source.version,
      name: source.name,
      text: section.text,
      start: section.start,
      end: section.end,
    });
  }
  return { spans, omitted };
}
export function createCampaignSourceRecall(
  raw: FrozenCampaignSources,
  initialSpans: readonly SourceSpan[] = []
) {
  const frozen = frozenCampaignSourcesSchema.parse(raw);
  const supplied = [...initialSpans];
  const navigation = new Map(
    frozen.sources.map((source) => [source.id, sectionNavigation(source)])
  );
  const fingerprint = createHash('sha256').update(JSON.stringify(frozen)).digest('hex');
  const cursors = new Map<string, { query: string; sourceId?: string; offset: number }>();
  let nextCursor = 0;
  return {
    markSupplied(raw: unknown) {
      // Only successful, delivered get payloads call this after receipt persistence.
      const parsed = z
        .object({
          id: z.uuid(),
          version: z.number().int().positive(),
          name: z.string(),
          text: z.string(),
          start: z.number().int().nonnegative(),
          end: z.number().int().nonnegative(),
        })
        .safeParse(raw);
      if (parsed.success) {
        const span = parsed.data;
        const source = frozen.sources.find((s) => s.id === span.id && s.version === span.version);
        if (
          source &&
          span.end > span.start &&
          span.end <= source.text.length &&
          span.text === source.text.slice(span.start, span.end) &&
          !supplied.some(
            (s) =>
              s.id === span.id &&
              s.version === span.version &&
              s.start === span.start &&
              s.end === span.end
          )
        )
          supplied.push(span);
      }
    },
    search(raw: unknown): Record<string, unknown> {
      const input = campaignSourceSearchSchema.parse(raw);
      if (input.sourceId && !frozen.sources.some((s) => s.id === input.sourceId))
        throw new Problem(404, 'campaign_source_missing', 'Source is outside this frozen campaign');
      const hits = frozen.sources
        .filter((s) => !input.sourceId || s.id === input.sourceId)
        .flatMap((source) =>
          navigation.get(source.id)!.map((section) => {
            const { rank, match } = searchMatch(section.text, input.query);
            let start =
              section.start + Math.max(0, match - CAMPAIGN_SOURCE_SELECTION.excerptLeadChars);
            if (start > section.start && /[\uDC00-\uDFFF]/.test(source.text[start]!)) start--;
            let end = Math.min(section.end, start + CAMPAIGN_SOURCE_SELECTION.excerptChars);
            if (end < source.text.length && /[\uD800-\uDBFF]/.test(source.text[end - 1]!)) end--;
            return {
              sourceId: source.id,
              version: source.version,
              name: source.name,
              sectionIndex: section.index,
              title: section.title,
              alreadySupplied: suppliedSection(source, section, supplied),
              start,
              end,
              text: source.text.slice(start, end),
              rank,
            };
          })
        )
        .filter((hit) => hit.rank > 0)
        .sort(
          (a, b) =>
            b.rank - a.rank ||
            a.sourceId.localeCompare(b.sourceId) ||
            a.sectionIndex - b.sectionIndex
        );
      let offset = 0;
      if (input.cursor) {
        const saved = cursors.get(input.cursor);
        if (!saved || saved.query !== input.query || saved.sourceId !== input.sourceId)
          throw new Problem(
            422,
            'campaign_source_cursor_invalid',
            'Cursor does not match this frozen lookup'
          );
        offset = saved.offset;
      }
      const entries = hits
        .slice(offset, offset + CAMPAIGN_SOURCE_SELECTION.searchPageSections)
        .map(({ rank: _rank, ...hit }) => hit);
      let cursor: string | null = null;
      if (offset + entries.length < hits.length) {
        cursor = `${fingerprint}:${nextCursor++}`;
        cursors.set(cursor, {
          query: input.query,
          sourceId: input.sourceId,
          offset: offset + entries.length,
        });
      }
      return { entries, nextCursor: cursor, reason: entries.length ? null : 'no_match' };
    },
    get(raw: unknown, receiptId: string): Record<string, unknown> {
      const input = campaignSourceGetSchema.parse(raw);
      const source = frozen.sources.find((s) => s.id === input.sourceId);
      if (!source)
        throw new Problem(404, 'campaign_source_missing', 'Source is outside this frozen campaign');
      if (source.version !== input.version)
        throw new Problem(
          409,
          'campaign_source_version',
          'Use the version in the frozen source catalog'
        );
      const section = navigation.get(source.id)![input.sectionIndex];
      if (!section)
        throw new Problem(404, 'campaign_source_section', 'Source section does not exist');
      return {
        receiptId,
        title: section.title,
        alreadySupplied: suppliedSection(source, section, supplied),
        sourceSpan: {
          id: source.id,
          version: source.version,
          name: source.name,
          text: section.text,
          start: section.start,
          end: section.end,
        },
        sectionIndex: section.index,
      };
    },
  };
}
