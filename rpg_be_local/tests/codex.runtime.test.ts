import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, stat, link, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  codexEnvironment,
  CODEX_ISOLATED_VERSION,
  isolatedCodexArgs,
  isolatedCodexConfig,
  parseCodexCatalog,
} from '../src/providers/codex.js';
import { runProcess } from '../src/providers/processRunner.js';
import { parseProviderOutput } from '../src/providers/adapters.js';

// Explicit native-runtime test: anonymous loopback fixtures only, no model or account requests.
test(
  'actual Codex sends no tools or outside instructions, switches saved context, and preserves auth hardlinks',
  { skip: !process.env.RPG_TEST_CODEX_BIN || !process.env.RPG_TEST_CODEX_MODELS },
  async () => {
    const binary = process.env.RPG_TEST_CODEX_BIN!;
    const root = await mkdtemp(path.join(os.tmpdir(), 'rpg-codex-runtime-'));
    const requests: Record<string, unknown>[] = [];
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      assert.equal(req.url, '/responses');
      assert.equal(req.headers.authorization, undefined);
      requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      const item = {
        id: 'message-fixture',
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'output_text', text: '{"text":"fixture"}', annotations: [] }],
      };
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const event of [
        {
          type: 'response.created',
          response: {
            id: 'response-fixture',
            object: 'response',
            status: 'in_progress',
            output: [],
          },
        },
        { type: 'response.output_item.added', output_index: 0, item },
        {
          type: 'response.output_text.delta',
          item_id: item.id,
          output_index: 0,
          content_index: 0,
          delta: '{"text":"fixture"}',
        },
        { type: 'response.output_item.done', output_index: 0, item },
        {
          type: 'response.completed',
          response: {
            id: 'response-fixture',
            object: 'response',
            status: 'completed',
            output: [item],
            usage: { input_tokens: 1000, output_tokens: 10, total_tokens: 1010 },
          },
        },
      ])
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      res.end();
    });
    try {
      assert.equal(
        (await runProcess(binary, ['--version'], '', { timeoutMs: 8000 })).trim(),
        `codex-cli ${CODEX_ISOLATED_VERSION}`
      );
      const parsed = parseCodexCatalog(
        JSON.parse(await readFile(process.env.RPG_TEST_CODEX_MODELS!, 'utf8'))
      );
      assert.ok(parsed.models.length >= 2);
      const original = path.join(root, 'synthetic-auth.json');
      await writeFile(original, '{}');
      const nativeAuthHome = path.join(root, 'auth-write-proof');
      await mkdir(nativeAuthHome);
      await link(original, path.join(nativeAuthHome, 'auth.json'));
      const before = await stat(original);
      await runProcess(
        binary,
        ['login', '--with-api-key'],
        'rpg-synthetic-placeholder-not-a-real-key',
        {
          cwd: root,
          env: { ...codexEnvironment(process.env), CODEX_HOME: nativeAuthHome },
          timeoutMs: 8000,
        }
      );
      const after = await stat(original);
      const linked = await stat(path.join(nativeAuthHome, 'auth.json'));
      assert.equal(after.ino, before.ino);
      assert.equal(after.ino, linked.ino);
      assert.ok(after.size > before.size);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      const threads: string[] = [];
      for (const [index, model] of parsed.models.slice(0, 2).entries()) {
        const cwd = path.join(root, `cwd-${index}`);
        const home = path.join(root, `home-${index}`);
        await mkdir(cwd);
        await mkdir(home);
        const catalogPath = path.join(cwd, 'models.json');
        const instructionsPath = path.join(cwd, 'instructions.txt');
        const schemaPath = path.join(cwd, 'schema.json');
        await writeFile(catalogPath, JSON.stringify(parsed.metadata));
        await writeFile(
          instructionsPath,
          'You are a tabletop RPG narrator. Only supplied campaign JSON is authoritative.'
        );
        await writeFile(
          schemaPath,
          JSON.stringify({
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text'],
            additionalProperties: false,
          })
        );
        const config = {
          ...isolatedCodexConfig(catalogPath, instructionsPath),
          model_provider: 'rpg_fixture',
          'model_providers.rpg_fixture.name': 'RPG anonymous fixture',
          'model_providers.rpg_fixture.base_url': `http://127.0.0.1:${address.port}`,
          'model_providers.rpg_fixture.wire_api': 'responses',
          'model_providers.rpg_fixture.requires_openai_auth': false,
          'model_providers.rpg_fixture.supports_websockets': false,
          'features.enable_request_compression': false,
        };
        const output = await runProcess(
          binary,
          isolatedCodexArgs(
            { provider: 'codex', model: model.id, effort: model.efforts[0] ?? null },
            schemaPath,
            config
          ),
          JSON.stringify({
            campaign: { id: 'saved-campaign', state: index },
            savedTurns: ['saved previous narrative'],
          }),
          {
            cwd,
            env: { ...codexEnvironment(process.env), CODEX_HOME: home },
            timeoutMs: 15000,
            maxOutputBytes: 100000,
          }
        );
        assert.deepEqual(parseProviderOutput('codex', output), { text: 'fixture' });
        threads.push(
          JSON.parse(output.split('\n').find((line) => line.includes('thread.started'))!).thread_id
        );
        const request = requests[index] as {
          model: string;
          input: { type: string; role?: string; tools?: unknown[]; content?: { text: string }[] }[];
        };
        assert.equal(request.model, model.id);
        for (const input of request.input)
          if (input.type === 'additional_tools') assert.deepEqual(input.tools, []);
        const content = JSON.stringify(request.input);
        assert.doesNotMatch(
          content,
          /AGENTS\.md|SKILL\.md|available.skills|claude|G:\\\\My Drive|spawn_agent|exec_command|mcp__/i
        );
        const users = request.input.filter((input) => input.role === 'user');
        assert.equal(users.length, 2);
        assert.match(JSON.stringify(users[0]), /environment_context/);
        assert.ok(JSON.stringify(users[0]).length < 2000);
        assert.match(JSON.stringify(users[1]), /saved-campaign/);
        assert.match(JSON.stringify(users[1]), /saved previous narrative/);
      }
      assert.equal(requests.length, 2);
      assert.notEqual(threads[0], threads[1]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  }
);
