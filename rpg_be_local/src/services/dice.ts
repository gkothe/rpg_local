import type { FrozenCampaignSources } from '../domain/campaignSourceRecall.js';
import { type FrozenKnowledge } from '../domain/knowledgeRecall.js';
import type { GameplayToolDefinition } from '../providers/gameplayTools.js';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { Store, ownerId } from '../store.js';
import { Problem } from '../errors.js';
import { TurnStatus } from '../domain/options.js';
import type { Turn } from '../domain/types.js';
import { CombatProblem, CombatRollScope } from '../domain/combat.js';
import { CombatPreparationService, frozenCombatContext } from './combatPreparation.js';
import {
  DICE_LIMITS,
  diceInputSchema,
  generateFaces,
  type DiceRecord,
  type DiceResult,
} from '../domain/dice.js';

import { diceDigest } from '../domain/diceContext.js';
import { RuleStore } from './ruleStore.js';
export { diceDigest, gameplayDigest } from '../domain/diceContext.js';
export class DiceService {
  constructor(readonly store: Store) {}
  async createSession(
    turn: Turn,
    contextDigest: string,
    characterIds: string[],
    metadata: {
      frozenSources?: FrozenCampaignSources;
      systemPrompt: string;
      knowledge: FrozenKnowledge;
      toolDefinitions: GameplayToolDefinition[];
    }
  ): Promise<string> {
    return this.store.transaction(async (client) => {
      await this.assertOwned(turn, client);
      if (turn.ruleContext) await new RuleStore(this.store).guard(turn.ruleContext, client);
      const id = randomUUID();
      try {
        await client.query(
          'INSERT INTO dice_sessions(id,campaign_id,root_turn_id,context_digest,frozen_prompt,frozen_revision,character_ids,system_prompt,frozen_knowledge,tool_definitions,frozen_sources) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
          [
            id,
            turn.campaignId,
            turn.id,
            contextDigest,
            turn.context!.prompt,
            turn.context!.revision,
            JSON.stringify(characterIds),
            metadata.systemPrompt,
            metadata.knowledge,
            JSON.stringify(metadata.toolDefinitions),
            metadata.frozenSources ?? null,
          ]
        );
      } catch (error) {
        if ((error as { code?: string }).code === '42703')
          throw new Problem(
            503,
            'database_setup',
            'Database migrations are missing. Run setup-database.cmd in the project root, then restart the application; no game-state changes were applied.'
          );
        throw error;
      }
      await client.query(
        'INSERT INTO dice_attempts(turn_id,campaign_id,session_id) VALUES($1,$2,$3)',
        [turn.id, turn.campaignId, id]
      );
      const active = await this.store.turn(turn.campaignId, turn.id, client);
      active.diceSessionId = id;
      if (active.context) active.context.diceSessionId = id;
      if (turn.context) turn.context.diceSessionId = id;
      turn.diceSessionId = id;
      await this.store.saveTurn(active, client);
      return id;
    });
  }
  async assertOwned(turn: Turn, client: PoolClient): Promise<void> {
    await this.store.campaign(turn.campaignId, client, true);
    const result = await client.query(
      'SELECT owner,status,lease_until,document FROM turns WHERE id=$1 AND campaign_id=$2 FOR UPDATE',
      [turn.id, turn.campaignId]
    );
    const row = result.rows[0];
    if (
      !row ||
      row.owner !== ownerId ||
      row.status !== TurnStatus.Running ||
      new Date(row.lease_until).getTime() <= Date.now()
    )
      throw new Problem(409, 'dice_inactive', 'Dice attempt is no longer active');
    if (row.document.context?.prompt !== turn.context?.prompt)
      throw new Problem(409, 'dice_context', 'Dice requests must use the active attempt context');
  }
  async records(sessionId: string, client?: PoolClient): Promise<DiceRecord[]> {
    const result = await (client ?? this.store.pool).query(
      'SELECT * FROM dice_records WHERE session_id=$1 ORDER BY slot',
      [sessionId]
    );
    return result.rows.map((row) => ({
      ...row.input,
      id: row.id,
      sessionId: row.session_id,
      campaignId: row.campaign_id,
      groups: row.groups,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }
  async roll(sessionId: string, turn: Turn, raw: unknown): Promise<DiceResult> {
    // Invalid requests consume the persisted attempt allowance too. Returning the error from
    // the transaction commits its counter; throwing inside would incorrectly roll it back.
    const outcome = await this.store.transaction(async (client): Promise<DiceResult | Problem> => {
      await this.assertOwned(turn, client);
      const sessions = await client.query(
        'SELECT * FROM dice_sessions WHERE id=$1 AND campaign_id=$2 FOR UPDATE',
        [sessionId, turn.campaignId]
      );
      const session = sessions.rows[0];
      const attempts = await client.query(
        'SELECT * FROM dice_attempts WHERE turn_id=$1 AND session_id=$2 FOR UPDATE',
        [turn.id, sessionId]
      );
      const attempt = attempts.rows[0];
      if (!session || !attempt || session.imported)
        throw new Problem(
          409,
          'dice_session',
          'No executable local dice session belongs to this attempt'
        );
      if (turn.ruleContext) await new RuleStore(this.store).guard(turn.ruleContext, client);
      if (session.frozen_prompt !== turn.context?.prompt)
        throw new Problem(409, 'dice_context', 'Dice attempt must use its original frozen context');
      const requests = Math.min(attempt.requests + 1, DICE_LIMITS.requestsPerAttempt + 1);
      await client.query('UPDATE dice_attempts SET requests=$2 WHERE turn_id=$1', [
        turn.id,
        requests,
      ]);
      if (requests > DICE_LIMITS.requestsPerAttempt)
        return new Problem(422, 'dice_limit', 'Dice request limit exceeded');
      const parsed = diceInputSchema.safeParse(raw);
      if (!parsed.success)
        return new Problem(422, 'dice_input', 'Invalid dice input or dice limits exceeded');
      const input = parsed.data;
      // Prepared NPCs are authorized by receipt; the frozen character list never changes.
      const allowed = [...(session.character_ids as string[])];
      const prepared = await new CombatPreparationService(this.store).authorization(
        sessionId,
        client
      );
      const frozen = frozenCombatContext(session);
      allowed.push(...prepared.drafts.map((draft) => draft.characterId));
      const active = frozen.encounter?.active ? frozen.encounter : null;
      const encounterId = prepared.encounterId ?? active?.id ?? null;
      const participants = new Set([
        ...(active?.participants ?? []).map((p) => p.characterId),
        ...prepared.participants.map((p) => p.characterId),
      ]);
      if (
        input.scope === CombatRollScope.Combat &&
        (input.encounterId !== encounterId ||
          [input.actorId, input.targetId].some((id) => id && !participants.has(id)))
      )
        return new Problem(
          422,
          CombatProblem.Identity,
          'Combat rolls must use the active or prepared encounter and its participants'
        );
      if (
        input.scope === CombatRollScope.Character &&
        [input.actorId, input.targetId].some((id) => id && participants.has(id))
      )
        return new Problem(
          422,
          CombatProblem.Identity,
          'Encounter participants roll with combat scope while the encounter exists'
        );
      if ([input.actorId, input.targetId].some((id) => id && !allowed.includes(id)))
        return new Problem(
          422,
          'dice_character',
          'Dice character references must belong to the frozen context'
        );
      if (input.slot > attempt.next_slot)
        return new Problem(409, 'dice_order', 'Dice slots must be requested in order');
      const records = await this.records(sessionId, client);
      const stored = await client.query(
        'SELECT * FROM dice_records WHERE session_id=$1 AND slot=$2',
        [sessionId, input.slot]
      );
      const existing = stored.rows[0];
      const digest = diceDigest(input);
      if (existing && existing.spec_digest !== digest)
        return new Problem(
          409,
          'dice_specification',
          'The retry changed the original dice specification or declaration'
        );
      if (!existing && input.slot !== records.length)
        return new Problem(
          409,
          'dice_order',
          'Replay all original rolls in order before appending dice'
        );
      if (
        input.rerollOf &&
        !records.some((record) => record.id === input.rerollOf!.rollId && record.slot < input.slot)
      )
        return new Problem(
          422,
          'dice_reroll',
          'Reroll must reference an earlier recorded roll in this session'
        );
      const count = input.groups.reduce((sum, group) => sum + group.count, 0);
      if (!existing && session.new_faces + count > DICE_LIMITS.facesPerSession)
        return new Problem(422, 'dice_limit', 'Dice session face limit exceeded');
      const result: DiceResult = {
        rollId: existing?.id ?? randomUUID(),
        slot: input.slot,
        groups: existing?.groups ?? generateFaces(input),
        reused: !!existing,
      };
      const transcriptBytes =
        attempt.transcript_bytes +
        Buffer.byteLength(JSON.stringify(input), 'utf8') +
        Buffer.byteLength(JSON.stringify(result), 'utf8');
      if (transcriptBytes > DICE_LIMITS.transcriptBytes)
        return new Problem(
          422,
          'dice_limit',
          'Dice transcript exceeds the reserved byte allowance'
        );
      if (!existing) {
        await client.query(
          'INSERT INTO dice_records(id,campaign_id,session_id,slot,spec_digest,input,groups) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [
            result.rollId,
            turn.campaignId,
            sessionId,
            input.slot,
            digest,
            input,
            JSON.stringify(result.groups),
          ]
        );
        await client.query('UPDATE dice_sessions SET new_faces=new_faces+$2 WHERE id=$1', [
          sessionId,
          count,
        ]);
      }
      await client.query(
        'UPDATE dice_attempts SET next_slot=$2,transcript_bytes=$3 WHERE turn_id=$1',
        [turn.id, Math.max(attempt.next_slot, input.slot + 1), transcriptBytes]
      );
      return result;
    });
    if (outcome instanceof Problem) throw outcome;
    return outcome;
  }
}
