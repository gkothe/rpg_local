import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Problem } from '../errors.js';
import { ruleSlugSchema, rulePathSchema, ruleQuerySchema } from './rules.js';
import { sourceLocatorSchema, type SourceLocator } from './historyRecall.js';
import { sourceSections } from './sourceSections.js';
import { SourceStatus } from './options.js';
import type { ReferenceMaps } from './responseReferences.js';
import type { Campaign } from './types.js';

export enum GmIndexRefKind {
  CampaignField = 'campaign_field',
  Knowledge = 'knowledge',
  Turn = 'turn',
  SourceSection = 'source_section',
  Character = 'character',
  RuleHint = 'rule_hint',
}
export const gmIndexContentHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const gmIndexTextHash = (text: string) => createHash('sha256').update(text).digest('hex');
const knowledge = z.object({ kind: z.literal(GmIndexRefKind.Knowledge), id: z.uuid() }).strict();
const character = z
  .object({ kind: z.literal(GmIndexRefKind.Character), characterId: z.uuid() })
  .strict();
const turn = sourceLocatorSchema.extend({ kind: z.literal(GmIndexRefKind.Turn) }).strict();
const common = [
  z
    .object({
      kind: z.literal(GmIndexRefKind.CampaignField),
      field: z.enum(['description', 'instructions']),
      contentHash: gmIndexContentHashSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal(GmIndexRefKind.SourceSection),
      sourceId: z.uuid(),
      version: z.number().int().positive(),
      sectionIndex: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal(GmIndexRefKind.RuleHint),
      systemKey: ruleSlugSchema,
      query: ruleQuerySchema,
      path: rulePathSchema.optional(),
    })
    .strict(),
] as const;
export const gmIndexRefSchema = z.union([...common, knowledge, character, turn]);
export type GmIndexRef = z.infer<typeof gmIndexRefSchema>;
export const gmIndexWireRefSchema = z.union([
  gmIndexRefSchema,
  z
    .object({
      kind: z.literal(GmIndexRefKind.Knowledge),
      knowledgeChangeIndex: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal(GmIndexRefKind.Knowledge),
      npcIntroductionOperationIndex: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal(GmIndexRefKind.Character),
      operationIndex: z.number().int().nonnegative(),
    })
    .strict(),
  z.object({ kind: z.literal(GmIndexRefKind.Turn), current: z.literal(true) }).strict(),
]);
export type GmIndexWireRef = z.infer<typeof gmIndexWireRefSchema>;

/** Aliases are permitted only in staged output, never persisted notes. */
export function normalizeGmIndexRefs(
  refs: readonly GmIndexWireRef[],
  maps: ReferenceMaps,
  currentTurn: SourceLocator
): GmIndexRef[] {
  return refs.map((input) => {
    const ref = gmIndexWireRefSchema.parse(input);
    if (
      'knowledgeChangeIndex' in ref ||
      'operationIndex' in ref ||
      'npcIntroductionOperationIndex' in ref
    ) {
      const id =
        'knowledgeChangeIndex' in ref
          ? maps.knowledge.get(ref.knowledgeChangeIndex)
          : 'npcIntroductionOperationIndex' in ref
            ? maps.introductions.get(ref.npcIntroductionOperationIndex)
            : maps.characters.get(ref.operationIndex);
      if (!id)
        throw new Problem(
          422,
          'gm_index_reference',
          'Index alias must resolve to a successful create'
        );
      return gmIndexRefSchema.parse(
        ref.kind === GmIndexRefKind.Knowledge
          ? { kind: ref.kind, id }
          : { kind: ref.kind, characterId: id }
      );
    }
    if ('current' in ref)
      return gmIndexRefSchema.parse({
        kind: ref.kind,
        turnId: currentTurn.turnId,
        contentHash: currentTurn.contentHash,
      });
    return gmIndexRefSchema.parse(ref);
  });
}

export type GmIndexReferenceCapture = { campaign: Campaign; turns: readonly SourceLocator[] };
/** Existence is checked against this campaign's capture, never global/live lookup. */
export function validateGmIndexRefs(
  refs: readonly GmIndexRef[],
  capture: GmIndexReferenceCapture
): void {
  for (const input of refs) {
    const ref = gmIndexRefSchema.parse(input);
    const c = capture.campaign;
    let valid = false;
    switch (ref.kind) {
      case GmIndexRefKind.CampaignField:
        valid = gmIndexTextHash(c[ref.field]) === ref.contentHash;
        break;
      case GmIndexRefKind.Knowledge:
        valid = !!c.knowledge?.some((record) => record.id === ref.id);
        break;
      case GmIndexRefKind.Character:
        valid = c.characters.some((record) => record.id === ref.characterId);
        break;
      case GmIndexRefKind.Turn:
        valid = capture.turns.some(
          (record) => record.turnId === ref.turnId && record.contentHash === ref.contentHash
        );
        break;
      case GmIndexRefKind.SourceSection: {
        const source = c.sources.find(
          (s) =>
            s.id === ref.sourceId &&
            s.version === ref.version &&
            s.status === SourceStatus.Confirmed
        );
        valid = !!source && sourceSections(source).some((s) => s.index === ref.sectionIndex);
        break;
      }
      case GmIndexRefKind.RuleHint:
        // Navigation only: rule content is resolved against the current library when used.
        valid = true;
        break;
    }
    if (!valid)
      throw new Problem(
        422,
        'gm_index_reference',
        'Index reference is missing or differs from the captured original'
      );
  }
}
