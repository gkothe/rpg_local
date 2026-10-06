import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { Problem } from '../errors.js';
import { characterInput } from './schemas.js';
import { CharacterType, OPERATION_KIND, CHARACTER_FIELD } from './options.js';
import { knowledgeIntroductionSchema } from './knowledge.js';
import { mapResponseCitations } from './citationInput.js';
import { MAX_ENTITY_NAME_CHARS, MAX_LONG_TEXT_CHARS } from './limits.js';
import { ResponseFieldProblem, type ResponsePath } from './responseFields.js';
import type { Campaign, Character, JsonObject } from './types.js';
import type { DiceRecord } from './dice.js';

export const COMBAT_PREPARE_TOOL_NAME = 'combat_prepare';
export enum CombatFieldKind {
  Vitality = 'vitality',
  Damage = 'damage',
  Condition = 'condition',
  Resource = 'resource',
}
export enum CombatRollScope {
  Combat = 'combat',
  Character = 'character',
  Oracle = 'oracle',
}
export enum CombatRollKind {
  Attack = 'attack',
  Defense = 'defense',
  Resistance = 'resistance',
  Awareness = 'awareness',
  Resource = 'resource',
  Other = 'other',
}
export const CombatProblem = {
  Identity: 'combat_identity',
  PreparationConflict: 'combat_preparation_conflict',
  State: 'combat_state',
  Effect: 'combat_effect',
  Reference: 'combat_reference',
} as const;
export const COMBAT_LIMITS = {
  participants: 1000,
  pathSegments: 16,
  trackedFieldsPerParticipant: 64,
} as const;
/** Tool-input limits only; they never bound generation, context or inference. */
export const COMBAT_PREPARATION_LIMITS = {
  requestBytes: 1_048_576,
  rpcEnvelopeBytes: 65_536,
} as const;
const RESERVED_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

const label = z.string().trim().min(1).max(MAX_ENTITY_NAME_CHARS);
const localKey = z.string().trim().min(1).max(MAX_ENTITY_NAME_CHARS);
export const trackedPathSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1)
      .max(MAX_ENTITY_NAME_CHARS)
      .refine((segment) => !RESERVED_PATH_SEGMENTS.has(segment), 'Reserved path segment')
  )
  .min(1)
  .max(COMBAT_LIMITS.pathSegments);
export type TrackedPath = z.infer<typeof trackedPathSchema>;
export const trackedFieldSchema = z
  .object({ path: trackedPathSchema, kind: z.enum(CombatFieldKind), label })
  .strict();
export type TrackedField = z.infer<typeof trackedFieldSchema>;
const isPrefix = (a: readonly string[], b: readonly string[]) =>
  a.length <= b.length && a.every((part, index) => part === b[index]);
export const trackedFieldsSchema = z
  .array(trackedFieldSchema)
  .min(1)
  .max(COMBAT_LIMITS.trackedFieldsPerParticipant)
  .superRefine((fields, ctx) => {
    if (
      !fields.some((f) => f.kind === CombatFieldKind.Vitality || f.kind === CombatFieldKind.Damage)
    )
      ctx.addIssue({ code: 'custom', message: 'Track at least one vitality or damage field' });
    fields.forEach((field, i) =>
      fields.forEach((other, j) => {
        if (i < j && (isPrefix(field.path, other.path) || isPrefix(other.path, field.path)))
          ctx.addIssue({
            code: 'custom',
            message: 'Tracked paths must be unique and must not overlap by prefix',
          });
      })
    );
  });
export const combatParticipantSchema = z
  .object({ characterId: z.uuid(), label, trackedFields: trackedFieldsSchema })
  .strict();
export type CombatParticipant = z.infer<typeof combatParticipantSchema>;
const uniqueIds = (ids: readonly string[]) => new Set(ids).size === ids.length;
export const combatEncounterSchema = z
  .object({
    id: z.uuid(),
    active: z.boolean(),
    round: z.number().int().nonnegative(),
    participants: z.array(combatParticipantSchema).max(COMBAT_LIMITS.participants),
  })
  .strict()
  .refine((encounter) => uniqueIds(encounter.participants.map((p) => p.characterId)), {
    message: 'Encounter participants must be unique',
  });
export type CombatEncounter = z.infer<typeof combatEncounterSchema>;

