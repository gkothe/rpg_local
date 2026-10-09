import { z } from 'zod';
import { remapRuleSearchEvidence } from '../domain/ruleReadArchive.js';
import { createHash } from 'node:crypto';
import { canonicalRuleJson } from '../domain/rules.js';
import { ruleContextSchema, ruleReadSchema } from '../domain/rules.js';
import {
  campaignKnowledgeSchema,
  knowledgeIntroductionSchema,
  sourceSpanSchema,
} from '../domain/knowledge.js';
import { npcPrepareSchema } from '../domain/npcPreparation.js';
import {
  npcPreparationPayloadSchema,
  NpcPreparationStatus,
  NPC_PREPARATION_LIMITS,
} from '../domain/npcPreparation.js';
import { npcArgumentDigest } from './npcPreparation.js';
import { remapProfile } from './continuityArchive.js';

export const npcIntroductionEvidenceSchema = z
  .object({
    campaignId: z.uuid(),
    turnId: z.uuid(),
    ruleContext: ruleContextSchema.optional(),
    sourceSpans: z.array(sourceSpanSchema),
    ruleReads: z.array(ruleReadSchema),
  })
  .strict();
export const npcPreparationArchiveSchema = z
  .object({
    id: z.uuid(),
    campaignId: z.uuid(),
    sessionId: z.uuid(),
    turnId: z.uuid(),
    ownerTurnId: z.uuid(),
    localKey: z.string().min(1).max(NPC_PREPARATION_LIMITS.localKeyChars),
    argumentDigest: z.string().regex(/^[a-f0-9]{64}$/),
    frozenInput: z
      .object({
        arguments: npcPrepareSchema,
        introduction: knowledgeIntroductionSchema,
        introductionEvidence: npcIntroductionEvidenceSchema,
        intent: z.string(),
        roleHint: z.string().optional(),
        establishedCharacter: npcPrepareSchema.shape.establishedCharacter,
        instructions: z.string(),
        campaign: z
          .object({ description: z.string(), state: z.record(z.string(), z.unknown()) })
          .strict(),
        knowledge: z.array(campaignKnowledgeSchema),
        characters: z.array(z.record(z.string(), z.unknown())),
      })
      .strict(),
    providerSettings: z
      .object({ provider: z.string(), model: z.string(), effort: z.string().nullable() })
      .strict(),
    reservedCharacterId: z.uuid(),
    status: z.enum(NpcPreparationStatus),
    result: npcPreparationPayloadSchema.nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .refine(
    (r) => (r.status === NpcPreparationStatus.Ready) === (r.result !== null),
    'NPC receipt status/result mismatch'
  );
export type NpcPreparationArchive = z.infer<typeof npcPreparationArchiveSchema>;
export function preparationArchiveRow(row: Record<string, unknown>): NpcPreparationArchive {
  return npcPreparationArchiveSchema.parse({
    id: row.id,
    campaignId: row.campaign_id,
    sessionId: row.session_id,
    turnId: row.turn_id,
    ownerTurnId: row.owner_turn_id,
    localKey: row.local_key,
    argumentDigest: row.argument_digest,
    frozenInput: row.frozen_input,
    providerSettings: row.provider_settings,
    reservedCharacterId: row.reserved_character_id,
    status: row.status,
    result: row.result,
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  });
}
export function remapNpcPreparation(
  row: NpcPreparationArchive,
  mapped: (id: string) => string
): void {
  // Remap only declared contract references; keys, fiction and mechanical values are opaque.
  const evidence = (items: unknown): void => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (item.type === 'campaign_source' && typeof item.sourceId === 'string')
        item.sourceId = mapped(item.sourceId);
      if (item.type === 'book' && typeof item.citation?.receiptId === 'string')
        item.citation.receiptId = mapped(item.citation.receiptId);
    }
  };
  const args = row.frozenInput.arguments as Record<string, unknown> | undefined;
  if (args) {
    for (const key of ['relevantCharacterIds', 'distinctFromCharacterIds', 'relevantKnowledgeIds'])
      if (Array.isArray(args[key])) args[key] = (args[key] as string[]).map(mapped);
    evidence((args.introduction as { evidence?: unknown })?.evidence);
  }
  const knowledge = row.frozenInput.knowledge as
    import('../domain/knowledge.js').CampaignKnowledge[] | undefined;
  for (const record of knowledge ?? []) {
    record.id = mapped(record.id);
    record.characterIds = record.characterIds.map(mapped);
    record.characterNames = Object.fromEntries(
      Object.entries(record.characterNames).map(([id, name]) => [mapped(id), name])
    );
    if (record.holderId) record.holderId = mapped(record.holderId);
    if (record.createdTurnId) record.createdTurnId = mapped(record.createdTurnId);
    if (record.updatedTurnId) record.updatedTurnId = mapped(record.updatedTurnId);
    evidence(record.evidence);
    for (const attribution of record.attributions) {
      if (attribution.turnId) attribution.turnId = mapped(attribution.turnId);
      evidence(attribution.evidence);
    }
  }
  for (const character of (row.frozenInput.characters ?? []) as { id: string }[])
    character.id = mapped(character.id);
  evidence(row.frozenInput.introduction?.evidence);
  const captured = row.frozenInput.introductionEvidence;
  if (captured) {
    captured.campaignId = mapped(captured.campaignId);
    captured.turnId = mapped(captured.turnId);
    for (const span of captured.sourceSpans) span.id = mapped(span.id);
    for (const read of captured.ruleReads) {
      read.id = mapped(read.id);
      read.campaignId = mapped(read.campaignId);
      read.turnId = mapped(read.turnId);
      read.payload.receipt = read.id;
      if (read.tool === 'rules_search') remapRuleSearchEvidence(read.payload, mapped);
      read.resultHash = createHash('sha256').update(canonicalRuleJson(read.payload)).digest('hex');
    }
  }
  row.id = mapped(row.id);
  row.campaignId = mapped(row.campaignId);
  row.sessionId = mapped(row.sessionId);
  row.turnId = mapped(row.turnId);
  row.ownerTurnId = mapped(row.ownerTurnId);
  row.reservedCharacterId = mapped(row.reservedCharacterId);
  if (row.frozenInput.arguments) row.argumentDigest = npcArgumentDigest(row.frozenInput.arguments);
  if (row.result) {
    row.result.receiptId = mapped(row.result.receiptId);
    row.result.characterId = mapped(row.result.characterId);
    remapProfile(row.result.profile, mapped);
    evidence(row.result.introduction.evidence);
  }
  if (row.status === NpcPreparationStatus.Running) row.status = NpcPreparationStatus.Interrupted;
}
