import { cliFailure, finishProcessingCleanup } from '../processingErrors.js';
import { link, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { ProviderSettings } from '../domain/types.js';
import type { Executable } from './discovery.js';
import { Problem } from '../errors.js';
import { BOOK_GAMEPLAY_NARRATOR } from '../domain/gameplayNarrator.js';
import { nativeGameplaySchema } from './gameplayContract.js';

import {
  gameplayToolDefinitions,
  type BookGameplayAdapter,
  type GameplayToolResult,
} from './gameplayTools.js';
import {
  CODEX_TRANSPORT_SCHEMA,
  codexEnvironment,
  codexHome,
  inspectCodex,
  isolatedCodexConfig,
  parseCodexPayload,
} from './codex.js';
import {
  CODEX_DICE_RPC,
  CODEX_DICE_ITEM_TYPES,
  CODEX_DICE_REQUEST_ID,
  CODEX_DICE_STATUS,
  DICE_NARRATOR,
  DiceProtocol,
  type RollCallback,
} from './diceProtocol.js';
import { runProcess } from './processRunner.js';
import { logPrompt, traceEvent, safeTraceFailure, type PromptTraceContext } from './promptLog.js';

const rpcSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    method: z.string().optional(),
    params: z.record(z.string(), z.unknown()).optional(),
    result: z.record(z.string(), z.unknown()).optional(),
    error: z.unknown().optional(),
  })
  .passthrough();
const toolCallSchema = z
  .object({
    tool: z.string(),
    arguments: z.unknown(),
    callId: z.string(),
    threadId: z.string(),
    turnId: z.string(),
    namespace: z.string().nullish(),
  })
  .passthrough();

