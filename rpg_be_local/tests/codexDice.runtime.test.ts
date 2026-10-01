import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { runCodexDicePhases } from '../src/providers/codexDice.js';
import {
  codexEnvironment,
  isolatedCodexConfig,
  parseCodexCatalog,
} from '../src/providers/codex.js';
import { DICE_NARRATOR } from '../src/providers/diceProtocol.js';
test(
  'native Codex exposes only dice and stops every tool phase before a hidden continuation',
  { skip: !process.env.RPG_TEST_CODEX_BIN || !process.env.RPG_TEST_CODEX_MODELS },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rpg-codex-dice-native-'));
    const requests: Record<string, unknown>[] = [];
    const input = {
      slot: 0,
      groups: [{ label: 'check', count: 1, sides: 6 }],
      reason: 'Native fixture',
      declaration: 'No modifiers',
    };
    const server = createServer(async (req, res) => {
      assert.equal(req.url, '/responses');
      assert.equal(req.headers.authorization, undefined);
      const chunks: Buffer[] = [];
      for await (const part of req) chunks.push(part);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      requests.push(body);
      const index = requests.length - 1;
      const item =
        index < 2
          ? {
              id: `fc${index}`,
              type: 'function_call',
              call_id: `call${index}`,
              name: 'roll_dice',
              arguments: JSON.stringify({ ...input, slot: index }),
              status: 'completed',
            }
          : {
              id: 'final',
              type: 'message',
              status: 'completed',
              role: 'assistant',
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({ payload_json: JSON.stringify({ received: [4, 5] }) }),
                  annotations: [],
                },
              ],
            };
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const event of [
        {
          type: 'response.created',
          response: {
            id: `response${index}`,
            object: 'response',
            status: 'in_progress',
            output: [],
          },
        },
        { type: 'response.output_item.added', output_index: 0, item },
        { type: 'response.output_item.done', output_index: 0, item },
        {
          type: 'response.completed',
          response: {
            id: `response${index}`,
            object: 'response',
            status: 'completed',
            output: [item],
            usage: { input_tokens: 1000, output_tokens: 30, total_tokens: 1030 },
          },
        },
      ])
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      res.end();
    });
    try {
      const home = path.join(root, 'home');
      await mkdir(home);
      const originalHome = path.join(root, 'original-home');
      await mkdir(originalHome);
      await writeFile(path.join(root, 'AGENTS.md'), 'HOST_RULE_CANARY');
      await writeFile(path.join(originalHome, 'AGENTS.md'), 'GLOBAL_MEMORY_CANARY');
      const parsed = parseCodexCatalog(
        JSON.parse(await readFile(process.env.RPG_TEST_CODEX_MODELS!, 'utf8'))
      );
      const catalogPath = path.join(root, 'models.json');
      const instructionsPath = path.join(root, 'instructions.txt');
      await writeFile(
        catalogPath,
        JSON.stringify({
          models: (parsed.metadata as { models: Record<string, unknown>[] }).models.map(
            (model) => ({
              ...model,
              base_instructions: DICE_NARRATOR,
              supports_parallel_tool_calls: false,
            })
          ),
        })
      );
      await writeFile(instructionsPath, DICE_NARRATOR);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      const config = {
        ...isolatedCodexConfig(catalogPath, instructionsPath),
        model_provider: 'fixture',
        'model_providers.fixture.name': 'Anonymous dice fixture',
        'model_providers.fixture.base_url': `http://127.0.0.1:${address.port}`,
        'model_providers.fixture.wire_api': 'responses',
        'model_providers.fixture.requires_openai_auth': false,
        'model_providers.fixture.supports_websockets': false,
        'features.enable_request_compression': false,
      };
      let calls = 0;
      const result = await runCodexDicePhases(
        { binary: process.env.RPG_TEST_CODEX_BIN!, prefix: [] },
        { provider: 'codex', model: parsed.models[0]!.id, effort: 'low' },
        'Synthetic campaign only',
        root,
        { ...codexEnvironment(process.env), CODEX_HOME: home },
        config,
        async (raw) => {
          assert.deepEqual(raw, { ...input, slot: calls });
          return {
            rollId: randomUUID(),
            slot: calls,
            groups: [{ label: 'check', sides: 6, faces: [4 + calls++] }],
            reused: false,
          };
        }
      );
      assert.deepEqual(result, { received: [4, 5] });
      assert.equal(calls, 2);
      assert.equal(requests.length, 3);
      for (const request of requests) {
        const items = request.input as {
          type: string;
          tools?: { type: string; name: string; tools?: { name: string }[] }[];
        }[];
        const advertised = (
          (request.tools as { type: string; name: string; tools?: { name: string }[] }[]) ?? []
        ).concat(
          ...items
            .filter((item) => item.type === 'additional_tools')
            .map((item) => item.tools ?? [])
        );
        const functions = advertised.flatMap((tool) =>
          tool.type === 'namespace' ? (tool.tools ?? []) : [tool]
        );
        assert.deepEqual(
          functions.map((tool) => tool.name),
          ['roll_dice']
        );
        assert.doesNotMatch(
          JSON.stringify(request.input),
          /HOST_RULE_CANARY|GLOBAL_MEMORY_CANARY|tool_search|read_mcp_resource/
        );
        assert.ok(Buffer.byteLength(JSON.stringify(request.input), 'utf8') < 32000);
      }
      assert.match(JSON.stringify(requests[1]!.input), /faces/);
      assert.match(JSON.stringify(requests[2]!.input), /rollId/);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  }
);
