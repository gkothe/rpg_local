import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Problem } from '../errors.js';
import { MAX_ENTITY_NAME_CHARS, MAX_LONG_TEXT_CHARS } from './limits.js';
import { ruleCitationSchema, type RuleRead, type RuleContext } from './rules.js';
import { validateRuleCitations } from './ruleCitationValidation.js';
import type { Character } from './types.js';
export enum KnowledgeVisibility {
  Player = 'player',
  GmOnly = 'gm_only',
}
export enum KnowledgeKind {
  Npc = 'npc',
  Place = 'place',
  Relationship = 'relationship',
  Debt = 'debt',
  Objective = 'objective',
  Event = 'event',
  Other = 'other',
}
export enum KnowledgeOrigin {
  Source = 'source',
  Gm = 'gm',
  Player = 'player',
  Unknown = 'unknown',
}
export enum KnowledgeCertainty {
  Established = 'established',
  Rumor = 'rumor',
  Belief = 'belief',
}
export enum KnowledgeStatus {
  Active = 'active',
  Resolved = 'resolved',
  Retracted = 'retracted',
}
const title = z.string().trim().min(1).max(MAX_ENTITY_NAME_CHARS);
const text = z.string().trim().min(1).max(MAX_LONG_TEXT_CHARS);
export const sourceSpanSchema = z
  .object({
    id: z.uuid(),
    version: z.number().int().positive(),
    name: z.string(),
    text: z.string(),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  })
  .strict();
export type SourceSpan = z.infer<typeof sourceSpanSchema>;
export const knowledgeEvidenceSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('campaign_source'),
      sourceId: z.uuid(),
      version: z.number().int().positive(),
      sourceName: z.string(),
      quote: z.string().min(1).max(MAX_LONG_TEXT_CHARS),
      start: z.number().int().nonnegative(),
      end: z.number().int().positive(),
    })
    .strict(),
  z.object({ type: z.literal('book'), citation: ruleCitationSchema }).strict(),
]);
export const knowledgeProvenanceSchema = z
  .object({ origin: z.enum(KnowledgeOrigin), evidence: z.array(knowledgeEvidenceSchema) })
  .strict();
export const characterLinkSchema = z.union([
  z.uuid(),
  z.object({ operationIndex: z.number().int().nonnegative() }).strict(),
]);
const mutable = {
  kind: z.enum(KnowledgeKind),
  title,
  text,
  certainty: z.enum(KnowledgeCertainty),
  status: z.enum(KnowledgeStatus),
  characterIds: z.array(characterLinkSchema),
  holderId: characterLinkSchema.nullable().optional(),
};
export const knowledgeChangeSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('create'), ...mutable, ...knowledgeProvenanceSchema.shape }).strict(),
  z
    .object({
      op: z.literal('update'),
      id: z.uuid(),
      expectedRevision: z.number().int().positive(),
      changes: z
        .object(mutable)
        .partial()
        .strict()
        .refine((v) => Object.keys(v).length > 0),
      ...knowledgeProvenanceSchema.shape,
    })
    .strict(),
]);
export type KnowledgeChange = z.infer<typeof knowledgeChangeSchema>;
export const knowledgeAttributionSchema = z
  .object({ ...knowledgeProvenanceSchema.shape, turnId: z.uuid().nullable(), at: z.iso.datetime() })
  .strict();
export const knowledgeRecordSchema = z
  .object({
    id: z.uuid(),
    ...mutable,
    characterIds: z.array(z.uuid()),
    holderId: z.uuid().nullable().optional(),
    characterNames: z.record(z.uuid(), z.string()),
    holderName: z.string().optional(),
    ...knowledgeProvenanceSchema.shape,
    createdTurnId: z.uuid().nullable(),
    updatedTurnId: z.uuid().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    revision: z.number().int().positive(),
    attributions: z.array(knowledgeAttributionSchema),
  })
  .strict();
export const knowledgeAttributionV5Schema = knowledgeAttributionSchema
  .extend({
    visibility: z.enum(KnowledgeVisibility).optional(),
    revealReason: text.optional(),
  })
  .strict();
export const campaignKnowledgeSchema = knowledgeRecordSchema
  .extend({
    visibility: z.enum(KnowledgeVisibility).optional(),
    introductionVisibility: z.enum(KnowledgeVisibility).optional(),
    attributions: z.array(knowledgeAttributionV5Schema),
  })
  .strict();
export const knowledgeProvenanceV5Schema = knowledgeProvenanceSchema
  .extend({
    visibility: z.enum(KnowledgeVisibility),
  })
  .strict();