export async function generateCodexDice(
  executable: Executable,
  settings: ProviderSettings,
  prompt: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  roll: RollCallback,
  signal?: AbortSignal,
  book?: BookGameplayAdapter,
  trace?: PromptTraceContext
): Promise<unknown> {
  const narrator = book?.systemPrompt ?? (book ? BOOK_GAMEPLAY_NARRATOR : DICE_NARRATOR);
  const inspected = await inspectCodex(executable, env);
  const metadata = inspected.metadata as { models: { slug: string; context_window?: number }[] };
  const model = inspected.models.find((option) => option.id === settings.model);
  if (!model || (settings.effort && !model.efforts.includes(settings.effort)))
    throw new Problem(422, 'codex_model', 'Select a supported Codex model and effort');
  const home = codexHome(env);
  const isolatedHome = await mkdtemp(path.join(home, 'rpg-isolated-'));
  let failed = false;
  try {
    try {
      await link(path.join(home, 'auth.json'), path.join(isolatedHome, 'auth.json'));
    } catch {
      throw new Problem(
        503,
        'codex_auth_link',
        'Codex isolated subscription login needs native hardlink support'
      );
    }
    const catalogPath = path.join(cwd, 'codex-dice-models.json');
    const instructionsPath = path.join(cwd, 'codex-dice-instructions.txt');
    await writeFile(
      catalogPath,
      JSON.stringify({
        models: metadata.models.map((model) => ({
          ...model,
          base_instructions: book?.systemPrompt !== undefined ? '' : narrator,
          supports_parallel_tool_calls: false,
        })),
      })
    );
    await writeFile(
      instructionsPath,
      `${narrator} Return a transport object with payload_json encoding the application JSON.`
    );
    const config = {
      ...isolatedCodexConfig(catalogPath, instructionsPath),
    };
    return await runCodexDicePhases(
      executable,
      settings,
      prompt,
      cwd,
      { ...codexEnvironment(env), CODEX_HOME: isolatedHome },
      config,
      roll,
      signal,
      book,
      trace
    );
  } catch (error) {
    await traceEvent(trace, 'failure', safeTraceFailure(error));
    failed = true;
    throw error;
  } finally {
    await finishProcessingCleanup(() => cleanDiceHome(home, isolatedHome), failed);
  }
}
async function cleanDiceHome(home: string, isolatedHome: string): Promise<void> {
  if (
    path.dirname(isolatedHome) !== home ||
    !path.basename(isolatedHome).startsWith('rpg-isolated-')
  )
    throw new Problem(500, 'codex_cleanup', 'Isolated CLI cleanup path validation failed');
  await rm(isolatedHome, { recursive: true, force: true });
}
/** One ephemeral native thread per logical turn, with bounded owned tool continuations. */
export async function runCodexDicePhases(
  executable: Executable,
  settings: ProviderSettings,
  prompt: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  config: Record<string, unknown>,
  roll: RollCallback,
  signal?: AbortSignal,
  book?: BookGameplayAdapter,
  trace?: PromptTraceContext
): Promise<unknown> {
  const args = [...executable.prefix, 'app-server', '--stdio'];
  for (const [key, value] of Object.entries(config))
    args.push('-c', `${key}=${JSON.stringify(value)}`);
  const protocol = new DiceProtocol(roll);
  const transcript: { tool?: string; arguments: unknown; result: GameplayToolResult }[] = [];
  const definitions = book?.definitions ?? gameplayToolDefinitions(!!book);
  {
    let phase = 0;
    const phasePrompt =
      prompt +
      (book?.systemPrompt !== undefined
        ? ''
        : '\nApplication-owned gameplay transcript (already executed; do not repeat these calls): ' +
          JSON.stringify(transcript) +
          (book
            ? '\nUse the owned gameplay tools sequentially as needed. Return the final supplied schema response acknowledging every roll ID and any rule citations.'
            : '\nUse the owned roll tool sequentially as needed. Return the final schema response acknowledging every roll ID. No other tools or external context.'));
    let threadId = '';
    let turnId = '';
    let completed = false;
    const calls = new Map<string, string>();
    let final: unknown;
    await logPrompt(
      book ? 'generateCodexBookGameplay' : 'generateCodexGameplay',
      settings,
      phasePrompt,
      `${book?.systemPrompt ?? (book ? BOOK_GAMEPLAY_NARRATOR : DICE_NARRATOR)} Return a transport object with payload_json encoding the application JSON.`,
      undefined,
      trace
    );
    await runProcess(executable.binary, args, '', {
      cwd,
      env,
      signal,
      timeoutMs: 0,
      maxOutputBytes: Infinity,
      protocol: {
        start(send) {
          send({
            id: CODEX_DICE_REQUEST_ID.Initialize,
            method: CODEX_DICE_RPC.Initialize,
            params: {
              clientInfo: { name: 'local-rpg-dice', version: '1' },
              capabilities: { experimentalApi: true },
            },
          });
        },
        async line(raw, send, end) {
          const message = rpcSchema.parse(raw);
          if (message.error) throw cliFailure(JSON.stringify(message.error));
          if (message.id === CODEX_DICE_REQUEST_ID.Initialize && message.result) {
            send({ method: CODEX_DICE_RPC.Initialized, params: {} });
            send({
              id: CODEX_DICE_REQUEST_ID.Thread,
              method: CODEX_DICE_RPC.ThreadStart,
              params: {
                model: settings.model,
                cwd,
                approvalPolicy: 'never',
                sandbox: 'read-only',
                ephemeral: true,
                dynamicTools: definitions.map((definition) => ({
                  type: 'function',
                  ...definition,
                })),
              },
            });
          } else if (message.id === CODEX_DICE_REQUEST_ID.Thread && message.result) {
            threadId = z.object({ thread: z.object({ id: z.string() }) }).parse(message.result)
              .thread.id;
            send({
              id: CODEX_DICE_REQUEST_ID.Turn,
              method: CODEX_DICE_RPC.TurnStart,
              params: {
                threadId,
                input: [{ type: 'text', text: phasePrompt }],
                outputSchema: CODEX_TRANSPORT_SCHEMA,
                ...(settings.effort ? { effort: settings.effort } : {}),
              },
            });
          } else if (message.id === CODEX_DICE_REQUEST_ID.Turn && message.result) {
            turnId = z.object({ turn: z.object({ id: z.string() }) }).parse(message.result).turn.id;
          } else if (message.method === CODEX_DICE_RPC.ToolCall) {
            const call = toolCallSchema.parse(message.params);
            if (
              !threadId ||
              call.namespace ||
              call.threadId !== threadId ||
              (turnId && call.turnId !== turnId) ||
              message.id === undefined ||
              !definitions.some((definition) => definition.name === call.tool)
            )
              throw new Problem(
                502,
                'dice_isolation',
                'Codex requested an unapproved or concurrent dice capability'
              );
            const identity = JSON.stringify({ tool: call.tool, arguments: call.arguments });
            if (calls.has(call.callId) && calls.get(call.callId) !== identity)
              throw new Problem(409, 'gameplay_transport_conflict', 'Native tool identity changed');
            calls.set(call.callId, identity);
            let result: GameplayToolResult;
            try {
              result = await (book ? book.dispatch : protocol.call.bind(protocol))(
                call.tool,
                call.arguments,
                call.callId
              );
            } catch (error) {
              if (
                !(error instanceof Problem) ||
                ![
                  'dice_input',
                  'gameplay_arguments_invalid',
                  'knowledge_not_found',
                  'knowledge_cursor',
                  'npc_not_found',
                  'npc_cursor',
                ].includes(error.code)
              )
                throw error;
              send({
                id: message.id,
                result: {
                  contentItems: [
                    {
                      type: 'inputText',
                      text: `${error.code}: ${error.message}. Correct the arguments using the owned tool schema; use a new callId.`,
                    },
                  ],
                  success: false,
                },
              });
              return;
            }
            transcript.push({
              ...(book ? { tool: call.tool } : {}),
              arguments: call.arguments,
              result,
            });
            // Installed app-server DynamicToolCallResponse schema: text content + success.
            send({
              id: message.id,
              result: {
                contentItems: [{ type: 'inputText', text: JSON.stringify(result) }],
                success: true,
              },
            });
          } else if (message.id !== undefined && message.method) {
            throw new Problem(502, 'dice_isolation', 'Codex requested an unapproved capability');
          } else if (message.method === CODEX_DICE_RPC.TokenUsage) {
            const usage = z
              .object({
                threadId: z.string(),
                tokenUsage: z.object({
                  last: z.object({
                    inputTokens: z.number().int().nonnegative(),
                    outputTokens: z.number().int().nonnegative().optional(),
                    cachedInputTokens: z.number().int().nonnegative().optional(),
                  }),
                }),
              })
              .safeParse(message.params);
            const owner = z.object({ threadId: z.string() }).parse(message.params);
            if (owner.threadId !== threadId)
              throw new Problem(
                502,
                'dice_isolation',
                'Codex reported token usage for a foreign thread'
              );
            if (!usage.success) {
              await traceEvent(trace, 'usage_unavailable', { provider: 'codex' });
              return;
            }
            await traceEvent(trace, 'usage', {
              inputTokens: usage.data.tokenUsage.last.inputTokens,
              outputTokens: usage.data.tokenUsage.last.outputTokens,
              cacheReadTokens: usage.data.tokenUsage.last.cachedInputTokens,
              phase,
            });
            book?.observe?.({
              provider: 'codex',
              phase,
              inputTokens: usage.data.tokenUsage.last.inputTokens,
              outputTokens: usage.data.tokenUsage.last.outputTokens,
              cacheReadTokens: usage.data.tokenUsage.last.cachedInputTokens,
            });
            phase++;
          } else if (message.method === CODEX_DICE_RPC.TurnCompleted) {
            const result = z
              .object({
                threadId: z.string(),
                turn: z.object({
                  id: z.string(),
                  status: z.enum([CODEX_DICE_STATUS.Completed, CODEX_DICE_STATUS.Interrupted]),
                  items: z.array(z.record(z.string(), z.unknown())),
                }),
              })
              .parse(message.params);
            if (
              completed ||
              result.threadId !== threadId ||
              (turnId && result.turn.id !== turnId) ||
              result.turn.status !== CODEX_DICE_STATUS.Completed
            )
              throw new Problem(502, 'codex_protocol', 'Codex returned an unexpected dice phase');
            if (
              result.turn.items.some(
                (item) =>
                  typeof item.type !== 'string' ||
                  !(CODEX_DICE_ITEM_TYPES as readonly string[]).includes(item.type)
              )
            )
              throw new Problem(
                502,
                'dice_isolation',
                'Codex completed with an unapproved capability'
              );
            {
              const messages = result.turn.items.filter(
                (item) => item.type === CODEX_DICE_ITEM_TYPES[0]
              );
              if (messages.length !== 1 || typeof messages[0]?.text !== 'string')
                throw new Problem(
                  502,
                  'provider_json',
                  'Codex did not return one complete application response'
                );
              final = parseCodexPayload(messages[0].text);
            }
            completed = true;
            end();
          } else if (
            message.method === CODEX_DICE_RPC.ItemStarted ||
            message.method === CODEX_DICE_RPC.ItemCompleted
          ) {
            const item = message.params?.item as { type?: string } | undefined;
            if (item?.type && !(CODEX_DICE_ITEM_TYPES as readonly string[]).includes(item.type))
              throw new Problem(
                502,
                'dice_isolation',
                'Codex invoked a capability outside the dice boundary'
              );
          }
        },
      },
    });
    if (!completed)
      throw new Problem(502, 'provider_protocol', 'Codex closed before completing its dice phase');
    const validated = nativeGameplaySchema(book, !!book).parse(final);
    await traceEvent(trace, 'final', { response: validated });
    return validated;
  }
}
