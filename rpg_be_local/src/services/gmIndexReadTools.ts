import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { canonicalJson } from '../domain/journalLedger.js';
import { Problem } from '../errors.js';
import type { Store } from '../store.js';
import type { Campaign } from '../domain/types.js';
import type { FrozenHistory, TurnVersion } from '../domain/historyRecall.js';
import {
  originalHistoryGetSchema,
  originalHistorySearchSchema,
  HISTORY_GET_TOOL_NAME,
  HISTORY_SEARCH_TOOL_NAME,
} from '../domain/historyRecall.js';
import {
  createCampaignSourceRecall,
  campaignSourceGetSchema,
  campaignSourceSearchSchema,
  freezeCampaignSources,
  CAMPAIGN_SOURCE_GET_TOOL_NAME,
  CAMPAIGN_SOURCE_SEARCH_TOOL_NAME,
} from '../domain/campaignSourceRecall.js';
import {
  createKnowledgeRecall,
  knowledgeGetSchema,
  knowledgeSearchSchema,
  freezeKnowledge,
  KNOWLEDGE_GET_TOOL_NAME,
  KNOWLEDGE_SEARCH_TOOL_NAME,
} from '../domain/knowledgeRecall.js';
import type { GameplayToolDispatch, GameplayToolDefinition } from '../providers/gameplayTools.js';
import { HistoryReader } from './historyStore.js';

export type GmIndexSourceSection = { sourceId: string; version: number; sectionIndex: number };
export type GmIndexReadReceipt = {
  durationMs?: number;
  initialSourceSections?: readonly GmIndexSourceSection[];
  name: string;
  arguments: unknown;
  requestId: string;
  result: Record<string, unknown>;
};

/** Reconstruct cursor and delivered-span state in receipt order, verifying frozen results. */
export function restoreGmIndexSourceReads(
  campaign: Campaign,
  reads: readonly GmIndexReadReceipt[],
  initialSections: readonly GmIndexSourceSection[] = reads[0]?.initialSourceSections ?? []
) {
  const source = createCampaignSourceRecall(freezeCampaignSources(campaign));
  for (const section of initialSections)
    source.markSupplied(source.get(section, randomUUID()).sourceSpan);
  for (const read of reads) {
    let result: Record<string, unknown>;
    if (read.name === CAMPAIGN_SOURCE_SEARCH_TOOL_NAME) result = source.search(read.arguments);
    else if (read.name === CAMPAIGN_SOURCE_GET_TOOL_NAME)
      result = source.get(read.arguments, String(read.result.receiptId));
    else continue;
    if (canonicalJson(result) !== canonicalJson(read.result))
      throw new Problem(
        409,
        'gm_index_replay',
        'Saved source read no longer matches its frozen input.'
      );
    if (read.name === CAMPAIGN_SOURCE_GET_TOOL_NAME) source.markSupplied(result.sourceSpan);
  }
  return source;
}