export const npcDraftSchema = characterInput
  .omit({ notes: true, type: true })
  .extend({ type: z.literal(CharacterType.Npc) })
  .strict();
export type NpcDraft = z.infer<typeof npcDraftSchema>;
export const existingCombatantSchema = z
  .object({ characterId: z.uuid(), label, trackedFields: trackedFieldsSchema })
  .strict();
export const draftCombatantSchema = z
  .object({
    localKey,
    label,
    character: npcDraftSchema,
    introduction: knowledgeIntroductionSchema,
    trackedFields: trackedFieldsSchema,
  })
  .strict();
export type DraftCombatant = z.infer<typeof draftCombatantSchema>;
export const combatPrepareSchema = z
  .object({
    localKey,
    encounterId: z.uuid().optional(),
    participants: z
      .array(z.union([existingCombatantSchema, draftCombatantSchema]))
      .min(1)
      .max(COMBAT_LIMITS.participants),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > COMBAT_PREPARATION_LIMITS.requestBytes)
      ctx.addIssue({ code: 'custom', message: 'Combat preparation exceeds its byte limit' });
    const ids = value.participants.flatMap((p) => ('characterId' in p ? [p.characterId] : []));
    const keys = value.participants.flatMap((p) => ('localKey' in p ? [p.localKey] : []));
    if (!uniqueIds(ids) || !uniqueIds(keys))
      ctx.addIssue({ code: 'custom', message: 'A batch lists each individual once' });
  });
export type CombatPrepareInput = z.infer<typeof combatPrepareSchema>;

export const combatEffectSchema = z
  .object({
    characterId: z.uuid(),
    operationIndex: z.number().int().nonnegative(),
    paths: z.array(trackedPathSchema).min(1).max(COMBAT_LIMITS.trackedFieldsPerParticipant),
    reason: z.string().trim().min(1).max(MAX_LONG_TEXT_CHARS),
    rollIds: z.array(z.uuid()),
    afterParagraph: z.number().int().positive(),
  })
  .strict();
export type CombatEffect = z.infer<typeof combatEffectSchema>;
export const participantReferenceSchema = z
  .object({
    afterParagraph: z.number().int().positive(),
    characterIds: z.array(z.uuid()).min(1).max(COMBAT_LIMITS.participants),
  })
  .strict();
export type ParticipantReference = z.infer<typeof participantReferenceSchema>;

export type CombatTracking = { kind: 'none' } | { kind: 'structured'; encounter: CombatEncounter };
/** state.combat holds only the structured encounter; free-form notes belong in state.combatNotes. */
export function combatTracking(state: JsonObject): CombatTracking {
  if (state.combat === undefined) return { kind: 'none' };
  const parsed = combatEncounterSchema.safeParse(state.combat);
  if (!parsed.success)
    throw new Problem(
      422,
      CombatProblem.State,
      'state.combat must be a structured encounter; keep free-form combat notes in state.combatNotes'
    );
  return { kind: 'structured', encounter: parsed.data };
}
export function structuredEncounter(state: JsonObject): CombatEncounter | null {
  const tracking = combatTracking(state);
  return tracking.kind === 'structured' ? tracking.encounter : null;
}

export type TrackedValue = { found: true; value: unknown } | { found: false };
/** Own-property traversal only; bindings never create values or reach prototypes. */
export function trackedValue(root: unknown, path: readonly string[]): TrackedValue {
  let current = root;
  for (const segment of path) {
    if (
      !current ||
      typeof current !== 'object' ||
      Array.isArray(current) ||
      RESERVED_PATH_SEGMENTS.has(segment) ||
      !Object.hasOwn(current, segment)
    )
      return { found: false };
    current = (current as Record<string, unknown>)[segment];
  }
  return { found: true, value: current };
}
export function missingTrackedPaths(
  attributes: JsonObject,
  fields: readonly TrackedField[]
): TrackedPath[] {
  return fields.filter((f) => !trackedValue(attributes, f.path).found).map((f) => f.path);
}

/** Citation offsets are computed after preparation; compare the model-authored provenance. */
export function comparableIntroduction(introduction: unknown): unknown {
  const wrapped = mapResponseCitations(
    { operations: [{ op: OPERATION_KIND.Create, introduction }] },
    (citation) => {
      for (const key of ['start', 'end', 'precision', 'pdfPages', 'printedPages'])
        delete citation[key];
    }
  ) as { operations: [{ introduction: unknown }] };
  return wrapped.operations[0].introduction;
}

