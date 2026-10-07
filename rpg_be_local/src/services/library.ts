import { operationExplanationSchema } from '../domain/operationExplanations.js';
import {
  frozenCampaignSourcesSchema,
  CAMPAIGN_SOURCE_SEARCH_TOOL_NAME,
  CAMPAIGN_SOURCE_GET_TOOL_NAME,
} from '../domain/campaignSourceRecall.js';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { Store } from '../store.js';
import { newCampaign } from '../domain/campaign.js';
import type { Campaign, Archive, Snapshot, Memory } from '../domain/types.js';
import { Problem } from '../errors.js';
import { sourceSections } from '../domain/sourceSections.js';
import {
  ARCHIVE_TURN_STATUSES,
  CHARACTER_MUTABLE_FIELDS,
  CharacterType,
  CONTEXT_BUDGET_LIMITS,
  SourceKind,
  SourcePurpose,
  SourceStatus,
  TurnStatus,
} from '../domain/options.js';
import {
  MAX_ARCHIVE_TURNS,
  MAX_ENTITY_NAME_CHARS,
  MAX_SOURCE_PAGES,
  MAX_SOURCE_TEXT_CHARS,
} from '../domain/limits.js';
import {
  combatPreparationArchiveSchema,
  combatPreparedCharacterArchiveSchema,
  turnCombatArchiveShape,
  validateCombatArchive,
  remapCombatState,
  remapCombatPreparation,
  remapPreparedCharacter,
  remapTurnCombat,
} from './combatArchive.js';
import {
  ruleContextSchema,
  ruleReferenceSchema,
  ruleReadSchema,
  ruleCitationSchema,
  RULE_LIMITS,
  RuleSystemKind,
  canonicalRuleJson,
  serializedBytes,
  DEFAULT_RULE_SYSTEM_ID,
  type RuleReference,
} from '../domain/rules.js';
import { RuleStore } from './ruleStore.js';
import { validateRuleCitations } from '../domain/ruleCitationValidation.js';
import { DICE_LIMITS, diceRecordSchema, diceSessionSchema } from '../domain/dice.js';
import {
  placedRollInterpretationSchema,
  validateRollInterpretations,
  validateRollPlacement,
} from '../domain/diceResponse.js';
import { diceDigest } from './dice.js';
import {
  campaignKnowledgeSchema,
  validateKnowledgeEvidence,
  KnowledgeOrigin,
  sourceSpanSchema,
  type CampaignKnowledge,
} from '../domain/knowledge.js';
import { frozenKnowledgeSchema, type FrozenKnowledge } from '../domain/knowledgeRecall.js';
import { JournalEventKind } from '../domain/journal.js';
import { eventDigest, journalLedgerSchema, sha256 } from '../domain/journalLedger.js';
/** Identifies a Local RPG campaign export; any other JSON document is rejected. */
export const ARCHIVE_FORMAT_ID = 'local-rpg';
const uuid = z.uuid();
const object = z.record(z.string(), z.unknown());
const character = z
  .object({
    id: uuid,
    name: z.string().min(1).max(MAX_ENTITY_NAME_CHARS),
    type: z.enum(CharacterType),
    attributes: object,
    inventory: object,
    description: object,
    notes: z.string(),
    revision: z.number().int().nonnegative(),
  })
  .strict();
const memory = z
  .object({
    id: uuid,
    text: z.string(),
    coveredTurnIds: z.array(uuid),
    valid: z.boolean(),
    createdAt: z.iso.datetime(),
  })
  .strict();
const settings = z
  .object({
    provider: z.string().max(40),
    model: z.string().max(120),
    effort: z.string().max(20).nullable(),
  })
  .strict();
