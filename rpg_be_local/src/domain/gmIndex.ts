import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { Problem } from '../errors.js';
import { atResponseField } from './responseFields.js';
import { sourceLocatorSchema } from './historyRecall.js';
import {
  gmDirectionSchema,
  GmDirectionBasis,
  gmFoundationEntrySchema,
  gmFoundationValueSchema,
  gmIndexTitleSchema,
  gmIndexProseSchema,
} from './gmDirection.js';
import {
  GmIndexRefKind,
  gmIndexContentHashSchema,
  gmIndexRefSchema,
  gmIndexWireRefSchema,
  normalizeGmIndexRefs,
  validateGmIndexRefs,
  type GmIndexReferenceCapture,
} from './gmIndexRefs.js';
import type { ReferenceMaps } from './responseReferences.js';
import type { SourceLocator } from './historyRecall.js';

export enum GmIndexContractVersion {
  V1 = 1,
}
export enum GmIndexEntryKind {
  Focus = 'focus',
  Task = 'task',
  Clue = 'clue',
  Question = 'question',
  GmPlan = 'gm_plan',
  Pressure = 'pressure',
  Opportunity = 'opportunity',
}
export enum GmIndexEntryStatus {
  Active = 'active',
  Resolved = 'resolved',
}
export const GM_INDEX_ENTRY_KIND_OPTIONS = [
  { id: GmIndexEntryKind.Focus, label: 'Current focus' },
  { id: GmIndexEntryKind.Task, label: 'Pending task' },
  { id: GmIndexEntryKind.Clue, label: 'Clue' },
  { id: GmIndexEntryKind.Question, label: 'Open question' },
  { id: GmIndexEntryKind.GmPlan, label: 'Tentative GM plan' },
  { id: GmIndexEntryKind.Pressure, label: 'World pressure' },
  { id: GmIndexEntryKind.Opportunity, label: 'Possible development' },
] as const;
/** Selection/writing targets only; never validation or inference limits. */
export const GM_INDEX_TARGETS = {
  entriesBytes: 4096,
  foundationBytes: 4096,
  handoffSchemaBytes: 8192,
} as const;
const valueObject = z
  .object({
    kind: z.enum(GmIndexEntryKind),
    status: z.enum(GmIndexEntryStatus),
    title: gmIndexTitleSchema,
    text: gmIndexProseSchema,
    ownerCharacterId: z.uuid().nullable(),
    refs: z.array(gmIndexRefSchema),
    direction: gmDirectionSchema.nullable(),
  })
  .strict();
const directional = (entry: {
  kind: GmIndexEntryKind;
  direction: z.infer<typeof gmDirectionSchema> | null;
  refs: { kind: string }[];
}) => {
  const required =
    entry.kind === GmIndexEntryKind.Pressure || entry.kind === GmIndexEntryKind.Opportunity;
  if (required !== (entry.direction !== null)) return false;
  return (
    entry.direction?.basis !== GmDirectionBasis.Campaign ||
    entry.refs.some((ref) => ref.kind !== GmIndexRefKind.RuleHint)
  );
};
export const gmIndexEntryValueSchema = valueObject.refine(
  directional,
  'Directions require proposal metadata and campaign directions require provenance'
);
export const gmIndexEntrySchema = valueObject
  .extend({ id: z.uuid() })
  .strict()
  .refine(directional, 'Invalid direction metadata or provenance');
export type GmIndexEntry = z.infer<typeof gmIndexEntrySchema>;
const uniqueIds = (entries: { id: string }[]) =>
  new Set(entries.map((entry) => entry.id)).size === entries.length;
const dependency = z
  .object({ entryId: z.uuid(), contentHash: gmIndexContentHashSchema, stale: z.boolean() })
  .strict();
export const gmIndexDependencyStateSchema = z
  .object({
    canonicalHash: gmIndexContentHashSchema,
    historyBootstrapPending: z.boolean().optional(),
    entries: z.array(dependency),
    foundation: z.array(dependency),
    sourceCoverage: z.array(
      z
        .object({
          sourceId: z.uuid(),
          version: z.number().int().positive(),
          sectionIndex: z.number().int().nonnegative(),
          contentHash: gmIndexContentHashSchema,
        })
        .strict()
    ),
    turnCoverage: z.array(sourceLocatorSchema),
  })
  .strict();
export const gmIndexDocumentSchema = z
  .object({
    generationId: z.uuid(),
    contractVersion: z.literal(GmIndexContractVersion.V1),
    campaignFoundation: z
      .array(gmFoundationEntrySchema)
      .refine(uniqueIds, 'Duplicate foundation ID'),
    entries: z.array(gmIndexEntrySchema).refine(uniqueIds, 'Duplicate index entry ID'),
    lastCheckedTurnId: z.uuid().nullable(),
    dependencyState: gmIndexDependencyStateSchema,
  })
  .strict();
