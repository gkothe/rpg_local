import { z } from 'zod';
import { Problem } from '../errors.js';
import type { ProviderSettings } from '../domain/types.js';
import { postJson, type ApiFetch } from './apiHttp.js';
import {
  ApiConversation,
  addUsage,
  instructionsWithSchema,
  parseFinalJson,
  toolParameters,
  type ApiToolCall,
  type ApiUsage,
} from './apiConversation.js';
import type { GameplayAdapter, GameplayToolDispatch } from './gameplayTools.js';
import type { GameplayPhase, GameplaySession } from './gameplaySession.js';
import { traceEvent, logPrompt, type PromptTraceContext } from './promptLog.js';

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const FINISH = { Length: 'length', ContentFilter: 'content_filter', Error: 'error' } as const;

const toolCallSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal('function'),
    function: z.object({ name: z.string().min(1), arguments: z.string() }).passthrough(),
  })
  .passthrough();
const responseSchema = z
  .object({
    error: z.unknown().optional(),
    choices: z
      .array(
        z
          .object({
            finish_reason: z.string().nullable().optional(),
            message: z
              .object({
                content: z.string().nullable().optional(),
                refusal: z.string().nullable().optional(),
                tool_calls: z.array(toolCallSchema).optional(),
              })
              .passthrough(),
          })
          .passthrough()
      )
      .min(1),
    usage: z
      .object({
        prompt_tokens: z.number().optional(),
        completion_tokens: z.number().optional(),
        prompt_tokens_details: z.object({ cached_tokens: z.number().optional() }).optional(),
      })
      .optional(),
  })
  .passthrough();

/** Availability failures only: quality or request-shape failures are not hidden by switching models. */
const FALLBACK_CODES: readonly string[] = [
  'provider_quota',
  'model_unavailable',
  'provider_failure',
  'provider_network',
];
const REASONING_FIELDS = ['reasoning', 'reasoning_details', 'reasoning_content'] as const;

export type OpenRouterContext = {
  key: string;
  fetchImpl?: ApiFetch;
  /** Administrator-ordered models after the selected one, tried in order on availability failures. */
  fallbackModels?: readonly string[];
};

/** Reasoning metadata belongs to the model that produced it; drop it before another model reads it. */
function withoutReasoning(messages: unknown[]): void {
  for (const message of messages)
    if (message && typeof message === 'object')
      for (const field of REASONING_FIELDS) delete (message as Record<string, unknown>)[field];
}

type OpenRouterSessionState = {
  messages: unknown[];
  model: string;
  remaining: string[];
  totalUsage: ApiUsage;
};