export type PreparedDraft = {
  characterId: string;
  receiptId: string;
  localKey: string;
  label: string;
  character: NpcDraft;
  introduction: z.infer<typeof knowledgeIntroductionSchema>;
  trackedFields: TrackedField[];
};
/** Session-scoped registry rebuilt from append-only preparation receipts. */
export type CombatAuthorization = {
  encounterId: string | null;
  participants: CombatParticipant[];
  drafts: PreparedDraft[];
};
export const emptyCombatAuthorization = (): CombatAuthorization => ({
  encounterId: null,
  participants: [],
  drafts: [],
});

type CombatResponse = {
  narrative: string;
  operations: readonly (
    | { op: 'create' }
    | { op: 'set'; characterId: string; field: string; expected: unknown; value: unknown }
    | { op: 'state' }
  )[];
  combatEffects: readonly CombatEffect[];
  participantReferences: readonly ParticipantReference[];
};
export const paragraphCount = (narrative: string) => narrative.trim().split(/\r?\n\s*\r?\n/).length;
const fail = (path: ResponsePath, code: string, message: string): never => {
  throw new ResponseFieldProblem(path, new Problem(422, code, message));
};

/**
 * Structural combat validation for one v6 response: identities, tracked-field coverage and
 * narrative references. Values and rules remain the GM's; this proves only declared links.
 */
