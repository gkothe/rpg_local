import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { DICE_LIMITS, DICE_TOOL_NAME, diceInputSchema, type DiceResult } from '../domain/dice.js';
import { Problem } from '../errors.js';

const RPC_ENVELOPE_BYTES = 512;
const CAPABILITY_BYTES = 32;
const HTTP_REQUEST_TIMEOUT_MS = 10_000;
export type DiceMcpEndpoint = {
  url: string;
  headers: { Authorization: string };
  close(): Promise<void>;
};

export async function startDiceMcp(
  roll: (input: unknown, rpcId: string | number) => Promise<DiceResult>,
  signal?: AbortSignal
): Promise<DiceMcpEndpoint> {
  const authorization = `Bearer ${randomBytes(CAPABILITY_BYTES).toString('hex')}`;
  const expectedAuthorization = Buffer.from(authorization);
  let closed = false;
  let closing: Promise<void> | undefined;
  let queue: Promise<void> = Promise.resolve();
  let requests = 0;
  const deadline = Date.now() + DICE_LIMITS.attemptMs;
  const transports = new Set<StreamableHTTPServerTransport>();
  const receipts = new Map<string, { digest: string; result: DiceResult }>();
  const http = createServer(async (req, res) => {
    const supplied = Buffer.from(req.headers.authorization ?? '');
    if (
      supplied.length !== expectedAuthorization.length ||
      !timingSafeEqual(supplied, expectedAuthorization)
    ) {
      res.writeHead(401).end();
      return;
    }
    if (
      req.headers.origin ||
      req.headers.host !== new URL(endpoint.url).host ||
      req.url !== '/mcp'
    ) {
      res.writeHead(403).end();
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST' }).end();
      return;
    }
    let body: unknown;
    let rpcId: string | number = '';
    try {
      const buffers: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += Buffer.byteLength(chunk);
        if (bytes > DICE_LIMITS.inputBytes + RPC_ENVELOPE_BYTES) {
          res.writeHead(413).end();
          return;
        }
        buffers.push(Buffer.from(chunk));
      }
      body = JSON.parse(Buffer.concat(buffers).toString('utf8'));
      if (typeof body !== 'object' || body === null || Array.isArray(body)) {
        res.writeHead(400).end();
        return;
      }
      const message = body as Record<string, unknown>;
      if (typeof message.id === 'string' || typeof message.id === 'number') rpcId = message.id;
      const mcp = new Server(
        { name: 'local-rpg-dice', version: '1' },
        { capabilities: { tools: {} } }
      );
      mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
        tools: [
          {
            name: DICE_TOOL_NAME,
            description:
              'Generate and persist random dice faces only. Declare known modifiers and target first. Request sequential slots starting at 0. All game randomness must use this tool.',
            inputSchema: z.toJSONSchema(diceInputSchema, { unrepresentable: 'any' }) as {
              type: 'object';
            },
          },
        ],
      }));
      mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
        requests++;
        const work = queue.then(async () => {
          if (closed || signal?.aborted || Date.now() >= deadline)
            throw new Problem(409, 'cancelled', 'Dice attempt is no longer active');
          if (requests > DICE_LIMITS.requestsPerAttempt)
            throw new Problem(422, 'dice_limit', 'Dice request limit exceeded');
          if (request.params.name !== DICE_TOOL_NAME)
            throw new Problem(422, 'dice_tool', 'Only roll_dice is available');
          if (
            Buffer.byteLength(JSON.stringify(request.params.arguments ?? {}), 'utf8') >
            DICE_LIMITS.inputBytes
          )
            throw new Problem(422, 'dice_limit', 'Dice input exceeds byte limit');
          const key = JSON.stringify(rpcId);
          const digest = createHash('sha256').update(JSON.stringify(request.params)).digest('hex');
          const previous = receipts.get(key);
          if (previous) {
            if (previous.digest !== digest)
              throw new Problem(
                409,
                'dice_rpc_identity',
                'MCP request identity was reused with changed dice input'
              );
            return previous.result;
          }
          const result = await roll(request.params.arguments, rpcId);
          receipts.set(key, { digest, result });
          return result;
        });
        queue = work.then(
          () => {},
          () => {}
        );
        try {
          const result = await work;
          return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
        } catch (error) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text:
                  error instanceof Problem
                    ? `${error.code}: ${error.message}`
                    : 'dice_failure: Dice request failed',
              },
            ],
          };
        }
      });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      transports.add(transport);
      res.on('close', () => {
        transports.delete(transport);
        void mcp.close();
      });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch {
      if (!res.headersSent) res.writeHead(400).end();
    }
  });
  http.requestTimeout = HTTP_REQUEST_TIMEOUT_MS;
  http.headersTimeout = HTTP_REQUEST_TIMEOUT_MS;
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(0, '127.0.0.1', () => {
      http.removeListener('error', reject);
      resolve();
    });
  });
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('Dice listener did not bind');
  const endpoint: DiceMcpEndpoint = {
    url: `http://127.0.0.1:${address.port}/mcp`,
    headers: { Authorization: authorization },
    close() {
      if (closing) return closing;
      closed = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      closing = (async () => {
        for (const transport of transports) await transport.close();
        await new Promise<void>((resolve) => {
          http.close(() => resolve());
          http.closeAllConnections();
        });
        await queue;
      })();
      return closing;
    },
  };
  const abort = () => {
    void endpoint.close();
  };
  const timer = setTimeout(abort, DICE_LIMITS.attemptMs);
  timer.unref();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) await endpoint.close();
  return endpoint;
}
