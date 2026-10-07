import { z } from 'zod';
import { trackedPathSchema } from './combat.js';
import { CHARACTER_FIELD } from './options.js';
import { serializedBytes } from './rules.js';

/** Character sections a sheet layout may address; `name` is not a free-form section. */
export const SHEET_SECTIONS = [
  CHARACTER_FIELD.Attributes,
  CHARACTER_FIELD.Inventory,
  CHARACTER_FIELD.Description,
] as const;

export enum SheetWidget {
  Number = 'number',
  Dots = 'dots',
  Checks = 'checks',
  Track = 'track',
  Percentile = 'percentile',
  Score = 'score',
  Tags = 'tags',
  Items = 'items',
  Prose = 'prose',
  Facts = 'facts',
  Hidden = 'hidden',
}

export const SHEET_LAYOUT_LIMITS = {
  fields: 200,
  bytes: 32_768,
  labelChars: 80,
  pathSegments: 16,
  orderMax: 999,
  dotsMax: 10,
  checksMax: 20,
  trackMax: 1000,
} as const;

type Range = { min: number; max: number; required: boolean };
type WidgetParams = { max?: Range; maxPath?: boolean; modifierPath?: boolean };
export const SHEET_WIDGET_OPTIONS: readonly {
  id: SheetWidget;
  label: string;
  description: string;
  params: WidgetParams;
}[] = [
  {
    id: SheetWidget.Number,
    label: 'Number',
    description: 'A plain stat number.',
    params: {},
  },
  {
    id: SheetWidget.Dots,
    label: 'Dots',
    description: 'A rating shown as filled dots out of a fixed maximum (e.g. a 0–5 skill).',
    params: { max: { min: 1, max: SHEET_LAYOUT_LIMITS.dotsMax, required: true } },
  },
  {
    id: SheetWidget.Checks,
    label: 'Check boxes',
    description: 'A count shown as ticked boxes out of a fixed maximum (e.g. stress or uses).',
    params: { max: { min: 1, max: SHEET_LAYOUT_LIMITS.checksMax, required: true } },
  },
  {
    id: SheetWidget.Track,
    label: 'Track',
    description:
      'A current value shown as a bar against a maximum, given either as a number or a path to another value (e.g. hit points).',
    params: {
      max: { min: 1, max: SHEET_LAYOUT_LIMITS.trackMax, required: false },
      maxPath: true,
    },
  },
  {
    id: SheetWidget.Percentile,
    label: 'Percentile',
    description: 'A skill or characteristic rated on a 0–100 scale.',
    params: {},
  },
  {
    id: SheetWidget.Score,
    label: 'Ability score',
    description: 'A score with an optional modifier read from another value.',
    params: { modifierPath: true },
  },
  {
    id: SheetWidget.Tags,
    label: 'Tags',
    description: 'A list of short strings shown as tags.',
    params: {},
  },
  {
    id: SheetWidget.Items,
    label: 'Item cards',
    description: 'A list of named objects shown as cards.',
    params: {},
  },
  {
    id: SheetWidget.Prose,
    label: 'Prose',
    description: 'Long text shown as readable paragraphs.',
    params: {},
  },
  {
    id: SheetWidget.Facts,
    label: 'Fact list',
    description: 'A labelled group of values shown as a compact definition list.',
    params: {},
  },
  {
    id: SheetWidget.Hidden,
    label: 'Hidden',
    description: 'Omit the field from the sheet view (it stays in the stored sheet).',
    params: {},
  },
];

const firstSegment = (path: readonly string[]) => path[0] as (typeof SHEET_SECTIONS)[number];
const sheetPath = trackedPathSchema
  .max(SHEET_LAYOUT_LIMITS.pathSegments)
  .refine((path) => SHEET_SECTIONS.includes(firstSegment(path)), {
    message: `Path must start with ${SHEET_SECTIONS.join(', ')}`,
  });
const integer = (min: number, max: number) => z.number().int().min(min).max(max);

const fieldHintSchema = z
  .object({
    path: sheetPath,
    widget: z.enum(SheetWidget),
    label: z.string().trim().min(1).max(SHEET_LAYOUT_LIMITS.labelChars).optional(),
    max: z.number().optional(),
    maxPath: sheetPath.optional(),
    modifierPath: sheetPath.optional(),
    order: integer(0, SHEET_LAYOUT_LIMITS.orderMax).optional(),
  })
  .strict()
  .superRefine((field, ctx) => {
    const reject = (key: 'max' | 'maxPath' | 'modifierPath', message: string) =>
      ctx.addIssue({ code: 'custom', path: [key], message });
    const bounded = (min: number, max: number) => {
      if (field.max === undefined || !Number.isInteger(field.max))
        return reject('max', `max is required: an integer ${min}–${max}`);
      if (field.max < min || field.max > max) reject('max', `max must be an integer ${min}–${max}`);
    };
    if (field.widget === SheetWidget.Dots) bounded(1, SHEET_LAYOUT_LIMITS.dotsMax);
    else if (field.widget === SheetWidget.Checks) bounded(1, SHEET_LAYOUT_LIMITS.checksMax);
    else if (field.widget === SheetWidget.Track) {
      if ((field.max === undefined) === (field.maxPath === undefined))
        reject('max', 'track needs exactly one of max or maxPath');
      else if (field.max !== undefined) bounded(1, SHEET_LAYOUT_LIMITS.trackMax);
    } else if (field.max !== undefined) reject('max', `${field.widget} does not take max`);
    if (field.widget !== SheetWidget.Track && field.maxPath !== undefined)
      reject('maxPath', `${field.widget} does not take maxPath`);
    if (field.widget !== SheetWidget.Score && field.modifierPath !== undefined)
      reject('modifierPath', `${field.widget} does not take modifierPath`);
  });

export const sheetLayoutSchema = z
  .object({ fields: z.array(fieldHintSchema).max(SHEET_LAYOUT_LIMITS.fields) })
  .strict()
  .superRefine((layout, ctx) => {
    const seen = new Set<string>();
    layout.fields.forEach((field, index) => {
      const key = JSON.stringify(field.path);
      if (seen.has(key))
        ctx.addIssue({
          code: 'custom',
          path: ['fields', index, 'path'],
          message: 'Duplicate path',
        });
      seen.add(key);
    });
    if (serializedBytes(layout) > SHEET_LAYOUT_LIMITS.bytes)
      ctx.addIssue({
        code: 'custom',
        message: `Layout exceeds ${SHEET_LAYOUT_LIMITS.bytes} bytes`,
      });
  });
export type SheetLayout = z.infer<typeof sheetLayoutSchema>;
export const EMPTY_SHEET_LAYOUT: SheetLayout = { fields: [] };

export const sheetLayoutRequestSchema = z
  .object({ requestId: z.uuid(), sheetLayout: sheetLayoutSchema })
  .strict();

export const SHEET_LAYOUT_OPTIONS = {
  widgets: SHEET_WIDGET_OPTIONS,
  limits: {
    fields: SHEET_LAYOUT_LIMITS.fields,
    bytes: SHEET_LAYOUT_LIMITS.bytes,
    labelChars: SHEET_LAYOUT_LIMITS.labelChars,
    pathSegments: SHEET_LAYOUT_LIMITS.pathSegments,
  },
} as const;