export function validateCombatTurn(input: {
  before: Campaign;
  after: Campaign;
  response: CombatResponse;
  authorization: CombatAuthorization;
  rolls: readonly DiceRecord[];
  narrative: string;
}): void {
  const { before, after, response, authorization, rolls } = input;
  const stateIndex = response.operations.findLastIndex((op) => op.op === OPERATION_KIND.State);
  const statePath: ResponsePath = stateIndex >= 0 ? ['operations', stateIndex] : ['operations'];
  const prior = structuredEncounter(before.state);
  let current: CombatEncounter | null;
  try {
    current = structuredEncounter(after.state);
  } catch (error) {
    if (error instanceof Problem) fail(statePath, error.code, error.message);
    throw error;
  }
  if (prior?.active && current?.id !== prior.id)
    fail(
      statePath,
      CombatProblem.State,
      'End the active encounter explicitly with active:false before replacing or removing it'
    );
  if (current && current.id !== prior?.id && current.id !== authorization.encounterId)
    fail(statePath, CombatProblem.Identity, 'A new encounter ID must come from combat_prepare');
  if (current?.active && prior && prior.id === current.id && !prior.active)
    fail(
      statePath,
      CombatProblem.State,
      'An ended encounter cannot be reopened; prepare a new one'
    );
  const characterIn = (campaign: Campaign, id: string) =>
    campaign.characters.find((character) => character.id === id);
  const lastAttributesOp = (id: string) =>
    response.operations.findLastIndex(
      (op) =>
        op.op === OPERATION_KIND.Set &&
        op.characterId === id &&
        op.field === CHARACTER_FIELD.Attributes
    );
  for (const participant of current?.participants ?? []) {
    const character = characterIn(after, participant.characterId);
    if (!character)
      fail(
        statePath,
        CombatProblem.Identity,
        `Participant ${participant.label} is not a character sheet in this campaign`
      );
    const existing = prior?.participants.find((p) => p.characterId === participant.characterId);
    const authorized = authorization.participants.find(
      (p) => p.characterId === participant.characterId
    );
    const allowedBindings = [existing?.trackedFields, authorized?.trackedFields].filter(
      (fields) => fields !== undefined
    );
    if (!allowedBindings.some((fields) => isDeepStrictEqual(fields, participant.trackedFields)))
      fail(
        statePath,
        CombatProblem.Identity,
        `${participant.label}: participants and tracked fields must come from the existing encounter or combat_prepare`
      );
    if (missingTrackedPaths(character!.attributes, participant.trackedFields).length) {
      const index = lastAttributesOp(participant.characterId);
      fail(
        index >= 0 ? ['operations', index] : statePath,
        CombatProblem.State,
        `${participant.label}: tracked attribute paths must remain present on the sheet`
      );
    }
  }
  const bindings = new Map<string, CombatParticipant>();
  for (const participant of [...(prior?.participants ?? []), ...(current?.participants ?? [])])
    bindings.set(participant.characterId, participant);
  const used = new Set<string>([
    ...(current?.participants ?? []).map((p) => p.characterId),
    ...response.combatEffects.map((e) => e.characterId),
    ...response.participantReferences.flatMap((r) => r.characterIds),
  ]);
  const combatRolls = rolls.filter((roll) => roll.scope === CombatRollScope.Combat);
  for (const roll of combatRolls) {
    for (const id of [roll.actorId, roll.targetId]) {
      if (!id) continue;
      used.add(id);
      if (!bindings.has(id))
        fail(
          statePath,
          CombatProblem.State,
          'Every combat roll participant must belong to the final or prior encounter'
        );
    }
  }
  for (const draft of authorization.drafts)
    if (used.has(draft.characterId) && !characterIn(after, draft.characterId))
      fail(
        ['operations'],
        CombatProblem.Identity,
        `Prepared NPC ${draft.label} is used; include its exact create operation from combat_prepare`
      );

  const paragraphs = paragraphCount(input.narrative);
  const rollIds = new Set(rolls.map((roll) => roll.id));
  const covered = new Set<string>();
  response.combatEffects.forEach((effect, index) => {
    const path: ResponsePath = ['combatEffects', index];
    const op = response.operations[effect.operationIndex];
    if (
      !op ||
      op.op !== OPERATION_KIND.Set ||
      op.field !== CHARACTER_FIELD.Attributes ||
      op.characterId !== effect.characterId
    )
      fail(
        path,
        CombatProblem.Effect,
        'Effect must reference an attributes set operation on the same character'
      );
    const participant = bindings.get(effect.characterId);
    if (!participant)
      fail(path, CombatProblem.Effect, 'Effect character is not an encounter participant');
    const set = op as Extract<CombatResponse['operations'][number], { op: 'set' }>;
    for (const tracked of effect.paths) {
      if (!participant!.trackedFields.some((f) => isDeepStrictEqual(f.path, tracked)))
        fail(path, CombatProblem.Effect, 'Effect path is not a tracked field of this participant');
      if (isDeepStrictEqual(trackedValue(set.expected, tracked), trackedValue(set.value, tracked)))
        fail(path, CombatProblem.Effect, 'Effect path does not change in its operation');
      const key = JSON.stringify([effect.operationIndex, tracked]);
      if (covered.has(key)) fail(path, CombatProblem.Effect, 'Duplicate effect for one change');
      covered.add(key);
    }
    if (!uniqueIds(effect.rollIds) || effect.rollIds.some((id) => !rollIds.has(id)))
      fail(path, CombatProblem.Effect, 'Effect rolls must be unique saved rolls of this turn');
    if (effect.afterParagraph > paragraphs)
      fail(path, CombatProblem.Effect, 'Effect afterParagraph must identify a narrative paragraph');
  });
  response.operations.forEach((op, index) => {
    if (op.op !== OPERATION_KIND.Set || op.field !== CHARACTER_FIELD.Attributes) return;
    const participant = bindings.get(op.characterId);
    for (const field of participant?.trackedFields ?? [])
      if (
        !isDeepStrictEqual(
          trackedValue(op.expected, field.path),
          trackedValue(op.value, field.path)
        )
      ) {
        if (!covered.has(JSON.stringify([index, field.path])))
          fail(
            ['combatEffects'],
            CombatProblem.Effect,
            `${participant!.label}: change to tracked field ${field.label} (operation ${index}) needs a combat effect`
          );
      }
  });

  const seenParagraphs = new Set<number>();
  response.participantReferences.forEach((reference, index) => {
    const path: ResponsePath = ['participantReferences', index];
    if (reference.afterParagraph > paragraphs || seenParagraphs.has(reference.afterParagraph))
      fail(
        path,
        CombatProblem.Reference,
        'Each reference names one existing narrative paragraph once'
      );
    seenParagraphs.add(reference.afterParagraph);
    if (
      !uniqueIds(reference.characterIds) ||
      reference.characterIds.some((id) => !bindings.has(id))
    )
      fail(path, CombatProblem.Reference, 'References list unique encounter participants');
  });
  const referenced = (id: string, paragraph?: number) =>
    response.participantReferences.some(
      (r) =>
        (paragraph === undefined || r.afterParagraph === paragraph) && r.characterIds.includes(id)
    );
  for (const effect of response.combatEffects)
    if (!referenced(effect.characterId, effect.afterParagraph))
      fail(
        ['participantReferences'],
        CombatProblem.Reference,
        'Reference each affected participant in the paragraph of its effect'
      );
  for (const roll of combatRolls)
    for (const id of [roll.actorId, roll.targetId])
      if (id && !referenced(id))
        fail(
          ['participantReferences'],
          CombatProblem.Reference,
          'Reference every combat roll participant in the narrative'
        );
}

