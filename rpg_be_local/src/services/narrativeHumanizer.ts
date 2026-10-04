import type { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { Problem } from '../errors.js';
import type { ProviderSettings } from '../domain/types.js';
import type { Generator } from '../providers/service.js';
import { traceEvent, safeTraceFailure, type PromptTraceContext } from '../providers/promptLog.js';
import {
  NARRATIVE_EDITOR_PURPOSE,
  narrativeDigest,
  narrativeHumanizerJsonSchema,
  narrativeHumanizerPrompt,
  validateHumanizedNarrative,
} from '../domain/narrativeHumanizer.js';
import { RESPONSE_RETRY_COUNT, responseRetryFeedback } from '../domain/responseRetry.js';

export async function humanizeNarrative(
  generator: Generator,
  settings: ProviderSettings,
  originalNarrative: string,
  options: {
    signal?: AbortSignal;
    trace?: PromptTraceContext;
    protectedNames?: readonly string[];
  } = {}
): Promise<string> {
  if (options.signal?.aborted) throw new Problem(409, 'cancelled', 'Narrative editing cancelled');
  const editorSettings = generator.narrativeEditorSettings
    ? await generator.narrativeEditorSettings(settings)
    : { ...settings, effort: null };
  let feedback = '';
  for (let attempt = 0; ; attempt++) {
    if (options.signal?.aborted) throw new Problem(409, 'cancelled', 'Narrative editing cancelled');
    const trace = options.trace
      ? {
          ...options.trace,
          executionId: randomUUID(),
          purpose: NARRATIVE_EDITOR_PURPOSE,
          correctionAttempt: attempt,
        }
      : undefined;
    try {
      const output = await generator.generate(
        editorSettings,
        narrativeHumanizerPrompt(originalNarrative, feedback),
        narrativeHumanizerJsonSchema,
        options.signal,
        trace
      );
      const narrative = validateHumanizedNarrative(
        originalNarrative,
        output,
        options.protectedNames
      );
      await traceEvent(trace, 'narrative_selected', {
        originalDigest: narrativeDigest(originalNarrative),
        narrative,
      });
      return narrative;
    } catch (error) {
      await traceEvent(trace, 'narrative_rejected', safeTraceFailure(error));
      const reason =
        error instanceof Problem && error.code === 'narrative_anchors'
          ? error.message
          : responseRetryFeedback(error);
      if (options.signal?.aborted || reason === null || attempt >= RESPONSE_RETRY_COUNT)
        throw error;
      feedback = `${reason}. Edit the original narrative again; preserve its meaning and protected anchors. Return only the narrative object.`;
    }
  }
}

export type NarrativeCandidate = {
  turnId: string;
  campaignId: string;
  candidateDigest: string;
  campaignRevision: number;
  ruleContext: unknown;
  settings: ProviderSettings;
  rawResponse: unknown;
  rawNarrative: string;
  editedNarrative: string | null;
  status: 'pending' | 'completed' | 'abandoned';
  owner: string;
};

/** SQL methods may share the caller's ownership/revision transaction. No CLI work happens here. */
export class NarrativeCandidateRepository {
  constructor(private readonly pool: Pool) {}
  async save(
    candidate: Omit<NarrativeCandidate, 'candidateDigest' | 'editedNarrative' | 'status'>,
    client?: PoolClient
  ): Promise<NarrativeCandidate> {
    const candidateDigest = narrativeDigest(candidate.rawResponse);
    const result = await (client ?? this.pool).query(
      `INSERT INTO narrative_edit_candidates(turn_id,campaign_id,candidate_digest,campaign_revision,rule_context,settings,raw_response,raw_narrative,owner)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9 WHERE EXISTS (SELECT 1 FROM turns WHERE id=$1 AND campaign_id=$2 AND owner=$9 AND status='running')
       ON CONFLICT(turn_id) DO UPDATE SET owner=EXCLUDED.owner, updated_at=now()
       WHERE narrative_edit_candidates.candidate_digest=EXCLUDED.candidate_digest AND narrative_edit_candidates.status<>'abandoned'
       AND narrative_edit_candidates.campaign_revision=EXCLUDED.campaign_revision AND narrative_edit_candidates.rule_context=EXCLUDED.rule_context
       AND narrative_edit_candidates.settings=EXCLUDED.settings AND narrative_edit_candidates.raw_narrative=EXCLUDED.raw_narrative
       RETURNING *`,
      [
        candidate.turnId,
        candidate.campaignId,
        candidateDigest,
        candidate.campaignRevision,
        JSON.stringify(candidate.ruleContext),
        JSON.stringify(candidate.settings),
        JSON.stringify(candidate.rawResponse),
        candidate.rawNarrative,
        candidate.owner,
      ]
    );
    if (!result.rows.length)
      throw new Problem(
        409,
        'editing_conflict',
        'Narrative candidate changed or execution ownership was lost'
      );
    return this.fromRow(result.rows[0]);
  }
  async load(turnId: string, client?: PoolClient): Promise<NarrativeCandidate | null> {
    const result = await (client ?? this.pool).query(
      'SELECT * FROM narrative_edit_candidates WHERE turn_id=$1',
      [turnId]
    );
    return result.rows[0] ? this.fromRow(result.rows[0]) : null;
  }
  async claim(
    turnId: string,
    owner: string,
    digest: string,
    requestId: string,
    client?: PoolClient
  ): Promise<void> {
    const result = await (client ?? this.pool).query(
      `WITH candidate AS (UPDATE narrative_edit_candidates SET owner=$2,updated_at=now()
       WHERE turn_id=$1 AND candidate_digest=$3 AND status<>'abandoned'
       AND EXISTS(SELECT 1 FROM turns WHERE id=$1 AND owner=$2 AND status='running') RETURNING turn_id)
       INSERT INTO narrative_edit_requests(turn_id,request_id,candidate_digest) SELECT turn_id,$4,$3 FROM candidate
       ON CONFLICT(turn_id,request_id) DO UPDATE SET candidate_digest=narrative_edit_requests.candidate_digest
       WHERE narrative_edit_requests.candidate_digest=EXCLUDED.candidate_digest RETURNING turn_id`,
      [turnId, owner, digest, requestId]
    );
    if (!result.rows.length)
      throw new Problem(
        409,
        'editing_conflict',
        'Narrative editing cannot resume for this execution'
      );
  }
  async complete(
    turnId: string,
    owner: string,
    digest: string,
    narrative: string,
    client?: PoolClient
  ): Promise<void> {
    const result = await (client ?? this.pool).query(
      `UPDATE narrative_edit_candidates SET edited_narrative=$4,status='completed',updated_at=now()
       WHERE turn_id=$1 AND owner=$2 AND candidate_digest=$3 AND (status='pending' OR (status='completed' AND edited_narrative=$4))
       AND EXISTS(SELECT 1 FROM turns WHERE id=$1 AND owner=$2 AND status='running') RETURNING turn_id`,
      [turnId, owner, digest, narrative]
    );
    if (!result.rows.length)
      throw new Problem(409, 'editing_conflict', 'Narrative editing ownership was lost');
  }
  async abandon(turnId: string, client?: PoolClient): Promise<void> {
    await (client ?? this.pool).query(
      "UPDATE narrative_edit_candidates SET status='abandoned',updated_at=now() WHERE turn_id=$1",
      [turnId]
    );
  }
  private fromRow(row: Record<string, unknown>): NarrativeCandidate {
    return {
      turnId: row.turn_id as string,
      campaignId: row.campaign_id as string,
      candidateDigest: row.candidate_digest as string,
      campaignRevision: row.campaign_revision as number,
      ruleContext: row.rule_context,
      settings: row.settings as ProviderSettings,
      rawResponse: row.raw_response,
      rawNarrative: row.raw_narrative as string,
      editedNarrative: row.edited_narrative as string | null,
      status: row.status as NarrativeCandidate['status'],
      owner: row.owner as string,
    };
  }
}
