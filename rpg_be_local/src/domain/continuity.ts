import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import { Problem, conflict } from '../errors.js';
import { MAX_LONG_TEXT_CHARS } from './limits.js';
import {
  KnowledgeKind,
  KnowledgeStatus,
  KnowledgeVisibility,
  knowledgeProvenanceSchema,
  validateKnowledgeEvidence,
  type KnowledgeValidation,
} from './knowledge.js';
import { CharacterType } from './options.js';
import type { Campaign } from './types.js';
import { atResponseField } from './responseFields.js';
import {
  characterRefSchema,
  knowledgeRefSchema,
  resolveCharacterRef,
  resolveKnowledgeRef,
  type ReferenceMaps,
} from './responseReferences.js';

export const NPC_CONTINUITY_LIMITS = {
  proseChars: 2000,
  boundaries: 20,
  references: 1000,
  profiles: 1000,
} as const;
const prose = z.string().trim().min(1).max(NPC_CONTINUITY_LIMITS.proseChars);
const unique = <T extends z.ZodType>(schema: T, max: number) =>
  z
    .array(schema)
    .max(max)
    .refine(
      (a) => new Set(a.map((x) => JSON.stringify(x))).size === a.length,
      'Entries must be unique'
    );
export const profileCoreSchema = z
  .object({
    shortTermGoal: prose,
    longTermGoal: prose,
    boundaries: unique(prose, NPC_CONTINUITY_LIMITS.boundaries),
    relationshipKnowledgeIds: unique(z.uuid(), NPC_CONTINUITY_LIMITS.references),
    revealedTraitKnowledgeIds: unique(z.uuid(), NPC_CONTINUITY_LIMITS.references),
    tension: prose.optional(),
    secret: prose.optional(),
  })
  .strict();
export const npcProfileSchema = profileCoreSchema.extend({ characterId: z.uuid() }).strict();
export type NpcProfile = z.infer<typeof npcProfileSchema>;
export const continuitySchema = z
  .object({
    npcProfiles: z
      .array(npcProfileSchema)
      .max(NPC_CONTINUITY_LIMITS.profiles)
      .refine(
        (a) => new Set(a.map((x) => x.characterId)).size === a.length,
        'Duplicate NPC profile'
      ),
  })
  .strict();
export type Continuity = z.infer<typeof continuitySchema>;
const wireCoreSchema = profileCoreSchema.extend({
  relationshipKnowledgeIds: unique(knowledgeRefSchema, NPC_CONTINUITY_LIMITS.references),
  revealedTraitKnowledgeIds: unique(knowledgeRefSchema, NPC_CONTINUITY_LIMITS.references),
});
const common = {
  characterId: characterRefSchema,
  explanation: z.string().trim().min(1).max(MAX_LONG_TEXT_CHARS),
  ...knowledgeProvenanceSchema.shape,
};
export const continuityChangeSchema = z.discriminatedUnion('op', [
  z
    .object({ ...common, op: z.literal('create'), expected: z.null(), next: wireCoreSchema })
    .strict(),
  z
    .object({
      ...common,
      op: z.literal('update'),
      expected: npcProfileSchema,
      next: wireCoreSchema,
    })
    .strict(),
  z
    .object({ ...common, op: z.literal('remove'), expected: npcProfileSchema, next: z.null() })
    .strict(),
]);
export type ContinuityChange = z.infer<typeof continuityChangeSchema>;
export const frozenContinuitySchema = z
  .object({ npcProfiles: continuitySchema.shape.npcProfiles })
  .strict();
