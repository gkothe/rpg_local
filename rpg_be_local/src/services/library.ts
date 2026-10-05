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
import { Problem, conflict } from '../errors.js';
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
  ARCHIVE_FORMAT_ID,
  ARCHIVE_FORMAT_VERSION,
  LEGACY_ARCHIVE_FORMAT_VERSION,
  DICE_GAMEPLAY_RESPONSE_SCHEMA_VERSION,
  DICE_ARCHIVE_FORMAT_VERSION,
  RULE_ARCHIVE_FORMAT_VERSION,
  KNOWLEDGE_ARCHIVE_FORMAT_VERSION,
  AUDITED_ARCHIVE_FORMAT_VERSION,
} from '../domain/versions.js';
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
import { validateRuleCitations } from '../domain/ruleResponse.js';
import { DICE_LIMITS, diceRecordSchema, diceSessionSchema } from '../domain/dice.js';
import { rollInterpretationSchema, validateRollInterpretations } from '../domain/diceResponse.js';
import { diceDigest } from './dice.js';
import {
  knowledgeRecordSchema,
  campaignKnowledgeSchema,
  legacyKnowledge,
  validateKnowledgeEvidence,
  KnowledgeOrigin,
  sourceSpanSchema,
  type CampaignKnowledge,
} from '../domain/knowledge.js';
import {
  frozenKnowledgeSchema,
  frozenKnowledgeV5Schema,
  type FrozenKnowledge,
} from '../domain/knowledgeRecall.js';
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
          })
          .strict()
      )
      .max(1000),
    settings,
    pinnedFacts: z.array(z.string()),
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
        gameplay: z
          .number()
          .int()
          .min(CONTEXT_BUDGET_LIMITS.gameplay.min)
          .max(CONTEXT_BUDGET_LIMITS.gameplay.max),
        compaction: z
          .number()
          .int()
          .min(CONTEXT_BUDGET_LIMITS.compaction.min)
          .max(CONTEXT_BUDGET_LIMITS.compaction.max),
        memory: z
          .number()
          .int()
          .min(CONTEXT_BUDGET_LIMITS.memory.min)
          .max(CONTEXT_BUDGET_LIMITS.memory.max),
      })
      .strict(),
    state: object,
    memory: memory.nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
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
  })
  .strict();