async function runOpenRouterPhase(
  context: OpenRouterContext,
  settings: ProviderSettings,
  state: OpenRouterSessionState,
  phase: {
    prompt: string;
    schema: unknown;
    systemPrompt: string;
    tools?: GameplayToolDispatch;
    trace?: PromptTraceContext;
    adapterObserve?: GameplayAdapter['observe'];
  },
  options: {
    phaseNumber: number;
    logGameplayPrompt?: boolean;
    signal?: AbortSignal;
  }
): Promise<unknown> {
  const instructions = instructionsWithSchema(phase.systemPrompt, phase.schema);
  const phaseTrace = phase.trace;
  if (options.logGameplayPrompt)
    await logPrompt(
      'generateOpenRouterGameplay',
      settings,
      phase.prompt,
      instructions,
      undefined,
      phaseTrace
    );
  if (options.phaseNumber <= 1) {
    state.messages.push({ role: 'system', content: instructions });
    state.messages.push({ role: 'user', content: phase.prompt });
  } else {
    state.messages[0] = { role: 'system', content: instructions };
    state.messages.push({ role: 'user', content: phase.prompt });
  }
  const phaseAdapter: GameplayAdapter | undefined = phase.tools
    ? {
        dispatch: phase.tools,
        definitions: phase.tools.definitions ?? [],
        schema: phase.schema,
        systemPrompt: phase.systemPrompt,
        observe: phase.adapterObserve,
      }
    : undefined;
  const conversation = phaseAdapter && new ApiConversation(phaseAdapter, options.signal);
  let usageSeen = true;
  let modelTurns = 0;
  const phaseUsage: ApiUsage = {};
  const phaseStartedAt = Date.now();

  const send = async (): Promise<unknown> => {
    for (;;) {
      if (conversation) await conversation.beforeRequest();
      else if (options.signal?.aborted) throw new Problem(409, 'cancelled', 'Request cancelled');
      try {
        return await post();
      } catch (error) {
        if (
          !(error instanceof Problem) ||
          !FALLBACK_CODES.includes(error.code) ||
          !state.remaining.length
        )
          throw error;
        const next = state.remaining.shift()!;
        await traceEvent(phaseTrace, 'model_fallback', {
          from: state.model,
          to: next,
          code: error.code,
        });
        withoutReasoning(state.messages);
        state.model = next;
      }
    }
  };

  const post = () =>
    postJson({
      provider: 'OpenRouter',
      url: OPENROUTER_URL,
      headers: { Authorization: `Bearer ${context.key}` },
      body: {
        model: state.model,
        messages: state.messages,
        provider: { require_parameters: true },
        ...(conversation && conversation.definitions.length
          ? {
              tools: conversation.definitions.map((definition) => ({
                type: 'function',
                function: {
                  name: definition.name,
                  description: definition.description,
                  parameters: toolParameters(definition),
                },
              })),
            }
          : { response_format: { type: 'json_object' } }),
      },
      signal: options.signal,
      fetchImpl: context.fetchImpl,
    });

  for (;;) {
    const data = responseSchema.safeParse(await send());
    if (!data.success)
      throw new Problem(502, 'invalid_response', 'OpenRouter returned an unexpected response');
    if (data.data.error !== undefined)
      throw new Problem(502, 'provider_failure', 'OpenRouter reported an error for this request');
    modelTurns++;
    const usage = data.data.usage;
    if (usage?.prompt_tokens === undefined && usage?.completion_tokens === undefined)
      usageSeen = false;
    const currentUsage = {
      inputTokens: usage?.prompt_tokens,
      outputTokens: usage?.completion_tokens,
      cacheReadTokens: usage?.prompt_tokens_details?.cached_tokens,
    };
    addUsage(state.totalUsage, currentUsage);
    addUsage(phaseUsage, currentUsage);
    const choice = data.data.choices[0]!;
    const message = choice.message;
    if (choice.finish_reason === FINISH.Length)
      throw new Problem(502, 'provider_truncated', 'The model output was cut off');
    if (choice.finish_reason === FINISH.ContentFilter || message.refusal)
      throw new Problem(502, 'provider_refused', 'The model refused or filtered the response');
    if (choice.finish_reason === FINISH.Error)
      throw new Problem(502, 'provider_failure', 'OpenRouter ended the response with an error');
    if (message.tool_calls?.length) {
      if (!conversation)
        throw new Problem(
          502,
          'provider_isolation',
          'The model requested a tool during a no-tools generation'
        );
      const calls: ApiToolCall[] = message.tool_calls.map((call) => {
        try {
          return {
            id: call.id,
            name: call.function.name,
            arguments: call.function.arguments.trim() ? JSON.parse(call.function.arguments) : {},
          };
        } catch {
          throw new Problem(502, 'invalid_response', 'The model sent unreadable tool arguments');
        }
      });
      state.messages.push(message);
      for (const outcome of await conversation.run(calls))
        state.messages.push({
          role: 'tool',
          tool_call_id: outcome.call.id,
          content: JSON.stringify(outcome.payload),
        });
      continue;
    }
    state.messages.push(message);
    const final = parseFinalJson(message.content ?? '', !!phase.tools);
    if (usageSeen) {
      await traceEvent(phaseTrace, 'usage', { ...phaseUsage, modelTurns });
      phaseAdapter?.observe?.({ provider: 'openrouter', ...phaseUsage, modelTurns });
    } else await traceEvent(phaseTrace, 'usage_unavailable', { provider: 'openrouter' });
    if (phase.tools) await traceEvent(phaseTrace, 'final', { response: final });
    if (options.phaseNumber > 0)
      await traceEvent(phaseTrace, 'session_phase_complete', {
        phase: options.phaseNumber,
        durationMs: Date.now() - phaseStartedAt,
      });
    return final;
  }
}

/** Ordinary (adapter undefined) or owned-tool generation against OpenRouter Chat Completions. */
export async function generateOpenRouter(
  context: OpenRouterContext,
  settings: ProviderSettings,
  prompt: string,
  schema: unknown,
  systemPrompt: string,
  adapter: GameplayAdapter | undefined,
  signal?: AbortSignal,
  trace?: PromptTraceContext
): Promise<unknown> {
  const state: OpenRouterSessionState = {
    messages: [],
    model: settings.model,
    remaining: [...(context.fallbackModels ?? [])],
    totalUsage: {},
  };
  return runOpenRouterPhase(
    context,
    settings,
    state,
    {
      prompt,
      schema,
      systemPrompt,
      tools: adapter?.dispatch,
      trace,
      adapterObserve: adapter?.observe,
    },
    {
      phaseNumber: 0,
      logGameplayPrompt: !!adapter,
      signal,
    }
  );
}

export function createOpenRouterSession(
  context: OpenRouterContext,
  settings: ProviderSettings,
  signal?: AbortSignal,
  trace?: PromptTraceContext
): GameplaySession & { close: () => void } {
  const state: OpenRouterSessionState = {
    messages: [],
    model: settings.model,
    remaining: [...(context.fallbackModels ?? [])],
    totalUsage: {},
  };
  let phaseNumber = 0;
  let running = false;
  let closed = false;
  let failure: unknown;
  return {
    async runPhase(phase: GameplayPhase): Promise<unknown> {
      if (failure) throw failure;
      if (closed) throw new Problem(409, 'gm_session_lost', 'GM conversation is closed');
      if (running) throw new Problem(409, 'gameplay_phase', 'A GM phase is already running');
      running = true;
      phaseNumber++;
      try {
        const result = await runOpenRouterPhase(
          context,
          settings,
          state,
          {
            prompt: phase.prompt,
            schema: phase.schema,
            systemPrompt: phase.systemPrompt,
            tools: phase.tools,
            trace: phase.trace ?? trace,
          },
          {
            phaseNumber,
            logGameplayPrompt: phaseNumber === 1,
            signal,
          }
        );
        return result;
      } catch (error) {
        if (!(
          error instanceof Problem && ['provider_json', 'invalid_response'].includes(error.code)
        )) {
          failure = error;
          closed = true;
        }
        throw error;
      } finally {
        running = false;
      }
    },
    close() {
      closed = true;
    },
  };
}
