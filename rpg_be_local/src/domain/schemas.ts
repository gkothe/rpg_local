import { z } from 'zod';
import {
  CHARACTER_MUTABLE_FIELDS,
  CharacterType,
  CONTEXT_BUDGET_LIMITS,
  OPERATION_KIND,
  SourceKind,
  SourceStatus,
  TurnStatus,
  OCR_LANGUAGE_CODES,
  TRANSCRIPTION_LANGUAGE_CODES,
} from './options.js';
import {
  MAX_ENTITY_NAME_CHARS,
  MAX_JSON_OBJECT_CHARS,
  MAX_LONG_TEXT_CHARS,
  MAX_TURN_TEXT_CHARS,
} from './limits.js';
const object = z
  .record(z.string(), z.unknown())
  .refine((v) => JSON.stringify(v).length <= MAX_JSON_OBJECT_CHARS, 'Object exceeds 100KB');
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
    name: z.string().trim().min(1).max(MAX_ENTITY_NAME_CHARS),
    type: z.enum(CharacterType).default(CharacterType.Player),
    attributes: object.default({}),
    inventory: object.default({}),
    description: object.default({}),
    notes: z.string().max(MAX_LONG_TEXT_CHARS).default(''),
  })
  .strict();
// PATCH must not apply creation defaults to fields the user did not send.
export const characterPatchSchema = characterInput
  .omit({ type: true })
  .extend({
    attributes: characterInput.shape.attributes.removeDefault(),
    inventory: characterInput.shape.inventory.removeDefault(),
    description: characterInput.shape.description.removeDefault(),
    notes: characterInput.shape.notes.removeDefault(),
  })
  .partial()
  .extend({ revision: z.number().int().nonnegative() })
  .strict();
export const operationSchema = z.discriminatedUnion('op', [
  z
    .object({
      op: z.literal(OPERATION_KIND.Create),
      character: characterInput.omit({ notes: true }),
    })
    .strict(),
  z
    .object({
      op: z.literal(OPERATION_KIND.Set),
      characterId: idSchema,
      field: z.enum(CHARACTER_MUTABLE_FIELDS),
      expected: z.unknown(),
      value: z.unknown(),
    })
    .strict(),
  z.object({ op: z.literal(OPERATION_KIND.State), expected: object, value: object }).strict(),
]);
export const memorySchema = z.object({ text: z.string().trim().min(1) }).strict();
export const draftSchema = characterInput.omit({ notes: true });
export const memoryJsonSchema = z.toJSONSchema(memorySchema);
export const draftJsonSchema = z.toJSONSchema(draftSchema);
export const campaignCreateSchema = z
  .object({
    systemId: idSchema.nullable().optional(),
    name: z.string().trim().min(1).max(MAX_ENTITY_NAME_CHARS),
    description: z.string().max(MAX_LONG_TEXT_CHARS).default(''),
    instructions: z.string().max(MAX_LONG_TEXT_CHARS).default(''),
    settings: settingsSchema.optional(),
  })
  .strict();
export const campaignRuleBindingSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    requestId: z.uuid(),
    systemId: idSchema.nullable(),
  })
  .strict();
export const campaignPatchSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    name: z.string().trim().min(1).max(MAX_ENTITY_NAME_CHARS).optional(),
    description: z.string().max(MAX_LONG_TEXT_CHARS).optional(),
    instructions: z.string().max(MAX_LONG_TEXT_CHARS).optional(),
    settings: settingsSchema.optional(),
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
      .transform(({ compaction }) => ({ compaction }))
      .optional(),
    state: object.optional(),
  })
  .strict();
export const turnInputSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    requestId: idSchema,
    action: z.string().trim().min(1).max(MAX_TURN_TEXT_CHARS),
    settings: settingsSchema.optional(),
  })
  .strict();

export const turnStatusSchema = z.enum(TurnStatus);
export const sourceStatusSchema = z.enum(SourceStatus);
export const sourceKindSchema = z.enum(SourceKind);
export const ocrLanguageSchema = z.enum(OCR_LANGUAGE_CODES);
export const transcriptionLanguageSchema = z.enum(TRANSCRIPTION_LANGUAGE_CODES);
