import { z } from 'zod';
import { Problem } from '../errors.js';
import {
  combatEffectSchema,
  combatEncounterSchema,
  participantReferenceSchema,
  paragraphCount,
} from '../domain/combat.js';
import { MAX_ENTITY_NAME_CHARS } from '../domain/limits.js';
import type { JsonObject } from '../domain/types.js';

const uuid = z.uuid();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const combatPreparationArchiveSchema = z
  .object({
    id: uuid,
    campaignId: uuid,
    sessionId: uuid,
    turnId: uuid,
    encounterId: uuid,
    preparationKey: z.string().min(1).max(MAX_ENTITY_NAME_CHARS),
    argumentDigest: digest,
    payload: z
      .object({
        receiptId: uuid,
        encounterId: uuid,
        participants: z.array(
          z.object({ characterId: uuid, sheet: z.object({ id: uuid }).loose() }).loose()
        ),
        createOperations: z.array(
          z.object({ characterId: uuid, preparationReceiptId: uuid }).loose()
        ),
      })
      .loose(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export const combatPreparedCharacterArchiveSchema = z
  .object({
    id: uuid,
    campaignId: uuid,
    sessionId: uuid,
    preparationId: uuid,
    localKey: z.string().min(1).max(MAX_ENTITY_NAME_CHARS),
    specificationDigest: digest,
    draft: z.record(z.string(), z.unknown()),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type CombatPreparationArchive = z.infer<typeof combatPreparationArchiveSchema>;
export type CombatPreparedCharacterArchive = z.infer<typeof combatPreparedCharacterArchiveSchema>;
export const turnCombatArchiveShape = {
  combatEffects: z.array(combatEffectSchema).optional(),
  participantReferences: z.array(participantReferenceSchema).optional(),
};
const invalid = (message: string): never => {
  throw new Problem(422, 'archive_invalid', message);
};

/** state.combat is absent or a structured encounter; free-form notes live in combatNotes. */
export function archivedEncounter(state: JsonObject) {
  if (state.combat === undefined) return null;
  const parsed = combatEncounterSchema.safeParse(state.combat);
  if (!parsed.success) invalid('Combat state must be a structured encounter');
  return parsed.data!;
}

export type CombatArchiveLinks = {
  character: (id: string) => void;
  encounter: (id: string) => void;
};
/** Validate combat links and register every structural identity for remapping. */
export function validateCombatArchive(
  input: {
    campaignId: string;
    states: JsonObject[];
    sessions: { id: string }[];
    turns: {
      id: string;
      diceSessionId?: string;
      status: string;
      narrative: string | null;
      rolls?: { id: string; encounterId?: string }[];
      combatEffects?: z.infer<typeof combatEffectSchema>[];
      participantReferences?: z.infer<typeof participantReferenceSchema>[];
    }[];
    records: { sessionId: string; encounterId?: string }[];
    preparations: CombatPreparationArchive[];
    prepared: CombatPreparedCharacterArchive[];
    completed: string;
  },
  links: CombatArchiveLinks
): void {
  const sessions = new Set(input.sessions.map((s) => s.id));
  const turnIds = new Set(input.turns.map((t) => t.id));
  for (const state of input.states) {
    const encounter = archivedEncounter(state);
    if (!encounter) continue;
    links.encounter(encounter.id);
    encounter.participants.forEach((p) => links.character(p.characterId));
  }
  const encounterBySession = new Map<string, string>();
  const keys = new Set<string>();
  for (const prep of input.preparations) {
    if (
      prep.campaignId !== input.campaignId ||
      !sessions.has(prep.sessionId) ||
      !turnIds.has(prep.turnId) ||
      prep.payload.receiptId !== prep.id ||
      prep.payload.encounterId !== prep.encounterId ||
      (encounterBySession.get(prep.sessionId) ?? prep.encounterId) !== prep.encounterId ||
      keys.has(`${prep.sessionId}:${prep.preparationKey}`)
    )
      invalid('Combat preparation ownership or identity is invalid');
    keys.add(`${prep.sessionId}:${prep.preparationKey}`);
    encounterBySession.set(prep.sessionId, prep.encounterId);
    links.encounter(prep.encounterId);
    prep.payload.participants.forEach((p) => {
      if (p.sheet.id !== p.characterId) invalid('Prepared sheet identity is inconsistent');
      links.character(p.characterId);
    });
  }
  const localKeys = new Set<string>();
  for (const draft of input.prepared) {
    const prep = input.preparations.find((p) => p.id === draft.preparationId);
    if (
      !prep ||
      draft.campaignId !== input.campaignId ||
      draft.sessionId !== prep.sessionId ||
      localKeys.has(`${draft.sessionId}:${draft.localKey}`)
    )
      invalid('Prepared character receipt is invalid');
    localKeys.add(`${draft.sessionId}:${draft.localKey}`);
    links.character(draft.id);
  }
  for (const prep of input.preparations)
    for (const op of prep.payload.createOperations)
      if (
        !input.prepared.some(
          (d) =>
            d.id === op.characterId &&
            d.preparationId === op.preparationReceiptId &&
            d.sessionId === prep.sessionId
        )
      )
        invalid('Prepared create operation does not match its receipt');
  for (const record of input.records)
    if (record.encounterId) {
      if (!sessions.has(record.sessionId)) invalid('Combat rolls require their dice session');
      links.encounter(record.encounterId);
    }
  for (const turn of input.turns) {
    const effects = turn.combatEffects ?? [];
    const references = turn.participantReferences ?? [];
    if (!effects.length && !references.length) continue;
    if (!turn.diceSessionId || !sessions.has(turn.diceSessionId))
      invalid('Combat links require their dice session');
    for (const effect of effects) {
      if (effect.rollIds.some((id) => !turn.rolls?.some((roll) => roll.id === id)))
        invalid('Unresolved combat effect roll');
      links.character(effect.characterId);
    }
    references.forEach((r) => r.characterIds.forEach(links.character));
    if (turn.status === input.completed) {
      const paragraphs = paragraphCount(turn.narrative ?? '');
      if (
        [...effects, ...references].some((entry) => entry.afterParagraph > paragraphs) ||
        new Set(references.map((r) => r.afterParagraph)).size !== references.length
      )
        invalid('Combat links must identify saved narrative paragraphs');
    }
  }
}

/** Rewrite only structural combat identities; free JSON, prompts and narrative stay intact. */
export function remapCombatState(state: JsonObject, mapped: (id: string) => string): void {
  if (!archivedEncounter(state)) return;
  const combat = state.combat as { id: string; participants: { characterId: string }[] };
  combat.id = mapped(combat.id);
  for (const participant of combat.participants)
    participant.characterId = mapped(participant.characterId);
}
export function remapCombatPreparation(
  prep: CombatPreparationArchive,
  mapped: (id: string) => string
): void {
  prep.id = mapped(prep.id);
  prep.campaignId = mapped(prep.campaignId);
  prep.sessionId = mapped(prep.sessionId);
  prep.turnId = mapped(prep.turnId);
  prep.encounterId = mapped(prep.encounterId);
  prep.payload.receiptId = prep.id;
  prep.payload.encounterId = prep.encounterId;
  for (const participant of prep.payload.participants) {
    participant.characterId = mapped(participant.characterId);
    participant.sheet.id = participant.characterId;
  }
  for (const op of prep.payload.createOperations) {
    op.characterId = mapped(op.characterId);
    op.preparationReceiptId = mapped(op.preparationReceiptId);
  }
}
export function remapPreparedCharacter(
  draft: CombatPreparedCharacterArchive,
  mapped: (id: string) => string
): void {
  draft.id = mapped(draft.id);
  draft.campaignId = mapped(draft.campaignId);
  draft.sessionId = mapped(draft.sessionId);
  draft.preparationId = mapped(draft.preparationId);
}
export function remapTurnCombat(
  turn: {
    combatEffects?: z.infer<typeof combatEffectSchema>[];
    participantReferences?: z.infer<typeof participantReferenceSchema>[];
  },
  mapped: (id: string) => string
): void {
  for (const effect of turn.combatEffects ?? []) {
    effect.characterId = mapped(effect.characterId);
    effect.rollIds = effect.rollIds.map(mapped);
  }
  for (const reference of turn.participantReferences ?? [])
    reference.characterIds = reference.characterIds.map(mapped);
}
