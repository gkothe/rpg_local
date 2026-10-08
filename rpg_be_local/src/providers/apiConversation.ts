import { randomUUID } from 'node:crypto';
import { Problem } from '../errors.js';
import { nativeGameplaySchema } from './gameplayContract.js';
import type { GameplayAdapter, GameplayToolDefinition } from './gameplayTools.js';

export type ApiToolCall = { id: string; name: string; arguments: unknown };
export type ApiToolOutcome = { call: ApiToolCall; ok: boolean; payload: Record<string, unknown> };

/** Owned-tool errors the model can fix by changing arguments; anything else aborts the attempt. */
const CORRECTABLE_TOOL_ERRORS: readonly string[] = [
  'dice_input',
  'gameplay_arguments_invalid',
  'gameplay_tool_invalid',
  'gameplay_transport_conflict',
  'knowledge_not_found',
  'knowledge_cursor',
  'npc_not_found',
  'npc_cursor',
];

/** One generation conversation: sequential dispatch with namespaced transport ids. */
export class ApiConversation {
  private readonly namespace = randomUUID();
  constructor(
    private readonly adapter: GameplayAdapter,
    private readonly signal?: AbortSignal
  ) {
    if (!adapter.dispatch.assertActive)
      throw new Problem(
        503,
        'gameplay_registry',
        'API gameplay requires the ownership check from the owned tool registry'
      );
  }
  get definitions(): GameplayToolDefinition[] {
    return this.adapter.definitions;
  }
  /** Point-in-time check before every HTTP request; no transaction spans network work. */
  async beforeRequest(): Promise<void> {
    if (this.signal?.aborted) throw new Problem(409, 'cancelled', 'Request cancelled');
    await this.adapter.dispatch.assertActive!();
  }
  async run(calls: ApiToolCall[]): Promise<ApiToolOutcome[]> {
    const outcomes: ApiToolOutcome[] = [];
    for (const call of calls) {
      await this.beforeRequest();
      try {
        const result = await this.adapter.dispatch(
          call.name,
          call.arguments,
          `${this.namespace}:${call.id}`
        );
        outcomes.push({ call, ok: true, payload: result as Record<string, unknown> });
      } catch (error) {
        if (!(error instanceof Problem) || !CORRECTABLE_TOOL_ERRORS.includes(error.code))
          throw error;
        // A correctable rejection is returned to the model, but ownership loss still wins.
        await this.beforeRequest();
        outcomes.push({
          call,
          ok: false,
          payload: {
            error: `${error.code}: ${error.message}. Correct the arguments using the tool schema.`,
          },
        });
      }
    }
    return outcomes;
  }
}

/** Remove only the schema-dialect annotation; every constraint is kept. */
export function toolParameters(definition: GameplayToolDefinition): Record<string, unknown> {
  const { $schema: _dialect, ...schema } = definition.inputSchema;
  void _dialect;
  return schema;
}

export function instructionsWithSchema(systemPrompt: string, schema: unknown): string {
  return `${systemPrompt}\nReturn only one JSON object, with no markdown fence, matching this JSON Schema:\n${JSON.stringify(schema)}`;
}

/** Final text -> validated JSON object; empty or non-JSON output is an explicit failure. */
export function parseFinalJson(text: string, gameplay: boolean): unknown {
  const trimmed = text.trim();
  if (!trimmed) throw new Problem(502, 'invalid_response', 'The model returned no content');
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(trimmed);
  try {
    const value: unknown = JSON.parse(fenced ? fenced[1]! : trimmed);
    return gameplay ? nativeGameplaySchema().parse(value) : value;
  } catch {
    throw new Problem(502, 'provider_json', 'The model did not return the required JSON response');
  }
}

export type ApiUsage = { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number };
export function addUsage(total: ApiUsage, next: ApiUsage | undefined): void {
  if (!next) return;
  for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens'] as const)
    if (next[key] !== undefined) total[key] = (total[key] ?? 0) + next[key]!;
}
