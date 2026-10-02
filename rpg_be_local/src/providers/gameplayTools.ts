import { z } from 'zod';
import { DICE_LIMITS, DICE_TOOL_NAME, diceInputSchema, type DiceResult } from '../domain/dice.js';
import { RULE_TOOLS, RULE_LIMITS, serializedBytes, type RuleTool } from '../domain/rules.js';
import { ruleToolSchemas } from '../services/ruleLookup.js';
import { Problem } from '../errors.js';
export type GameplayToolResult = DiceResult | Record<string, unknown>;
export type GameplayToolDispatch = (
  name: string,
  input: unknown,
  requestId: string | number
) => Promise<GameplayToolResult>;
export type GameplayToolDefinition = {
  name: string;
  description: string;
  inputSchema: { type: 'object'; [key: string]: unknown };
};
export type GameplayNativeUsage = {
  provider: string;
  phase?: number;
  inputTokens?: number;
  outputTokens?: number;
  contextWindow?: number;
  modelTurns?: number;
};
export type BookGameplayAdapter = {
  dispatch: GameplayToolDispatch;
  observe?: (usage: GameplayNativeUsage) => void;
};
export const VERIFIED_BOOK_LIMITS = {
  ruleCalls: 12,
  diceCalls: 12,
  combinedCalls: 24,
  promptBytes: 8000,
} as const;
export type BookGameplayLimits = {
  ruleCalls: number;
  diceCalls: number;
  combinedCalls: number;
  promptBytes: number;
};
export function gameplayToolDefinitions(book: boolean): GameplayToolDefinition[] {
  const definitions: GameplayToolDefinition[] = [
    {
      name: DICE_TOOL_NAME,
      description:
        'Request genuine persisted dice faces. Declare known modifiers/targets before sequential slots.',
      inputSchema: z.toJSONSchema(diceInputSchema, {
        unrepresentable: 'any',
      }) as GameplayToolDefinition['inputSchema'],
    },
  ];
  if (book)
    for (const name of RULE_TOOLS)
      definitions.push({
        name,
        description:
          name === 'rules_get'
            ? 'Read bounded direct original text or derived fields. Only direct text receipts support citations.'
            : 'Discover current rule paths and derived navigation metadata. Results are not ruling authority.',
        inputSchema: z.toJSONSchema(ruleToolSchemas[name], {
          unrepresentable: 'any',
        }) as GameplayToolDefinition['inputSchema'],
      });
  return definitions;
}
export class GameplayTools {
  readonly definitions: GameplayToolDefinition[];
  private calls = 0;
  private ruleCalls = 0;
  private diceCalls = 0;
  private ruleBytes = 0;
  private diceBytes = 0;
  private readonly receipts = new Map<string, { identity: string; result: GameplayToolResult }>();
  private tail: Promise<void> = Promise.resolve();
  constructor(
    readonly options: {
      book: boolean;
      roll: (input: unknown, requestId: string | number) => Promise<DiceResult>;
      read?: (
        tool: RuleTool,
        input: unknown,
        requestId: string
      ) => Promise<Record<string, unknown>>;
      assertActive: () => Promise<void>;
      signal?: AbortSignal;
      limits?: BookGameplayLimits;
    }
  ) {
    if (options.book && !options.read)
      throw new Error('Book gameplay requires persisted rule reads');
    this.definitions = gameplayToolDefinitions(options.book);
  }
  call: GameplayToolDispatch = (name, input, requestId) => {
    const work = this.tail.then(() => this.dispatch(name, input, requestId));
    this.tail = work.then(
      () => undefined,
      () => undefined
    );
    return work;
  };
  private async dispatch(
    name: string,
    input: unknown,
    requestId: string | number
  ): Promise<GameplayToolResult> {
    if (this.options.signal?.aborted)
      throw new Problem(409, 'cancelled', 'Gameplay attempt cancelled');
    await this.options.assertActive();
    if (!this.definitions.some((definition) => definition.name === name))
      throw new Problem(
        422,
        'gameplay_tool_invalid',
        'Tool is outside the owned gameplay registry'
      );
    const key = JSON.stringify(requestId);
    const identity = JSON.stringify({ name, input });
    const existing = this.receipts.get(key);
    if (existing) {
      if (existing.identity !== identity)
        throw new Problem(
          409,
          'gameplay_transport_conflict',
          'Transport identity reused with changed tool arguments'
        );
      return existing.result;
    }
    if (this.calls >= (this.options.limits?.combinedCalls ?? RULE_LIMITS.combinedCalls))
      throw new Problem(422, 'gameplay_calls_exhausted', 'Combined gameplay call limit exhausted');
    const rule = name !== DICE_TOOL_NAME;
    if (
      rule
        ? this.ruleCalls >= (this.options.limits?.ruleCalls ?? RULE_LIMITS.calls)
        : this.diceCalls >= (this.options.limits?.diceCalls ?? DICE_LIMITS.requestsPerAttempt)
    )
      throw new Problem(422, 'gameplay_calls_exhausted', 'Gameplay tool call limit exhausted');
    this.calls++;
    if (rule) this.ruleCalls++;
    else this.diceCalls++;
    const result = rule
      ? await this.options.read!(name as RuleTool, input, key)
      : await this.options.roll(input, requestId);
    const bytes = serializedBytes({ tool: name, arguments: input, result });
    if (
      rule
        ? this.ruleBytes + bytes > RULE_LIMITS.transcriptBytes
        : this.diceBytes + bytes > DICE_LIMITS.transcriptBytes
    )
      throw new Problem(
        422,
        'gameplay_transcript_exhausted',
        'Gameplay transcript byte limit exhausted'
      );
    if (rule) this.ruleBytes += bytes;
    else this.diceBytes += bytes;
    if (this.options.signal?.aborted)
      throw new Problem(409, 'cancelled', 'Gameplay attempt cancelled');
    this.receipts.set(key, { identity, result });
    return result;
  }
}
