import { z } from 'zod';
import { cliFailure, finishProcessingCleanup } from '../processingErrors.js';
import type { Executable } from './discovery.js';
import type { ProviderSettings } from '../domain/types.js';
import { Problem } from '../errors.js';
import { runProcess } from './processRunner.js';
import { logPrompt, traceEvent, safeTraceFailure, type PromptTraceContext } from './promptLog.js';
import { startGameplayMcp } from './gameplayMcp.js';
import {
  type GameplaySessionBridge,
  assertPhaseToolsCompatible,
  assertPhaseToolAuthority,
} from './gameplaySession.js';
import { randomUUID } from 'node:crypto';
import { type GameplayAdapter } from './gameplayTools.js';
import { nativeGameplaySchema } from './gameplayContract.js';

const CLAUDE_DICE_EVENT = { System: 'system', Assistant: 'assistant', Result: 'result' } as const;
const CLAUDE_DICE_SUBTYPE = { Init: 'init', Success: 'success' } as const;
const CLAUDE_DICE_SERVER_STATUS = { Connected: 'connected' } as const;
const CLAUDE_DICE_CONTENT_TYPE = { ToolUse: 'tool_use' } as const;

// Tested evidence baseline only; version differences produce a warning, never a gate.
export const CLAUDE_DICE_VERSION = '2.1.232';
export function claudeDiceEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...source };
  for (const key of Object.keys(env))
    if (
      /^CLAUDE_CODE_|^ANTHROPIC_|^MCP_|^MAX_THINKING_TOKENS$|^MAX_STRUCTURED_OUTPUT_RETRIES$|API_KEY|AUTH_TOKEN|OAUTH_TOKEN/i.test(
        key
      )
    )
      delete env[key];
  return {
    ...env,
    CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1',
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
    CLAUDE_CODE_DISABLE_ORG_MEMORY: '1',
    CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS: '1',
  };
}
export async function generateClaudeDice(
  executable: Executable,
  settings: ProviderSettings,
  prompt: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  adapter: GameplayAdapter,
  signal?: AbortSignal,
  trace?: PromptTraceContext,
  session?: GameplaySessionBridge
): Promise<unknown> {
  const definitions = adapter.definitions;
  const names = definitions.map((definition) => `mcp__dice__${definition.name}`);
  let active = adapter;
  let phaseNumber = 1;
  let completed = false;
  const sessionId = randomUUID();
  const isolated = claudeDiceEnvironment(env);
  const endpoint = await startGameplayMcp(
    definitions,
    async (tool, input, rpcId) => {
      assertPhaseToolAuthority(tool, active.definitions, completed);
      const stableRpcId = rpcId !== undefined && rpcId !== '' ? rpcId : randomUUID();
      const callId = session ? `claude:phase:${phaseNumber}:call:${stableRpcId}` : stableRpcId;
      return active.dispatch(tool, input, callId);
    },
    signal
  );
  let failed = false;
  try {
    const config = JSON.stringify({
      mcpServers: { dice: { type: 'http', url: endpoint.url, headers: endpoint.headers } },
    });
    let initialized = false;
    let final: unknown;
    const consumedResultUuids = new Set<string>();
    await logPrompt(
      'generateClaudeGameplay',
      settings,
      prompt,
      adapter.systemPrompt,
      undefined,
      trace
    );
    await runProcess(
      executable.binary,
      [
        ...executable.prefix,
        '-p',
        '--setting-sources',
        '',
        '--settings',
        '{"disableAllHooks":true,"enabledPlugins":{}}',
        '--permission-mode',
        'dontAsk',
        '--no-session-persistence',
        '--session-id',
        sessionId,
        '--tools',
        '',
        '--allowedTools',
        names.join(','),
        '--disable-slash-commands',
        '--strict-mcp-config',
        '--mcp-config',
        config,
        '--no-chrome',
        ...(session ? ['--input-format', 'stream-json'] : []),
        '--output-format',
        'stream-json',
        '--verbose',
        '--model',
        settings.model,
        ...(settings.effort ? ['--effort', settings.effort] : []),
        '--system-prompt',
        adapter.systemPrompt,
      ],
      '',
      {
        cwd,
        env: isolated,
        signal,
        timeoutMs: 0,
        maxOutputBytes: Infinity,
        protocol: {
          start(send, end) {
            if (!session) {
              end(prompt);
              return;
            }
            session.attach(
              (next) => {
                if (!completed)
                  throw new Problem(409, 'gameplay_phase', 'Previous GM phase is incomplete');
                assertPhaseToolsCompatible(definitions, next.tools.definitions);
                active = {
                  dispatch: next.tools,
                  definitions: next.tools.definitions ?? [],
                  schema: next.schema,
                  systemPrompt: next.systemPrompt,
                };
                trace = next.trace;
                completed = false;
                phaseNumber++;
                const serializedSchema = JSON.stringify(next.schema);
                const schemaInstruction = next.prompt.includes(serializedSchema)
                  ? ''
                  : `\nApplication schema: ${serializedSchema}`;
                send({
                  type: 'user',
                  message: {
                    content: `${next.systemPrompt}\n${next.prompt}${schemaInstruction}\nReturn only valid JSON matching the application schema.`,
                  },
                });
              },
              () => end()
            );
            send({
              type: 'user',
              message: { content: prompt },
            });
          },
          async line(raw) {
            const event = raw as Record<string, unknown>;
            if (
              event.type === CLAUDE_DICE_EVENT.System &&
              event.subtype === CLAUDE_DICE_SUBTYPE.Init
            ) {
              const tools = event.tools as unknown[];
              const servers = event.mcp_servers as { name: string; status: string }[];
              if (
                initialized ||
                !Array.isArray(tools) ||
                tools.length !== names.length ||
                tools.some((tool) => typeof tool !== 'string' || !names.includes(tool)) ||
                new Set(tools).size !== names.length ||
                !Array.isArray(servers) ||
                servers.length !== 1 ||
                servers[0]?.name !== 'dice' ||
                servers[0]?.status !== CLAUDE_DICE_SERVER_STATUS.Connected ||
                typeof event.session_id !== 'string' ||
                event.session_id !== sessionId
              )
                throw new Problem(
                  502,
                  'dice_isolation',
                  'Claude did not start with the exclusive dice capability'
                );
              initialized = true;
            } else if (event.type === CLAUDE_DICE_EVENT.Assistant) {
              if (
                !initialized ||
                completed ||
                typeof event.session_id !== 'string' ||
                event.session_id !== sessionId
              ) {
                throw new Problem(
                  502,
                  'dice_isolation',
                  'Claude emitted an unowned assistant event'
                );
              }
              const message = event.message as { content?: { type: string; name?: string }[] };
              for (const item of message?.content ?? [])
                if (item.type === CLAUDE_DICE_CONTENT_TYPE.ToolUse) {
                  if (!names.includes(item.name ?? ''))
                    throw new Problem(502, 'dice_isolation', 'Claude attempted an unapproved tool');
                  const toolName = (item.name ?? '').replace(/^mcp__dice__/, '');
                  assertPhaseToolAuthority(toolName, active.definitions, completed);
                }
            } else if (event.type === CLAUDE_DICE_EVENT.Result) {
              if (
                !initialized ||
                completed ||
                typeof event.session_id !== 'string' ||
                event.session_id !== sessionId ||
                typeof event.uuid !== 'string' ||
                !event.uuid ||
                consumedResultUuids.has(event.uuid)
              )
                throw new Problem(
                  502,
                  'dice_isolation',
                  'Claude returned an unowned or repeated final result'
                );
              consumedResultUuids.add(event.uuid);
              if (event.is_error || event.subtype !== CLAUDE_DICE_SUBTYPE.Success)
                throw cliFailure(typeof event.result === 'string' ? event.result : '');
              if (
                typeof event.result !== 'string' ||
                !Number.isInteger(event.num_turns) ||
                (event.num_turns as number) < 1
              )
                throw new Problem(
                  502,
                  'provider_protocol',
                  `Claude did not complete a bounded dice conversation (${typeof event.subtype === 'string' && /^[a-z_]{1,80}$/.test(event.subtype) ? event.subtype : 'invalid result'}; turns=${Number.isInteger(event.num_turns) ? event.num_turns : 'unreported'}; error=${event.is_error === true}; category=${typeof event.result === 'string' && /hit your limit|usage limit|rate limit/i.test(event.result) ? 'subscription_limit' : 'unclassified'})`
                );
              const telemetry = z
                .record(
                  z.string(),
                  z.object({
                    contextWindow: z.number().positive().optional(),
                    outputTokens: z.number().nonnegative().optional(),
                    cacheReadInputTokens: z.number().int().nonnegative().optional(),
                  })
                )
                .safeParse(event.modelUsage);
              const text = event.result.trim();
              if (telemetry.success) {
                const usage = telemetry.data;
                const models = Object.values(usage);
                await traceEvent(trace, 'usage', { models: usage, modelTurns: event.num_turns });
                active.observe?.({
                  provider: 'claude',
                  contextWindow:
                    models.length && models.every((value) => value.contextWindow !== undefined)
                      ? Math.min(...models.map((value) => value.contextWindow!))
                      : undefined,
                  outputTokens:
                    models.length && models.every((value) => value.outputTokens !== undefined)
                      ? models.reduce((total, value) => total + value.outputTokens!, 0)
                      : undefined,
                  modelTurns: event.num_turns as number,
                  cacheReadTokens:
                    models.length &&
                    models.every((value) => value.cacheReadInputTokens !== undefined)
                      ? models.reduce((total, value) => total + value.cacheReadInputTokens!, 0)
                      : undefined,
                });
              } else {
                await traceEvent(trace, 'usage_unavailable', { provider: 'claude' });
              }
              const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(text);
              final = JSON.parse(fenced ? fenced[1]! : text);
              if (
                typeof final === 'object' &&
                final !== null &&
                'payload_json' in final &&
                typeof (final as { payload_json: unknown }).payload_json === 'string'
              ) {
                final = JSON.parse((final as { payload_json: string }).payload_json);
              }
              completed = true;
              const validated = nativeGameplaySchema().parse(final);
              await traceEvent(trace, 'final', { response: validated });
              if (session) {
                session.complete(validated);
              }
            }
          },
        },
      }
    );
    if (!completed)
      throw new Problem(502, 'provider_protocol', 'Claude closed before completing the dice turn');
    session?.fail(new Problem(409, 'gm_session_lost', 'Claude conversation ended'));
    if (
      typeof final === 'object' &&
      final !== null &&
      'payload_json' in final &&
      typeof (final as { payload_json: unknown }).payload_json === 'string'
    ) {
      final = JSON.parse((final as { payload_json: string }).payload_json);
    }
    const validated = nativeGameplaySchema().parse(final);
    await traceEvent(trace, 'final', { response: validated });
    return validated;
  } catch (error) {
    await traceEvent(trace, 'failure', safeTraceFailure(error));
    session?.fail(error);
    failed = true;
    throw error;
  } finally {
    await finishProcessingCleanup(() => endpoint.close(), failed);
  }
}