const turn = z
  .object({
    ruleContext: ruleContextSchema.optional(),
    ruleReads: z.array(ruleReadSchema).max(RULE_LIMITS.calls).optional(),
    ruleCitations: z.array(ruleCitationSchema).max(RULE_LIMITS.calls).optional(),
    diceSessionId: uuid.optional(),
    retryOfTurnId: uuid.optional(),
    rolls: z.array(diceRecordSchema).max(DICE_LIMITS.slots).optional(),
    rollInterpretations: z.array(rollInterpretationSchema).max(DICE_LIMITS.slots).optional(),
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
const knowledgeContext = context.extend({
  systemPrompt: z.string().optional(),
  promptContractVersion: z.literal(KNOWLEDGE_ARCHIVE_FORMAT_VERSION).optional(),
  diceSessionId: uuid.optional(),
  frozenKnowledge: frozenKnowledgeSchema.optional(),
  sourceSpans: z.array(sourceSpanSchema).optional(),
});
const archiveSchema = z
  .object({
    format: z.literal(ARCHIVE_FORMAT_ID),
    version: z.union([
      z.literal(LEGACY_ARCHIVE_FORMAT_VERSION),
      z.literal(DICE_ARCHIVE_FORMAT_VERSION),
      z.literal(RULE_ARCHIVE_FORMAT_VERSION),
    ]),
    diceSessions: z.array(diceSessionSchema).max(MAX_ARCHIVE_TURNS).optional(),
    diceRecords: z
      .array(diceRecordSchema)
      .max(MAX_ARCHIVE_TURNS * DICE_LIMITS.slots)
      .optional(),
    campaign,
    turns: z.array(turn).max(MAX_ARCHIVE_TURNS),
    snapshots: z.array(snapshot),
    memories: z.array(memory),
  })
  .strict();
const knowledgeArchiveSchema = archiveSchema.extend({
  version: z.literal(KNOWLEDGE_ARCHIVE_FORMAT_VERSION),
  campaign: campaign.extend({ knowledge: z.array(knowledgeRecordSchema) }),
  turns: z.array(turn.extend({ context: knowledgeContext.nullable() })).max(MAX_ARCHIVE_TURNS),
  snapshots: z.array(
    snapshot.extend({
      beforeKnowledge: z.array(knowledgeRecordSchema).optional(),
      afterKnowledge: z.array(knowledgeRecordSchema).optional(),
    })
  ),
});
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
const auditedContext = knowledgeContext
  .extend({
    promptContractVersion: z.union([z.literal(4), z.literal(5)]).optional(),
    frozenKnowledge: frozenKnowledgeV5Schema.optional(),
    frozenSources: frozenCampaignSourcesSchema.optional(),
    sourceSelection: z
      .object({
        bootstrap: z.boolean(),
        reasons: z.array(z.enum(['no_source', 'no_match', 'target_omission'])),
        included: z.array(
          z
            .object({
              id: uuid,
              version: z.number().int().positive(),
              sectionIndex: z.number().int().nonnegative(),
            })
            .strict()
        ),
        omitted: z.array(
          z
            .object({
              id: uuid,
              version: z.number().int().positive(),
              sectionIndex: z.number().int().nonnegative(),
            })
            .strict()
        ),
      })
      .strict()
      .optional(),
  })
  .strict();
const auditedArchiveSchema = knowledgeArchiveSchema
  .extend({
    version: z.literal(AUDITED_ARCHIVE_FORMAT_VERSION),
    campaign: campaign
      .extend({
        knowledge: z.array(campaignKnowledgeSchema),
        sources: z
          .array(
            campaign.shape.sources.element
              .extend({ purpose: z.enum(SourcePurpose).optional() })
              .strict()
          )
          .max(1000),
      })
      .strict(),
    turns: z
      .array(
        turn
          .extend({
            context: auditedContext.nullable(),
            ruleReads: z.array(ruleReadSchema).optional(),
            sourceReads: z.array(sourceRead).optional(),
            operationExplanations: z.array(operationExplanationSchema).optional(),
            traceId: z.string().optional(),
          })
          .strict()
      )
      .max(MAX_ARCHIVE_TURNS),
    snapshots: z.array(
      snapshot
        .extend({
          beforeKnowledge: z.array(campaignKnowledgeSchema).optional(),
          afterKnowledge: z.array(campaignKnowledgeSchema).optional(),
        })
        .strict()
    ),
  })
  .strict();
export function remapArchive(raw: unknown): Archive {
  const isAudited =
    typeof raw === 'object' &&
    raw !== null &&
    'version' in raw &&
    raw.version === AUDITED_ARCHIVE_FORMAT_VERSION;
  const isKnowledge =
    isAudited ||
    (typeof raw === 'object' &&
      raw !== null &&
      'version' in raw &&
      raw.version === KNOWLEDGE_ARCHIVE_FORMAT_VERSION);
  const parsed = isAudited
    ? auditedArchiveSchema.parse(raw)
    : isKnowledge
      ? knowledgeArchiveSchema.parse(raw)
      : archiveSchema.parse(raw);
  const metadata = [
    'promptContractVersion',
    'digestVersion',
    'systemPrompt',
    'frozenKnowledge',
    'toolDefinitions',
  ] as const;
  for (const session of parsed.diceSessions ?? []) {
    if (
      !isAudited &&
      (session.promptContractVersion === 5 || session.digestVersion === 3 || session.frozenSources)
    )
      throw new Problem(422, 'archive_invalid', 'New frozen metadata requires a version 5 archive');
    if (session.promptContractVersion === 4 && session.frozenKnowledge)
      frozenKnowledgeSchema.parse(session.frozenKnowledge);
    if (
      session.promptContractVersion === 5 &&
      (session.digestVersion !== 3 || !session.frozenSources)
    )
      throw new Problem(
        422,
        'archive_invalid',
        'Version 5 session requires its digest and frozen sources'
      );
    const count = metadata.filter((key) => session[key] !== undefined).length;
    if ((!isKnowledge && count) || (count !== 0 && count !== metadata.length))
      throw new Problem(
        422,
        'archive_invalid',
        'Frozen session metadata requires a complete version 4 contract'
      );
    if (
      session.toolDefinitions &&
      new Set(session.toolDefinitions.map((tool) => tool.name)).size !==
        session.toolDefinitions.length
    )
      throw new Problem(422, 'archive_invalid', 'Duplicate frozen tool definition');
  }
  const hasRules =
    parsed.campaign.ruleSystemId ||
    parsed.campaign.ruleReference ||
    parsed.campaign.ruleResolution ||
    parsed.turns.some(
      (entry) =>
        entry.ruleContext?.kind === RuleSystemKind.Library ||
        entry.context?.ruleContext?.kind === RuleSystemKind.Library ||
        entry.ruleReads?.length ||
        entry.ruleCitations?.length
    );
  if (hasRules && parsed.version < RULE_ARCHIVE_FORMAT_VERSION)
    throw new Problem(
      422,
      'archive_invalid',
      'Rule references and evidence require a version 3 archive'
    );
  if (
    parsed.campaign.ruleSystemId &&
    !parsed.campaign.ruleReference &&
    !parsed.campaign.ruleResolution
  )
    throw new Problem(422, 'archive_invalid', 'Book selection requires a portable rule reference');
  if (
    parsed.version === LEGACY_ARCHIVE_FORMAT_VERSION &&
    ((parsed.diceSessions?.length ?? 0) ||
      (parsed.diceRecords?.length ?? 0) ||
      parsed.turns.some(
        (turn) =>
          turn.diceSessionId ||
          turn.retryOfTurnId ||
          turn.rolls?.length ||
          turn.rollInterpretations?.length
      ))
  )
    throw new Problem(422, 'archive_invalid', 'Legacy archives cannot contain dice sessions');
  const archive: Archive = {
    ...parsed,
    version: (isAudited
      ? AUDITED_ARCHIVE_FORMAT_VERSION
      : ARCHIVE_FORMAT_VERSION) as Archive['version'],
    diceSessions: parsed.diceSessions ?? [],
    diceRecords: parsed.diceRecords ?? [],
  };
  if (isKnowledge || ARCHIVE_FORMAT_VERSION >= KNOWLEDGE_ARCHIVE_FORMAT_VERSION)
    archive.campaign.knowledge ??= [];
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
  archive.diceSessions!.forEach((session) => register(session.id));
  archive.diceRecords!.forEach((record) => register(record.id));
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
    ...archive.diceSessions!.map((session) => session.id),
    ...archive.diceRecords!.map((record) => record.id),
    ...archive.turns.flatMap((turn) => (turn.ruleReads ?? []).map((read) => read.id)),
    ...archive.turns.flatMap((turn) => (turn.sourceReads ?? []).map((read) => read.id)),
  ]);
  const knowledgeCollections = [
    old.knowledge ?? [],
    ...archive.snapshots.flatMap((snap) => [snap.beforeKnowledge ?? [], snap.afterKnowledge ?? []]),
    ...archive.diceSessions!.map((session) => session.frozenKnowledge?.records ?? []),
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
  for (const session of archive.diceSessions!)
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
  const frozen = [
    ...archive.diceSessions!.flatMap((session) =>
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
  for (const session of archive.diceSessions!) {
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
          archive.diceSessions!.find((s) => s.id === turn.diceSessionId)?.frozenSources;
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
              {
                version: RULE_ARCHIVE_FORMAT_VERSION,
                narrative: 'Knowledge evidence',
                operations: [],
                rollInterpretations: [],
                ruleCitations: [evidence.citation],
              },
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
  for (const session of archive.diceSessions!)
    for (const id of session.characterIds) if (!ids.has(id)) ids.set(id, randomUUID());
  for (const session of archive.diceSessions!) {
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
  for (const record of archive.diceRecords!) {
    const session = archive.diceSessions!.find((session) => session.id === record.sessionId);
    if (
      record.campaignId !== old.id ||
      !session ||
      [record.actorId, record.targetId].some((id) => id && !session.characterIds.includes(id)) ||
      (record.rerollOf &&
        !archive.diceRecords!.some(
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
    if (
      new Set(reads.map((read) => read.transportRequestId)).size !== reads.length ||
      (archive.version < AUDITED_ARCHIVE_FORMAT_VERSION &&
        reads.reduce((sum, read) => sum + serializedBytes(read.payload), 0) >
          RULE_LIMITS.legacyArchiveTranscriptBytes)
    )
      throw new Problem(422, 'archive_invalid', 'Rule receipt identities or size are invalid');
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
        {
          version: RULE_ARCHIVE_FORMAT_VERSION,
          narrative: turn.narrative ?? '',
          operations: [],
          rollInterpretations: [],
          ruleCitations: turn.ruleCitations ?? [],
        },
        reads,
        old.id,
        turn.id,
        captured
      );
    const session = archive.diceSessions!.find((session) => session.id === turn.diceSessionId);
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
      const canonical = archive.diceRecords!.find((canonical) => canonical.id === record.id);
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
    if (turn.status === TurnStatus.Completed && turn.diceSessionId)
      validateRollInterpretations(
        {
          version: DICE_GAMEPLAY_RESPONSE_SCHEMA_VERSION,
          narrative: turn.narrative ?? '',
          operations: [],
          rollInterpretations: turn.rollInterpretations ?? [],
        },
        (turn.rolls ?? []).map((record) => record.id)
      );
    if (
      (turn.rollInterpretations ?? []).some(
        (entry) => !(turn.rolls ?? []).some((record) => record.id === entry.rollId)
      )
    )
      throw new Problem(422, 'archive_invalid', 'Unresolved dice interpretation');
  }
  const remapRecord = (record: NonNullable<Archive['diceRecords']>[number]) => {
    record.id = mapped(record.id);
    record.sessionId = mapped(record.sessionId);
    record.campaignId = mapped(record.campaignId);
    if (record.actorId) record.actorId = mapped(record.actorId);
    if (record.targetId) record.targetId = mapped(record.targetId);
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
    captured.sourceIds = captured.sourceIds.map(mapped);
    for (const source of captured.sourceVersions ?? []) source.id = mapped(source.id);
  };
  out.campaign.knowledge?.forEach(remapKnowledge);
  for (const session of out.diceSessions!) {
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
  for (const record of out.diceRecords!) remapRecord(record);
  out.campaign.id = mapped(old.id);
  out.campaign.ruleSystemId = null;
  if (out.campaign.ruleReference?.kind === RuleSystemKind.Library)
    out.campaign.ruleResolution = { status: 'unresolved', reference: out.campaign.ruleReference };
  if (parsed.version < RULE_ARCHIVE_FORMAT_VERSION) {
    delete out.campaign.ruleReference;
    delete out.campaign.ruleResolution;
  }
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
      if (c.revision !== input.revision) throw conflict('Campaign changed');
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
      return {
        format: ARCHIVE_FORMAT_ID,
        version: ARCHIVE_FORMAT_VERSION,
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
          ...(ARCHIVE_FORMAT_VERSION >= KNOWLEDGE_ARCHIVE_FORMAT_VERSION &&
          row.prompt_contract_version != null
            ? {
                promptContractVersion: row.prompt_contract_version,
                digestVersion: row.digest_version,
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
          ...(ARCHIVE_FORMAT_VERSION < AUDITED_ARCHIVE_FORMAT_VERSION
            ? { knowledge: legacyKnowledge(c.knowledge ?? []) }
            : {}),
        },
        turns,
        snapshots: snaps.rows.map((r) => r.document as Snapshot),
        memories: memories.rows.map((r) => r.document as Memory),
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
      for (const session of archive.diceSessions ?? [])
        await client.query(
          session.promptContractVersion !== undefined
            ? 'INSERT INTO dice_sessions(id,campaign_id,root_turn_id,context_digest,frozen_prompt,frozen_revision,character_ids,imported,new_faces,created_at,prompt_contract_version,digest_version,system_prompt,frozen_knowledge,tool_definitions,frozen_sources) VALUES($1,$2,$3,$4,$5,$6,$7,true,$8,$9,$10,$11,$12,$13,$14,$15)'
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
            ...(session.promptContractVersion !== undefined
              ? [
                  session.promptContractVersion,
                  session.digestVersion,
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
      for (const record of archive.diceRecords ?? []) {
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
      await this.store.reindex(archive.campaign, client);
      return archive.campaign;
    });
  }
  async template(name: string, campaignId: string, revision: number) {
    return this.store.transaction(async (client) => {
      const c = await this.store.campaign(campaignId, client, true);
      if (c.revision !== revision)
        throw conflict('Campaign changed; refresh before saving template');
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
        pinnedFacts: c.pinnedFacts,
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
      const c = { ...newCampaign({ name: name ?? template.name }), ...template.setup } as Campaign;
      // Even an older externally stored template cannot transplant another campaign's timeline.
      if (ARCHIVE_FORMAT_VERSION >= KNOWLEDGE_ARCHIVE_FORMAT_VERSION) c.knowledge = [];
      else delete c.knowledge;
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
