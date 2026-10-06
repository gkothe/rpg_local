import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
import { Store } from '../store.js';
import { Problem } from '../errors.js';
import type { Turn, JsonObject } from '../domain/types.js';
import { canonicalRuleJson } from '../domain/rules.js';
import { KnowledgeVisibility } from '../domain/knowledge.js';
import { usesCombatContract } from '../domain/versions.js';
import {
  combatPrepareSchema,
  combatTracking,
  missingTrackedPaths,
  CombatProblem,
  type CombatAuthorization,
  type CombatEncounter,
  type CombatParticipant,
  type PreparedDraft,
  type TrackedField,
} from '../domain/combat.js';
import { DiceService } from './dice.js';

type Sheet = {
  id: string;
  name: string;
  type: string;
  attributes: JsonObject;
  inventory: JsonObject;
  description: JsonObject;
};
type SessionRow = {
  id: string;
  campaign_id: string;
  imported: boolean;
  prompt_contract_version: number | null;
  frozen_prompt: string;
  character_ids: string[];
  frozen_knowledge: { npcCharacters?: Sheet[] } | null;
};
export type CombatPreparationPayload = {
  receiptId: string;
  encounterId: string;
  encounter: 'active' | 'new';
  legacyCombat: boolean;
  participants: (CombatParticipant & { origin: 'existing' | 'prepared'; sheet: Sheet })[];
  createOperations: {
    op: 'create';
    characterId: string;
    preparationReceiptId: string;
    character: PreparedDraft['character'];
    introduction: PreparedDraft['introduction'];
  }[];
  guidance: string;
};
export type CombatSessionAuthorization = CombatAuthorization & {
  preparations: { receiptId: string; preparationKey: string; payload: CombatPreparationPayload }[];
};
const digest = (value: unknown) =>
  createHash('sha256').update(canonicalRuleJson(value)).digest('hex');
const fail = (code: string, message: string): never => {
  throw new Problem(422, code, message);
};
const PREPARATION_GUIDANCE =
  'Use these character IDs in roll_dice actorId/targetId, combatEffects and participantReferences. Each prepared NPC you use must be created with its exact createOperations entry; add every participant you use to state.combat with the returned label and trackedFields. Unused prepared drafts remain audit only.';

/** Frozen session context: the campaign as captured before this logical action started. */
export function frozenCombatContext(session: SessionRow): {
  encounter: CombatEncounter | null;
  legacy: boolean;
  sheets: Map<string, Sheet>;
} {
  const mandatory = (JSON.parse(session.frozen_prompt) as { mandatory?: Record<string, unknown> })
    .mandatory;
  const tracking = combatTracking((mandatory?.state ?? {}) as JsonObject);
  const sheets = new Map<string, Sheet>();
  for (const sheet of [
    ...((mandatory?.characters ?? []) as Sheet[]),
    ...(session.frozen_knowledge?.npcCharacters ?? []),
  ])
    if (session.character_ids.includes(sheet.id)) sheets.set(sheet.id, sheet);
  return {
    encounter: tracking.kind === 'structured' ? tracking.encounter : null,
    legacy: tracking.kind === 'legacy',
    sheets,
  };
}

