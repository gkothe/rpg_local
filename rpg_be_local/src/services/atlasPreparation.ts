import { atlasObservations } from '../domain/atlasRecall.js';
import { assertAtlas } from '../domain/atlasCompatibility.js';
import { randomUUID, createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { Store } from '../store.js';
import { Problem } from '../errors.js';
import type { Turn } from '../domain/types.js';
import type { Generator } from '../providers/service.js';
import type { PromptTraceContext } from '../providers/promptLog.js';
import { DiceService } from './dice.js';
import { CampaignSourceLookup } from './campaignSourceLookup.js';
import { turnRuleReads } from './ruleReadRecords.js';
import { canonicalRuleJson } from '../domain/rules.js';
import {
  atlasPrepareSchema,
  atlasPreparedSchema,
  atlasDraftSchema,
  atlasEvidenceSchema,
  type AtlasPrepared,
} from '../domain/atlasPreparation.js';
import { atlasRecall, frozenAtlasSchema } from '../domain/atlasRecall.js';
import { prepareAtlasResult, compileAtlas } from '../domain/atlasCommit.js';
import { bindResponseCitations } from '../domain/citationBinding.js';
import { gameplayResponseSchema } from '../domain/gameplayResponse.js';
import { applyResponse } from '../domain/state.js';
import { z } from 'zod';

export class AtlasPreparationService {
  constructor(
    readonly store: Store,
    readonly generator?: Generator
  ) {}
  async ready(sessionId: string, client?: PoolClient): Promise<AtlasPrepared[]> {
    const result = await (client ?? this.store.pool).query(
      "SELECT result FROM atlas_preparations WHERE session_id=$1 AND status='ready' ORDER BY created_at,id",
      [sessionId]
    );
    return result.rows.map((r) => atlasPreparedSchema.parse(r.result));
  }
  async prepare(turn: Turn, raw: unknown, signal?: AbortSignal, trace?: PromptTraceContext) {
    if (!this.generator)
      throw new Problem(503, 'atlas_provider', 'Cartography requires a configured generator');
    const input = atlasPrepareSchema.parse(raw),
      digest = createHash('sha256').update(canonicalRuleJson(input)).digest('hex'),
      owner = randomUUID();
    const claim = await this.store.transaction(async (client) => {
      await new DiceService(this.store).assertOwned(turn, client);
      const sessions = await client.query(
        'SELECT * FROM dice_sessions WHERE id=$1 AND campaign_id=$2 FOR UPDATE',
        [turn.diceSessionId, turn.campaignId]
      );
      const session = sessions.rows[0];
      if (
        !session ||
        session.imported ||
        !session.frozen_atlas ||
        session.frozen_prompt !== turn.context?.prompt
      )
        throw new Problem(
          409,
          'atlas_session',
          'Cartography requires its captured executable session'
        );
      assertAtlas(session.frozen_atlas, await this.store.campaign(turn.campaignId, client));
      const prior = await client.query(
        'SELECT * FROM atlas_preparations WHERE session_id=$1 AND local_key=$2 FOR UPDATE',
        [session.id, input.localKey]
      );
      const old = prior.rows[0];
      if (old && old.argument_digest !== digest)
        throw new Problem(
          409,
          'atlas_request_reused',
          'Cartographer key reused with different input'
        );
      if (old?.status === 'ready') return { replay: atlasPreparedSchema.parse(old.result) };
      if (old && old.owner_turn_id === turn.id)
        throw new Problem(
          409,
          'atlas_preparation_retry',
          'Preparation is running or interrupted; explicitly retry this turn'
        );
      const reads = await new CampaignSourceLookup(this.store).records(
        turn.campaignId,
        turn.id,
        client
      );
      const evidence = atlasEvidenceSchema.parse({
        campaignId: turn.campaignId,
        turnId: turn.id,
        mapObservations: atlasObservations(turn.context?.frozenAtlas),
        sourceSpans: [
          ...(turn.context?.sourceSpans ?? []),
          ...reads.flatMap((r) => (r.payload.sourceSpan ? [r.payload.sourceSpan] : [])),
        ],
        ruleReads: await turnRuleReads(turn.id, client),
        ...(turn.ruleContext ? { ruleContext: turn.ruleContext } : {}),
      });
      const frozenInput = old?.frozen_input ?? {
        input,
        frozen: frozenAtlasSchema.parse(session.frozen_atlas),
        evidence,
      };
      const id = old?.id ?? randomUUID();
      if (!old)
        await client.query(
          "INSERT INTO atlas_preparations(id,campaign_id,session_id,turn_id,owner_turn_id,local_key,argument_digest,frozen_input,provider_settings,status,owner_id) VALUES($1,$2,$3,$4,$4,$5,$6,$7,$8,'running',$9)",
          [
            id,
            turn.campaignId,
            session.id,
            turn.id,
            input.localKey,
            digest,
            frozenInput,
            turn.settings,
            owner,
          ]
        );
      else
        await client.query(
          "UPDATE atlas_preparations SET status='running',owner_id=$2,owner_turn_id=$3,safe_error=NULL,updated_at=now() WHERE id=$1",
          [id, owner, turn.id]
        );
      return { id, frozenInput, settings: old?.provider_settings ?? turn.settings };
    });
    if ('replay' in claim) return { receiptId: claim.replay!.id, draft: claim.replay!.draft };
    try {
      signal?.throwIfAborted();
      const frozen = frozenAtlasSchema.parse(claim.frozenInput.frozen);
      const prompt = JSON.stringify({
        instruction:
          'Create a compact campaign geography draft, never commit it. Preserve established Places, routes, dimensions and visibility. New places use local keys; references use {localKey}. Existing identities use UUIDs and the expected content token from world_map_get, or full expected values. Create fictional detail only where unknown; source facts require exact supplied evidence. Rooms/junctions may have frame placements; tunnels use explicit connections. Geometry is not connectivity. No party movement, automatic time, combat or NPC changes.',
        intent: input.intent,
        map: atlasRecall(frozen).get({ scope: input.scope }),
        sourceEvidence: claim.frozenInput.evidence,
        outputSchema: z.toJSONSchema(atlasDraftSchema),
      });
      const output = await this.generator.generate(
        claim.settings,
        prompt,
        z.toJSONSchema(atlasDraftSchema),
        signal,
        trace
      );
      let prepared = prepareAtlasResult(
        claim.id,
        output,
        atlasEvidenceSchema.parse(claim.frozenInput.evidence)
      );
      // Normalize evidence using the same exact-quote binder that validates the final turn.
      const wire = gameplayResponseSchema.parse({
        narrative: 'Atlas draft validation',
        operations: [],
        knowledgeChanges: [],
        rollInterpretations: [],
        ruleCitations: [],
        operationExplanations: [],
        combatEffects: [],
        participantReferences: [],
        atlasChanges: { preparedReceiptIds: [prepared.id] },
      });
      const compiled = compileAtlas(wire, [prepared]);
      const context = {
        ...prepared.evidence,
        preparedKnowledgeIds: compiled.ids,
        preparedKnowledgeEvidence: compiled.knowledgeEvidence,
        preparedAtlasEvidence: compiled.atlasEvidence,
      };
      const bound = bindResponseCitations(compiled.response, context);
      const current = await this.store.campaign(turn.campaignId);
      applyResponse(
        { ...current, atlas: frozen.atlas, knowledge: frozen.records },
        bound,
        turn.id,
        context
      );
      const knowledge = bound.knowledgeChanges;
      prepared = {
        ...prepared,
        draft: {
          ...prepared.draft,
          places: prepared.draft.places.map((p, i) => ({ ...p, evidence: knowledge[i]!.evidence })),
          changes: {
            ...prepared.draft.changes,
            frames: prepared.draft.changes.frames?.map((f, i) => ({
              ...f,
              value: { ...f.value, evidence: bound.atlasChanges!.frames![i]!.value.evidence },
            })),
            routes: prepared.draft.changes.routes?.map((r, i) => ({
              ...r,
              value: { ...r.value, evidence: bound.atlasChanges!.routes![i]!.value.evidence },
            })),
          },
        },
      };
      signal?.throwIfAborted();
      await this.store.transaction(async (client) => {
        await new DiceService(this.store).assertOwned(turn, client);
        const result = await client.query(
          "UPDATE atlas_preparations SET status='ready',owner_id=NULL,result=$3,updated_at=now() WHERE id=$1 AND owner_id=$2 AND status='running'",
          [claim.id, owner, prepared]
        );
        if (!result.rowCount)
          throw new Problem(409, 'atlas_stale', 'Cartographer lost ownership before publication');
      });
      return { receiptId: prepared.id, draft: prepared.draft };
    } catch (error) {
      await this.store.pool.query(
        "UPDATE atlas_preparations SET status=$3,owner_id=NULL,safe_error=$4,updated_at=now() WHERE id=$1 AND owner_id=$2 AND status='running'",
        [
          claim.id,
          owner,
          signal?.aborted ? 'interrupted' : 'failed',
          error instanceof Problem
            ? error.message
            : 'Cartographer failed; review provider diagnostics and retry.',
        ]
      );
      throw error;
    }
  }
}
