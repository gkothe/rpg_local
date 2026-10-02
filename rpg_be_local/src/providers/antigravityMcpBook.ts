import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Problem } from '../errors.js';
import { DICE_LIMITS } from '../domain/dice.js';
import { RULE_LIMITS, canonicalRuleJson, serializedBytes } from '../domain/rules.js';
import { BOOK_GAMEPLAY_NARRATOR } from '../domain/gameplayNarrator.js';
import { ruleResponseSchema, ruleResponseJsonSchema } from '../domain/ruleResponse.js';
import { diceResponseSchema, diceResponseJsonSchema } from '../domain/diceResponse.js';
import type { ProviderSettings } from '../domain/types.js';
import type { Executable } from './discovery.js';
import { ANTIGRAVITY_ISOLATED_VERSION, generateAntigravity } from './antigravity.js';
import { antigravityDiceEnvironment } from './antigravityDice.js';
import { startGameplayMcp } from './gameplayMcp.js';
import { gameplayToolDefinitions, type BookGameplayAdapter } from './gameplayTools.js';
import { DICE_CLI_LIMITS, DICE_NARRATOR } from './diceProtocol.js';
import { MAX_PROVIDER_INPUT_TOKENS } from './options.js';
import { runProcess } from './processRunner.js';

const MCP_SERVER = 'local_rpg';
const MCP_GATEWAY = 'call_mcp_tool';
const PROFILE_PREFIX = 'rpg-agy-private-';
const NATIVE_ACCESS_DENIED = [
  'command(*)',
  'unsandboxed(*)',
  'read_file(*)',
  'write_file(*)',
  'read_url(*)',
  'execute_url(*)',
];
type PendingCall = { index: number; key: string; claimed: boolean };