export class CombatPreparationService {
  constructor(readonly store: Store) {}
  private async session(turn: Turn, client: PoolClient): Promise<SessionRow> {
    const result = await client.query(
      'SELECT * FROM dice_sessions WHERE id=$1 AND campaign_id=$2 FOR UPDATE',
      [turn.diceSessionId, turn.campaignId]
    );
    const session = result.rows[0] as SessionRow | undefined;
    if (
      !turn.diceSessionId ||
      !session ||
      session.imported ||
      !usesCombatContract(session.prompt_contract_version ?? undefined)
    )
      throw new Problem(
        409,
        CombatProblem.Identity,
        'Combat preparation requires an executable version 6 session'
      );
    if (session.frozen_prompt !== turn.context?.prompt)
      throw new Problem(409, 'dice_context', 'Combat preparation must use the frozen context');
    return session;
  }
  /** Idempotent by preparation key; one logical session prepares at most one encounter. */
  async prepare(turn: Turn, raw: unknown): Promise<CombatPreparationPayload> {
    return this.store.transaction(async (client) => {
      await new DiceService(this.store).assertOwned(turn, client);
      const session = await this.session(turn, client);
      const input = combatPrepareSchema.parse(raw);
      const argumentDigest = digest(input);
      const prior = await client.query(
        'SELECT argument_digest,payload FROM combat_preparations WHERE session_id=$1 AND preparation_key=$2',
        [session.id, input.localKey]
      );
      if (prior.rows[0]) {
        if (prior.rows[0].argument_digest !== argumentDigest)
          throw new Problem(
            409,
            CombatProblem.PreparationConflict,
            'This preparation key was already used with different arguments'
          );
        return prior.rows[0].payload as CombatPreparationPayload;
      }
      const registry = await this.authorization(session.id, client);
      const frozen = frozenCombatContext(session);
      let encounterId: string;
      if (input.encounterId) {
        const known =
          registry.encounterId ?? (frozen.encounter?.active ? frozen.encounter.id : null);
        if (input.encounterId !== known)
          fail(
            CombatProblem.Identity,
            'encounterId must be the active encounter or the one already prepared in this action'
          );
        encounterId = input.encounterId;
      } else
        encounterId =
          registry.encounterId ?? (frozen.encounter?.active ? frozen.encounter.id : randomUUID());
      const receiptId = randomUUID();
      const participants: CombatPreparationPayload['participants'] = [];
      const createOperations: CombatPreparationPayload['createOperations'] = [];
      const reservations: { id: string; localKey: string; digest: string; draft: object }[] = [];
      const sameBinding = (characterId: string, label: string, fields: TrackedField[]) => {
        const earlier = registry.participants.find((p) => p.characterId === characterId);
        if (
          earlier &&
          (earlier.label !== label || !isDeepStrictEqual(earlier.trackedFields, fields))
        )
          throw new Problem(
            409,
            CombatProblem.PreparationConflict,
            `${label}: this individual was already prepared with a different label or tracked fields`
          );
      };
      for (const entry of input.participants) {
        if ('characterId' in entry) {
          const sheet = frozen.sheets.get(entry.characterId);
          if (!sheet || registry.drafts.some((d) => d.characterId === entry.characterId))
            fail(
              CombatProblem.Identity,
              `${entry.label}: existing participants must be saved characters from this action's frozen context`
            );
          if (missingTrackedPaths(sheet!.attributes, entry.trackedFields).length)
            fail(
              CombatProblem.State,
              `${entry.label}: tracked fields must already exist in the character's attributes`
            );
          sameBinding(entry.characterId, entry.label, entry.trackedFields);
          participants.push({
            characterId: entry.characterId,
            label: entry.label,
            trackedFields: entry.trackedFields,
            origin: 'existing',
            sheet: sheet!,
          });
          continue;
        }
        if (entry.introduction.visibility === KnowledgeVisibility.GmOnly)
          fail(
            CombatProblem.Identity,
            'Character sheets are public; keep unrevealed combatants in GM-only knowledge'
          );
        if (missingTrackedPaths(entry.character.attributes, entry.trackedFields).length)
          fail(
            CombatProblem.State,
            `${entry.label}: the draft attributes must contain every tracked field`
          );
        const specification = {
          label: entry.label,
          character: entry.character,
          introduction: entry.introduction,
          trackedFields: entry.trackedFields,
        };
        const specificationDigest = digest(specification);
        const reserved = await client.query(
          'SELECT id,preparation_id,specification_digest FROM combat_prepared_characters WHERE session_id=$1 AND local_key=$2',
          [session.id, entry.localKey]
        );
        let characterId: string;
        let preparationReceiptId = receiptId;
        if (reserved.rows[0]) {
          if (reserved.rows[0].specification_digest !== specificationDigest)
            throw new Problem(
              409,
              CombatProblem.PreparationConflict,
              `${entry.label}: localKey ${entry.localKey} was already prepared with a different specification`
            );
          characterId = reserved.rows[0].id;
          preparationReceiptId = reserved.rows[0].preparation_id;
        } else {
          characterId = randomUUID();
          reservations.push({
            id: characterId,
            localKey: entry.localKey,
            digest: specificationDigest,
            draft: specification,
          });
        }
        participants.push({
          characterId,
          label: entry.label,
          trackedFields: entry.trackedFields,
          origin: 'prepared',
          sheet: { id: characterId, ...entry.character },
        });
        createOperations.push({
          op: 'create',
          characterId,
          preparationReceiptId,
          character: entry.character,
          introduction: entry.introduction,
        });
      }
      const payload: CombatPreparationPayload = {
        receiptId,
        encounterId,
        encounter:
          frozen.encounter?.active && frozen.encounter.id === encounterId ? 'active' : 'new',
        legacyCombat: frozen.legacy,
        participants,
        createOperations,
        guidance: PREPARATION_GUIDANCE,
      };
      await client.query(
        'INSERT INTO combat_preparations(id,campaign_id,session_id,turn_id,encounter_id,preparation_key,argument_digest,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          receiptId,
          turn.campaignId,
          session.id,
          turn.id,
          encounterId,
          input.localKey,
          argumentDigest,
          payload,
        ]
      );
      for (const reservation of reservations)
        await client.query(
          'INSERT INTO combat_prepared_characters(id,campaign_id,session_id,preparation_id,local_key,specification_digest,draft) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [
            reservation.id,
            turn.campaignId,
            session.id,
            receiptId,
            reservation.localKey,
            reservation.digest,
            reservation.draft,
          ]
        );
      return payload;
    });
  }
  /** Union of every receipt in the logical session, in creation order. */
  async authorization(sessionId: string, client?: PoolClient): Promise<CombatSessionAuthorization> {
    const db = client ?? this.store.pool;
    const rows = await db.query(
      'SELECT id,preparation_key,encounter_id,payload FROM combat_preparations WHERE session_id=$1 ORDER BY created_at,id',
      [sessionId]
    );
    const drafts = await db.query(
      'SELECT id,preparation_id,local_key,draft FROM combat_prepared_characters WHERE session_id=$1 ORDER BY created_at,id',
      [sessionId]
    );
    const participants = new Map<string, CombatParticipant>();
    for (const row of rows.rows)
      for (const p of (row.payload as CombatPreparationPayload).participants)
        if (!participants.has(p.characterId))
          participants.set(p.characterId, {
            characterId: p.characterId,
            label: p.label,
            trackedFields: p.trackedFields,
          });
    return {
      encounterId: rows.rows[0]?.encounter_id ?? null,
      participants: [...participants.values()],
      // Batch order, not random UUID order, for rows reserved in the same transaction.
      drafts: drafts.rows
        .map((row) => ({
          row,
          position: rows.rows
            .flatMap((prep) =>
              (prep.payload as CombatPreparationPayload).createOperations.map(
                (op) => op.characterId
              )
            )
            .indexOf(row.id),
        }))
        .sort((a, b) => a.position - b.position)
        .map(({ row }) => ({
          characterId: row.id,
          receiptId: row.preparation_id,
          localKey: row.local_key,
          ...row.draft,
        })),
      preparations: rows.rows.map((row) => ({
        receiptId: row.id,
        preparationKey: row.preparation_key,
        payload: row.payload,
      })),
    };
  }
}
