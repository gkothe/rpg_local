import { z } from 'zod';
import { atlasMutationSchema, atlasText } from './atlas.js';
import {
  KnowledgeOrigin,
  knowledgeProvenanceSchema,
  knowledgeChangeSchema,
  sourceSpanSchema,
  mapAssetEvidenceSchema,
} from './knowledge.js';
import { ruleContextSchema, ruleReadSchema } from './rules.js';
export enum AtlasPreparationStatus {
  Running = 'running',
  Ready = 'ready',
  Failed = 'failed',
  Interrupted = 'interrupted',
}
export const ATLAS_PREPARE_TOOL = 'world_map_prepare';
export const atlasPrepareSchema = z
  .object({
    localKey: z.string().trim().min(1).max(200),
    intent: atlasText,
    scope: z.uuid().optional(),
  })
  .strict();
export const atlasDraftSchema = z
  .object({
    places: z.array(
      knowledgeChangeSchema.options[0]
        .omit({ op: true, kind: true, characterIds: true, holderId: true, status: true })
        .extend({ key: z.string().trim().min(1).max(200) })
        .strict()
    ),
    changes: atlasMutationSchema
      .omit({ createPlaces: true, preparedReceiptIds: true, position: true })
      .strict(),
  })
  .strict();
export const atlasEvidenceSchema = z
  .object({
    campaignId: z.uuid(),
    turnId: z.uuid(),
    sourceSpans: z.array(sourceSpanSchema),
    ruleReads: z.array(ruleReadSchema),
    ruleContext: ruleContextSchema.optional(),
    mapObservations: z.array(mapAssetEvidenceSchema).optional(),
  })
  .strict();
export const atlasPreparedSchema = z
  .object({
    id: z.uuid(),
    draft: atlasDraftSchema,
    bindings: z
      .object({
        places: z.record(z.string(), z.uuid()),
        frames: z.record(z.string(), z.uuid()),
        routes: z.array(z.uuid()),
      })
      .strict(),
    evidence: atlasEvidenceSchema,
  })
  .strict();
export type AtlasPrepared = z.infer<typeof atlasPreparedSchema>;
export const gmAtlasProvenance = knowledgeProvenanceSchema.parse({
  origin: KnowledgeOrigin.Gm,
  evidence: [],
});
