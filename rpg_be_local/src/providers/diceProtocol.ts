import { z } from 'zod';
import { DICE_LIMITS, DICE_TOOL_NAME, diceInputSchema, type DiceResult } from '../domain/dice.js';
import { Problem } from '../errors.js';

// Claude reserves 25 outputs of 2048 tokens plus bounded prompt/tool history.
// Codex interrupts each tool phase and starts with a fresh bounded application transcript.
// No automatic compaction is allowed inside the turn. Existing no-tools calls retain their limits.
export const DICE_CLI_LIMITS = {
  contextTokens: 128_000,
  modelOutputTokens: 2048,
  modelTurns: DICE_LIMITS.requestsPerAttempt + 1,
  protocolBytes: 2_000_000,
  codexPhaseInputBytes: 32_000,
} as const;
export { DICE_NARRATOR } from '../domain/dice.js';
export const diceToolSchema = z.toJSONSchema(diceInputSchema, { unrepresentable: 'any' });
export type RollCallback = (input: unknown, requestId: string | number) => Promise<DiceResult>;
export const CODEX_DICE_RPC = {
  Initialize: 'initialize',
  Initialized: 'initialized',
  ThreadStart: 'thread/start',
  TurnStart: 'turn/start',
  ToolCall: 'item/tool/call',
  TokenUsage: 'thread/tokenUsage/updated',
  TurnCompleted: 'turn/completed',
  ItemStarted: 'item/started',
  ItemCompleted: 'item/completed',
  TurnInterrupt: 'turn/interrupt',
} as const;
export const CODEX_DICE_ITEM_TYPES = [
  'agentMessage',
  'userMessage',
  'reasoning',
  'dynamicToolCall',
] as const;
export const CODEX_DICE_REQUEST_ID = { Initialize: 1, Thread: 2, Turn: 3, Interrupt: 4 } as const;
export const CODEX_DICE_STATUS = { Completed: 'completed', Interrupted: 'interrupted' } as const;
export const CLAUDE_DICE_EVENT = {
  System: 'system',
  Assistant: 'assistant',
  Result: 'result',
} as const;
export const CLAUDE_DICE_SUBTYPE = { Init: 'init', Success: 'success' } as const;
export const CLAUDE_DICE_SERVER_STATUS = { Connected: 'connected' } as const;
export const CLAUDE_DICE_CONTENT_TYPE = { ToolUse: 'tool_use' } as const;

/** Receipt reuse is transport idempotency; persistent slot reuse is owned by DiceService. */
export class DiceProtocol {
  private calls = 0;
  private receipts = new Map<string, { input: string; result: DiceResult }>();
  constructor(private readonly roll: RollCallback) {}
  async call(name: string, input: unknown, requestId: string | number): Promise<DiceResult> {
    if (name !== DICE_TOOL_NAME)
      throw new Problem(502, 'dice_isolation', 'CLI attempted a tool outside the dice boundary');
    if (++this.calls > DICE_LIMITS.requestsPerAttempt)
      throw new Problem(422, 'dice_limit', 'Dice request limit exceeded');
    const parsed = diceInputSchema.safeParse(input);
    if (!parsed.success)
      throw new Problem(422, 'dice_input', 'CLI supplied invalid dice arguments');
    const key = JSON.stringify(requestId);
    const encoded = JSON.stringify(parsed.data);
    const previous = this.receipts.get(key);
    if (previous) {
      if (previous.input !== encoded)
        throw new Problem(409, 'dice_rpc_identity', 'CLI reused a tool request with changed input');
      return previous.result;
    }
    const result = await this.roll(parsed.data, requestId);
    this.receipts.set(key, { input: encoded, result });
    return result;
  }
}