/** A prepared draft becomes canonical only through its exact create operation. */
export function resolvePreparedCreate(
  op: {
    character: unknown;
    introduction?: unknown;
    characterId?: string;
    preparationReceiptId?: string;
  },
  authorization: CombatAuthorization,
  existing: readonly Character[]
): PreparedDraft | undefined {
  if (op.characterId === undefined && op.preparationReceiptId === undefined) return undefined;
  const draft = authorization.drafts.find(
    (d) => d.characterId === op.characterId && d.receiptId === op.preparationReceiptId
  );
  if (!draft)
    throw new Problem(
      422,
      CombatProblem.Identity,
      'Reserved character IDs require their own combat_prepare receipt'
    );
  if (existing.some((character) => character.id === draft.characterId))
    throw new Problem(422, CombatProblem.Identity, 'Prepared character was already created');
  if (
    !isDeepStrictEqual(op.character, draft.character) ||
    !isDeepStrictEqual(
      comparableIntroduction(op.introduction),
      comparableIntroduction(draft.introduction)
    )
  )
    throw new Problem(
      422,
      CombatProblem.Identity,
      'Prepared create must copy the prepared character and introduction exactly'
    );
  return draft;
}

/**
 * Manual edits may change sheet values and unrelated state, but the structured encounter is
 * owned by validated gameplay responses: no creation, replacement or binding removal through PATCH.
 */
export function assertManualStateEdit(current: JsonObject, next: JsonObject): void {
  const encounter = structuredEncounter(current);
  const tracking = combatTracking(next);
  if (encounter) {
    if (isDeepStrictEqual(next.combat, current.combat)) return;
    if (!encounter.active && next.combat === undefined) return;
    throw new Problem(
      422,
      CombatProblem.State,
      'The structured encounter changes only through gameplay; an ended encounter may be removed'
    );
  }
  if (tracking.kind === 'structured')
    throw new Problem(
      422,
      CombatProblem.State,
      'Structured encounters are created through combat_prepare during gameplay'
    );
}
function activeParticipant(state: JsonObject, characterId: string) {
  const encounter = structuredEncounter(state);
  return encounter?.active
    ? encounter.participants.find((p) => p.characterId === characterId)
    : undefined;
}
export function assertManualAttributesEdit(
  state: JsonObject,
  characterId: string,
  attributes: JsonObject
): void {
  const participant = activeParticipant(state, characterId);
  if (participant && missingTrackedPaths(attributes, participant.trackedFields).length)
    throw new Problem(
      422,
      CombatProblem.State,
      `${participant.label}: keep the tracked combat fields; their values may be edited`
    );
}
export function assertCharacterRemovable(state: JsonObject, characterId: string): void {
  if (activeParticipant(state, characterId))
    throw new Problem(
      409,
      CombatProblem.State,
      'This character takes part in the active encounter; end the encounter first'
    );
}

export const COMBAT_FIELD_KIND_OPTIONS = [
  { id: CombatFieldKind.Vitality, label: 'Vitality' },
  { id: CombatFieldKind.Damage, label: 'Damage' },
  { id: CombatFieldKind.Condition, label: 'Condition' },
  { id: CombatFieldKind.Resource, label: 'Resource' },
] as const;
export const COMBAT_ROLL_SCOPE_OPTIONS = [
  { id: CombatRollScope.Combat, label: 'Combat' },
  { id: CombatRollScope.Character, label: 'Character check' },
  { id: CombatRollScope.Oracle, label: 'Oracle' },
] as const;
export const COMBAT_ROLL_KIND_OPTIONS = [
  { id: CombatRollKind.Attack, label: 'Attack' },
  { id: CombatRollKind.Defense, label: 'Defense' },
  { id: CombatRollKind.Resistance, label: 'Resistance' },
  { id: CombatRollKind.Awareness, label: 'Awareness' },
  { id: CombatRollKind.Resource, label: 'Resource' },
  { id: CombatRollKind.Other, label: 'Other' },
] as const;
