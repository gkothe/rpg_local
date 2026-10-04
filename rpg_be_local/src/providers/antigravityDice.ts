import { type PromptTraceContext } from './promptLog.js';
import { z } from 'zod';
import { Problem } from '../errors.js';
import { DICE_TOOL_NAME } from '../domain/dice.js';
import { RULE_TOOLS } from '../domain/rules.js';
import type { BookGameplayAdapter } from './gameplayTools.js';
import type { ProviderSettings } from '../domain/types.js';
import type { Executable } from './discovery.js';
import { DiceProtocol, type RollCallback } from './diceProtocol.js';
import { parseProviderOutput } from './adapters.js';
import { PROVIDER_ID } from './options.js';
import { generateAntigravityMcpBook } from './antigravityMcpBook.js';

export const ANTIGRAVITY_DICE_PHASE_RESERVE_BYTES = 3200;
export const ANTIGRAVITY_DICE_PHASE_KIND = { ToolCall: 'tool_call', Final: 'final' } as const;
const ANTIGRAVITY_DICE_EVENT = { Init: 'init', Step: 'step_update', Result: 'result' } as const;
const ANTIGRAVITY_DICE_STEPS = ['user_input', 'agent_response'] as const;
const phaseSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal(ANTIGRAVITY_DICE_PHASE_KIND.ToolCall),
      tool: z.literal(DICE_TOOL_NAME),
      arguments: z.unknown(),
    })
    .strict(),
  z.object({ kind: z.literal(ANTIGRAVITY_DICE_PHASE_KIND.Final), response: z.unknown() }).strict(),
]);
const bookPhaseSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal(ANTIGRAVITY_DICE_PHASE_KIND.ToolCall),
      tool: z.enum([DICE_TOOL_NAME, ...RULE_TOOLS]),
      arguments: z.unknown(),
    })
    .strict(),
  z.object({ kind: z.literal(ANTIGRAVITY_DICE_PHASE_KIND.Final), response: z.unknown() }).strict(),
]);

export function antigravityDiceEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...source };
  for (const key of Object.keys(env)) {
    if (/^ANTIGRAVITY_|^CASCADE_|^MCP_|API_KEY|AUTH_TOKEN|OAUTH_TOKEN|^GEMINI_|^GOOGLE_/i.test(key))
      delete env[key];
  }
  return env;
}

export function parseAntigravityDicePhase(
  output: string,
  book = false
): z.infer<typeof bookPhaseSchema> {
  try {
    const events = output
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    if (
      events.filter((event) => event.event === ANTIGRAVITY_DICE_EVENT.Init).length !== 1 ||
      events.filter((event) => event.event === ANTIGRAVITY_DICE_EVENT.Result).length !== 1
    )
      throw new Problem(
        502,
        'dice_isolation',
        'Antigravity did not complete exactly one isolated dice phase'
      );
    for (const event of events) {
      if (event.event === ANTIGRAVITY_DICE_EVENT.Step) {
        const step = event.step_update as { step_type?: string } | undefined;
        if (
          !step?.step_type ||
          !(ANTIGRAVITY_DICE_STEPS as readonly string[]).includes(step.step_type)
        )
          throw new Problem(
            502,
            'dice_isolation',
            `Antigravity emitted unapproved phase activity (${typeof step?.step_type === 'string' && /^[a-z_]{1,80}$/.test(step.step_type) ? step.step_type : 'unrecognized'})`
          );
      } else if (
        event.event !== ANTIGRAVITY_DICE_EVENT.Init &&
        event.event !== ANTIGRAVITY_DICE_EVENT.Result
      )
        throw new Problem(
          502,
          'dice_isolation',
          'Antigravity emitted an unapproved dice phase event'
        );
    }
    return (book ? bookPhaseSchema : phaseSchema).parse(
      parseProviderOutput(PROVIDER_ID.Antigravity, output)
    );
  } catch (error) {
    if (error instanceof Problem) throw error;
    throw new Problem(
      502,
      'dice_protocol',
      'Antigravity returned an invalid application tool-call envelope'
    );
  }
}

/** Execute owned tools through private native MCP in one bounded logical turn. */
export async function generateAntigravityDice(
  executable: Executable,
  settings: ProviderSettings,
  prompt: string,
  cwd: string,
  sourceEnv: NodeJS.ProcessEnv,
  roll: RollCallback,
  signal?: AbortSignal,
  book?: BookGameplayAdapter,
  trace?: PromptTraceContext
): Promise<unknown> {
  const protocol = new DiceProtocol(roll);
  return generateAntigravityMcpBook(
    executable,
    settings,
    prompt,
    cwd,
    sourceEnv,
    book ?? { dispatch: protocol.call.bind(protocol) },
    signal,
    !!book,
    trace
  );
}
