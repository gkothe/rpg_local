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

export const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const FINISH_STOP = 'STOP';
const FINISH_TRUNCATED = 'MAX_TOKENS';

const partSchema = z
  .object({
    text: z.string().optional(),
    thought: z.boolean().optional(),
    functionCall: z
      .object({ id: z.string().optional(), name: z.string().min(1), args: z.unknown().optional() })
      .passthrough()
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

async function runGeminiPhase(
  context: GeminiContext,
  settings: ProviderSettings,
  contents: unknown[],
  phase: {
    prompt: string;
    schema: unknown;
    systemPrompt: string;
    tools?: GameplayToolDispatch;
    trace?: PromptTraceContext;
    adapterObserve?: GameplayAdapter['observe'];
  },
  options: {
    totalUsage: ApiUsage;
    phaseNumber: number;
    logGameplayPrompt?: boolean;
    signal?: AbortSignal;
  }
): Promise<unknown> {
  const instructions = instructionsWithSchema(phase.systemPrompt, phase.schema);
  const phaseTrace = phase.trace;
  if (options.logGameplayPrompt)
    await logPrompt(
      'generateGeminiApiGameplay',
      settings,
      phase.prompt,
      instructions,
      undefined,
      phaseTrace
    );
  contents.push({ role: 'user', parts: [{ text: phase.prompt }] });
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
  for (;;) {
    if (conversation) await conversation.beforeRequest();
    else if (options.signal?.aborted) throw new Problem(409, 'cancelled', 'Request cancelled');
    const data = responseSchema.safeParse(
      await postJson({
        provider: 'Gemini API',
        url: `${GEMINI_URL}/${encodeURIComponent(settings.model)}:generateContent`,
        headers: { 'x-goog-api-key': context.key },
        body: {
          systemInstruction: { parts: [{ text: instructions }] },
          contents,
          ...(conversation && conversation.definitions.length
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
        signal: options.signal,
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
    const currentUsage = {
      inputTokens: usage?.promptTokenCount,
      outputTokens:
        usage?.candidatesTokenCount === undefined
          ? undefined
          : usage.candidatesTokenCount + (usage.thoughtsTokenCount ?? 0),
      cacheReadTokens: usage?.cachedContentTokenCount,
    };
    addUsage(options.totalUsage, currentUsage);
    addUsage(phaseUsage, currentUsage);
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
        id: call.id ?? `call-${options.phaseNumber}-${modelTurns}-${index}`,
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
    contents.push(candidate.content);
    const text = candidate.content.parts
      .filter((part) => !part.thought)
      .map((part) => part.text ?? '')
      .join('');
    const final = parseFinalJson(text, !!phase.tools);
    if (usageSeen) {
      await traceEvent(phaseTrace, 'usage', { ...phaseUsage, modelTurns });
      phaseAdapter?.observe?.({ provider: 'gemini-api', ...phaseUsage, modelTurns });
    } else await traceEvent(phaseTrace, 'usage_unavailable', { provider: 'gemini-api' });
    if (phase.tools) await traceEvent(phaseTrace, 'final', { response: final });
    if (options.phaseNumber > 0)
      await traceEvent(phaseTrace, 'session_phase_complete', {
        phase: options.phaseNumber,
        durationMs: Date.now() - phaseStartedAt,
      });
    return final;
  }
}

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
  const contents: unknown[] = [];
  const totalUsage: ApiUsage = {};
  return runGeminiPhase(
    context,
    settings,
    contents,
    {
      prompt,
      schema,
      systemPrompt,
      tools: adapter?.dispatch,
      trace,
      adapterObserve: adapter?.observe,
    },
    {
      totalUsage,
      phaseNumber: 0,
      logGameplayPrompt: !!adapter,
      signal,
    }
  );
}

export function createGeminiSession(
  context: GeminiContext,
  settings: ProviderSettings,
  signal?: AbortSignal,
  trace?: PromptTraceContext
): GameplaySession & { close: () => void } {
  const contents: unknown[] = [];
  const totalUsage: ApiUsage = {};
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
        const result = await runGeminiPhase(
          context,
          settings,
          contents,
          {
            prompt: phase.prompt,
            schema: phase.schema,
            systemPrompt: phase.systemPrompt,
            tools: phase.tools,
            trace: phase.trace ?? trace,
          },
          {
            totalUsage,
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