/** Fresh invocation: no old supplied-state is inferred from retained provenance receipts. */
export function createGmIndexReadTools(
  store: Store,
  campaign: Campaign,
  historyCapture: FrozenHistory,
  assertActive: () => Promise<void>,
  onRead: (read: GmIndexReadReceipt) => Promise<void>,
  overlays: readonly TurnVersion[] = [],
  priorReads: readonly GmIndexReadReceipt[] = [],
  options: {
    originalsOnly?: boolean;
    suppliedSourceSections?: readonly GmIndexSourceSection[];
    onReadStarted?: (name: string) => Promise<void>;
  } = {}
): GameplayToolDispatch {
  const source = restoreGmIndexSourceReads(
    campaign,
    priorReads,
    options.suppliedSourceSections ?? priorReads[0]?.initialSourceSections
  );
  const knowledge = createKnowledgeRecall(freezeKnowledge(campaign));
  const history = new HistoryReader(store, historyCapture, overlays);
  const specs = [
    [
      CAMPAIGN_SOURCE_SEARCH_TOOL_NAME,
      campaignSourceSearchSchema,
      (args: unknown) => source.search(args),
    ],
    [
      CAMPAIGN_SOURCE_GET_TOOL_NAME,
      campaignSourceGetSchema,
      (args: unknown) => source.get(args, randomUUID()),
    ],
    [KNOWLEDGE_SEARCH_TOOL_NAME, knowledgeSearchSchema, (args: unknown) => knowledge.search(args)],
    [KNOWLEDGE_GET_TOOL_NAME, knowledgeGetSchema, (args: unknown) => knowledge.get(args)],
    [
      HISTORY_SEARCH_TOOL_NAME,
      options.originalsOnly
        ? originalHistorySearchSchema.extend({ mode: z.literal('originals').default('originals') })
        : originalHistorySearchSchema,
      (args: unknown) => history.search(args),
    ],
    [HISTORY_GET_TOOL_NAME, originalHistoryGetSchema, (args: unknown) => history.get(args)],
  ] as const;
  const replay = new Map<
    string,
    { name: string; arguments: string; result: Record<string, unknown> }
  >();
  for (const read of priorReads)
    replay.set(read.requestId, {
      name: read.name,
      arguments: canonicalJson(read.arguments),
      result: read.result,
    });
  return Object.assign(
    async (name: string, raw: unknown, requestId: string | number) => {
      await assertActive();
      const spec = specs.find((spec) => spec[0] === name);
      if (!spec)
        throw new Problem(
          422,
          'gm_index_tool',
          'Only the six read-only index tools are available.'
        );
      const key = String(requestId),
        args = canonicalJson(raw),
        prior = replay.get(key);
      if (prior) {
        if (prior.name !== name || prior.arguments !== args)
          throw new Problem(409, 'gm_index_replay', 'Read identity was reused with changed input.');
        return prior.result;
      }
      const parsed = spec[1].parse(raw);
      const readStartedAt = Date.now();
      await options.onReadStarted?.(name);
      const result = await spec[2](parsed);
      await onRead({
        durationMs: Date.now() - readStartedAt,
        name,
        arguments: raw,
        requestId: key,
        result,
        ...(options.suppliedSourceSections?.length
          ? { initialSourceSections: options.suppliedSourceSections }
          : {}),
      });
      if (name === CAMPAIGN_SOURCE_GET_TOOL_NAME && 'sourceSpan' in result)
        source.markSupplied(result.sourceSpan);
      replay.set(key, { name, arguments: args, result });
      return result;
    },
    {
      assertActive,
      definitions: specs.map(([name, schema]) => ({
        name,
        description:
          name === HISTORY_SEARCH_TOOL_NAME && options.originalsOnly
            ? 'Search exact captured original turns. No history summaries exist during preparation. Use only for a specific missing passage, not an exploratory campaign audit.'
            : 'Read frozen originals/canonical facts only when a specific needed detail is absent from the supplied batch/context. Complete supplied source sections are marked alreadySupplied; use their text directly.',
        inputSchema: z.toJSONSchema(schema),
      })) as GameplayToolDefinition[],
    }
  );
}

export function gmIndexReadSummary(read: {
  name: string;
  result: Record<string, unknown>;
  durationMs?: number;
}) {
  const result = read.result;
  const rows = result.items ?? result.records ?? result.entries ?? result.originals;
  const groups = Array.isArray(result.results) ? (result.results as { entries?: unknown[] }[]) : [];
  const resultCount = Array.isArray(rows)
    ? rows.length
    : groups.length
      ? groups.reduce((count, group) => count + (group.entries?.length ?? 0), 0)
      : null;
  return {
    tool: read.name,
    durationMs: read.durationMs ?? null,
    resultCount,
    empty: read.name.endsWith('_search') && resultCount === 0,
    alreadySupplied: result.alreadySupplied === true,
  };
}
