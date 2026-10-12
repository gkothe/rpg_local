import { randomUUID } from 'node:crypto';

import { Problem } from '../errors.js';
import type { Store } from '../store.js';
import { ownerId } from '../store.js';
import type { Generator } from '../providers/service.js';

import { traceEvent, type PromptTraceContext } from '../providers/promptLog.js';
import { canonicalJson, sha256 } from '../domain/journalLedger.js';
import { RESPONSE_RETRY_COUNT, responseRetryFeedback } from '../domain/responseRetry.js';
import type { TurnVersion, FrozenHistory } from '../domain/historyRecall.js';
import {
  createGmIndexReadTools,
  restoreGmIndexSourceReads,
  gmIndexReadSummary,
} from './gmIndexReadTools.js';
import {
  GM_INDEX_UPDATER_INSTRUCTIONS,
  GM_INDEX_UPDATE_PURPOSE,
  gmIndexUpdateJsonSchema,
  gmIndexUpdateSchema,
  type GmIndexUpdate,
} from '../domain/gmIndexUpdate.js';
import { gmIndexDocumentSchema, type GmIndexDocument } from '../domain/gmIndex.js';
import type { Campaign } from '../domain/types.js';

export type GmIndexCheckpoint = {
  contractVersion: 1;
  candidateDigest: string;
  narrativeDigest: string;
  canonicalIdentity: string;
  indexIdentity: string;
  reservations: {
    characters: [number, string][];
    introductions: [number, string][];
    knowledge: [number, string][];
    appliedAt: string;
  };
  campaign: Campaign;
  history: FrozenHistory;
  currentOriginal: TurnVersion;
  prompt: string;
  invocations: {
    id: string;
    reads: {
      requestId: string;
      name: string;
      arguments: unknown;
      result: Record<string, unknown>;
    }[];
  }[];
  result?: GmIndexDocument;
};
export async function requireGmIndexTransport(
  generator: Generator,
  settings: Campaign['settings']
): Promise<void> {
  if (!generator.generateOwnedGameplay || !generator.gameplayCapacity)
    throw new Problem(
      503,
      'gm_index_transport',
      'GM index requires an isolated provider with owned read-only tools.'
    );
  await generator.gameplayCapacity(settings);
}
export class GmIndexUpdater {
  constructor(
    private store: Store,
    private generator: Generator
  ) {}
  async save(turnId: string, checkpoint: GmIndexCheckpoint): Promise<void> {
    await this.store.transaction(async (client) => {
      await this.store.campaign(checkpoint.campaign.id, client, true);
      const result = await client.query(
        `UPDATE narrative_edit_candidates SET gm_index_checkpoint=$3,updated_at=now()
        WHERE turn_id=$1 AND owner=$2 AND candidate_digest=$4 AND status='completed'
        AND campaign_id=$5 AND EXISTS(SELECT 1 FROM turns WHERE id=$1 AND campaign_id=$5 AND owner=$2 AND status='running' AND lease_until>now()) RETURNING turn_id`,
        [
          turnId,
          ownerId,
          JSON.stringify(checkpoint),
          checkpoint.candidateDigest,
          checkpoint.campaign.id,
        ]
      );
      if (!result.rows.length)
        throw new Problem(409, 'gm_index_inactive', 'GM index finalization ownership was lost.');
    });
  }
  async generate(
    turnId: string,
    checkpoint: GmIndexCheckpoint,
    signal: AbortSignal,
    trace?: PromptTraceContext,
    validate?: (update: GmIndexUpdate) => Promise<void>
  ): Promise<GmIndexUpdate> {
    await requireGmIndexTransport(this.generator, checkpoint.campaign.settings);
    for (const invocation of checkpoint.invocations)
      restoreGmIndexSourceReads(checkpoint.campaign, invocation.reads);
    let feedback = '';
    for (let attempt = 0; ; attempt++) {
      const invocation = {
        id: randomUUID(),
        reads: [] as GmIndexCheckpoint['invocations'][number]['reads'],
      };
      checkpoint.invocations.push(invocation);
      await this.save(turnId, checkpoint);
      const assertActive = async () => {
        if (signal.aborted) throw new Problem(409, 'cancelled', 'GM index update cancelled.');
        const result = await this.store.pool.query(
          "SELECT id FROM turns WHERE id=$1 AND owner=$2 AND status='running' AND lease_until>now()",
          [turnId, ownerId]
        );
        if (!result.rows.length)
          throw new Problem(409, 'gm_index_inactive', 'GM index finalization ownership was lost.');
      };
      // A new native conversation gets no inherited supplied-state or cursors.
      const dispatch = createGmIndexReadTools(
        this.store,
        checkpoint.campaign,
        checkpoint.history,
        assertActive,
        async (read) => {
          await traceEvent(trace, 'gm_index_read_complete', {
            ...gmIndexReadSummary(read),
            readNumber: invocation.reads.length + 1,
          });
          invocation.reads.push(read);
          await this.save(turnId, checkpoint);
        },
        [checkpoint.currentOriginal],
        [],
        {
          onReadStarted: (name) =>
            traceEvent(trace, 'gm_index_read_start', {
              tool: name,
              readNumber: invocation.reads.length + 1,
            }),
        }
      );
      const stageStartedAt = Date.now();
      await traceEvent(trace, 'gm_index_stage_start', {
        purpose: GM_INDEX_UPDATE_PURPOSE,
        attempt,
        promptBytes: Buffer.byteLength(checkpoint.prompt, 'utf8'),
      });
      try {
        const output = await this.generator.generateOwnedGameplay!(
          checkpoint.campaign.settings,
          checkpoint.prompt + feedback,
          gmIndexUpdateJsonSchema,
          GM_INDEX_UPDATER_INSTRUCTIONS,
          dispatch,
          signal,
          trace
            ? {
                ...trace,
                executionId: invocation.id,
                purpose: GM_INDEX_UPDATE_PURPOSE,
                correctionAttempt: attempt,
              }
            : undefined
        );
        await assertActive();
        const update = gmIndexUpdateSchema.parse(output);
        if (validate) await validate(update);
        await traceEvent(trace, 'gm_index_stage_complete', {
          purpose: GM_INDEX_UPDATE_PURPOSE,
          attempt,
          elapsedMs: Date.now() - stageStartedAt,
          retrievalCalls: invocation.reads.length,
        });
        return update;
      } catch (error) {
        await traceEvent(trace, 'gm_index_stage_failed', {
          purpose: GM_INDEX_UPDATE_PURPOSE,
          attempt,
          elapsedMs: Date.now() - stageStartedAt,
          code: error instanceof Problem ? error.code : 'invalid_response',
        });
        const reason =
          responseRetryFeedback(error) ??
          (error instanceof Problem && error.code.startsWith('gm_index_') && error.status === 422
            ? error.message
            : null);
        if (signal.aborted || reason === null || attempt >= RESPONSE_RETRY_COUNT) throw error;
        feedback = `\nValidation feedback: ${reason}. Return the corrected index delta object only.`;
      }
    }
  }
}
export const gmIndexCheckpointDigest = (checkpoint: GmIndexCheckpoint) =>
  sha256(
    canonicalJson({
      candidate: checkpoint.candidateDigest,
      narrative: checkpoint.narrativeDigest,
      canonical: checkpoint.canonicalIdentity,
      index: checkpoint.indexIdentity,
      reservations: checkpoint.reservations,
      prompt: checkpoint.prompt,
    })
  );
export function validatedCheckpointResult(
  checkpoint: GmIndexCheckpoint
): GmIndexDocument | undefined {
  return checkpoint.result ? gmIndexDocumentSchema.parse(checkpoint.result) : undefined;
}