export type FrozenContinuity = z.infer<typeof frozenContinuitySchema>;
export function validateContinuity(campaign: Campaign): void {
  const value = continuitySchema.parse(campaign.continuity ?? { npcProfiles: [] });
  for (const profile of value.npcProfiles) {
    if (
      !campaign.characters.some((c) => c.id === profile.characterId && c.type === CharacterType.Npc)
    )
      throw new Problem(422, 'continuity_reference', 'Profile must belong to a campaign NPC');
    for (const id of [...profile.relationshipKnowledgeIds, ...profile.revealedTraitKnowledgeIds])
      if (!campaign.knowledge?.some((r) => r.id === id))
        throw new Problem(422, 'continuity_reference', 'Profile knowledge reference is missing');
  }
}
export function validateProfileKnowledge(
  profile: NpcProfile,
  knowledge: readonly import('./knowledge.js').CampaignKnowledge[]
): void {
  for (const knowledgeId of profile.relationshipKnowledgeIds) {
    const record = knowledge.find((r) => r.id === knowledgeId);
    if (
      !record ||
      record.kind !== KnowledgeKind.Relationship ||
      record.status === KnowledgeStatus.Retracted
    )
      throw new Problem(
        422,
        'continuity_reference',
        'Relationship reference must identify accepted relationship knowledge'
      );
  }
  for (const knowledgeId of profile.revealedTraitKnowledgeIds) {
    const record = knowledge.find((r) => r.id === knowledgeId);
    if (
      !record ||
      record.visibility === KnowledgeVisibility.GmOnly ||
      record.status === KnowledgeStatus.Retracted
    )
      throw new Problem(
        422,
        'continuity_reference',
        'Revealed trait must reference available public knowledge'
      );
  }
}
export function applyContinuity(
  campaign: Campaign,
  raw: ContinuityChange[],
  maps: ReferenceMaps,
  evidence: KnowledgeValidation
): { before: NpcProfile[]; after: NpcProfile[] } {
  const before: NpcProfile[] = [];
  const after: NpcProfile[] = [];
  const touched = new Set<string>();
  const profiles = structuredClone(campaign.continuity?.npcProfiles ?? []);
  raw.forEach((change, index) =>
    atResponseField(['continuityChanges', index], () => {
      const op = continuityChangeSchema.parse(change);
      validateKnowledgeEvidence(op, evidence);
      const id = resolveCharacterRef(op.characterId, maps);
      if (touched.has(id))
        throw new Problem(
          422,
          'continuity_duplicate',
          'Only one profile change per NPC per response'
        );
      touched.add(id);
      const current = profiles.find((p) => p.characterId === id) ?? null;
      if (!isDeepStrictEqual(current, op.expected))
        throw conflict('NPC profile expected value does not match');
      if (current) before.push(structuredClone(current));
      const position = profiles.findIndex((p) => p.characterId === id);
      if (op.op === 'remove') {
        if (position >= 0) profiles.splice(position, 1);
        return;
      }
      const next = npcProfileSchema.parse({
        ...op.next,
        characterId: id,
        relationshipKnowledgeIds: op.next.relationshipKnowledgeIds.map((r) =>
          resolveKnowledgeRef(r, maps)
        ),
        revealedTraitKnowledgeIds: op.next.revealedTraitKnowledgeIds.map((r) =>
          resolveKnowledgeRef(r, maps)
        ),
      });
      validateProfileKnowledge(next, campaign.knowledge ?? []);
      if (position < 0) profiles.push(next);
      else profiles[position] = next;
      after.push(structuredClone(next));
    })
  );
  if (raw.length) campaign.continuity = continuitySchema.parse({ npcProfiles: profiles });
  validateContinuity(campaign);
  return { before, after };
}
export function undoContinuity(
  campaign: Campaign,
  before: NpcProfile[],
  after: NpcProfile[]
): void {
  const ids = new Set([...before, ...after].map((p) => p.characterId));
  for (const id of ids)
    if (
      !isDeepStrictEqual(
        campaign.continuity?.npcProfiles.find((p) => p.characterId === id) ?? null,
        after.find((p) => p.characterId === id) ?? null
      )
    )
      throw conflict('NPC profile changed after this turn');
  if (ids.size)
    campaign.continuity = {
      npcProfiles: [
        ...(campaign.continuity?.npcProfiles ?? []).filter((p) => !ids.has(p.characterId)),
        ...structuredClone(before),
      ],
    };
}
