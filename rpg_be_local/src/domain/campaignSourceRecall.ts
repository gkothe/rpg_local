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
} as const;
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
export function campaignSourceCatalog(frozen: FrozenCampaignSources) {
  return frozen.sources.map((s) => ({
    id: s.id,
    version: s.version,
    name: s.name,
    purpose: s.purpose,
    sectionCount: sections(s).length,
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
export function createCampaignSourceRecall(raw: FrozenCampaignSources) {
  const frozen = frozenCampaignSourcesSchema.parse(raw);
  const fingerprint = createHash('sha256').update(JSON.stringify(frozen)).digest('hex');
  const cursors = new Map<string, { query: string; sourceId?: string; offset: number }>();
  let nextCursor = 0;
  return {
    search(raw: unknown): Record<string, unknown> {
      const input = campaignSourceSearchSchema.parse(raw);
      if (input.sourceId && !frozen.sources.some((s) => s.id === input.sourceId))
        throw new Problem(404, 'campaign_source_missing', 'Source is outside this frozen campaign');
      const words = input.query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
      const hits = frozen.sources
        .filter((s) => !input.sourceId || s.id === input.sourceId)
        .flatMap((source) =>
          sections(source).map((section) => {
            const text = section.text.toLowerCase();
            const rank = words.reduce((sum, word) => sum + (text.includes(word) ? 1 : 0), 0);
            const match =
              words
                .map((word) => section.text.search(new RegExp(word, 'iu')))
                .filter((i) => i >= 0)
                .sort((a, b) => a - b)[0] ?? 0;
            let start = section.start + Math.max(0, match - 60);
            if (start > section.start && /[\uDC00-\uDFFF]/.test(source.text[start]!)) start--;
            let end = Math.min(section.end, start + CAMPAIGN_SOURCE_SELECTION.excerptChars);
            if (end < source.text.length && /[\uD800-\uDBFF]/.test(source.text[end - 1]!)) end--;
            return {
              sourceId: source.id,
              version: source.version,
              name: source.name,
              sectionIndex: section.index,
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
      const section = sections(source)[input.sectionIndex];
      if (!section)
        throw new Problem(404, 'campaign_source_section', 'Source section does not exist');
      return {
        receiptId,
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
