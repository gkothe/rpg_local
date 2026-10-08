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
import type { GameplayAdapter } from './gameplayTools.js';
import { traceEvent, logPrompt, type PromptTraceContext } from './promptLog.js';

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const FINISH = { Length: 'length', ContentFilter: 'content_filter', Error: 'error' } as const;

const toolCallSchema = z.object({
  id: z.string().min(1),
  type: z.literal('function'),
  function: z.object({ name: z.string().min(1), arguments: z.string() }),
});
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
  const conversation = adapter && new ApiConversation(adapter, signal);
  const instructions = instructionsWithSchema(systemPrompt, schema);
  if (adapter)
    await logPrompt('generateOpenRouterGameplay', settings, prompt, instructions, undefined, trace);
  // Native history keeps every returned assistant message verbatim (reasoning metadata included).
  const messages: unknown[] = [
    { role: 'system', content: instructions },
    { role: 'user', content: prompt },
  ];
  const total: ApiUsage = {};
  let usageSeen = true;
  let modelTurns = 0;
  // Sticky for the rest of the conversation once a fallback model has taken over.
  let model = settings.model;
  const remaining = [...(context.fallbackModels ?? [])];
  const send = async (): Promise<unknown> => {
    for (;;) {
      if (conversation) await conversation.beforeRequest();
      else if (signal?.aborted) throw new Problem(409, 'cancelled', 'Request cancelled');
      try {
        return await post();
      } catch (error) {
        if (
          !(error instanceof Problem) ||
          !FALLBACK_CODES.includes(error.code) ||
          !remaining.length
        )
          throw error;
        const next = remaining.shift()!;
        await traceEvent(trace, 'model_fallback', { from: model, to: next, code: error.code });
        withoutReasoning(messages);
        model = next;
      }
    }
  };
  const post = () =>
    postJson({
      provider: 'OpenRouter',
      url: OPENROUTER_URL,
      headers: { Authorization: `Bearer ${context.key}` },
      body: {
        model,
        messages,
        // No model fallback list and no provider that ignores supplied parameters.
        provider: { require_parameters: true },
        ...(conversation
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
      signal,
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
    addUsage(total, {
      inputTokens: usage?.prompt_tokens,
      outputTokens: usage?.completion_tokens,
      cacheReadTokens: usage?.prompt_tokens_details?.cached_tokens,
    });
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
      messages.push(message);
      for (const outcome of await conversation.run(calls))
        messages.push({
          role: 'tool',
          tool_call_id: outcome.call.id,
          content: JSON.stringify(outcome.payload),
        });
      continue;
    }
    const final = parseFinalJson(message.content ?? '', !!adapter);
    if (usageSeen) {
      await traceEvent(trace, 'usage', { ...total, modelTurns });
      adapter?.observe?.({ provider: 'openrouter', ...total, modelTurns });
    } else await traceEvent(trace, 'usage_unavailable', { provider: 'openrouter' });
    if (adapter) await traceEvent(trace, 'final', { response: final });
    return final;
  }
}
