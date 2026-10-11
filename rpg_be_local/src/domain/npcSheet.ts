import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import { Problem } from '../errors.js';
import { MAX_LONG_TEXT_CHARS } from './limits.js';
import { characterInput } from './schemas.js';
import { citationWireSchema } from './citationInput.js';
import { ruleCitationSchema } from './rules.js';

export const NPC_SHEET_VERSION = 1;
export enum NpcSheetBasis {
  Book = 'book',
  Instructions = 'instructions',
  ModelKnowledge = 'model_knowledge',
}
export enum NpcSheetValueType {
  Number = 'number',
  String = 'string',
  Boolean = 'boolean',
  Object = 'object',
  Array = 'array',
}
const text = z.string().trim().min(1).max(MAX_LONG_TEXT_CHARS);
const unsafe = new Set(['__proto__', 'prototype', 'constructor']);
export const npcSheetPathSchema = z
  .array(
    z
      .string()
      .min(1)
      .refine((k) => !unsafe.has(k))
  )
  .min(2)
  .refine(
    (p) => p[0] === 'attributes' || p[0] === 'inventory',
    'Sheet path must select attributes or inventory'
  );
export const npcSheetFieldSchema = z
  .object({
    path: npcSheetPathSchema,
    type: z.enum(NpcSheetValueType),
    reason: text,
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    integer: z.boolean().optional(),
    values: z
      .array(z.union([z.string(), z.number().finite(), z.boolean()]))
      .min(1)
      .optional(),
    formula: text.optional(),
  })
  .strict()
  .refine(
    (f) => f.min === undefined || f.max === undefined || f.min <= f.max,
    'Invalid field range'
  );
// Wire citations omit offsets; the owning evidence binder supplies them.
const citationInputSchema = z
  .object(ruleCitationSchema.shape)
  .omit({ start: true, end: true, pdfPages: true, printedPages: true })
  .extend({
    precision: ruleCitationSchema.shape.precision.optional(),
    start: z.number().int().nonnegative().optional(),
    end: z.number().int().nonnegative().optional(),
    pdfPages: z.array(z.number().int()).optional(),
    printedPages: z.array(z.string()).optional(),
  });
export const npcSheetRequirementsSchema = z
  .object({
    version: z.literal(NPC_SHEET_VERSION),
    systemName: text,
    edition: text,
    category: text,
    basis: z.enum(NpcSheetBasis),
    applicability: z.array(text),
    citations: z.array(citationInputSchema),
    fields: z.array(npcSheetFieldSchema).min(1),
  })
  .strict()
  .superRefine((r, ctx) => {
    for (let i = 0; i < r.fields.length; i++)
      for (let j = 0; j < i; j++) {
        const a = r.fields[i]!.path,
          b = r.fields[j]!.path;
        if (a.slice(0, Math.min(a.length, b.length)).every((k, n) => k === b[n]))
          ctx.addIssue({
            code: 'custom',
            path: ['fields', i, 'path'],
            message: 'Duplicate or overlapping field paths',
          });
      }
    if (r.basis === NpcSheetBasis.Book && !r.citations.length)
      ctx.addIssue({
        code: 'custom',
        path: ['citations'],
        message: 'Book requirements need owned original citations',
      });
    if (r.basis !== NpcSheetBasis.Book && r.citations.length)
      ctx.addIssue({
        code: 'custom',
        path: ['citations'],
        message: 'Non-book requirements cannot claim book citations',
      });
  });
export type NpcSheetRequirements = z.infer<typeof npcSheetRequirementsSchema>;
export const npcSheetValuesSchema = z
  .object({
    attributes: characterInput.shape.attributes.removeDefault(),
    inventory: characterInput.shape.inventory.removeDefault(),
  })
  .strict();
export const npcSheetResultSchema = npcSheetValuesSchema
  .extend({
    rationales: z.array(z.object({ path: npcSheetPathSchema, reason: text }).strict()),
    conflicts: z.array(text),
  })
  .strict();
export type NpcSheetValues = z.infer<typeof npcSheetValuesSchema>;
export type NpcSheetResult = z.infer<typeof npcSheetResultSchema>;
export function validateNpcSheetResult(
  requirements: NpcSheetRequirements,
  result: NpcSheetResult,
  existing?: NpcSheetValues
): void {
  validateNpcSheet(requirements, result, existing);
  for (const field of requirements.fields)
    if (!result.rationales.some((r) => isDeepStrictEqual(r.path, field.path)))
      throw new Problem(422, 'npc_sheet_rationale', 'Every required sheet field needs a rationale');
}
export const npcSheetMetadataSchema = z
  .object({ requirements: npcSheetRequirementsSchema, result: npcSheetResultSchema })
  .strict();
export const npcSheetRequirementsJsonSchema = citationWireSchema(
  z.toJSONSchema(npcSheetRequirementsSchema)
);
export function sheetValue(root: unknown, path: readonly string[]): unknown {
  let value = root;
  for (const key of path) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, key))
      return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}
function preserve(before: unknown, after: unknown, path: string): void {
  if (before && typeof before === 'object' && !Array.isArray(before)) {
    if (!after || typeof after !== 'object' || Array.isArray(after))
      throw new Problem(422, 'npc_sheet_existing', `Changed established ${path}`);
    for (const [key, value] of Object.entries(before)) {
      if (!Object.hasOwn(after, key))
        throw new Problem(422, 'npc_sheet_existing', `Removed established ${path}.${key}`);
      preserve(value, (after as Record<string, unknown>)[key], `${path}.${key}`);
    }
  } else if (!isDeepStrictEqual(before, after))
    throw new Problem(422, 'npc_sheet_existing', `Changed established ${path}`);
}
export function validateNpcSheet(
  requirements: NpcSheetRequirements,
  raw: NpcSheetValues,
  existing?: NpcSheetValues
): void {
  const req = npcSheetRequirementsSchema.parse(requirements);
  const sheet = npcSheetValuesSchema.parse({
    attributes: raw.attributes,
    inventory: raw.inventory,
  });
  if (existing) {
    preserve(existing.attributes, sheet.attributes, 'attributes');
    preserve(existing.inventory, sheet.inventory, 'inventory');
  }
  for (const f of req.fields) {
    const v = sheetValue(sheet, f.path);
    const validType =
      f.type === NpcSheetValueType.Array
        ? Array.isArray(v)
        : f.type === NpcSheetValueType.Object
          ? !!v && typeof v === 'object' && !Array.isArray(v)
          : typeof v === f.type;
    if (
      !validType ||
      (typeof v === 'number' &&
        (!Number.isFinite(v) ||
          (f.integer && !Number.isInteger(v)) ||
          (f.min !== undefined && v < f.min) ||
          (f.max !== undefined && v > f.max))) ||
      (f.values && !f.values.some((value) => isDeepStrictEqual(value, v)))
    )
      throw new Problem(
        422,
        'npc_sheet_invalid',
        `Missing or invalid required field: ${f.path.join('.')}`
      );
  }
}
