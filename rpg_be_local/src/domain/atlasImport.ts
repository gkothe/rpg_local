import { z } from 'zod';
import { atlasDraftSchema } from './atlasPreparation.js';
import { MAX_LONG_TEXT_CHARS } from './limits.js';
export enum AtlasImportStatus {
  Running = 'running',
  Ready = 'ready',
  Applied = 'applied',
  Failed = 'failed',
  Cancelled = 'cancelled',
  Interrupted = 'interrupted',
}
export { ATLAS_IMAGE_TYPES, ATLAS_IMAGE_MAX_PIXELS } from './atlasImageOptions.js';
export const atlasImportInputSchema = z
  .object({
    requestId: z.uuid(),
    scope: z.uuid().optional(),
    legend: z.string().max(MAX_LONG_TEXT_CHARS).default(''),
  })
  .strict();
export const atlasImportAcceptSchema = z
  .object({
    requestId: z.uuid(),
    selectedKeys: z.array(z.string()),
    matches: z.record(z.string(), z.uuid()),
    selectedRoutes: z.array(z.number().int().nonnegative()).optional(),
    selectedFrames: z.array(z.number().int().nonnegative()).optional(),
    playerSafe: z.boolean(),
  })
  .strict();
export const atlasImageRegionSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .strict()
  .refine((r) => r.x + r.width <= 1 && r.y + r.height <= 1);
export const atlasImageDraftSchema = z
  .object({
    geography: atlasDraftSchema,
    observations: z.array(
      z
        .object({ key: z.string().min(1), region: atlasImageRegionSchema, uncertainty: z.string() })
        .strict()
    ),
  })
  .strict();
