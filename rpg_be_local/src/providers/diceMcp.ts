import { z } from 'zod';
import { DICE_TOOL_NAME, diceInputSchema, type DiceResult } from '../domain/dice.js';
import { startGameplayMcp, type GameplayMcpEndpoint } from './gameplayMcp.js';
import { createHash } from 'node:crypto';
import { Problem } from '../errors.js';
export type DiceMcpEndpoint = GameplayMcpEndpoint;
export async function startDiceMcp(
  roll: (input: unknown, rpcId: string | number) => Promise<DiceResult>,
  signal?: AbortSignal
): Promise<DiceMcpEndpoint> {
  const receipts = new Map<string, { digest: string; result: DiceResult }>();
  return startGameplayMcp(
    [
      {
        name: DICE_TOOL_NAME,
        description:
          'Generate and persist random dice faces only. Declare known modifiers and target first. Request sequential slots starting at 0. All game randomness must use this tool.',
        inputSchema: z.toJSONSchema(diceInputSchema, { unrepresentable: 'any' }) as {
          type: 'object';
        },
      },
    ],
    async (name, input, id) => {
      const key = JSON.stringify(id);
      const digest = createHash('sha256')
        .update(JSON.stringify({ name, arguments: input }))
        .digest('hex');
      const prior = receipts.get(key);
      if (prior) {
        if (prior.digest !== digest)
          throw new Problem(
            409,
            'dice_rpc_identity',
            'MCP request identity was reused with changed dice input'
          );
        return prior.result;
      }
      const result = await roll(input, id);
      receipts.set(key, { digest, result });
      return result;
    },
    signal
  );
}
