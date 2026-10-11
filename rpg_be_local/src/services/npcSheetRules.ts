import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { Problem } from '../errors.js';
import type { Generator } from '../providers/service.js';
import type { ProviderSettings } from '../domain/types.js';
import type { PromptTraceContext } from '../providers/promptLog.js';
import { traceEvent } from '../providers/promptLog.js';
import { RuleSystemKind, RULE_TOOLS, type RuleSystem, type RuleTool } from '../domain/rules.js';
import { ruleContext } from './ruleStore.js';
import { RuleLookup, ruleToolSchemas } from './ruleLookup.js';
import {
  npcSheetRequirementsSchema,
  npcSheetRequirementsJsonSchema,
  NpcSheetBasis,
  type NpcSheetRequirements,
} from '../domain/npcSheet.js';
import { bindNpcSheetEvidence, type NpcSheetRead } from '../domain/npcSheetEvidence.js';

export const npcSheetLookupSchema = z
  .object({
    tool: z.enum(RULE_TOOLS),
    arguments: z.record(z.string(), z.unknown()),
    page: z.number().int().nonnegative(),
  })
  .strict();
export type NpcSheetLookup = z.infer<typeof npcSheetLookupSchema>;
export type NpcSheetCheckpoint = {
  history: { request: NpcSheetLookup; result: Record<string, unknown> }[];
  requirements?: NpcSheetRequirements;
};
const stepSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['action'],
  properties: {
    action: { enum: ['read', 'finish', 'fail'] },
    error: { type: 'string', minLength: 1 },
    request: z.toJSONSchema(npcSheetLookupSchema),
    requirements: npcSheetRequirementsJsonSchema,
  },
  oneOf: [
    { required: ['request'], properties: { action: { const: 'read' } } },
    { required: ['requirements'], properties: { action: { const: 'finish' } } },
    { required: ['error'], properties: { action: { const: 'fail' } } },
  ],
};
/** Reconstruct pagination from logical pages; never persist process-local cursor tokens. */
export function executeNpcSheetLookup(
  system: RuleSystem,
  raw: NpcSheetLookup,
  receiptId: string
): Record<string, unknown> {
  const request = npcSheetLookupSchema.parse(raw);
  if ('cursor' in request.arguments || 'locator' in request.arguments)
    throw new Problem(422, 'npc_sheet_lookup', 'Use logical pages, not cursor or locator tokens');
  const args = ruleToolSchemas[request.tool].parse(request.arguments);
  const lookup = new RuleLookup();
  let payload: Record<string, unknown> = {};
  let cursor: string | undefined;
  for (let page = 0; page <= request.page; page++) {
    if (page && !cursor)
      throw new Problem(422, 'npc_sheet_lookup', 'Requested page is beyond this original');
    payload = lookup.execute(
      system,
      request.tool as RuleTool,
      { ...args, ...(cursor ? { cursor } : {}) },
      receiptId
    );
    cursor = typeof payload.cursor === 'string' ? payload.cursor : undefined;
  }
  const copy = structuredClone(payload);
  // Tokens are meaningful only to this lookup instance.
  const strip = (v: unknown): void => {
    if (!v || typeof v !== 'object') return;
    for (const [key, value] of Object.entries(v)) {
      if (key === 'cursor' || key === 'nextCursor' || key === 'locator')
        delete (v as Record<string, unknown>)[key];
      else strip(value);
    }
  };
  strip(copy);
  return {
    ...copy,
    ...(cursor ? { nextPage: request.page + 1 } : {}),
    ruleContext: ruleContext(system),
    receiptId,
  };
}
export async function deriveNpcSheetRequirements(input: {
  generator: Generator;
  settings: ProviderSettings;
  system: RuleSystem;
  context: unknown;
  scope: { campaignId: string; ownerId: string; characterId?: string; systemId: string };
  checkpoint?: NpcSheetCheckpoint;
  reads: () => Promise<NpcSheetRead[]>;
  read: (request: NpcSheetLookup, index: number) => Promise<Record<string, unknown>>;
  save: (checkpoint: NpcSheetCheckpoint) => Promise<void>;
  alive: () => Promise<void>;
  signal?: AbortSignal;
  trace?: PromptTraceContext;
}): Promise<NpcSheetRequirements> {
  const checkpoint = input.checkpoint ?? { history: [] };
  if (checkpoint.requirements)
    return bindNpcSheetEvidence(checkpoint.requirements, await input.reads(), input.scope);
  for (;;) {
    await input.alive();
    if (input.signal?.aborted) throw new Problem(409, 'cancelled', 'Sheet generation cancelled');
    const raw = await input.generator.generate(
      input.settings,
      JSON.stringify({
        task: 'Establish the COMPLETE playable NPC sheet requirements for this selected system, edition and NPC type BEFORE assigning values. Return read requests until you have the required original rules, then finish with requirements. No tools, no values, no randomness.',
        guidance:
          'Include every required attribute and skill (including zero/untrained entries if required), derived defenses, vitality/resources, conditions, relevant abilities/powers, and equipment. Use the system-specific NPC rules, not an unrelated player sheet. Enumerate required leaf paths and ranges/catalog values; explain formulas, prerequisites and inapplicable sections. An existing sheet or layout is not a complete specification. Copy exact quotes from owned originals. Unknown system identity, edition, required random allocation without saved dice, unresolved required rules or missing book coverage: fail explicitly, never invent proof. Library mode may not fall back to model knowledge. Model-knowledge mode is provisional and must name the actual game from campaign context, never call the game Model knowledge. Read arguments must use logical page numbers; use nextPage to continue originals.',
        selectedSystem: { ...ruleContext(input.system), instructions: input.system.instructions },
        context: input.context,
        history: checkpoint.history,
      }),
      stepSchema,
      input.signal,
      input.trace
        ? { ...input.trace, executionId: randomUUID(), purpose: 'npc_sheet_requirements' }
        : undefined
    );
    const step = z
      .object({
        action: z.enum(['read', 'finish', 'fail']),
        error: z.string().trim().min(1).optional(),
        request: npcSheetLookupSchema.optional(),
        requirements: npcSheetRequirementsSchema.optional(),
      })
      .strict()
      .parse(raw);
    if (step.action === 'fail')
      throw new Problem(
        422,
        'npc_sheet_incomplete',
        'The selected system rules do not establish a complete NPC sheet; clarify the system, edition or missing rules and try again'
      );
    if (step.action === 'read') {
      if (!step.request || input.system.kind !== RuleSystemKind.Library)
        throw new Problem(
          422,
          'npc_sheet_lookup',
          'Original rule lookup is unavailable for this request'
        );
      const result = await input.read(step.request, checkpoint.history.length);
      checkpoint.history.push({ request: step.request, result });
      await input.save(checkpoint);
      continue;
    }
    if (!step.requirements)
      throw new Problem(422, 'npc_sheet_incomplete', 'NPC sheet requirements are missing');
    if (
      input.system.kind === RuleSystemKind.Library &&
      step.requirements.basis !== NpcSheetBasis.Book
    )
      throw new Problem(422, 'npc_sheet_evidence', 'Library NPC sheets require original rules');
    if (
      input.system.kind !== RuleSystemKind.Library &&
      step.requirements.basis === NpcSheetBasis.Book
    )
      throw new Problem(422, 'npc_sheet_evidence', 'Book verification is unavailable');
    if (/^(model[- ]knowledge|unknown|unspecified)$/i.test(step.requirements.systemName))
      throw new Problem(
        422,
        'npc_sheet_system',
        'Specify the campaign game system before completing an NPC sheet'
      );
    const requirements = bindNpcSheetEvidence(step.requirements, await input.reads(), input.scope);
    checkpoint.requirements = requirements;
    await input.save(checkpoint);
    await traceEvent(input.trace, 'npc_sheet_requirements_ready', {
      fields: requirements.fields.length,
      basis: requirements.basis,
    });
    return requirements;
  }
}
