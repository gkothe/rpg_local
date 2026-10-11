import { z } from 'zod';
import { Problem } from '../errors.js';
import type { Generator } from '../providers/service.js';
import type { ProviderSettings } from '../domain/types.js';
import type { PromptTraceContext } from '../providers/promptLog.js';
import {
  npcSheetResultSchema,
  validateNpcSheetResult,
  type NpcSheetRequirements,
  type NpcSheetResult,
  type NpcSheetValues,
} from '../domain/npcSheet.js';
import { RESPONSE_RETRY_COUNT } from '../domain/responseRetry.js';
import { applyResponseCorrections } from './responseRepair.js';

export async function validateSheetWithRepair(
  raw: unknown,
  requirements: NpcSheetRequirements,
  existing: NpcSheetValues,
  generator: Generator,
  settings: ProviderSettings,
  signal?: AbortSignal,
  trace?: PromptTraceContext,
  allowConflicts = false
): Promise<NpcSheetResult> {
  let candidate = raw;
  for (let attempt = 0; ; attempt++) {
    try {
      const parsed = npcSheetResultSchema.parse(candidate);
      if (parsed.conflicts.length && allowConflicts) return parsed;
      if (parsed.conflicts.length)
        throw new Problem(422, 'npc_sheet_conflict', 'NPC sheet has unresolved conflicts');
      validateNpcSheetResult(requirements, parsed, existing);
      return parsed;
    } catch (error) {
      if (attempt >= RESPONSE_RETRY_COUNT || signal?.aborted) throw error;
      if (error instanceof Problem && error.code === 'npc_sheet_conflict') throw error;
      const wrapper = { operations: [candidate] };
      const invalidRoots =
        error instanceof z.ZodError
          ? [
              ...new Set(
                error.issues
                  .map((issue) => issue.path[0])
                  .filter((root) => root === 'attributes' || root === 'inventory')
              ),
            ]
          : error instanceof Error
            ? ['attributes', 'inventory'].filter(
                (root) => error.message.includes(`${root}.`) || error.message.endsWith(root)
              )
            : [];
      if (!invalidRoots.length) throw error;
      const paths = invalidRoots.map((root) => ['operations', 0, root]);
      const schema = {
        type: 'object',
        additionalProperties: false,
        required: ['corrections'],
        properties: {
          corrections: {
            type: 'array',
            minItems: paths.length,
            maxItems: paths.length,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['path', 'value'],
              properties: { path: { enum: paths }, value: { type: 'object' } },
            },
          },
        },
      };
      const corrections = await generator.generate(
        settings,
        JSON.stringify({
          task: 'Correct ONLY the invalid mechanical sheet fields. Return exactly the path/value corrections in allowed order. Preserve every established value, core, rationale and conflict. No tools, events or rerolls.',
          allowedPaths: paths,
          invalid: error instanceof Error ? error.message : 'Invalid sheet',
          requirements,
          existing,
          response: wrapper,
        }),
        schema,
        signal,
        trace
      );
      candidate = applyResponseCorrections(wrapper, paths, corrections).operations[0];
    }
  }
}
export async function generateNpcSheet(
  requirements: NpcSheetRequirements,
  existing: NpcSheetValues,
  context: unknown,
  generator: Generator,
  settings: ProviderSettings,
  signal?: AbortSignal,
  trace?: PromptTraceContext
): Promise<NpcSheetResult> {
  const raw = await generator.generate(
    settings,
    JSON.stringify({
      task: 'Complete this NPC mechanical sheet for the supplied system, edition and category. Fill every applicable required path. Preserve ALL established values including zero/false/empty leaf values. Do not change identity, personality, history, notes or existing gear. No random rolls, tools or witnessed events. Report contradictory established stats or unavailable formulas as conflicts. List each field rationale. Newly specified starting equipment is a proposal for review, not a historical acquisition.',
      requirements,
      existing,
      context,
    }),
    z.toJSONSchema(npcSheetResultSchema),
    signal,
    trace
  );
  return validateSheetWithRepair(
    raw,
    requirements,
    existing,
    generator,
    settings,
    signal,
    trace,
    true
  );
}
