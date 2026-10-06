import { z } from 'zod';
import { cliFailure, finishProcessingCleanup } from '../processingErrors.js';
import type { Executable } from './discovery.js';
import type { ProviderSettings } from '../domain/types.js';
import { Problem } from '../errors.js';
import { runProcess } from './processRunner.js';
import { logPrompt, traceEvent, safeTraceFailure, type PromptTraceContext } from './promptLog.js';
import { startGameplayMcp } from './gameplayMcp.js';
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
  trace?: PromptTraceContext
): Promise<unknown> {
  const names = adapter.definitions.map((definition) => `mcp__dice__${definition.name}`);
  const isolated = claudeDiceEnvironment(env);
  const endpoint = await startGameplayMcp(adapter.definitions, adapter.dispatch, signal);
  let failed = false;
  try {
    const config = JSON.stringify({
      mcpServers: { dice: { type: 'http', url: endpoint.url, headers: endpoint.headers } },
    });
    let initialized = false;
    let completed = false;
    let final: unknown;
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
        '--tools',
        '',
        '--allowedTools',
        names.join(','),
        '--disable-slash-commands',
        '--strict-mcp-config',
        '--mcp-config',
        config,
        '--no-chrome',
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
          start(_send, end) {
            end(prompt);
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
                servers[0]?.status !== CLAUDE_DICE_SERVER_STATUS.Connected
              )
                throw new Problem(
                  502,
                  'dice_isolation',
                  'Claude did not start with the exclusive dice capability'
                );
              initialized = true;
            } else if (event.type === CLAUDE_DICE_EVENT.Assistant) {
              const message = event.message as { content?: { type: string; name?: string }[] };
              for (const item of message?.content ?? [])
                if (
                  item.type === CLAUDE_DICE_CONTENT_TYPE.ToolUse &&
                  !names.includes(item.name ?? '')
                )
                  throw new Problem(502, 'dice_isolation', 'Claude attempted an unapproved tool');
            } else if (event.type === CLAUDE_DICE_EVENT.Result) {
              if (!initialized || completed)
                throw new Problem(
                  502,
                  'dice_isolation',
                  'Claude returned an unowned or repeated final result'
                );
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
                adapter.observe?.({
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
              completed = true;
            }
          },
        },
      }
    );
    if (!completed)
      throw new Problem(502, 'provider_protocol', 'Claude closed before completing the dice turn');
    const validated = nativeGameplaySchema().parse(final);
    await traceEvent(trace, 'final', { response: validated });
    return validated;
  } catch (error) {
    await traceEvent(trace, 'failure', safeTraceFailure(error));
    failed = true;
    throw error;
  } finally {
    await finishProcessingCleanup(() => endpoint.close(), failed);
  }
}
