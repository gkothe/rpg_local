import { z } from 'zod';
const object = z
  .record(z.string(), z.unknown())
  .refine((v) => JSON.stringify(v).length <= 100_000, 'Object exceeds 100KB');
export const idSchema = z.uuid();
export const settingsSchema = z
  .object({
    provider: z.string().max(40),
    model: z.string().max(120),
    effort: z.string().max(20).nullable(),
  })
  .strict();
export const characterInput = z
  .object({
    name: z.string().trim().min(1).max(200),
    type: z.enum(['player', 'npc']).default('player'),
    attributes: object.default({}),
    inventory: object.default({}),
    description: object.default({}),
    notes: z.string().max(100_000).default(''),
  })
  .strict();
export const operationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('create'), character: characterInput.omit({ notes: true }) }).strict(),
  z
    .object({
      op: z.literal('set'),
      characterId: idSchema,
      field: z.enum(['name', 'attributes', 'inventory', 'description']),
      expected: z.unknown(),
      value: z.unknown(),
    })
    .strict(),
  z.object({ op: z.literal('state'), expected: object, value: object }).strict(),
]);
export const responseSchema = z
  .object({
    version: z.literal(1),
    narrative: z.string().trim().min(1).max(40_000),
    operations: z.array(operationSchema).max(100),
  })
  .strict();
export const memorySchema = z.object({ text: z.string().trim().min(1).max(16_000) }).strict();
export const draftSchema = characterInput.omit({ notes: true });
// Pass the same strict contract to the model and validate again locally.
export const responseJsonSchema = z.toJSONSchema(responseSchema);
export const memoryJsonSchema = z.toJSONSchema(memorySchema);
export const draftJsonSchema = z.toJSONSchema(draftSchema);
export const campaignCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().max(100_000).default(''),
    instructions: z.string().max(100_000).default(''),
    settings: settingsSchema.optional(),
  })
  .strict();
export const campaignPatchSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(100_000).optional(),
    instructions: z.string().max(100_000).optional(),
    settings: settingsSchema.optional(),
    pinnedFacts: z.array(z.string().max(4000)).max(100).optional(),
    pinnedSourceIds: z.array(idSchema).max(100).optional(),
    pinnedSourceSections: z
      .array(
        z
          .object({
            sourceId: idSchema,
            version: z.number().int().positive(),
            index: z.number().int().nonnegative(),
          })
          .strict()
      )
      .max(100)
      .optional(),
    budgets: z
      .object({
        gameplay: z.number().int().min(2000).max(16000),
        compaction: z.number().int().min(2000).max(8000),
        memory: z.number().int().min(200).max(2000),
      })
      .strict()
      .optional(),
    state: object.optional(),
  })
  .strict();
export const turnInputSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    requestId: idSchema,
    action: z.string().trim().min(1).max(40_000),
    settings: settingsSchema.optional(),
  })
  .strict();
