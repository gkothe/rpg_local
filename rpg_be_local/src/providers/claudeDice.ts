import type { Executable } from './discovery.js';
import type { ProviderSettings } from '../domain/types.js';
import { Problem } from '../errors.js';
import { DICE_LIMITS, DICE_TOOL_NAME } from '../domain/dice.js';
import {
  DICE_CLI_LIMITS,
  DICE_NARRATOR,
  DiceProtocol,
  type RollCallback,
  CLAUDE_DICE_EVENT,
  CLAUDE_DICE_SUBTYPE,
  CLAUDE_DICE_SERVER_STATUS,
  CLAUDE_DICE_CONTENT_TYPE,
} from './diceProtocol.js';
import { startDiceMcp } from './diceMcp.js';
import { runProcess } from './processRunner.js';
import { startGameplayMcp } from './gameplayMcp.js';
import { gameplayToolDefinitions, type BookGameplayAdapter } from './gameplayTools.js';
import { BOOK_GAMEPLAY_NARRATOR } from '../domain/gameplayNarrator.js';
import { ruleResponseSchema } from '../domain/ruleResponse.js';
import { diceResponseSchema } from '../domain/diceResponse.js';

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
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(DICE_CLI_LIMITS.modelOutputTokens),
    CLAUDE_CODE_MAX_CONTEXT_TOKENS: String(DICE_CLI_LIMITS.contextTokens),
    CLAUDE_CODE_MAX_RETRIES: '0',
    DISABLE_COMPACT: '1',
  };
}
export async function generateClaudeDice(
  executable: Executable,
  settings: ProviderSettings,
  prompt: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  roll: RollCallback,
  signal?: AbortSignal,
  book?: BookGameplayAdapter
): Promise<unknown> {
  const names = gameplayToolDefinitions(!!book).map(
    (definition) => `mcp__dice__${definition.name}`
  );
  const isolated = claudeDiceEnvironment(env);
  const version = await runProcess(executable.binary, [...executable.prefix, '--version'], '', {
    env: isolated,
    cwd,
    timeoutMs: 8000,
    maxOutputBytes: 10000,
  });
  if (!version.startsWith(CLAUDE_DICE_VERSION + ' '))
    throw new Problem(
      503,
      'claude_dice_version',
      `Claude dice isolation requires verified CLI ${CLAUDE_DICE_VERSION}`
    );
  const protocol = new DiceProtocol(roll);
  const endpoint = book
    ? await startGameplayMcp(gameplayToolDefinitions(true), book.dispatch, signal)
    : await startDiceMcp((input, id) => protocol.call(DICE_TOOL_NAME, input, id), signal);
  try {
    const config = JSON.stringify({
      mcpServers: { dice: { type: 'http', url: endpoint.url, headers: endpoint.headers } },
    });
    let initialized = false;
    let completed = false;
    let final: unknown;
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
        '--max-turns',
        String(DICE_CLI_LIMITS.modelTurns),
        '--system-prompt',
        book ? BOOK_GAMEPLAY_NARRATOR : DICE_NARRATOR,
      ],
      '',
      {
        cwd,
        env: isolated,
        signal,
        timeoutMs: DICE_LIMITS.attemptMs,
        maxOutputBytes: DICE_CLI_LIMITS.protocolBytes,
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
              if (
                !initialized ||
                completed ||
                event.subtype !== CLAUDE_DICE_SUBTYPE.Success ||
                event.is_error ||
                typeof event.result !== 'string' ||
                !Number.isInteger(event.num_turns) ||
                (event.num_turns as number) < 1 ||
                (event.num_turns as number) > DICE_CLI_LIMITS.modelTurns
              )
                throw new Problem(
                  502,
                  'claude_dice_result',
                  'Claude did not complete a bounded dice conversation'
                );
              const usage = event.modelUsage as Record<
                string,
                { contextWindow?: number; outputTokens?: number }
              >;
              if (
                !usage ||
                !Object.keys(usage).length ||
                !Object.values(usage).every(
                  (value) =>
                    typeof value.contextWindow === 'number' &&
                    value.contextWindow >= DICE_CLI_LIMITS.contextTokens &&
                    typeof value.outputTokens === 'number' &&
                    value.outputTokens >= 0 &&
                    value.outputTokens <=
                      DICE_CLI_LIMITS.modelTurns * DICE_CLI_LIMITS.modelOutputTokens
                ) ||
                Object.values(usage).reduce(
                  (total, value) => total + (value.outputTokens ?? 0),
                  0
                ) >
                  DICE_CLI_LIMITS.modelTurns * DICE_CLI_LIMITS.modelOutputTokens
              )
                throw new Problem(
                  502,
                  'dice_context',
                  'Claude did not report a verified dice continuation budget'
                );
              const text = event.result.trim();
              book?.observe?.({
                provider: 'claude',
                contextWindow: Math.min(
                  ...Object.values(usage).map((value) => value.contextWindow!)
                ),
                outputTokens: Object.values(usage).reduce(
                  (total, value) => total + value.outputTokens!,
                  0
                ),
                modelTurns: event.num_turns as number,
              });
              const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(text);
              final = JSON.parse(fenced ? fenced[1]! : text);
              completed = true;
            }
          },
        },
      }
    );
    if (!completed)
      throw new Problem(502, 'claude_dice_result', 'Claude closed before completing the dice turn');
    return (book ? ruleResponseSchema : diceResponseSchema).parse(final);
  } finally {
    await endpoint.close();
  }
}