const campaign = z
  .object({
    ruleSystemId: uuid.nullable().optional(),
    ruleReference: ruleReferenceSchema.optional(),
    ruleResolution: z
      .object({ status: z.literal('unresolved'), reference: ruleReferenceSchema })
      .strict()
      .optional(),
    id: uuid,
    name: z.string().min(1).max(MAX_ENTITY_NAME_CHARS),
    description: z.string(),
    instructions: z.string(),
    revision: z.number().int().nonnegative(),
    notes: z.string(),
    notesRevision: z.number().int().nonnegative(),
    characters: z.array(character).max(1000),
    sources: z
      .array(
        z
          .object({
            id: uuid,
            name: z.string(),
            kind: z.enum(SourceKind),
            text: z.string().max(MAX_SOURCE_TEXT_CHARS),
            status: z.enum(SourceStatus),
            version: z.number().int().positive(),
            pages: z.array(object).max(MAX_SOURCE_PAGES),
            warnings: z.array(z.string()),
            originalAvailable: z.boolean().optional(),
            purpose: z.enum(SourcePurpose).optional(),
          })
          .strict()
      )
      .max(1000),
    settings,
    pinnedSourceIds: z.array(uuid),
    pinnedSourceSections: z
      .array(
        z
          .object({
            sourceId: uuid,
            version: z.number().int().positive(),
            index: z.number().int().nonnegative(),
          })
          .strict()
      )
      .optional(),
    budgets: z
      .object({
        gameplay: z.number().optional(),
        compaction: z
          .number()
          .int()
          .min(CONTEXT_BUDGET_LIMITS.compaction.min)
          .max(CONTEXT_BUDGET_LIMITS.compaction.max),
        // Accept the retired field from old clients/archives, then discard it.
        memory: z.number().optional(),
      })
      .strict()
      .transform(({ compaction }) => ({ compaction })),
    state: object,
    memory: memory.nullable(),
    knowledge: z.array(campaignKnowledgeSchema),
    // Optional: archives exported before the Journal ledger carry none and import with an empty one.
    journal: journalLedgerSchema.optional(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
const sectionLocator = z
  .object({
    id: uuid,
    version: z.number().int().positive(),
    sectionIndex: z.number().int().nonnegative(),
  })
  .strict();
const context = z
  .object({
    ruleContext: ruleContextSchema.optional(),
    revision: z.number().int().nonnegative(),
    prompt: z.string(),
    estimatedTokens: z.number(),
    estimator: z.string(),
    sourceVersions: z.array(z.object({ id: uuid, version: z.number().int() })),
    historyIds: z.array(uuid),
    memoryId: uuid.nullable(),
    systemPrompt: z.string().optional(),
    diceSessionId: uuid.optional(),
    frozenKnowledge: frozenKnowledgeSchema.optional(),
    sourceSpans: z.array(sourceSpanSchema).optional(),
    frozenSources: frozenCampaignSourcesSchema.optional(),
    sourceSelection: z
      .object({
        bootstrap: z.boolean(),
        reasons: z.array(z.enum(['no_source', 'no_match', 'target_omission'])),
        included: z.array(sectionLocator),
        omitted: z.array(sectionLocator),
      })
      .strict()
      .optional(),
  })
  .strict();
const sourceRead = z
  .object({
    id: uuid,
    campaignId: uuid,
    turnId: uuid,
    sessionId: uuid,
    tool: z.enum([CAMPAIGN_SOURCE_SEARCH_TOOL_NAME, CAMPAIGN_SOURCE_GET_TOOL_NAME]),
    transportRequestId: z.string(),
    argumentDigest: z.string(),
    payload: object,
    createdAt: z.iso.datetime(),
  })
  .strict();
const turn = z
  .object({
    ruleContext: ruleContextSchema.optional(),
    ruleReads: z.array(ruleReadSchema).optional(),
    ruleCitations: z.array(ruleCitationSchema).max(RULE_LIMITS.calls).optional(),
    diceSessionId: uuid.optional(),
    retryOfTurnId: uuid.optional(),
    rolls: z.array(diceRecordSchema).max(DICE_LIMITS.slots).optional(),
    rollInterpretations: z.array(placedRollInterpretationSchema).max(DICE_LIMITS.slots).optional(),
    id: uuid,
    campaignId: uuid,
    requestId: uuid,
    status: z.enum(ARCHIVE_TURN_STATUSES),
    action: z.string(),
    narrative: z.string().nullable(),
    changes: z.array(z.string()),
    error: z.string().nullable(),
    undone: z.boolean(),
    settings,
    context: context.nullable(),
    createdAt: z.iso.datetime(),
    completedAt: z.iso.datetime().nullable(),
    sourceReads: z.array(sourceRead).optional(),
    operationExplanations: z.array(operationExplanationSchema).optional(),
    traceId: z.string().optional(),
    ...turnCombatArchiveShape,
  })
  .strict();
const snapshot = z
  .object({
    turnId: uuid,
    beforeCharacters: z.array(character),
    afterCharacters: z.array(character),
    beforeState: object,
    afterState: object,
    beforeMemory: memory.nullable(),
    beforeKnowledge: z.array(campaignKnowledgeSchema).optional(),
    afterKnowledge: z.array(campaignKnowledgeSchema).optional(),
    changedFields: z
      .array(
        z
          .object({
            characterId: uuid,
            fields: z.array(z.enum(CHARACTER_MUTABLE_FIELDS)),
          })
          .strict()
      )
      .optional(),
  })
  .strict();
const archiveSchema = z
  .object({
    format: z.literal(ARCHIVE_FORMAT_ID),
    campaign,
    turns: z.array(turn).max(MAX_ARCHIVE_TURNS),
    snapshots: z.array(snapshot),
    memories: z.array(memory),
    diceSessions: z.array(diceSessionSchema).max(MAX_ARCHIVE_TURNS),
    diceRecords: z.array(diceRecordSchema).max(MAX_ARCHIVE_TURNS * DICE_LIMITS.slots),
    combatPreparations: z.array(combatPreparationArchiveSchema),
    combatPreparedCharacters: z.array(combatPreparedCharacterArchiveSchema),
  })
  .strict();

/** Journal evidence must still match the archived final transcript; undone turns remain audit-only. */
function validateJournalArchive(archive: z.infer<typeof archiveSchema>): void {
  const ledger = archive.campaign.journal;
  if (!ledger) return;
  const invalid = (detail: string) => new Problem(422, 'archive_invalid', detail);
  const turns = new Map(archive.turns.map((t) => [t.id, t]));
  const quote = (e: {
    turnId: string;
    field: 'action' | 'narrative';
    quote: string;
    start: number;
    end: number;
    digest: string;
  }) => {
    const turn = turns.get(e.turnId);
    if (!turn) throw invalid('Journal evidence references a missing conversation');
    const text = e.field === 'action' ? turn.action : (turn.narrative ?? '');
    if (text.slice(e.start, e.end) !== e.quote || sha256(text) !== e.digest)
      throw invalid('Journal evidence no longer matches the archived conversation');
  };
  for (const id of [...ledger.coverageTurnIds, ...ledger.undoneTurnIds])
    if (!turns.has(id)) throw invalid('Journal ledger references a missing conversation');
  const eventIds = new Set<string>();
  for (const event of ledger.events) {
    if (eventIds.has(event.id)) throw invalid('Duplicate Journal event ID');
    eventIds.add(event.id);
    if (eventDigest(event as unknown as Record<string, unknown>) !== event.digest)
      throw invalid('Journal event digest mismatch');
    if (event.kind === JournalEventKind.Correction) {
      event.evidence.forEach(quote);
      continue;
    }
    const ordinals = new Set<number>();
    for (const x of event.contributions) {
      if (ordinals.has(x.ordinal) || !event.knowledgeIds.includes(x.knowledgeId))
        throw invalid('Journal contribution is inconsistent');
      ordinals.add(x.ordinal);
      if (!turns.has(x.turnId))
        throw invalid('Journal contribution references a missing conversation');
      x.evidence.forEach(quote);
    }
  }
}
export function remapArchive(raw: unknown): Archive {
  if (raw && typeof raw === 'object' && 'version' in raw)
    throw new Problem(
      422,
      'archive_unsupported',
      'This file was exported by an older app and can no longer be imported.'
    );
  const parsed = archiveSchema.parse(raw);
  validateJournalArchive(parsed);
  const metadata = ['systemPrompt', 'frozenKnowledge', 'toolDefinitions'] as const;
  for (const session of parsed.diceSessions) {
    const count = metadata.filter((key) => session[key] !== undefined).length;
    if (count !== 0 && count !== metadata.length)
      throw new Problem(422, 'archive_invalid', 'Frozen session metadata is incomplete');
    if (
      session.toolDefinitions &&
      new Set(session.toolDefinitions.map((tool) => tool.name)).size !==
        session.toolDefinitions.length
    )
      throw new Problem(422, 'archive_invalid', 'Duplicate frozen tool definition');
  }
  if (
    parsed.campaign.ruleSystemId &&
    !parsed.campaign.ruleReference &&
    !parsed.campaign.ruleResolution
  )
    throw new Problem(422, 'archive_invalid', 'Book selection requires a portable rule reference');
  const archive = parsed;
  const old = archive.campaign;
  const ids = new Map<string, string>();
  const register = (id: string) => {
    if (ids.has(id)) throw new Problem(422, 'archive_invalid', 'Duplicate entity ID in archive');
    ids.set(id, randomUUID());
  };
  register(old.id);
  old.characters.forEach((c) => register(c.id));
  old.sources.forEach((s) => register(s.id));
  archive.turns.forEach((t) => register(t.id));
  archive.memories.forEach((m) => register(m.id));
  archive.diceSessions.forEach((session) => register(session.id));
  archive.diceRecords.forEach((record) => register(record.id));
  archive.combatPreparations.forEach((prep) => register(prep.id));
  for (const entry of archive.turns) {
    for (const read of entry.ruleReads ?? []) register(read.id);
    for (const read of entry.sourceReads ?? []) register(read.id);
  }
  const tids = new Set(archive.turns.map((t) => t.id));
  const sids = new Set(old.sources.map((s) => s.id));
  const mids = new Set(archive.memories.map((m) => m.id));
  const nonCharacterIds = new Set([
    old.id,
    ...sids,
    ...tids,
    ...mids,
    ...archive.diceSessions.map((session) => session.id),
    ...archive.diceRecords.map((record) => record.id),
    ...archive.combatPreparations.map((prep) => prep.id),
    ...archive.turns.flatMap((turn) => (turn.ruleReads ?? []).map((read) => read.id)),
    ...archive.turns.flatMap((turn) => (turn.sourceReads ?? []).map((read) => read.id)),
  ]);
  const knowledgeCollections = [
    old.knowledge,
    ...archive.snapshots.flatMap((snap) => [snap.beforeKnowledge ?? [], snap.afterKnowledge ?? []]),
    ...archive.diceSessions.map((session) => session.frozenKnowledge?.records ?? []),
    ...archive.turns.map((turn) => turn.context?.frozenKnowledge?.records ?? []),
  ];
  const knowledgeIds = new Set<string>();
  for (const records of knowledgeCollections) {
    if (new Set(records.map((record) => record.id)).size !== records.length)
      throw new Problem(422, 'archive_invalid', 'Duplicate knowledge record ID');
    for (const record of records) {
      if (!knowledgeIds.has(record.id)) {
        register(record.id);
        knowledgeIds.add(record.id);
        nonCharacterIds.add(record.id);
      }
    }
  }
  const historicalSources = new Set(sids);
  const historicalCharacters = new Set(old.characters.map((char) => char.id));
  for (const snap of archive.snapshots)
    for (const char of [...snap.beforeCharacters, ...snap.afterCharacters])
      historicalCharacters.add(char.id);
  for (const session of archive.diceSessions)
    for (const id of session.characterIds) historicalCharacters.add(id);
  const sourceLink = (id: string) => {
    if (
      historicalCharacters.has(id) ||
      knowledgeIds.has(id) ||
      (ids.has(id) && !historicalSources.has(id))
    )
      throw new Problem(
        422,
        'archive_invalid',
        'Historical source ID collides with another entity'
      );
    if (!ids.has(id)) ids.set(id, randomUUID());
    historicalSources.add(id);
    nonCharacterIds.add(id);
  };
  const characterLink = (id: string) => {
    if (nonCharacterIds.has(id))
      throw new Problem(
        422,
        'archive_invalid',
        'Historical character ID collides with another entity'
      );
    if (!ids.has(id)) ids.set(id, randomUUID());
    historicalCharacters.add(id);
  };
  const frozen: FrozenKnowledge[] = [
    ...archive.diceSessions.flatMap((session) =>
      session.frozenKnowledge ? [session.frozenKnowledge] : []
    ),
    ...archive.turns.flatMap((turn) =>
      turn.context?.frozenKnowledge ? [turn.context.frozenKnowledge] : []
    ),
  ];
  for (const captured of frozen) {
    if (
      captured.campaignId !== old.id ||
      new Set(captured.characters.map((char) => char.id)).size !== captured.characters.length ||
      new Set(captured.sourceIds).size !== captured.sourceIds.length
    )
      throw new Problem(422, 'archive_invalid', 'Invalid frozen knowledge campaign or identities');
    captured.characters.forEach((char) => characterLink(char.id));
    if (captured.npcCharacters) {
      if (
        new Set(captured.npcCharacters.map((npc) => npc.id)).size !==
          captured.npcCharacters.length ||
        old.characters.some(
          (character) =>
            character.type === CharacterType.Player &&
            captured.npcCharacters!.some((npc) => npc.id === character.id)
        )
      )
        throw new Problem(422, 'archive_invalid', 'Invalid frozen NPC identities');
      captured.npcCharacters.forEach((npc) => characterLink(npc.id));
    }
    captured.sourceIds.forEach(sourceLink);
    if (captured.sourceVersions) {
      if (
        new Set(captured.sourceVersions.map((source) => source.id)).size !==
          captured.sourceVersions.length ||
        captured.sourceVersions.length !== captured.sourceIds.length ||
        captured.sourceVersions.some((source) => !captured.sourceIds.includes(source.id))
      )
        throw new Problem(
          422,
          'archive_invalid',
          'Frozen source versions must match captured source identities'
        );
      captured.sourceVersions.forEach((source) => sourceLink(source.id));
    }
  }
  for (const session of archive.diceSessions) {
    if (session.frozenSources && session.frozenSources.campaignId !== old.id)
      throw new Problem(422, 'archive_invalid', 'Frozen sources belong to another campaign');
    for (const source of session.frozenSources?.sources ?? []) sourceLink(source.id);
  }
  for (const turn of archive.turns) {
    if (turn.context?.frozenSources && turn.context.frozenSources.campaignId !== old.id)
      throw new Problem(422, 'archive_invalid', 'Frozen sources belong to another campaign');
    for (const source of turn.context?.frozenSources?.sources ?? []) sourceLink(source.id);
    for (const read of turn.sourceReads ?? []) {
      if (
        read.campaignId !== old.id ||
        read.turnId !== turn.id ||
        read.sessionId !== turn.diceSessionId ||
        (read.tool === CAMPAIGN_SOURCE_GET_TOOL_NAME && read.payload.receiptId !== read.id)
      )
        throw new Problem(422, 'archive_invalid', 'Campaign source receipt ownership is invalid');
      if (read.tool === CAMPAIGN_SOURCE_GET_TOOL_NAME) {
        const span = sourceSpanSchema.parse(read.payload.sourceSpan);
        const frozen =
          turn.context?.frozenSources ??
          archive.diceSessions.find((s) => s.id === turn.diceSessionId)?.frozenSources;
        const source = frozen?.sources.find(
          (s) => s.id === span.id && s.version === span.version && s.name === span.name
        );
        if (
          !source ||
          span.end !== span.start + span.text.length ||
          source.text.slice(span.start, span.end) !== span.text
        )
          throw new Problem(
            422,
            'archive_invalid',
            'Campaign source receipt must match its original frozen span'
          );
      }
    }
    if (turn.operationExplanations) {
      if (
        new Set(turn.operationExplanations.map((e) => e.operationIndex)).size !==
        turn.operationExplanations.length
      )
        throw new Problem(422, 'archive_invalid', 'Duplicate operation explanation index');
      for (const e of turn.operationExplanations) {
        if (e.rollIds.some((id) => !turn.rolls?.some((r) => r.id === id)))
          throw new Problem(422, 'archive_invalid', 'Unresolved explanation roll');
        if (e.evidence.length)
          validateKnowledgeEvidence(
            { origin: KnowledgeOrigin.Source, evidence: e.evidence },
            {
              campaignId: old.id,
              turnId: turn.id,
              ruleContext: turn.ruleContext ?? turn.context?.ruleContext,
              ruleReads: turn.ruleReads,
              sourceSpans: [
                ...(turn.context?.sourceSpans ?? []),
                ...(turn.sourceReads ?? []).flatMap((read) =>
                  read.tool === CAMPAIGN_SOURCE_GET_TOOL_NAME
                    ? [sourceSpanSchema.parse(read.payload.sourceSpan)]
                    : []
                ),
              ],
            }
          );
        for (const evidence of e.evidence) {
          if (evidence.type === 'campaign_source') sourceLink(evidence.sourceId);
          else if (!turn.ruleReads?.some((r) => r.id === evidence.citation.receiptId))
            throw new Problem(422, 'archive_invalid', 'Unresolved explanation book receipt');
        }
      }
    }
    turn.context?.sourceVersions.forEach((source) => sourceLink(source.id));
    for (const span of turn.context?.sourceSpans ?? []) {
      sourceLink(span.id);
      if (span.end !== span.start + span.text.length)
        throw new Problem(422, 'archive_invalid', 'Invalid frozen source span coordinates');
    }
  }
  const encounterIds = new Set<string>();
  validateCombatArchive(
    {
      campaignId: old.id,
      states: [
        old.state,
        ...archive.snapshots.flatMap((snap) => [snap.beforeState, snap.afterState]),
      ],
      sessions: archive.diceSessions,
      turns: archive.turns,
      records: archive.diceRecords,
      preparations: archive.combatPreparations,
      prepared: archive.combatPreparedCharacters,
      completed: TurnStatus.Completed,
    },
    {
      character: characterLink,
      encounter: (id) => {
        if (encounterIds.has(id)) return;
        if (ids.has(id) || historicalCharacters.has(id))
          throw new Problem(422, 'archive_invalid', 'Encounter ID collides with another entity');
        ids.set(id, randomUUID());
        encounterIds.add(id);
        nonCharacterIds.add(id);
      },
    }
  );
  for (const records of knowledgeCollections)
    for (const record of records) {
      if (
        new Set(record.characterIds).size !== record.characterIds.length ||
        record.characterIds.some((id) => !record.characterNames[id]) ||
        (record.holderId && !record.holderName)
      )
        throw new Problem(
          422,
          'archive_invalid',
          'Knowledge links require unique identities and historical names'
        );
      for (const id of [
        ...record.characterIds,
        ...Object.keys(record.characterNames),
        ...(record.holderId ? [record.holderId] : []),
      ])
        characterLink(id);
      for (const id of [
        record.createdTurnId,
        record.updatedTurnId,
        ...record.attributions.map((entry) => entry.turnId),
      ])
        if (id && !tids.has(id))
          throw new Problem(422, 'archive_invalid', 'Unresolved knowledge attribution turn');
      const first = record.attributions[0];
      if (
        !first ||
        first.origin !== record.origin ||
        first.turnId !== record.createdTurnId ||
        first.at !== record.createdAt ||
        canonicalRuleJson(first.evidence) !== canonicalRuleJson(record.evidence)
      )
        throw new Problem(422, 'archive_invalid', 'Knowledge creation attribution is inconsistent');
      const provenance = [
        { origin: record.origin, evidence: record.evidence, turnId: record.createdTurnId },
        ...record.attributions,
      ];
      for (const entry of provenance) {
        if ((entry.origin === 'source') !== entry.evidence.length > 0)
          throw new Problem(
            422,
            'archive_invalid',
            'Knowledge origin and evidence are inconsistent'
          );
        for (const evidence of entry.evidence) {
          if (evidence.type === 'campaign_source') {
            sourceLink(evidence.sourceId);
            const source = old.sources.find(
              (source) => source.id === evidence.sourceId && source.version === evidence.version
            );
            if (
              evidence.end !== evidence.start + evidence.quote.length ||
              (source && source.text.slice(evidence.start, evidence.end) !== evidence.quote)
            )
              throw new Problem(
                422,
                'archive_invalid',
                'Knowledge source quote coordinates are invalid'
              );
          } else {
            const event = archive.turns.find((turn) => turn.id === entry.turnId);
            const captured = event?.ruleContext ?? event?.context?.ruleContext;
            if (!event || !captured)
              throw new Problem(
                422,
                'archive_invalid',
                'Book knowledge requires its owning captured turn'
              );
            validateRuleCitations(
              { ruleCitations: [evidence.citation] },
              event.ruleReads ?? [],
              old.id,
              event.id,
              captured
            );
          }
        }
      }
    }
  const activeIds = archive.turns
    .filter((t) => t.status === TurnStatus.Completed && !t.undone)
    .map((t) => t.id);
  const requestIds = new Set<string>();
  for (const t of archive.turns) {
    if (requestIds.has(t.requestId))
      throw new Problem(422, 'archive_invalid', 'Duplicate request ID in archive');
    requestIds.add(t.requestId);
    if (t.campaignId !== old.id)
      throw new Problem(422, 'archive_invalid', 'Cross-campaign turn reference');
    if (t.context?.diceSessionId && t.context.diceSessionId !== t.diceSessionId)
      throw new Problem(422, 'archive_invalid', 'Context session identity does not match its turn');
    if (
      t.context &&
      (t.context.historyIds.some((id) => !tids.has(id)) ||
        (t.context.memoryId && !mids.has(t.context.memoryId)))
    )
      throw new Problem(422, 'archive_invalid', 'Unresolved context references');
    for (const source of t.context?.sourceVersions ?? []) {
      if (!ids.has(source.id)) ids.set(source.id, randomUUID());
    }
  }
  if (old.pinnedSourceIds.some((id) => !sids.has(id)) || (old.memory && !mids.has(old.memory.id)))
    throw new Problem(422, 'archive_invalid', 'Unresolved campaign reference');
  if (
    (old.pinnedSourceSections ?? []).some((pin) => {
      const source = old.sources.find(
        (source) =>
          source.id === pin.sourceId &&
          source.version === pin.version &&
          source.status === SourceStatus.Confirmed
      );
      return !source || !sourceSections(source)[pin.index];
    })
  )
    throw new Problem(422, 'archive_invalid', 'Unresolved current pinned section');
  for (const m of archive.memories) {
    if (m.coveredTurnIds.some((id) => !tids.has(id)))
      throw new Problem(422, 'archive_invalid', 'Unresolved memory turn coverage');
    if (
      m.valid &&
      JSON.stringify(m.coveredTurnIds) !==
        JSON.stringify(activeIds.slice(0, m.coveredTurnIds.length))
    )
      throw new Problem(
        422,
        'archive_invalid',
        'Valid memory must cover a consecutive active-turn prefix'
      );
  }
  if (
    old.memory &&
    !archive.memories.some(
      (m) => m.id === old.memory!.id && m.valid && JSON.stringify(m) === JSON.stringify(old.memory)
    )
  )
    throw new Problem(422, 'archive_invalid', 'Current memory must match a valid saved checkpoint');
  const snapshotIds = new Set<string>();
  for (const snap of archive.snapshots) {
    if (
      (snap.beforeKnowledge === undefined) !== (snap.afterKnowledge === undefined) ||
      snap.beforeKnowledge?.some(
        (record) => !snap.afterKnowledge?.some((after) => after.id === record.id)
      )
    )
      throw new Problem(
        422,
        'archive_invalid',
        'Knowledge undo snapshot must preserve touched records'
      );
    if (snapshotIds.has(snap.turnId))
      throw new Problem(422, 'archive_invalid', 'Duplicate snapshot turn ID');
    snapshotIds.add(snap.turnId);
    if (!tids.has(snap.turnId))
      throw new Problem(422, 'archive_invalid', 'Unresolved undo turn reference');
    const snapshotCharacterIds = new Set(
      [...snap.beforeCharacters, ...snap.afterCharacters].map((char) => char.id)
    );
    for (const characters of [snap.beforeCharacters, snap.afterCharacters]) {
      if (new Set(characters.map((char) => char.id)).size !== characters.length)
        throw new Problem(422, 'archive_invalid', 'Duplicate snapshot character ID');
    }
    for (const char of [...snap.beforeCharacters, ...snap.afterCharacters]) {
      if (nonCharacterIds.has(char.id))
        throw new Problem(
          422,
          'archive_invalid',
          'Snapshot character ID collides with another entity'
        );
      if (!ids.has(char.id)) ids.set(char.id, randomUUID());
    }
    if (snap.changedFields?.some((change) => !snapshotCharacterIds.has(change.characterId)))
      throw new Problem(422, 'archive_invalid', 'Unresolved changed-field character reference');
    if (snap.beforeMemory && !mids.has(snap.beforeMemory.id))
      throw new Problem(422, 'archive_invalid', 'Unresolved snapshot memory reference');
  }
  const completed = archive.turns.filter((t) => t.status === TurnStatus.Completed && !t.undone);
  if (completed.some((t) => !archive.snapshots.some((s) => s.turnId === t.id)))
    throw new Problem(422, 'archive_invalid', 'Completed turn is missing its undo snapshot');
  const out = structuredClone(archive);
  const mapped = (id: string) => ids.get(id)!;
  for (const session of archive.diceSessions)
    for (const id of session.characterIds) if (!ids.has(id)) ids.set(id, randomUUID());
  for (const session of archive.diceSessions) {
    const root = archive.turns.find((turn) => turn.id === session.rootTurnId);
    if (
      session.campaignId !== old.id ||
      !tids.has(session.rootTurnId) ||
      root?.diceSessionId !== session.id ||
      root.retryOfTurnId ||
      new Set(session.characterIds).size !== session.characterIds.length ||
      session.characterIds.some((id) => !ids.has(id) || nonCharacterIds.has(id))
    )
      throw new Problem(422, 'archive_invalid', 'Unresolved dice session references');
    const records = archive
      .diceRecords!.filter((record) => record.sessionId === session.id)
      .sort((a, b) => a.slot - b.slot);
    if (
      records.length > DICE_LIMITS.slots ||
      records.some((record, index) => record.slot !== index) ||
      records.reduce(
        (sum, record) =>
          sum + record.groups.reduce((count, group) => count + group.faces.length, 0),
        0
      ) !== session.newFaces
    )
      throw new Problem(
        422,
        'archive_invalid',
        'Dice session slots or face totals are inconsistent'
      );
  }
  for (const record of archive.diceRecords) {
    const session = archive.diceSessions.find((session) => session.id === record.sessionId);
    if (
      record.campaignId !== old.id ||
      !session ||
      [record.actorId, record.targetId].some(
        (id) =>
          id &&
          !session.characterIds.includes(id) &&
          !archive.combatPreparedCharacters.some(
            (draft) => draft.id === id && draft.sessionId === session.id
          )
      ) ||
      (record.rerollOf &&
        !archive.diceRecords.some(
          (previous) =>
            previous.id === record.rerollOf!.rollId &&
            previous.sessionId === record.sessionId &&
            previous.slot < record.slot
        ))
    )
      throw new Problem(422, 'archive_invalid', 'Unresolved dice record references');
  }
  for (const turn of archive.turns) {
    const reads = turn.ruleReads ?? [];
    const captured = turn.ruleContext ?? turn.context?.ruleContext;
    if ((reads.length || turn.ruleCitations?.length) && !captured)
      throw new Problem(422, 'archive_invalid', 'Rule evidence requires captured context');
    if (new Set(reads.map((read) => read.transportRequestId)).size !== reads.length)
      throw new Problem(422, 'archive_invalid', 'Rule receipt identities are invalid');
    for (const read of reads) {
      if (
        read.campaignId !== old.id ||
        read.turnId !== turn.id ||
        canonicalRuleJson(read.context) !== canonicalRuleJson(captured) ||
        read.payload.receipt !== read.id ||
        read.resultHash !==
          createHash('sha256').update(canonicalRuleJson(read.payload)).digest('hex')
      )
        throw new Problem(422, 'archive_invalid', 'Rule receipt provenance or hash is invalid');
    }
    if (captured)
      validateRuleCitations(
        { ruleCitations: turn.ruleCitations ?? [] },
        reads,
        old.id,
        turn.id,
        captured
      );
    const session = archive.diceSessions.find((session) => session.id === turn.diceSessionId);
    const previous = archive.turns.find((previous) => previous.id === turn.retryOfTurnId);
    if (
      (turn.diceSessionId && !session) ||
      (turn.retryOfTurnId &&
        (!previous ||
          previous.diceSessionId !== turn.diceSessionId ||
          previous.createdAt >= turn.createdAt ||
          ![TurnStatus.Failed, TurnStatus.Cancelled, TurnStatus.Interrupted].includes(
            previous.status as TurnStatus
          )))
    )
      throw new Problem(422, 'archive_invalid', 'Unresolved dice attempt references');
    for (const [index, record] of (turn.rolls ?? []).entries()) {
      const canonical = archive.diceRecords.find((canonical) => canonical.id === record.id);
      if (
        !session ||
        record.sessionId !== session.id ||
        record.slot !== index ||
        !canonical ||
        JSON.stringify(diceRecordSchema.parse(record)) !==
          JSON.stringify(diceRecordSchema.parse(canonical))
      )
        throw new Problem(
          422,
          'archive_invalid',
          'Turn dice must match its canonical session prefix'
        );
    }
    if (turn.status === TurnStatus.Completed && turn.diceSessionId) {
      validateRollPlacement({
        narrative: turn.narrative ?? '',
        rollInterpretations: turn.rollInterpretations ?? [],
      });
      validateRollInterpretations(
        { rollInterpretations: turn.rollInterpretations ?? [] },
        (turn.rolls ?? []).map((record) => record.id)
      );
    }
    if (
      (turn.rollInterpretations ?? []).some(
        (entry) => !(turn.rolls ?? []).some((record) => record.id === entry.rollId)
      )
    )
      throw new Problem(422, 'archive_invalid', 'Unresolved dice interpretation');
  }
  const remapRecord = (record: Archive['diceRecords'][number]) => {
    record.id = mapped(record.id);
    record.sessionId = mapped(record.sessionId);
    record.campaignId = mapped(record.campaignId);
    if (record.actorId) record.actorId = mapped(record.actorId);
    if (record.targetId) record.targetId = mapped(record.targetId);
    if (record.encounterId) record.encounterId = mapped(record.encounterId);
    if (record.rerollOf) record.rerollOf.rollId = mapped(record.rerollOf.rollId);
  };
  const remapKnowledge = (record: CampaignKnowledge) => {
    record.id = mapped(record.id);
    record.characterIds = record.characterIds.map(mapped);
    record.characterNames = Object.fromEntries(
      Object.entries(record.characterNames).map(([id, name]) => [mapped(id), name])
    );
    if (record.holderId) record.holderId = mapped(record.holderId);
    if (record.createdTurnId) record.createdTurnId = mapped(record.createdTurnId);
    if (record.updatedTurnId) record.updatedTurnId = mapped(record.updatedTurnId);
    for (const attribution of record.attributions)
      if (attribution.turnId) attribution.turnId = mapped(attribution.turnId);
    for (const evidence of [
      ...record.evidence,
      ...record.attributions.flatMap((entry) => entry.evidence),
    ]) {
      if (evidence.type === 'campaign_source') evidence.sourceId = mapped(evidence.sourceId);
      else evidence.citation.receiptId = mapped(evidence.citation.receiptId);
    }
  };
  const remapFrozen = (captured: FrozenKnowledge) => {
    captured.campaignId = mapped(captured.campaignId);
    captured.records.forEach(remapKnowledge);
    captured.characters.forEach((character) => {
      character.id = mapped(character.id);
    });
    captured.npcCharacters?.forEach((npc) => {
      npc.id = mapped(npc.id);
    });
    captured.sourceIds = captured.sourceIds.map(mapped);
    for (const source of captured.sourceVersions ?? []) source.id = mapped(source.id);
  };
  out.campaign.knowledge.forEach(remapKnowledge);
  if (out.campaign.journal) {
    // Journal ids that name removed (undone) records still need one consistent new identity.
    const jid = (id: string) => {
      if (!ids.has(id)) ids.set(id, randomUUID());
      return ids.get(id)!;
    };
    const ledger = out.campaign.journal;
    ledger.coverageTurnIds = ledger.coverageTurnIds.map(jid);
    ledger.undoneTurnIds = ledger.undoneTurnIds.map(jid);
    const remapEvidence = (e: { turnId: string }) => {
      e.turnId = jid(e.turnId);
    };
    for (const event of ledger.events) {
      event.id = jid(event.id);
      event.jobId = jid(event.jobId);
      if (event.kind === JournalEventKind.Correction) {
        event.knowledgeId = jid(event.knowledgeId);
        event.evidence.forEach(remapEvidence);
        for (const patch of [event.before, event.after]) {
          if (patch.characterIds) patch.characterIds = patch.characterIds.map(jid);
          if (patch.holderId) patch.holderId = jid(patch.holderId);
        }
      } else {
        event.knowledgeIds = event.knowledgeIds.map(jid);
        for (const x of event.contributions) {
          x.turnId = jid(x.turnId);
          x.knowledgeId = jid(x.knowledgeId);
          x.dependsOn = x.dependsOn.map(jid);
          x.evidence.forEach(remapEvidence);
          for (const fields of [x.before, x.after]) {
            if (!fields) continue;
            fields.characterIds = fields.characterIds.map(jid);
            if (fields.holderId) fields.holderId = jid(fields.holderId);
          }
        }
      }
      // Digests cover remapped structured payloads; frozen prompts are untouched.
      event.digest = eventDigest(event as unknown as Record<string, unknown>);
    }
  }
  for (const session of out.diceSessions) {
    session.id = mapped(session.id);
    session.campaignId = mapped(session.campaignId);
    session.rootTurnId = mapped(session.rootTurnId);
    session.characterIds = session.characterIds.map(mapped);
    if (session.frozenKnowledge) remapFrozen(session.frozenKnowledge);
    if (session.frozenSources) {
      session.frozenSources.campaignId = mapped(session.frozenSources.campaignId);
      for (const source of session.frozenSources.sources) source.id = mapped(source.id);
    }
    session.imported = true;
  }
  for (const record of out.diceRecords) remapRecord(record);
  for (const prep of out.combatPreparations) remapCombatPreparation(prep, mapped);
  for (const draft of out.combatPreparedCharacters) remapPreparedCharacter(draft, mapped);
  remapCombatState(out.campaign.state, mapped);
  out.campaign.id = mapped(old.id);
  out.campaign.ruleSystemId = null;
  if (out.campaign.ruleReference?.kind === RuleSystemKind.Library)
    out.campaign.ruleResolution = { status: 'unresolved', reference: out.campaign.ruleReference };
  for (const c of out.campaign.characters) c.id = mapped(c.id);
  for (const source of out.campaign.sources) {
    source.id = mapped(source.id);
    source.originalAvailable = false;
  }
  out.campaign.pinnedSourceIds = old.pinnedSourceIds.map(mapped);
  out.campaign.pinnedSourceSections = (old.pinnedSourceSections ?? []).map((pin) => ({
    ...pin,
    sourceId: mapped(pin.sourceId),
  }));
  const remapMemory = (m: Memory) => {
    m.id = mapped(m.id);
    m.coveredTurnIds = m.coveredTurnIds.map(mapped);
  };
  if (out.campaign.memory) remapMemory(out.campaign.memory);
  for (const m of out.memories) remapMemory(m);
  for (const t of out.turns) {
    for (const read of t.sourceReads ?? []) {
      read.id = mapped(read.id);
      read.campaignId = mapped(read.campaignId);
      read.turnId = mapped(read.turnId);
      read.sessionId = mapped(read.sessionId);
      if (read.tool === CAMPAIGN_SOURCE_GET_TOOL_NAME) read.payload.receiptId = read.id;
      if (
        read.payload.sourceSpan &&
        typeof read.payload.sourceSpan === 'object' &&
        'id' in read.payload.sourceSpan
      ) {
        const span = read.payload.sourceSpan as { id: string };
        span.id = mapped(span.id);
      }
      // Payloads contain frozen catalog/search results with historical source IDs.
      for (const field of ['sources', 'sections', 'entries'])
        if (Array.isArray(read.payload[field]))
          for (const value of read.payload[field])
            if (value && typeof value === 'object') {
              if (typeof value.sourceId === 'string') value.sourceId = mapped(value.sourceId);
              if (typeof value.id === 'string' && ids.has(value.id)) value.id = mapped(value.id);
            }
    }
    for (const e of t.operationExplanations ?? []) {
      e.rollIds = e.rollIds.map(mapped);
      for (const evidence of e.evidence)
        if (evidence.type === 'campaign_source') evidence.sourceId = mapped(evidence.sourceId);
        else evidence.citation.receiptId = mapped(evidence.citation.receiptId);
    }
    if (t.context?.frozenSources) {
      t.context.frozenSources.campaignId = mapped(t.context.frozenSources.campaignId);
      for (const source of t.context.frozenSources.sources) source.id = mapped(source.id);
    }
    for (const list of [
      t.context?.sourceSelection?.included ?? [],
      t.context?.sourceSelection?.omitted ?? [],
    ])
      for (const item of list) item.id = mapped(item.id);
    for (const read of t.ruleReads ?? []) {
      read.id = mapped(read.id);
      read.campaignId = out.campaign.id;
      read.turnId = mapped(t.id);
      read.payload.receipt = read.id;
      read.resultHash = createHash('sha256').update(canonicalRuleJson(read.payload)).digest('hex');
    }
    for (const citation of t.ruleCitations ?? []) citation.receiptId = mapped(citation.receiptId);
    t.rolls ??= [];
    t.rollInterpretations ??= [];
    if (t.diceSessionId) t.diceSessionId = mapped(t.diceSessionId);
    if (t.retryOfTurnId) t.retryOfTurnId = mapped(t.retryOfTurnId);
    for (const record of t.rolls ?? []) remapRecord(record);
    for (const entry of t.rollInterpretations ?? []) entry.rollId = mapped(entry.rollId);
    remapTurnCombat(t, mapped);
    t.id = mapped(t.id);
    t.campaignId = out.campaign.id;
    t.requestId = randomUUID();
    if (t.context) {
      if (t.context.diceSessionId) t.context.diceSessionId = mapped(t.context.diceSessionId);
      if (t.context.frozenKnowledge) remapFrozen(t.context.frozenKnowledge);
      for (const span of t.context.sourceSpans ?? []) span.id = mapped(span.id);
      t.context.sourceVersions = t.context.sourceVersions.map((source) => ({
        ...source,
        id: mapped(source.id),
      }));
      t.context.historyIds = t.context.historyIds.map(mapped);
      if (t.context.memoryId) t.context.memoryId = mapped(t.context.memoryId);
      // Historical prompts are immutable audit text, never reused as provider input.
    }
  }
  for (const snapshot of out.snapshots) {
    snapshot.beforeKnowledge?.forEach(remapKnowledge);
    snapshot.afterKnowledge?.forEach(remapKnowledge);
    snapshot.turnId = mapped(snapshot.turnId);
    for (const c of [...snapshot.beforeCharacters, ...snapshot.afterCharacters])
      c.id = mapped(c.id);
    if (snapshot.beforeMemory) remapMemory(snapshot.beforeMemory);
    remapCombatState(snapshot.beforeState, mapped);
    remapCombatState(snapshot.afterState, mapped);
    for (const change of snapshot.changedFields ?? [])
      change.characterId = mapped(change.characterId);
  }
  out.campaign.createdAt = new Date().toISOString();
  out.campaign.updatedAt = out.campaign.createdAt;
  return out;
}
export class LibraryService {
  constructor(readonly store: Store) {}
  private async resolveReference(c: Campaign, client: import('pg').PoolClient) {
    const reference = c.ruleResolution?.reference ?? c.ruleReference;
    c.ruleSystemId = null;
    if (!reference || reference.kind === RuleSystemKind.ModelKnowledge) {
      delete c.ruleResolution;
      return;
    }
    const found = await client.query(
      'SELECT id,kind,content_hash FROM rule_systems WHERE system_key=$1 FOR SHARE',
      [reference.systemKey]
    );
    const row = found.rows[0];
    if (row?.kind === reference.kind && row.content_hash === reference.contentHash) {
      c.ruleSystemId = row.id;
      delete c.ruleResolution;
    } else c.ruleResolution = { status: 'unresolved', reference };
  }
  private async reference(c: Campaign, client: import('pg').PoolClient): Promise<RuleReference> {
    if (c.ruleResolution) return c.ruleResolution.reference;
    const system = await new RuleStore(this.store).get(
      c.ruleSystemId ?? DEFAULT_RULE_SYSTEM_ID,
      client,
      'share'
    );
    const { systemKey, systemName, kind, contentHash } = system;
    return { systemKey, systemName, kind, contentHash };
  }
  async listTemplates(kind: 'campaign' | 'character', limit: number, offset: number) {
    const table = kind === 'campaign' ? 'templates' : 'character_templates';
    const result = await this.store.pool.query(
      `SELECT document FROM ${table} ORDER BY created_at DESC,id LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return result.rows.map((row) => row.document);
  }
  async deleteTemplate(kind: 'campaign' | 'character', id: string) {
    const table = kind === 'campaign' ? 'templates' : 'character_templates';
    await this.store.pool.query(`DELETE FROM ${table} WHERE id=$1`, [id]);
  }
  characterTemplate(input: {
    name: string;
    campaignId: string;
    characterId: string;
    revision: number;
  }) {
    return this.store.transaction(async (client) => {
      const c = await this.store.campaign(input.campaignId, client, true);
      const character = c.characters.find((character) => character.id === input.characterId);
      if (!character) throw new Problem(404, 'not_found', 'Character not found');
      const template = {
        id: randomUUID(),
        name: input.name,
        character: { ...character, notes: '', revision: 0 },
        createdAt: new Date().toISOString(),
      };
      await client.query('INSERT INTO character_templates(id,document) VALUES($1,$2)', [
        template.id,
        template,
      ]);
      return template;
    });
  }
  instantiateCharacter(id: string, templateId: string, revision: number) {
    return this.store.edit(id, revision, async (c, client) => {
      const result = await client.query('SELECT document FROM character_templates WHERE id=$1', [
        templateId,
      ]);
      if (!result.rows[0]) throw new Problem(404, 'not_found', 'Character template not found');
      c.characters.push({
        ...result.rows[0].document.character,
        id: randomUUID(),
        notes: '',
        revision: 0,
      });
    });
  }
  async export(id: string): Promise<Archive> {
    return this.store.transaction(async (client) => {
      const c = await this.store.campaign(id, client, true);
      await this.store.assertIdle(id, client);
      const turns = (await this.store.turns(id, client, MAX_ARCHIVE_TURNS)).map(
        ({
          diceRetry: _diceRetry,
          editingPending: _editingPending,
          editingResume: _editingResume,
          ...turn
        }) => turn
      );
      const snaps = await client.query('SELECT document FROM snapshots WHERE campaign_id=$1', [id]);
      const memories = await client.query(
        'SELECT document FROM memories WHERE campaign_id=$1 ORDER BY created_at',
        [id]
      );
      const sessions = await client.query(
        'SELECT * FROM dice_sessions WHERE campaign_id=$1 ORDER BY created_at,id',
        [id]
      );
      const records = await client.query(
        'SELECT * FROM dice_records WHERE campaign_id=$1 ORDER BY session_id,slot',
        [id]
      );
      const combat = {
        combatPreparations: (
          await client.query(
            'SELECT * FROM combat_preparations WHERE campaign_id=$1 ORDER BY created_at,id',
            [id]
          )
        ).rows.map((row) => ({
          id: row.id,
          campaignId: row.campaign_id,
          sessionId: row.session_id,
          turnId: row.turn_id,
          encounterId: row.encounter_id,
          preparationKey: row.preparation_key,
          argumentDigest: row.argument_digest,
          payload: row.payload,
          createdAt: new Date(row.created_at).toISOString(),
        })),
        combatPreparedCharacters: (
          await client.query(
            'SELECT * FROM combat_prepared_characters WHERE campaign_id=$1 ORDER BY created_at,id',
            [id]
          )
        ).rows.map((row) => ({
          id: row.id,
          campaignId: row.campaign_id,
          sessionId: row.session_id,
          preparationId: row.preparation_id,
          localKey: row.local_key,
          specificationDigest: row.specification_digest,
          draft: row.draft,
          createdAt: new Date(row.created_at).toISOString(),
        })),
      };
      return {
        format: ARCHIVE_FORMAT_ID,
        diceSessions: sessions.rows.map((row) => ({
          id: row.id,
          campaignId: row.campaign_id,
          rootTurnId: row.root_turn_id,
          contextDigest: row.context_digest,
          frozenPrompt: row.frozen_prompt,
          frozenRevision: row.frozen_revision,
          characterIds: row.character_ids,
          imported: row.imported,
          newFaces: row.new_faces,
          createdAt: new Date(row.created_at).toISOString(),
          ...(row.system_prompt != null
            ? {
                systemPrompt: row.system_prompt,
                frozenKnowledge: row.frozen_knowledge,
                ...(row.frozen_sources != null ? { frozenSources: row.frozen_sources } : {}),
                toolDefinitions: row.tool_definitions,
              }
            : {}),
        })),
        diceRecords: records.rows.map((row) => ({
          ...row.input,
          id: row.id,
          campaignId: row.campaign_id,
          sessionId: row.session_id,
          groups: row.groups,
          createdAt: new Date(row.created_at).toISOString(),
        })),
        campaign: {
          ...c,
          ruleSystemId: null,
          ruleReference: await this.reference(c, client),
          knowledge: c.knowledge ?? [],
        },
        turns,
        snapshots: snaps.rows.map((r) => r.document as Snapshot),
        memories: memories.rows.map((r) => r.document as Memory),
        ...combat,
      };
    });
  }
  async import(raw: unknown): Promise<Campaign> {
    const archive = remapArchive(raw);
    return this.store.transaction(async (client) => {
      await this.resolveReference(archive.campaign, client);
      await this.store.insert(archive.campaign, client);
      for (const t of archive.turns)
        await client.query(
          'INSERT INTO turns(id,campaign_id,request_id,payload_hash,status,document,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [t.id, archive.campaign.id, t.requestId, 'imported', t.status, t, t.createdAt]
        );
      for (const t of archive.turns)
        for (const read of t.ruleReads ?? [])
          await client.query(
            'INSERT INTO turn_rule_reads(id,campaign_id,turn_id,system_id,captured_context,tool_name,transport_request_id,argument_digest,result_hash,payload,transcript_bytes,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
            [
              read.id,
              read.campaignId,
              read.turnId,
              read.context.systemId,
              read.context,
              read.tool,
              read.transportRequestId,
              read.argumentDigest,
              read.resultHash,
              read.payload,
              serializedBytes(read.payload),
              read.createdAt,
            ]
          );
      for (const s of archive.snapshots)
        await client.query('INSERT INTO snapshots(turn_id,campaign_id,document) VALUES($1,$2,$3)', [
          s.turnId,
          archive.campaign.id,
          s,
        ]);
      for (const m of archive.memories)
        await client.query('INSERT INTO memories(id,campaign_id,document) VALUES($1,$2,$3)', [
          m.id,
          archive.campaign.id,
          m,
        ]);
      for (const session of archive.diceSessions)
        await client.query(
          session.systemPrompt !== undefined
            ? 'INSERT INTO dice_sessions(id,campaign_id,root_turn_id,context_digest,frozen_prompt,frozen_revision,character_ids,imported,new_faces,created_at,system_prompt,frozen_knowledge,tool_definitions,frozen_sources) VALUES($1,$2,$3,$4,$5,$6,$7,true,$8,$9,$10,$11,$12,$13)'
            : 'INSERT INTO dice_sessions(id,campaign_id,root_turn_id,context_digest,frozen_prompt,frozen_revision,character_ids,imported,new_faces,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,true,$8,$9)',
          [
            session.id,
            session.campaignId,
            session.rootTurnId,
            session.contextDigest,
            session.frozenPrompt,
            session.frozenRevision,
            JSON.stringify(session.characterIds),
            session.newFaces,
            session.createdAt,
            ...(session.systemPrompt !== undefined
              ? [
                  session.systemPrompt,
                  JSON.stringify(session.frozenKnowledge),
                  JSON.stringify(session.toolDefinitions),
                  session.frozenSources ? JSON.stringify(session.frozenSources) : null,
                ]
              : []),
          ]
        );
      for (const t of archive.turns)
        for (const read of t.sourceReads ?? [])
          await client.query(
            'INSERT INTO turn_campaign_source_reads(id,campaign_id,turn_id,session_id,tool_name,transport_request_id,argument_digest,payload,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
            [
              read.id,
              read.campaignId,
              read.turnId,
              read.sessionId,
              read.tool,
              read.transportRequestId,
              read.argumentDigest,
              read.payload,
              read.createdAt,
            ]
          );
      for (const record of archive.diceRecords) {
        const { id, sessionId, campaignId, createdAt, groups, ...base } = record;
        const input = {
          ...base,
          groups: groups.map((group) => ({
            label: group.label,
            sides: group.sides,
            count: group.faces.length,
          })),
        };
        await client.query(
          'INSERT INTO dice_records(id,campaign_id,session_id,slot,spec_digest,input,groups,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [
            id,
            campaignId,
            sessionId,
            record.slot,
            diceDigest(input),
            input,
            JSON.stringify(groups),
            createdAt,
          ]
        );
      }
      for (const prep of archive.combatPreparations)
        await client.query(
          'INSERT INTO combat_preparations(id,campaign_id,session_id,turn_id,encounter_id,preparation_key,argument_digest,payload,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [
            prep.id,
            prep.campaignId,
            prep.sessionId,
            prep.turnId,
            prep.encounterId,
            prep.preparationKey,
            prep.argumentDigest,
            prep.payload,
            prep.createdAt,
          ]
        );
      for (const draft of archive.combatPreparedCharacters)
        await client.query(
          'INSERT INTO combat_prepared_characters(id,campaign_id,session_id,preparation_id,local_key,specification_digest,draft,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
          [
            draft.id,
            draft.campaignId,
            draft.sessionId,
            draft.preparationId,
            draft.localKey,
            draft.specificationDigest,
            draft.draft,
            draft.createdAt,
          ]
        );
      await this.store.reindex(archive.campaign, client);
      return archive.campaign;
    });
  }
  async template(name: string, campaignId: string, _revision: number) {
    return this.store.transaction(async (client) => {
      const c = await this.store.campaign(campaignId, client, true);
      await this.store.assertIdle(c.id, client);
      const setup = {
        ruleSystemId: null,
        ruleReference: await this.reference(c, client),
        name: c.name,
        description: c.description,
        instructions: c.instructions,
        characters: c.characters,
        sources: c.sources,
        settings: c.settings,
        pinnedSourceIds: c.pinnedSourceIds,
        pinnedSourceSections: c.pinnedSourceSections ?? [],
        budgets: c.budgets,
      };
      const t = { id: randomUUID(), name, setup, createdAt: new Date().toISOString() };
      await client.query('INSERT INTO templates(id,document) VALUES($1,$2)', [t.id, t]);
      return t;
    });
  }
  async instantiate(id: string, name?: string): Promise<Campaign> {
    return this.store.transaction(async (client) => {
      const r = await client.query('SELECT document FROM templates WHERE id=$1', [id]);
      if (!r.rows[0]) throw new Problem(404, 'not_found', 'Template not found');
      const template = r.rows[0].document;
      const setup = { ...template.setup };
      delete setup.pinnedFacts;
      // Templates never carry play state: no encounter or its character links can transplant.
      delete setup.state;
      // Journal history and audit events belong to one campaign's timeline.
      delete setup.journal;
      const c = { ...newCampaign({ name: name ?? template.name }), ...setup } as Campaign;
      // Even an externally stored template cannot transplant another campaign's timeline.
      c.knowledge = [];
      c.id = randomUUID();
      if (name) c.name = name;
      const map = new Map<string, string>();
      c.characters = c.characters.map((char) => ({
        ...char,
        id: randomUUID(),
        notes: '',
        revision: 0,
      }));
      c.sources = c.sources.map((source) => {
        const next = randomUUID();
        map.set(source.id, next);
        return { ...source, id: next, originalAvailable: false };
      });
      c.pinnedSourceIds = c.pinnedSourceIds.map((id) => map.get(id)!);
      c.pinnedSourceSections = (c.pinnedSourceSections ?? []).map((pin) => ({
        ...pin,
        sourceId: map.get(pin.sourceId)!,
      }));
      await this.resolveReference(c, client);
      await this.store.insert(c, client);
      await this.store.reindex(c, client);
      return c;
    });
  }
}