export type GmIndexDocument = z.infer<typeof gmIndexDocumentSchema>;
export const gmIndexSchema = z
  .object({
    settings: z
      .object({
        enabled: z.boolean(),
        activationHistoryBaseline: z
          .object({ enabled: z.boolean(), modeDecisionId: z.uuid().nullable() })
          .strict(),
      })
      .strict(),
    document: gmIndexDocumentSchema,
  })
  .strict();
export type GmIndex = z.infer<typeof gmIndexSchema>;
export const frozenGmIndexSchema = z
  .object({
    enabled: z.literal(true),
    contractVersion: z.literal(GmIndexContractVersion.V1),
    document: gmIndexDocumentSchema,
  })
  .strict();
export type FrozenGmIndex = z.infer<typeof frozenGmIndexSchema>;

const wireValue = valueObject
  .extend({ refs: z.array(gmIndexWireRefSchema) })
  .strict()
  .refine(directional, 'Invalid direction metadata or provenance');
export const gmIndexChangeSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('create'), entry: wireValue }).strict(),
  z
    .object({
      op: z.literal('update'),
      id: z.uuid(),
      expected: gmIndexEntrySchema,
      value: wireValue,
    })
    .strict(),
  z.object({ op: z.literal('remove'), id: z.uuid(), expected: gmIndexEntrySchema }).strict(),
]);
export type GmIndexChange = z.infer<typeof gmIndexChangeSchema>;
const wireFoundation = gmFoundationValueSchema
  .extend({ refs: z.array(gmIndexWireRefSchema).min(1) })
  .strict();
export const gmFoundationChangeSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('create'), entry: wireFoundation }).strict(),
  z
    .object({
      op: z.literal('update'),
      id: z.uuid(),
      expected: gmFoundationEntrySchema,
      value: wireFoundation,
    })
    .strict(),
  z.object({ op: z.literal('remove'), id: z.uuid(), expected: gmFoundationEntrySchema }).strict(),
]);
export type GmFoundationChange = z.infer<typeof gmFoundationChangeSchema>;
export type GmIndexReductionCapture = GmIndexReferenceCapture & {
  maps: ReferenceMaps;
  currentTurn: SourceLocator;
};

/** Pure projection: an invalid delta never partially changes the live document. */
export function applyGmIndexChanges(
  document: GmIndexDocument,
  changes: readonly GmIndexChange[],
  foundationChanges: readonly GmFoundationChange[],
  capture: GmIndexReductionCapture,
  allocateId: () => string = randomUUID
): GmIndexDocument {
  const next = structuredClone(gmIndexDocumentSchema.parse(document));
  function reduce<T extends GmIndexEntry | z.infer<typeof gmFoundationEntrySchema>>(
    prior: T[],
    deltas: readonly (GmIndexChange | GmFoundationChange)[],
    parse: (value: unknown) => T,
    field: string
  ): T[] {
    const touched = new Set<string>();
    const entries = [...prior];
    deltas.forEach((delta, index) =>
      atResponseField([field, index], () => {
        if (delta.op !== 'create') {
          if (touched.has(delta.id))
            throw new Problem(
              422,
              'gm_index_conflict',
              'An index entry can change only once per update'
            );
          touched.add(delta.id);
          const at = entries.findIndex((entry) => entry.id === delta.id);
          const captured = prior.find((entry) => entry.id === delta.id);
          if (at < 0 || !captured || !isDeepStrictEqual(captured, delta.expected))
            throw new Problem(
              422,
              'gm_index_conflict',
              'Index entry must match the captured expected value'
            );
          if (delta.op === 'remove') {
            entries.splice(at, 1);
            return;
          }
        }
        const value = delta.op === 'create' ? delta.entry : delta.value;
        const id = delta.op === 'create' ? allocateId() : delta.id;
        const entry = parse({
          ...value,
          id,
          refs: normalizeGmIndexRefs(value.refs, capture.maps, capture.currentTurn),
        });
        validateGmIndexRefs(entry.refs, capture);
        if (
          'ownerCharacterId' in entry &&
          entry.ownerCharacterId &&
          !capture.campaign.characters.some((character) => character.id === entry.ownerCharacterId)
        )
          throw new Problem(
            422,
            'gm_index_reference',
            'Index owner must belong to the captured campaign'
          );
        const at = entries.findIndex((existing) => existing.id === id);
        if (delta.op === 'create' && at >= 0)
          throw new Problem(422, 'gm_index_conflict', 'Allocated index ID already exists');
        if (delta.op === 'create') entries.push(entry);
        else entries[at] = entry;
      })
    );
    return entries;
  }
  next.entries = reduce(
    next.entries,
    changes.map((change) => gmIndexChangeSchema.parse(change)),
    (entry) => gmIndexEntrySchema.parse(entry),
    'gmIndexChanges'
  );
  next.campaignFoundation = reduce(
    next.campaignFoundation,
    foundationChanges.map((change) => gmFoundationChangeSchema.parse(change)),
    (entry) => gmFoundationEntrySchema.parse(entry),
    'gmFoundationChanges'
  );
  next.lastCheckedTurnId = capture.currentTurn.turnId;
  // Dependency identities are recomputed by the finalization boundary, never authored by deltas.
  return gmIndexDocumentSchema.parse(next);
}