export const knowledgeChangeV5Schema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('create'), ...mutable, ...knowledgeProvenanceV5Schema.shape }).strict(),
  z
    .object({
      op: z.literal('update'),
      id: z.uuid(),
      expectedRevision: z.number().int().positive(),
      changes: z
        .object({ ...mutable, visibility: z.enum(KnowledgeVisibility) })
        .partial()
        .strict()
        .refine((v) => Object.keys(v).length > 0),
      ...knowledgeProvenanceSchema.shape,
      revealReason: text.optional(),
    })
    .strict(),
]);
export type KnowledgeChangeV5 = z.infer<typeof knowledgeChangeV5Schema>;
export type CampaignKnowledge = z.infer<typeof campaignKnowledgeSchema>;
export function normalizeKnowledge(records: readonly CampaignKnowledge[]): CampaignKnowledge[] {
  return records.map((r) =>
    campaignKnowledgeSchema.parse({
      ...r,
      visibility: r.visibility ?? KnowledgeVisibility.Player,
      introductionVisibility: r.introductionVisibility ?? KnowledgeVisibility.Player,
      attributions: r.attributions.map((a) => ({
        ...a,
        visibility: a.visibility ?? KnowledgeVisibility.Player,
      })),
    })
  );
}
export function legacyKnowledge(
  records: readonly CampaignKnowledge[]
): z.infer<typeof knowledgeRecordSchema>[] {
  // Retain the original key order for frozen v4 digest compatibility.
  return records.map(({ visibility: _visibility, introductionVisibility: _intro, ...record }) => ({
    ...record,
    attributions: record.attributions.map(({ visibility: _v, revealReason: _r, ...a }) => a),
  }));
}
export type KnowledgeValidation = {
  rolls?: readonly import('./dice.js').DiceRecord[];
  sourceSpans?: readonly SourceSpan[];
  ruleReads?: readonly RuleRead[];
  ruleContext?: RuleContext;
  campaignId: string;
  turnId: string;
};
const invalid = (detail: string): never => {
  throw new Problem(422, 'knowledge_invalid', detail);
};
export function validateKnowledgeEvidence(
  provenance: z.infer<typeof knowledgeProvenanceSchema>,
  context: KnowledgeValidation
): void {
  if (provenance.origin === KnowledgeOrigin.Source && !provenance.evidence.length)
    invalid('Source knowledge requires supporting evidence');
  if (provenance.origin !== KnowledgeOrigin.Source && provenance.evidence.length)
    invalid('Only source origins may carry source evidence');
  for (const evidence of provenance.evidence) {
    if (evidence.type === 'campaign_source') {
      const span = context.sourceSpans?.find(
        (s) =>
          s.id === evidence.sourceId &&
          s.version === evidence.version &&
          s.name === evidence.sourceName &&
          evidence.start >= s.start &&
          evidence.end <= s.end &&
          s.text.slice(evidence.start - s.start, evidence.end - s.start) === evidence.quote
      );
      if (!span || evidence.end !== evidence.start + evidence.quote.length)
        invalid(
          'Campaign evidence must identify an exact quote within one supplied frozen absolute UTF-16 span'
        );
    } else {
      if (!context.ruleContext) invalid('Book knowledge requires a captured rule library');
      validateRuleCitations(
        {
          version: 3,
          narrative: 'evidence',
          operations: [],
          rollInterpretations: [],
          ruleCitations: [evidence.citation],
        },
        context.ruleReads ?? [],
        context.campaignId,
        context.turnId,
        context.ruleContext!
      );
    }
  }
}
export function applyKnowledgeChanges(
  original: readonly CampaignKnowledge[],
  raw: readonly (KnowledgeChange | KnowledgeChangeV5)[],
  characters: readonly Character[],
  aliases: ReadonlyMap<number, string>,
  context: KnowledgeValidation,
  version = 4
): {
  records: CampaignKnowledge[];
  before: CampaignKnowledge[];
  after: CampaignKnowledge[];
  changes: string[];
} {
  const records = structuredClone([...original]);
  const touched = new Set<string>();
  const changes: string[] = [];
  const link = (value: string | { operationIndex: number }): string => {
    const id = typeof value === 'string' ? value : aliases.get(value.operationIndex);
    if (!id || !characters.some((c) => c.id === id))
      invalid(
        'Knowledge character reference must identify an existing campaign character or staged create operation'
      );
    return id!;
  };
  for (const value of raw) {
    const op =
      version === 5 ? knowledgeChangeV5Schema.parse(value) : knowledgeChangeSchema.parse(value);
    validateKnowledgeEvidence(op, context);
    const now = new Date().toISOString();
    const current = op.op === 'update' ? records.find((r) => r.id === op.id) : undefined;
    if (op.op === 'update' && (!current || current.revision !== op.expectedRevision))
      invalid('Knowledge expected prior revision does not match');
    const modern = version === 5 ? (op as KnowledgeChangeV5) : undefined;
    const requestedVisibility =
      modern?.op === 'create'
        ? modern.visibility
        : modern?.op === 'update'
          ? (modern.changes.visibility ?? current?.visibility)
          : current?.visibility;
    const revealing =
      current?.visibility === KnowledgeVisibility.GmOnly &&
      requestedVisibility === KnowledgeVisibility.Player;
    if (
      revealing &&
      (modern?.op !== 'update' ||
        !modern.revealReason ||
        !modern.changes.text ||
        !modern.changes.title ||
        !modern.changes.characterIds ||
        modern.changes.holderId === undefined)
    )
      invalid(
        'Revelation requires a reason and explicit public title, text, character links and holder'
      );
    const visibility = requestedVisibility ?? KnowledgeVisibility.Player;
    const fields = op.op === 'create' ? op : op.changes;
    const ids = fields.characterIds?.map(link) ?? current?.characterIds ?? [];
    if (new Set(ids).size !== ids.length) invalid('Knowledge character links must be unique');
    const holder =
      fields.holderId === undefined
        ? current?.holderId
        : fields.holderId === null
          ? null
          : link(fields.holderId);
    const names = { ...(current?.characterNames ?? {}) };
    for (const id of ids) names[id] = characters.find((c) => c.id === id)?.name ?? names[id]!;
    const attribution = {
      origin: op.origin,
      evidence: structuredClone(op.evidence),
      turnId: context.turnId,
      at: now,
      ...(version === 5
        ? {
            visibility,
            ...(modern?.op === 'update' && modern.revealReason
              ? { revealReason: modern.revealReason }
              : {}),
          }
        : {}),
    };
    const record: CampaignKnowledge = current
      ? {
          ...current,
          ...fields,
          ...(version === 5 ? { visibility } : {}),
          characterIds: ids,
          characterNames: names,
          holderId: holder,
          updatedAt: now,
          updatedTurnId: context.turnId,
          revision: current.revision + 1,
          attributions: [...current.attributions, attribution],
        }
      : {
          id: randomUUID(),
          ...(version === 5 ? { visibility, introductionVisibility: visibility } : {}),
          kind: op.op === 'create' ? op.kind : KnowledgeKind.Other,
          title: op.op === 'create' ? op.title : '',
          text: op.op === 'create' ? op.text : '',
          certainty: op.op === 'create' ? op.certainty : KnowledgeCertainty.Established,
          status: op.op === 'create' ? op.status : KnowledgeStatus.Active,
          characterIds: ids,
          characterNames: names,
          holderId: holder,
          origin: op.origin,
          evidence: structuredClone(op.evidence),
          createdTurnId: context.turnId,
          updatedTurnId: context.turnId,
          createdAt: now,
          updatedAt: now,
          revision: 1,
          attributions: [attribution],
        };
    if (holder)
      record.holderName = characters.find((c) => c.id === holder)?.name ?? record.holderName;
    else delete record.holderName;
    campaignKnowledgeSchema.parse(record);
    if (current) records[records.indexOf(current)] = record;
    else records.push(record);
    touched.add(record.id);
    if (visibility === KnowledgeVisibility.Player)
      changes.push(
        `${record.title}: knowledge ${current ? 'updated' : 'introduced'} (${record.origin}, ${record.certainty}, ${record.status})`
      );
  }
  return {
    records,
    before: original.filter((r) => touched.has(r.id)).map((r) => structuredClone(r)),
    after: records.filter((r) => touched.has(r.id)).map((r) => structuredClone(r)),
    changes,
  };
}
export const KNOWLEDGE_KIND_OPTIONS = Object.values(KnowledgeKind).map((id) => ({
  id,
  label: id === 'npc' ? 'NPC' : id[0]!.toUpperCase() + id.slice(1),
}));
export const KNOWLEDGE_ORIGIN_OPTIONS = Object.values(KnowledgeOrigin).map((id) => ({
  id,
  label: id === 'gm' ? 'GM improvised' : id[0]!.toUpperCase() + id.slice(1),
}));
export const KNOWLEDGE_CERTAINTY_OPTIONS = Object.values(KnowledgeCertainty).map((id) => ({
  id,
  label: id[0]!.toUpperCase() + id.slice(1),
}));
export const KNOWLEDGE_STATUS_OPTIONS = Object.values(KnowledgeStatus).map((id) => ({
  id,
  label: id[0]!.toUpperCase() + id.slice(1),
}));
