import { link, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { ProviderSettings } from '../domain/types.js';
import type { Executable } from './discovery.js';
import { Problem } from '../errors.js';
import { DICE_LIMITS, DICE_TOOL_NAME, type DiceResult } from '../domain/dice.js';
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
  DICE_CLI_LIMITS,
  DICE_NARRATOR,
  DiceProtocol,
  diceToolSchema,
  type RollCallback,
} from './diceProtocol.js';
import { runProcess } from './processRunner.js';

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
    tool: z.literal(DICE_TOOL_NAME),
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
  signal?: AbortSignal
): Promise<unknown> {
  const inspected = await inspectCodex(executable, env);
  const metadata = inspected.metadata as { models: { slug: string; context_window?: number }[] };
  const model = inspected.models.find((option) => option.id === settings.model);
  const contextWindow = metadata.models.find(
    (option) => option.slug === settings.model
  )?.context_window;
  if (!model || (settings.effort && !model.efforts.includes(settings.effort)))
    throw new Problem(422, 'codex_model', 'Select a supported Codex model and effort');
  if (!contextWindow || contextWindow < DICE_CLI_LIMITS.contextTokens)
    throw new Problem(503, 'dice_context', 'Codex model lacks a verified dice continuation budget');
  const home = codexHome(env);
  const isolatedHome = await mkdtemp(path.join(home, 'rpg-isolated-'));
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
          base_instructions: DICE_NARRATOR,
          supports_parallel_tool_calls: false,
        })),
      })
    );
    await writeFile(
      instructionsPath,
      `${DICE_NARRATOR} Return a transport object with payload_json encoding the application JSON.`
    );
    const config = {
      ...isolatedCodexConfig(catalogPath, instructionsPath),
      model_context_window: DICE_CLI_LIMITS.contextTokens,
      model_auto_compact_token_limit: DICE_CLI_LIMITS.contextTokens,
    };
    return await runCodexDicePhases(
      executable,
      settings,
      prompt,
      cwd,
      { ...codexEnvironment(env), CODEX_HOME: isolatedHome },
      config,
      roll,
      signal
    );
  } finally {
    await cleanDiceHome(home, isolatedHome);
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
/** Each native phase ends before tool reply, so hidden model history cannot grow. */
export async function runCodexDicePhases(
  executable: Executable,
  settings: ProviderSettings,
  prompt: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  config: Record<string, unknown>,
  roll: RollCallback,
  signal?: AbortSignal
): Promise<unknown> {
  const args = [...executable.prefix, 'app-server', '--stdio'];
  for (const [key, value] of Object.entries(config))
    args.push('-c', `${key}=${JSON.stringify(value)}`);
  const protocol = new DiceProtocol(roll);
  const transcript: { arguments: unknown; result: DiceResult }[] = [];
  const deadline = Date.now() + DICE_LIMITS.attemptMs;
  let outputBytes = 0;
  for (let phase = 0; phase < DICE_CLI_LIMITS.modelTurns; phase++) {
    const phasePrompt =
      prompt +
      '\nApplication-owned dice transcript (already executed; do not request these slots again): ' +
      JSON.stringify(transcript) +
      '\nRequest at most ONE next roll in this phase. Otherwise return the final schema response acknowledging every roll ID. No other tools or external context.';
    if (
      Buffer.byteLength(phasePrompt, 'utf8') > DICE_CLI_LIMITS.codexPhaseInputBytes ||
      Date.now() >= deadline ||
      outputBytes >= DICE_CLI_LIMITS.protocolBytes
    )
      throw new Problem(
        422,
        'context_overflow',
        'Codex dice phase exceeds its reserved context or time budget'
      );
    let threadId = '';
    let turnId = '';
    let completed = false;
    let called = false;
    let final: unknown;
    await runProcess(executable.binary, args, '', {
      cwd,
      env,
      signal,
      timeoutMs: deadline - Date.now(),
      maxOutputBytes: DICE_CLI_LIMITS.protocolBytes - outputBytes,
      onOutputBytes(bytes) {
        outputBytes += bytes;
      },
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
          if (message.error)
            throw new Problem(502, 'codex_protocol', 'Codex rejected the isolated dice phase');
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
                dynamicTools: [
                  {
                    type: 'function',
                    name: DICE_TOOL_NAME,
                    description:
                      'Persist trusted dice faces only. Request one roll, then the application provides a fresh bounded phase.',
                    inputSchema: diceToolSchema,
                  },
                ],
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
              called ||
              !threadId ||
              call.namespace ||
              call.threadId !== threadId ||
              (turnId && call.turnId !== turnId) ||
              message.id === undefined
            )
              throw new Problem(
                502,
                'dice_isolation',
                'Codex requested an unapproved or concurrent dice capability'
              );
            called = true;
            const result = await protocol.call(
              call.tool,
              call.arguments,
              `${phase}:${call.callId}`
            );
            transcript.push({ arguments: call.arguments, result });
            // Never reply to the pending dynamic call: that would allow a hidden continuation.
            // The next fresh phase receives this exact application-owned result instead.
            send({
              id: CODEX_DICE_REQUEST_ID.Interrupt,
              method: CODEX_DICE_RPC.TurnInterrupt,
              params: { threadId: call.threadId, turnId: call.turnId },
            });
          } else if (message.id !== undefined && message.method) {
            throw new Problem(502, 'dice_isolation', 'Codex requested an unapproved capability');
          } else if (message.method === CODEX_DICE_RPC.TokenUsage) {
            const usage = z
              .object({
                threadId: z.string(),
                tokenUsage: z.object({ last: z.object({ inputTokens: z.number() }) }),
              })
              .parse(message.params);
            if (
              usage.threadId !== threadId ||
              usage.tokenUsage.last.inputTokens > DICE_CLI_LIMITS.contextTokens
            )
              throw new Problem(
                422,
                'context_overflow',
                'Codex dice phase exceeded its context budget'
              );
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
              result.turn.status !==
                (called ? CODEX_DICE_STATUS.Interrupted : CODEX_DICE_STATUS.Completed)
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
            if (!called) {
              const messages = result.turn.items.filter(
                (item) => item.type === CODEX_DICE_ITEM_TYPES[0]
              );
              if (messages.length !== 1 || typeof messages[0]?.text !== 'string')
                throw new Problem(
                  502,
                  'codex_protocol',
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
      throw new Problem(502, 'codex_protocol', 'Codex closed before completing its dice phase');
    if (!called) return final;
    if (Buffer.byteLength(JSON.stringify(transcript), 'utf8') > DICE_LIMITS.transcriptBytes)
      throw new Problem(
        422,
        'dice_limit',
        'Codex dice transcript exceeded its reserved byte allowance'
      );
  }
  throw new Problem(
    422,
    'dice_limit',
    'Codex exhausted its bounded dice phases before a final response'
  );
}
