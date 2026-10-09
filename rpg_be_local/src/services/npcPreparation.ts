import { validateProfileKnowledge } from '../domain/continuity.js';
import { isDeepStrictEqual } from 'node:util';
import { isApiProvider } from '../providers/options.js';
import { turnRuleReads } from './ruleReadRecords.js';
import { CampaignSourceLookup } from './campaignSourceLookup.js';
import { gameplayResponseSchema } from '../domain/gameplayResponse.js';
import { sourceSpanSchema } from '../domain/knowledge.js';
import { bindResponseCitations } from '../domain/citationBinding.js';
import { randomUUID, createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { Store } from '../store.js';
import { DiceService } from './dice.js';
import { Problem } from '../errors.js';
import type { Turn } from '../domain/types.js';
import type { Generator } from '../providers/service.js';
import type { PromptTraceContext } from '../providers/promptLog.js';
import { canonicalRuleJson } from '../domain/rules.js';
import { KnowledgeVisibility, validateKnowledgeEvidence } from '../domain/knowledge.js';
import { npcCreatorPrompt, npcCreatorJsonSchema } from '../domain/npcCreationGeneration.js';
import {
  npcPrepareSchema,
  npcCreatorOutputSchema,
  npcPreparationPayloadSchema,
  preparationOperations,
  NpcPreparationStatus,
  type NpcPreparationPayload,
} from '../domain/npcPreparation.js';

export const npcArgumentDigest = (value: unknown): string =>
  createHash('sha256').update(canonicalRuleJson(value)).digest('hex');
/** The native child-tool wait is explicitly opt-in until live isolation compatibility is verified. */
export function npcPreparationAvailable(provider: string): boolean {
  return isApiProvider(provider) || process.env.RPG_NPC_PREPARATION_NATIVE === '1';
}
export class NpcPreparationService {
  constructor(
    readonly store: Store,
    readonly generator?: Generator
  ) {}
  async ready(sessionId: string, client?: PoolClient): Promise<NpcPreparationPayload[]> {
    const rows = await (client ?? this.store.pool).query(
      'SELECT result FROM npc_preparations WHERE session_id=$1 AND status=$2 ORDER BY created_at,id',
      [sessionId, NpcPreparationStatus.Ready]
    );
    return rows.rows.map((row) => npcPreparationPayloadSchema.parse(row.result));
  }
  async introductionEvidence(
    sessionId: string,
    client: PoolClient
  ): Promise<Map<string, import('../domain/knowledge.js').KnowledgeValidation>> {
    const rows = await client.query(
      'SELECT reserved_character_id,frozen_input FROM npc_preparations WHERE session_id=$1 AND status=$2',
      [sessionId, NpcPreparationStatus.Ready]
    );
    return new Map(
      rows.rows.map((row) => [row.reserved_character_id, row.frozen_input.introductionEvidence])
    );
  }
  async prepare(
    turn: Turn,
    raw: unknown,
    signal?: AbortSignal,
    trace?: PromptTraceContext
  ): Promise<Record<string, unknown>> {
    if (!this.generator || !npcPreparationAvailable(turn.settings.provider))
      throw new Problem(
        503,
        'npc_creation_unavailable',
        'NPC creation is unavailable for this provider; native providers require explicit opt-in'
      );
    let input = npcPrepareSchema.parse(raw);
    if (input.introduction.visibility === KnowledgeVisibility.GmOnly)
      throw new Problem(422, 'npc_hidden', 'Unrevealed NPC identities belong in private knowledge');
    const argumentsInput = structuredClone(input);
    const argumentDigest = npcArgumentDigest(input);
    const claim = randomUUID();
    const reserved = await this.store.transaction(async (client) => {
      await new DiceService(this.store).assertOwned(turn, client);
      const sessionRows = await client.query(
        'SELECT * FROM dice_sessions WHERE id=$1 AND campaign_id=$2 FOR UPDATE',
        [turn.diceSessionId, turn.campaignId]
      );
      const session = sessionRows.rows[0];
      if (
        !session ||
        session.imported ||
        !session.frozen_continuity ||
        session.frozen_prompt !== turn.context?.prompt
      )
        throw new Problem(
          409,
          'npc_session',
          'NPC creation requires its captured executable session'
        );
      const previous = await client.query(
        'SELECT * FROM npc_preparations WHERE session_id=$1 AND local_key=$2 FOR UPDATE',
        [session.id, input.localKey]
      );
      const old = previous.rows[0];
      if (old?.argument_digest !== undefined && old.argument_digest !== argumentDigest)
        throw new Problem(
          409,
          'npc_preparation_conflict',
          'NPC preparation key was used with different arguments'
        );
      if (old?.status === NpcPreparationStatus.Ready)
        return { replay: npcPreparationPayloadSchema.parse(old.result) };
      if (old?.status === NpcPreparationStatus.Running && old.owner_turn_id === turn.id)
        throw new Problem(409, 'npc_preparation_running', 'NPC preparation is already running');
      if (old && old.owner_turn_id === turn.id && old.status !== NpcPreparationStatus.Ready)
        throw new Problem(
          409,
          'npc_preparation_retry',
          'NPC preparation failed or was interrupted; explicitly retry the turn to retry creation'
        );
      const knowledge = session.frozen_knowledge?.records ?? [];
      const characters = session.frozen_knowledge?.npcCharacters ?? [];
      for (const id of input.relevantKnowledgeIds ?? [])
        if (!knowledge.some((r: { id: string }) => r.id === id))
          throw new Problem(422, 'npc_reference', 'Knowledge is not in the frozen context');
      const mandatory = JSON.parse(session.frozen_prompt).mandatory;
      const roster = [...(mandatory.characters ?? []), ...characters];
      for (const id of [
        ...(input.relevantCharacterIds ?? []),
        ...(input.distinctFromCharacterIds ?? []),
      ])
        if (!roster.some((c: { id: string }) => c.id === id))
          throw new Problem(422, 'npc_reference', 'Character is not in the frozen context');
      const sourceReads = await new CampaignSourceLookup(this.store).records(
        turn.campaignId,
        turn.id,
        client
      );
      const sourceSpans = [
        ...(turn.context?.sourceSpans ?? []),
        ...sourceReads.flatMap((r) =>
          r.payload.sourceSpan ? [sourceSpanSchema.parse(r.payload.sourceSpan)] : []
        ),
      ];
      const ruleReads = await turnRuleReads(turn.id, client);
      const introductionEvidence = old?.frozen_input.introductionEvidence ?? {
        campaignId: turn.campaignId,
        turnId: turn.id,
        sourceSpans,
        ruleContext: turn.ruleContext,
        ruleReads,
      };
      const bound = old
        ? undefined
        : (bindResponseCitations(
            gameplayResponseSchema.parse({
              narrative: 'NPC draft',
              operations: [
                {
                  op: 'create',
                  character: input.establishedCharacter ?? { name: 'Draft', type: 'npc' },
                  introduction: input.introduction,
                },
              ],
              knowledgeChanges: [],
              ruleCitations: [],
              rollInterpretations: [],
              operationExplanations: [],
              combatEffects: [],
              participantReferences: [],
            }),
            {
              campaignId: turn.campaignId,
              turnId: turn.id,
              sourceSpans,
              ruleContext: turn.ruleContext,
              ruleReads,
            }
          ) as { operations: { introduction: typeof input.introduction }[] });
      input = {
        ...input,
        introduction: old?.frozen_input.introduction ?? bound!.operations[0]!.introduction,
      };
      validateKnowledgeEvidence(input.introduction, introductionEvidence);
      const frozenInput = old?.frozen_input ?? {
        arguments: argumentsInput,
        introduction: input.introduction,
        introductionEvidence,
        intent: input.intent,
        roleHint: input.roleHint,
        establishedCharacter: input.establishedCharacter,
        instructions: session.system_prompt,
        campaign: {
          description: (await this.store.campaign(turn.campaignId, client)).description,
          state: mandatory.state,
        },
        knowledge: knowledge.filter((r: { id: string }) =>
          (input.relevantKnowledgeIds ?? []).includes(r.id)
        ),
        characters: roster.filter((c: { id: string }) =>
          (input.relevantCharacterIds ?? []).includes(c.id)
        ),
      };
      const id = old?.id ?? randomUUID();
      const characterId = old?.reserved_character_id ?? randomUUID();
      if (!old)
        await client.query(
          'INSERT INTO npc_preparations(id,campaign_id,session_id,turn_id,owner_turn_id,local_key,argument_digest,frozen_input,provider_settings,reserved_character_id,status,owner_id) VALUES($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10,$11)',
          [
            id,
            turn.campaignId,
            session.id,
            turn.id,
            input.localKey,
            argumentDigest,
            frozenInput,
            turn.settings,
            characterId,
            NpcPreparationStatus.Running,
            claim,
          ]
        );
      else
        await client.query(
          'UPDATE npc_preparations SET status=$2,owner_id=$3,owner_turn_id=$4,safe_error=NULL,updated_at=now() WHERE id=$1',
          [id, NpcPreparationStatus.Running, claim, turn.id]
        );
      return { id, characterId, frozenInput, settings: old?.provider_settings ?? turn.settings };
    });
    if ('replay' in reserved && reserved.replay) return preparationOperations(reserved.replay);
    if (!('id' in reserved))
      throw new Problem(409, 'npc_preparation_claim', 'Preparation could not be claimed');
    try {
      if (signal?.aborted) throw new Problem(409, 'cancelled', 'NPC creation cancelled');
      const output = npcCreatorOutputSchema.parse(
        await this.generator.generate(
          reserved.settings,
          npcCreatorPrompt(reserved.frozenInput),
          npcCreatorJsonSchema,
          signal,
          trace ? { ...trace, executionId: randomUUID(), purpose: 'npc_preparation' } : undefined
        )
      );
      if (input.establishedCharacter && output.name !== input.establishedCharacter.name)
        throw new Problem(422, 'npc_established_name', 'Creator changed the supplied NPC name');
      if (
        output.profile.secret &&
        JSON.stringify(output.description).includes(output.profile.secret)
      )
        throw new Problem(422, 'npc_secret', 'Private secret was copied into public description');
      for (const [key, value] of Object.entries(input.establishedCharacter?.description ?? {}))
        if (
          key in output.description &&
          !isDeepStrictEqual(value, output.description[key as keyof typeof output.description])
        )
          throw new Problem(
            422,
            'npc_established_description',
            'Creator changed an established public descriptor'
          );
      const payload = npcPreparationPayloadSchema.parse({
        receiptId: reserved.id,
        characterId: reserved.characterId,
        publicCharacter: {
          name: output.name,
          type: 'npc',
          attributes: input.establishedCharacter?.attributes ?? {},
          inventory: input.establishedCharacter?.inventory ?? {},
          description: { ...input.establishedCharacter?.description, ...output.description },
        },
        profile: { ...output.profile, characterId: reserved.characterId },
        introduction: input.introduction,
      });
      await this.store.transaction(async (client) => {
        await new DiceService(this.store).assertOwned(turn, client);
        if (signal?.aborted) throw new Problem(409, 'cancelled', 'NPC creation cancelled');
        const row = await client.query('SELECT * FROM npc_preparations WHERE id=$1 FOR UPDATE', [
          reserved.id,
        ]);
        if (row.rows[0]?.owner_id !== claim || row.rows[0]?.status !== NpcPreparationStatus.Running)
          throw new Problem(409, 'npc_preparation_claim', 'NPC preparation ownership was lost');
        const campaign = await this.store.campaign(turn.campaignId, client);
        const drafts = await this.ready(turn.diceSessionId!, client);
        if (
          [
            ...campaign.characters,
            ...drafts.map((p) => ({ ...p.publicCharacter, id: p.characterId })),
          ].some(
            (c) =>
              c.name.toLocaleLowerCase() === payload.publicCharacter.name.toLocaleLowerCase() &&
              !(input.distinctFromCharacterIds ?? []).includes(c.id)
          )
        )
          throw new Problem(
            409,
            'npc_identity_ambiguous',
            'An NPC with this name already exists; resolve identity before creation'
          );
        const allowed = (
          reserved.frozenInput as {
            knowledge: import('../domain/knowledge.js').CampaignKnowledge[];
          }
        ).knowledge;
        validateProfileKnowledge(payload.profile, allowed);
        for (const id of [
          ...payload.profile.relationshipKnowledgeIds,
          ...payload.profile.revealedTraitKnowledgeIds,
        ])
          if (!allowed.some((r) => r.id === id))
            throw new Problem(
              422,
              'npc_reference',
              'Creator used knowledge outside its captured input'
            );
        await client.query(
          'UPDATE npc_preparations SET status=$2,result=$3,owner_id=NULL,updated_at=now() WHERE id=$1 AND owner_id=$4',
          [reserved.id, NpcPreparationStatus.Ready, payload, claim]
        );
      });
      return preparationOperations(payload);
    } catch (error) {
      await this.store.pool.query(
        'UPDATE npc_preparations SET status=$2,safe_error=$3,owner_id=NULL,updated_at=now() WHERE id=$1 AND owner_id=$4 AND status=$5',
        [
          reserved.id,
          signal?.aborted ? NpcPreparationStatus.Interrupted : NpcPreparationStatus.Failed,
          { code: 'npc_creation_failed', detail: 'NPC creation did not complete' },
          claim,
          NpcPreparationStatus.Running,
        ]
      );
      if (error instanceof Problem) throw error;
      throw new Problem(
        502,
        'npc_creation_failed',
        'NPC creation failed; the draft was not committed'
      );
    }
  }
}
