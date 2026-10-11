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

export type GmIndexReadReceipt = {
  name: string;
  arguments: unknown;
  requestId: string;
  result: Record<string, unknown>;
};

/** Reconstruct cursor and delivered-span state in receipt order, verifying frozen results. */
export function restoreGmIndexSourceReads(
  campaign: Campaign,
  reads: readonly GmIndexReadReceipt[]
) {
  const source = createCampaignSourceRecall(freezeCampaignSources(campaign));
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
  onRead: (read: {
    name: string;
    arguments: unknown;
    requestId: string;
    result: Record<string, unknown>;
  }) => Promise<void>,
  overlays: readonly TurnVersion[] = [],
  priorReads: readonly GmIndexReadReceipt[] = []
): GameplayToolDispatch {
  const source = restoreGmIndexSourceReads(campaign, priorReads);
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
      originalHistorySearchSchema,
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
      const result = await spec[2](spec[1].parse(raw));
      await onRead({ name, arguments: raw, requestId: key, result });
      if (name === CAMPAIGN_SOURCE_GET_TOOL_NAME && 'sourceSpan' in result)
        source.markSupplied(result.sourceSpan);
      replay.set(key, { name, arguments: args, result });
      return result;
    },
    {
      assertActive,
      definitions: specs.map(([name, schema]) => ({
        name,
        description: 'Read frozen originals/canonical facts for private GM index preparation.',
        inputSchema: z.toJSONSchema(schema),
      })) as GameplayToolDefinition[],
    }
  );
}
