import { cliFailure } from '../processingErrors.js';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Problem } from '../errors.js';
import { RULE_LIMITS, canonicalRuleJson, serializedBytes } from '../domain/rules.js';
import { BOOK_GAMEPLAY_NARRATOR } from '../domain/gameplayNarrator.js';
import { ruleResponseJsonSchema } from '../domain/ruleResponse.js';
import { diceResponseJsonSchema } from '../domain/diceResponse.js';
import { nativeGameplaySchema } from './gameplayContract.js';
import type { ProviderSettings } from '../domain/types.js';
import type { Executable } from './discovery.js';
import { generateAntigravity } from './antigravity.js';
import { antigravityDiceEnvironment } from './antigravityDice.js';
import { startGameplayMcp } from './gameplayMcp.js';
import { gameplayToolDefinitions, type BookGameplayAdapter } from './gameplayTools.js';
import { DICE_NARRATOR } from './diceProtocol.js';
import { logPrompt, traceEvent, safeTraceFailure, type PromptTraceContext } from './promptLog.js';
import { responseRetryFeedback } from '../domain/responseRetry.js';
import { setTimeout as delay } from 'node:timers/promises';

const MCP_SERVER = 'local_rpg';
const MCP_GATEWAY = 'call_mcp_tool';
const MCP_INVOCATION_GUIDANCE = `Invoke every owned tool through ${MCP_GATEWAY} with ServerName="${MCP_SERVER}", ToolName set to its registered name, and Arguments set to its argument object. Never invoke a registered tool name directly as a native function.`;
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
  selectedBook = true,
  trace?: PromptTraceContext
): Promise<unknown> {
  const profile = await mkdtemp(path.join(os.tmpdir(), PROFILE_PREFIX));
  const deadline = Infinity;
  const controller = new AbortController();
  const boundedSignal = AbortSignal.any([controller.signal, ...(signal ? [signal] : [])]);
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
      if (!initialized)
        throw new Problem(
          502,
          'dice_isolation',
          'Antigravity requested a tool before initialization'
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
  let generationFailure: unknown;
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
    const responseJsonSchema =
      book.schema ?? (selectedBook ? ruleResponseJsonSchema : diceResponseJsonSchema);
    const responseSchema = nativeGameplaySchema(book, selectedBook);
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
        trace,
        ownedProfile: profile,
        privateMcp: { name: MCP_SERVER, endpoint },
        agentPrompt:
          book.systemPrompt !== undefined
            ? `${book.systemPrompt}\nNative transport: use the real private ${MCP_SERVER} MCP tools. Do not emit simulated JSON tool requests. ${MCP_INVOCATION_GUIDANCE}\nOwned MCP argument schemas:${JSON.stringify(definitions)}`
            : `${selectedBook ? BOOK_GAMEPLAY_NARRATOR : DICE_NARRATOR} Use the real private ${MCP_SERVER} MCP tools. Do not emit simulated JSON tool requests. ${MCP_INVOCATION_GUIDANCE} This is one bounded logical game turn. The supplied frozen campaign context and application tool results are authoritative. Return only the complete final GM JSON.\nOwned MCP argument schemas:${JSON.stringify(definitions)}`,
        timeoutMs: 0,
        deadlineMs: deadline,
        maxOutputBytes: Infinity,
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
                  const validUsage =
                    Number.isInteger(input) &&
                    input! >= 0 &&
                    Number.isInteger(step.usage.output_tokens) &&
                    step.usage.output_tokens! >= 0 &&
                    Number.isInteger(step.step_index);
                  if (!validUsage)
                    await traceEvent(trace, 'usage_unavailable', { provider: 'agy' });
                  if (validUsage && !inferences.has(step.step_index!)) {
                    inferences.set(step.step_index!, input!);
                    await traceEvent(trace, 'usage', {
                      inputTokens: input,
                      outputTokens: step.usage.output_tokens,
                      cacheReadTokens: step.usage.cache_read_tokens,
                      phase: inferences.size - 1,
                    });
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
                const gateway = step.tool_name ?? step.tool_info?.name;
                if (
                  step.state === 'DONE' &&
                  gateway === MCP_GATEWAY &&
                  parameters === undefined &&
                  pending.some((entry) => entry.index === step.step_index && entry.claimed)
                ) {
                  // Completion metadata can omit arguments; only an already validated,
                  // dispatched tool step can complete without repeating its envelope.
                  return;
                }
                if (
                  gateway !== MCP_GATEWAY ||
                  parameters?.ServerName !== MCP_SERVER ||
                  !tools.includes(parameters?.ToolName ?? '')
                ) {
                  await traceEvent(trace, 'rejected_tool', { code: 'dice_isolation' });
                  const ownedDirectCall = typeof gateway === 'string' && tools.includes(gateway);
                  const recoverable = gateway === MCP_GATEWAY || ownedDirectCall;
                  throw new Problem(
                    502,
                    recoverable ? 'gameplay_tool_unavailable' : 'dice_isolation',
                    recoverable
                      ? `Antigravity ${ownedDirectCall ? `invoked permitted tool ${gateway} directly instead of through MCP` : 'requested an unavailable MCP tool'}. ${MCP_INVOCATION_GUIDANCE} Available tools: ${tools.join(', ')}. Match the supplied argument schema.`
                      : 'Antigravity attempted a tool outside its private MCP'
                  );
                }
                let input: unknown;
                try {
                  input =
                    typeof parameters.Arguments === 'string'
                      ? JSON.parse(parameters.Arguments)
                      : parameters.Arguments;
                } catch {
                  throw new Problem(
                    422,
                    'gameplay_tool_arguments',
                    `Arguments for ${parameters.ToolName} must be a valid JSON object matching its registered schema. ${MCP_INVOCATION_GUIDANCE}`
                  );
                }
                if (
                  !input ||
                  typeof input !== 'object' ||
                  Array.isArray(input) ||
                  serializedBytes(input) > RULE_LIMITS.requestBytes
                )
                  throw new Problem(
                    422,
                    'gameplay_tool_arguments',
                    `Arguments for ${parameters.ToolName} must be a JSON object matching its registered schema and owned request size. ${MCP_INVOCATION_GUIDANCE}`
                  );
                if (
                  step.state === 'DONE' &&
                  !pending.some(
                    (entry) =>
                      entry.index === step.step_index &&
                      entry.claimed &&
                      entry.key === `${parameters.ToolName}:${canonicalRuleJson(input)}`
                  )
                )
                  throw new Problem(
                    502,
                    'dice_isolation',
                    'Antigravity completed a tool without its matching dispatched request'
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
                  pending.push({
                    index: step.step_index!,
                    key: `${parameters.ToolName}:${canonicalRuleJson(input)}`,
                    claimed: false,
                  });
                  notify();
                }
              } else if (
                step.step_type === 'unknown' &&
                step.state === 'DONE' &&
                Number.isInteger(step.step_index) &&
                step.step_index! >= 0 &&
                Object.keys(step).every((key) =>
                  [
                    'conversation_id',
                    'step_index',
                    'state',
                    'step_type',
                    'duration_seconds',
                  ].includes(key)
                )
              ) {
                // The CLI emits an empty completion marker after tool continuation.
                // It grants no capability and carries no tool or response content.
              } else if (step.step_type !== 'user_input') {
                await traceEvent(trace, 'rejected_step', { code: 'provider_protocol' });
                throw new Problem(
                  502,
                  'dice_isolation',
                  `Antigravity emitted unapproved native activity (${typeof step.step_type === 'string' && /^[a-z_]{1,80}$/.test(step.step_type) ? step.step_type : 'unrecognized'})`
                );
              }
            } else if (event.event === 'result') {
              const result = event.result as {
                status?: string;
                num_turns?: number;
                response?: string;
                usage?: { input_tokens?: number };
              };
              const unclaimedCalls = pending.filter((entry) => !entry.claimed).length;
              await traceEvent(trace, 'native_completion', {
                initialized,
                alreadyCompleted: completed,
                success: result.status === 'SUCCESS',
                reportedTurns: Number.isInteger(result.num_turns) ? result.num_turns : null,
                hasResponse: typeof result.response === 'string',
                responseCharacters:
                  typeof result.response === 'string' ? result.response.length : null,
                unclaimedCalls,
              });
              if (initialized && !completed && result.status !== 'SUCCESS')
                throw cliFailure(typeof result.response === 'string' ? result.response : '');
              if (
                !initialized ||
                completed ||
                result.status !== 'SUCCESS' ||
                result.num_turns !== 1 ||
                typeof result.response !== 'string' ||
                unclaimedCalls > 0
              ) {
                const reason = !initialized
                  ? 'its private agent was not initialized'
                  : completed
                    ? 'it sent a duplicate completion'
                    : result.num_turns !== 1
                      ? `it reported ${Number.isInteger(result.num_turns) ? result.num_turns : 'no'} completed turns instead of one`
                      : typeof result.response !== 'string'
                        ? 'its final response was missing'
                        : 'a tool request was not dispatched';
                throw new Problem(
                  502,
                  'dice_isolation',
                  `Antigravity did not complete the turn: ${reason}`
                );
              }
              const text = result.response.trim();
              try {
                await logPrompt('antigravityFinalResponse', settings, text);
              } catch {
                if (trace?.trace) trace.trace.incomplete = true;
                console.error(
                  JSON.stringify({
                    event: 'prompt_trace_incomplete',
                    executionId: trace?.executionId,
                  })
                );
              }
              await traceEvent(trace, 'final', { response: text });
              const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(text);
              try {
                final = responseSchema.parse(JSON.parse(fenced ? fenced[1]! : text));
              } catch (error) {
                throw new Problem(
                  502,
                  'provider_json',
                  responseRetryFeedback(error) ?? 'Invalid final GM JSON'
                );
              }
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
  } catch (error) {
    await traceEvent(trace, 'failure', safeTraceFailure(error));
    generationFailure = error;
  } finally {
    controller.abort();
    notify();
    try {
      await endpoint.close();
    } catch (closeError) {
      if (generationFailure instanceof Error) generationFailure.cause = closeError;
      else generationFailure = closeError;
    }
    try {
      await cleanProfile(profile);
    } catch (cleanupError) {
      if (generationFailure instanceof Error) generationFailure.cause = cleanupError;
      else generationFailure = cleanupError;
    }
  }
  if (generationFailure !== undefined) throw generationFailure;
  return final;
}

const PROFILE_CLEANUP_RETRIES = 10;
const PROFILE_CLEANUP_RETRY_DELAY_MS = 250;
export async function cleanProfile(profile: string, remove: typeof rm = rm): Promise<void> {
  if (path.dirname(profile) !== os.tmpdir() || !path.basename(profile).startsWith(PROFILE_PREFIX))
    throw new Problem(
      500,
      'antigravity_cleanup',
      'Owned private profile cleanup path validation failed'
    );
  // The CLI's Windows updater can briefly retain a lock after stdout closes.
  // Retry only transient filesystem errors, within this validated owned profile.
  for (let attempt = 0; ; attempt++) {
    try {
      await remove(profile, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (
        attempt >= PROFILE_CLEANUP_RETRIES ||
        !['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(code ?? '')
      )
        throw error;
      await delay(PROFILE_CLEANUP_RETRY_DELAY_MS);
    }
  }
}
