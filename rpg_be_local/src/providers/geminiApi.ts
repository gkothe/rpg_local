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

export const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const FINISH_STOP = 'STOP';
const FINISH_TRUNCATED = 'MAX_TOKENS';

const partSchema = z
  .object({
    text: z.string().optional(),
    thought: z.boolean().optional(),
    functionCall: z
      .object({ id: z.string().optional(), name: z.string().min(1), args: z.unknown().optional() })
      .optional(),
  })
  .passthrough();
const responseSchema = z
  .object({
    promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
    candidates: z
      .array(
        z
          .object({
            content: z
              .object({ role: z.string().optional(), parts: z.array(partSchema).optional() })
              .passthrough()
              .optional(),
            finishReason: z.string().optional(),
          })
          .passthrough()
      )
      .optional(),
    usageMetadata: z
      .object({
        promptTokenCount: z.number().optional(),
        candidatesTokenCount: z.number().optional(),
        thoughtsTokenCount: z.number().optional(),
        cachedContentTokenCount: z.number().optional(),
      })
      .optional(),
  })
  .passthrough();

export type GeminiContext = { key: string; fetchImpl?: ApiFetch };

/** Ordinary (adapter undefined) or owned-tool generation against Gemini generateContent. */
export async function generateGemini(
  context: GeminiContext,
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
    await logPrompt('generateGeminiApiGameplay', settings, prompt, instructions, undefined, trace);
  // Candidate content is replayed verbatim so thought signatures and call ids survive.
  const contents: unknown[] = [{ role: 'user', parts: [{ text: prompt }] }];
  const total: ApiUsage = {};
  let usageSeen = true;
  let modelTurns = 0;
  for (;;) {
    if (conversation) await conversation.beforeRequest();
    else if (signal?.aborted) throw new Problem(409, 'cancelled', 'Request cancelled');
    const data = responseSchema.safeParse(
      await postJson({
        provider: 'Gemini API',
        url: `${GEMINI_URL}/${encodeURIComponent(settings.model)}:generateContent`,
        headers: { 'x-goog-api-key': context.key },
        body: {
          systemInstruction: { parts: [{ text: instructions }] },
          contents,
          ...(conversation
            ? {
                tools: [
                  {
                    functionDeclarations: conversation.definitions.map((definition) => ({
                      name: definition.name,
                      description: definition.description,
                      parametersJsonSchema: toolParameters(definition),
                    })),
                  },
                ],
              }
            : { generationConfig: { responseMimeType: 'application/json' } }),
        },
        signal,
        fetchImpl: context.fetchImpl,
      })
    );
    if (!data.success)
      throw new Problem(502, 'invalid_response', 'Gemini API returned an unexpected response');
    if (data.data.promptFeedback?.blockReason)
      throw new Problem(502, 'provider_refused', 'Gemini API blocked the prompt');
    const candidate = data.data.candidates?.[0];
    if (!candidate?.content?.parts?.length)
      throw new Problem(
        502,
        candidate?.finishReason && candidate.finishReason !== FINISH_STOP
          ? 'provider_refused'
          : 'invalid_response',
        'Gemini API returned no content'
      );
    if (candidate.finishReason === FINISH_TRUNCATED)
      throw new Problem(502, 'provider_truncated', 'The model output was cut off');
    if (candidate.finishReason && candidate.finishReason !== FINISH_STOP)
      throw new Problem(502, 'provider_refused', 'Gemini API did not complete the response');
    modelTurns++;
    const usage = data.data.usageMetadata;
    if (usage?.promptTokenCount === undefined && usage?.candidatesTokenCount === undefined)
      usageSeen = false;
    addUsage(total, {
      inputTokens: usage?.promptTokenCount,
      outputTokens:
        usage?.candidatesTokenCount === undefined
          ? undefined
          : usage.candidatesTokenCount + (usage.thoughtsTokenCount ?? 0),
      cacheReadTokens: usage?.cachedContentTokenCount,
    });
    const nativeCalls = candidate.content.parts.flatMap((part) =>
      part.functionCall ? [part.functionCall] : []
    );
    if (nativeCalls.length) {
      if (!conversation)
        throw new Problem(
          502,
          'provider_isolation',
          'The model requested a tool during a no-tools generation'
        );
      const calls: ApiToolCall[] = nativeCalls.map((call, index) => ({
        id: call.id ?? `call-${modelTurns}-${index}`,
        name: call.name,
        arguments: call.args ?? {},
      }));
      contents.push(candidate.content);
      const outcomes = await conversation.run(calls);
      contents.push({
        role: 'user',
        parts: outcomes.map((outcome, index) => ({
          functionResponse: {
            name: outcome.call.name,
            ...(nativeCalls[index]!.id ? { id: nativeCalls[index]!.id } : {}),
            response: outcome.ok ? { output: outcome.payload } : outcome.payload,
          },
        })),
      });
      continue;
    }
    const text = candidate.content.parts
      .filter((part) => !part.thought)
      .map((part) => part.text ?? '')
      .join('');
    const final = parseFinalJson(text, !!adapter);
    if (usageSeen) {
      await traceEvent(trace, 'usage', { ...total, modelTurns });
      adapter?.observe?.({ provider: 'gemini-api', ...total, modelTurns });
    } else await traceEvent(trace, 'usage_unavailable', { provider: 'gemini-api' });
    if (adapter) await traceEvent(trace, 'final', { response: final });
    return final;
  }
}