/** One bounded native tool loop per logical turn; canonical state always belongs to the app. */
export async function generateAntigravityMcpBook(
  executable: Executable,
  settings: ProviderSettings,
  prompt: string,
  cwd: string,
  sourceEnv: NodeJS.ProcessEnv,
  book: BookGameplayAdapter,
  signal?: AbortSignal,
  selectedBook = true
): Promise<unknown> {
  const profile = await mkdtemp(path.join(os.tmpdir(), PROFILE_PREFIX));
  const deadline = Date.now() + DICE_LIMITS.attemptMs;
  const controller = new AbortController();
  const boundedSignal = AbortSignal.any([
    controller.signal,
    ...(signal ? [signal] : []),
    AbortSignal.timeout(DICE_LIMITS.attemptMs),
  ]);
  const env = { ...antigravityDiceEnvironment(sourceEnv), USERPROFILE: profile };
  const definitions = book.definitions ?? gameplayToolDefinitions(selectedBook);
  const tools = definitions.map((definition) => definition.name);
  const pending: PendingCall[] = [];
  const waiters = new Set<() => void>();
  const notify = () => {
    for (const waiter of waiters) waiter();
    waiters.clear();
  };
  const inferences = new Map<number, number>();
  let initialized = false;
  let completed = false;
  let final: unknown;
  let calls = 0;
  const check = () => {
    if (boundedSignal.aborted || Date.now() >= deadline)
      throw new Problem(409, 'cancelled', 'Antigravity book attempt is no longer active');
  };
  const endpoint = await startGameplayMcp(
    definitions,
    async (tool, input) => {
      const key = `${tool}:${canonicalRuleJson(input)}`;
      let invocation: PendingCall | undefined;
      while (!(invocation = pending.find((entry) => !entry.claimed && entry.key === key))) {
        check();
        await new Promise<void>((resolve) => {
          const ready = () => {
            boundedSignal.removeEventListener('abort', ready);
            waiters.delete(ready);
            resolve();
          };
          waiters.add(ready);
          boundedSignal.addEventListener('abort', ready, { once: true });
          if (boundedSignal.aborted) ready();
        });
      }
      check();
      if (!initialized || !inferences.size || ++calls > DICE_LIMITS.requestsPerAttempt)
        throw new Problem(
          422,
          'rules_calls_exhausted',
          'Antigravity exhausted its native tool allowance'
        );
      invocation.claimed = true;
      // Native clients may reuse JSON-RPC IDs across independent tool calls.
      // Stream step identity owns the application's persisted replay identity.
      return book.dispatch(tool, input, `agy:mcp:${invocation.index}`);
    },
    boundedSignal
  ).catch(async (error: unknown) => {
    await cleanProfile(profile);
    throw error;
  });
  try {
    const settingsDirectory = path.join(profile, '.gemini', 'antigravity-cli');
    await mkdir(settingsDirectory, { recursive: true });
    await writeFile(
      path.join(settingsDirectory, 'settings.json'),
      JSON.stringify({
        permissions: {
          allow: tools.map((tool) => `mcp(${MCP_SERVER}/${tool})`),
          deny: NATIVE_ACCESS_DENIED,
        },
      }),
      { flag: 'wx' }
    );
    const version = (
      await runProcess(executable.binary, [...executable.prefix, 'changelog'], '', {
        env,
        signal: boundedSignal,
        timeoutMs: 8000,
        maxOutputBytes: 200000,
      })
    )
      .trim()
      .split(/\r?\n/)[0]!
      .replace(/:$/, '');
    if (version !== ANTIGRAVITY_ISOLATED_VERSION)
      throw new Problem(
        503,
        'antigravity_dice_version',
        `Antigravity private MCP requires verified CLI ${ANTIGRAVITY_ISOLATED_VERSION}`
      );
    const responseJsonSchema = selectedBook ? ruleResponseJsonSchema : diceResponseJsonSchema;
    const responseSchema = selectedBook ? ruleResponseSchema : diceResponseSchema;
    const schema = JSON.stringify(responseJsonSchema);
    const phasePrompt = prompt.includes(schema)
      ? prompt
      : `${prompt}\nFinal response schema:${schema}`;
    await generateAntigravity(
      executable,
      settings,
      phasePrompt,
      responseJsonSchema,
      cwd,
      env,
      boundedSignal,
      {
        ownedProfile: profile,
        privateMcp: { name: MCP_SERVER, endpoint },
        agentPrompt: `${selectedBook ? BOOK_GAMEPLAY_NARRATOR : DICE_NARRATOR} Use the real private ${MCP_SERVER} MCP tools. Do not emit simulated JSON tool requests. This is one bounded logical game turn. The supplied frozen campaign context and application tool results are authoritative. Return only the complete final GM JSON.\nOwned MCP argument schemas:${JSON.stringify(definitions)}`,
        timeoutMs: deadline - Date.now(),
        deadlineMs: deadline,
        maxOutputBytes: DICE_CLI_LIMITS.protocolBytes,
        protocol: (agentName) => ({
          start(_send, end) {
            end(JSON.stringify({ event: 'user', message: { content: phasePrompt } }) + '\n');
          },
          async line(value) {
            check();
            const event = value as Record<string, unknown>;
            if (event.event === 'init') {
              const init = event.init as { agent?: string };
              if (initialized || init?.agent !== agentName)
                throw new Problem(
                  502,
                  'dice_isolation',
                  'Antigravity did not select its owned private agent'
                );
              initialized = true;
            } else if (event.event === 'step_update') {
              if (!initialized || completed)
                throw new Problem(
                  502,
                  'dice_isolation',
                  'Antigravity emitted activity outside the owned turn'
                );
              const step = event.step_update as {
                step_type?: string;
                step_index?: number;
                state?: string;
                usage?: {
                  input_tokens?: number;
                  output_tokens?: number;
                  cache_read_tokens?: number;
                };
                tool_name?: string;
                tool_info?: {
                  name?: string;
                  parameters?: { Arguments?: unknown; ServerName?: string; ToolName?: string };
                };
              };
              if (step.step_type === 'agent_response') {
                if (step.usage) {
                  const input = step.usage.input_tokens;
                  if (
                    !Number.isInteger(input) ||
                    input! < 0 ||
                    input! > MAX_PROVIDER_INPUT_TOKENS ||
                    !Number.isInteger(step.usage.output_tokens) ||
                    step.usage.output_tokens! < 0 ||
                    step.usage.output_tokens! > DICE_CLI_LIMITS.modelOutputTokens ||
                    !Number.isInteger(step.step_index)
                  )
                    throw new Problem(
                      422,
                      'context_overflow',
                      'Antigravity inference exceeded or omitted its verified context window'
                    );
                  if (!inferences.has(step.step_index!)) {
                    inferences.set(step.step_index!, input!);
                    if (inferences.size > DICE_CLI_LIMITS.modelTurns)
                      throw new Problem(
                        422,
                        'rules_calls_exhausted',
                        'Antigravity exhausted its bounded model inferences'
                      );
                    book.observe?.({
                      provider: 'agy',
                      phase: inferences.size - 1,
                      inputTokens: input,
                      outputTokens: step.usage.output_tokens,
                      cacheReadTokens: step.usage.cache_read_tokens,
                    });
                  }
                }
              } else if (step.step_type === 'tool') {
                const parameters = step.tool_info?.parameters;
                if (
                  (step.tool_name ?? step.tool_info?.name) !== MCP_GATEWAY ||
                  parameters?.ServerName !== MCP_SERVER ||
                  !tools.includes(parameters?.ToolName ?? '')
                )
                  throw new Problem(
                    502,
                    'dice_isolation',
                    'Antigravity attempted a tool outside its private MCP'
                  );
                const input =
                  typeof parameters.Arguments === 'string'
                    ? JSON.parse(parameters.Arguments)
                    : parameters.Arguments;
                if (
                  !input ||
                  typeof input !== 'object' ||
                  Array.isArray(input) ||
                  serializedBytes(input) > RULE_LIMITS.requestBytes
                )
                  throw new Problem(
                    422,
                    'rules_request_invalid',
                    'Antigravity native MCP arguments exceed their owned request contract'
                  );
                if (step.state === 'ACTIVE') {
                  if (
                    !Number.isInteger(step.step_index) ||
                    step.step_index! < 0 ||
                    pending.some((entry) => entry.index === step.step_index)
                  )
                    throw new Problem(
                      502,
                      'dice_isolation',
                      'Antigravity reused an invalid native tool identity'
                    );
                  if (!inferences.size || pending.length >= DICE_LIMITS.requestsPerAttempt)
                    throw new Problem(
                      422,
                      'rules_calls_exhausted',
                      'Antigravity exhausted its native tool allowance'
                    );
                  pending.push({
                    index: step.step_index!,
                    key: `${parameters.ToolName}:${canonicalRuleJson(input)}`,
                    claimed: false,
                  });
                  notify();
                }
              } else if (step.step_type !== 'user_input')
                throw new Problem(
                  502,
                  'dice_isolation',
                  `Antigravity emitted unapproved native activity (${typeof step.step_type === 'string' && /^[a-z_]{1,80}$/.test(step.step_type) ? step.step_type : 'unrecognized'})`
                );
            } else if (event.event === 'result') {
              const result = event.result as {
                status?: string;
                num_turns?: number;
                response?: string;
                usage?: { input_tokens?: number };
              };
              const total = result.usage?.input_tokens;
              if (
                !initialized ||
                completed ||
                result.status !== 'SUCCESS' ||
                result.num_turns !== 1 ||
                !inferences.size ||
                !Number.isInteger(total) ||
                total! < 0 ||
                total! > DICE_CLI_LIMITS.modelTurns * MAX_PROVIDER_INPUT_TOKENS ||
                typeof result.response !== 'string' ||
                pending.some((entry) => !entry.claimed)
              )
                throw new Problem(
                  502,
                  'dice_isolation',
                  'Antigravity did not complete one bounded private MCP turn'
                );
              const text = result.response.trim();
              const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(text);
              final = responseSchema.parse(JSON.parse(fenced ? fenced[1]! : text));
              completed = true;
            } else
              throw new Problem(
                502,
                'dice_isolation',
                'Antigravity emitted an unapproved native event'
              );
          },
        }),
      }
    );
    if (!completed)
      throw new Problem(
        502,
        'dice_protocol',
        'Antigravity ended before its complete native MCP final'
      );
    check();
    return final;
  } finally {
    controller.abort();
    notify();
    await endpoint.close();
    await cleanProfile(profile);
  }
}

async function cleanProfile(profile: string): Promise<void> {
  if (path.dirname(profile) !== os.tmpdir() || !path.basename(profile).startsWith(PROFILE_PREFIX))
    throw new Problem(
      500,
      'antigravity_cleanup',
      'Owned private profile cleanup path validation failed'
    );
  await rm(profile, { recursive: true, force: true });
}
