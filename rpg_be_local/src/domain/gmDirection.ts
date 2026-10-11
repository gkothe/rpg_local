import { z } from 'zod';
import { MAX_ENTITY_NAME_CHARS, MAX_LONG_TEXT_CHARS } from './limits.js';
import { GmIndexRefKind, gmIndexRefSchema } from './gmIndexRefs.js';

export enum GmFoundationTopic {
  Setting = 'setting',
  Conflict = 'conflict',
  FactionGoal = 'faction_goal',
  Constraint = 'constraint',
  Navigation = 'navigation',
}
export enum GmDirectionBasis {
  Campaign = 'campaign',
  Creative = 'creative',
}
export const gmIndexTitleSchema = z.string().trim().min(1).max(MAX_ENTITY_NAME_CHARS);
export const gmIndexProseSchema = z.string().trim().min(1).max(MAX_LONG_TEXT_CHARS);
export const gmFoundationValueSchema = z
  .object({
    topic: z.enum(GmFoundationTopic),
    title: gmIndexTitleSchema,
    text: gmIndexProseSchema,
    refs: z
      .array(gmIndexRefSchema)
      .min(1)
      .refine(
        (refs) => refs.some((ref) => ref.kind !== GmIndexRefKind.RuleHint),
        'Foundation requires an original or canonical campaign reference'
      ),
  })
  .strict();
export const gmFoundationEntrySchema = gmFoundationValueSchema.extend({ id: z.uuid() }).strict();
export type GmFoundationEntry = z.infer<typeof gmFoundationEntrySchema>;
/** This describes a possible development, never a canonical event or clock mutation. */
export const gmDirectionSchema = z
  .object({
    basis: z.enum(GmDirectionBasis),
    trigger: gmIndexProseSchema.nullable(),
    development: gmIndexProseSchema,
    choices: z.array(gmIndexProseSchema),
    rationale: gmIndexProseSchema,
  })
  .strict();
export type GmDirection = z.infer<typeof gmDirectionSchema>;
export const gmIndexCheckedSchema = z
  .object({
    notes: z.literal(true),
    foundation: z.literal(true),
    direction: z.literal(true),
  })
  .strict();
