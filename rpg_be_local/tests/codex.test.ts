import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  codexEnvironment,
  generateCodex,
  isolatedCodexConfig,
  parseCodexCatalog,
  CODEX_TRANSPORT_SCHEMA,
  parseCodexPayload,
} from '../src/providers/codex.js';
import { parseProviderOutput } from '../src/providers/adapters.js';
import { responseSchema } from '../src/domain/schemas.js';

const metadata = {
  models: [
    {
      slug: 'fixture',
      display_name: 'Fixture',
      visibility: 'list',
      supported_reasoning_levels: [{ effort: 'low' }, { effort: 'ultra' }],
      tool_mode: 'code_mode_only',
      shell_type: 'unified_exec',
      apply_patch_tool_type: 'freeform',
      experimental_supported_tools: ['clock'],
    },
  ],
};
test('Codex catalog removes tools and automatic delegation efforts without guessing models', () => {
  const parsed = parseCodexCatalog(metadata);
  assert.deepEqual(parsed.models, [
    { id: 'fixture', label: 'Fixture', efforts: ['low'], inputTokens: 8000 },
  ]);
  const model = (parsed.metadata as { models: Record<string, unknown>[] }).models[0]!;
  assert.equal(model.tool_mode, 'direct');
  assert.equal(model.shell_type, 'disabled');
  assert.equal(model.apply_patch_tool_type, null);
  assert.deepEqual(model.experimental_supported_tools, []);
  assert.equal(model.model_messages, null);
  assert.deepEqual(
    codexEnvironment({
      CODEX_HOME: '/own/home',
      CODEX_THREAD_ID: 'parent',
      CODEX_APP_TOOLS_PIPE_PATH: 'parent-tools',
      OPENAI_API_KEY: 'fixture',
      OPENAI_BASE_URL: 'external',
      PATH: 'local',
    }),
    { CODEX_HOME: '/own/home', PATH: 'local' }
  );
  const config = isolatedCodexConfig('/catalog', '/instructions');
  assert.equal(config['agents.enabled'], false);
  assert.equal(config['features.goals'], false);
  assert.equal(config['skills.include_instructions'], false);
  assert.equal(config['features.hooks'], false);
  assert.equal(config['features.plugins'], false);
});

test('Codex launch links native auth into a fresh home, streams context and cleans its own home', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'rpg-codex-test-'));
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'rpg-codex-cwd-'));
  try {
    await writeFile(
      path.join(home, 'auth.json'),
      'Synthetic fixture; never read by the application'
    );
    await writeFile(path.join(home, 'models_cache.json'), JSON.stringify(metadata));
    const script = path.join(cwd, 'cli.mjs');
    const proof = path.join(cwd, 'proof.json');
    await writeFile(
      script,
      `
      import fs from 'node:fs/promises'; import path from 'node:path';
      const args=process.argv.slice(2);
      if(args[0]==='--version') console.log('codex-cli 0.159.0-alpha.12.1');
      else if(args.includes('login')) console.log('Logged in using ChatGPT');
      else {
        let prompt=''; for await(const part of process.stdin)prompt+=part;
        const source=await fs.stat(path.join(process.env.RPG_TEST_ORIGINAL_HOME,'auth.json'));
        const linked=await fs.stat(path.join(process.env.CODEX_HOME,'auth.json'));
        await fs.writeFile(process.env.RPG_TEST_PROOF,JSON.stringify({prompt,args,home:process.env.CODEX_HOME,cwd:process.cwd(),linked:source.ino===linked.ino&&source.dev===linked.dev,parent:process.env.CODEX_THREAD_ID}));
        console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({payload_json:JSON.stringify({text:'done'})})}}));
        console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:1000}}));
      }
    `
    );
    const output = await generateCodex(
      { binary: process.execPath, prefix: [script] },
      { provider: 'codex', model: 'fixture', effort: 'low' },
      '{"campaign":"fresh"}',
      path.join(cwd, 'schema.json'),
      cwd,
      {
        ...process.env,
        CODEX_HOME: home,
        CODEX_THREAD_ID: 'parent-context',
        RPG_TEST_ORIGINAL_HOME: home,
        RPG_TEST_PROOF: proof,
      }
    );
    assert.deepEqual(parseProviderOutput('codex', output), { text: 'done' });
    const result = JSON.parse(await readFile(proof, 'utf8'));
    assert.equal(result.linked, true);
    assert.equal(path.dirname(result.home), home);
    assert.notEqual(result.home, home);
    assert.equal(result.cwd.toLowerCase(), cwd.toLowerCase());
    assert.equal(result.parent, undefined);
    assert.equal(result.prompt, '{"campaign":"fresh"}');
    assert.ok(result.args.includes('--ignore-user-config'));
    assert.ok(result.args.includes('--ignore-rules'));
    assert.ok(result.args.includes('--ephemeral'));
    const transportPath = result.args[result.args.indexOf('--output-schema') + 1];
    assert.deepEqual(JSON.parse(await readFile(transportPath, 'utf8')), CODEX_TRANSPORT_SCHEMA);
    assert.deepEqual((await readdir(home)).sort(), ['auth.json', 'models_cache.json']);
    await assert.rejects(
      generateCodex(
        { binary: process.execPath, prefix: [script] },
        { provider: 'codex', model: 'fixture', effort: 'ultra' },
        '{}',
        '',
        cwd,
        { ...process.env, CODEX_HOME: home }
      ),
      /automatic delegation/
    );
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
});

test('Codex output rejects tool events and a failed turn despite an agent message', () => {
  const narrative = JSON.stringify({
    type: 'item.completed',
    item: { type: 'agent_message', text: JSON.stringify({ payload_json: '{"text":"done"}' }) },
  });
  assert.throws(
    () =>
      parseProviderOutput(
        'codex',
        narrative +
          '\n' +
          JSON.stringify({ type: 'item.completed', item: { type: 'command_execution' } })
      ),
    /tool activity/
  );
  assert.throws(
    () => parseProviderOutput('codex', narrative + '\n{"type":"turn.failed"}'),
    /failed generation/
  );
});

test('Codex final output requires one successful turn without an app input-token ceiling', () => {
  const message = JSON.stringify({
    type: 'item.completed',
    item: { type: 'agent_message', text: JSON.stringify({ payload_json: '{"text":"done"}' }) },
  });
  const complete = (input_tokens: number) =>
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens } });
  assert.deepEqual(parseProviderOutput('codex', message + '\n' + complete(1000)), { text: 'done' });
  assert.throws(() => parseProviderOutput('codex', message), /complete one/);
  for (const inputTokens of [8001, 120000]) {
    assert.deepEqual(parseProviderOutput('codex', message + '\n' + complete(inputTokens)), {
      text: 'done',
    });
  }
  assert.deepEqual(parseProviderOutput('codex', message + '\n{"type":"turn.completed"}'), {
    text: 'done',
  });
  assert.throws(
    () => parseProviderOutput('codex', message + '\n' + complete(1000) + '\n' + message),
    /complete one/
  );
  assert.throws(
    () => parseProviderOutput('codex', message + '\n' + complete(1000) + '\n' + complete(1000)),
    /complete one/
  );
});

test('Codex strict transport preserves arbitrary sheet values without bypassing domain validation', () => {
  const response = {
    version: 1,
    narrative: 'Mira heals.',
    operations: [{ op: 'state', expected: {}, value: { arbitrary: ['north', { clue: 47 }] } }],
  };
  const decoded = parseCodexPayload(JSON.stringify({ payload_json: JSON.stringify(response) }));
  assert.deepEqual(responseSchema.parse(decoded), response);
  assert.throws(() => parseCodexPayload('{"payload_json":"not JSON"}'));
  assert.throws(() => parseCodexPayload('{"payload_json":"{}","unexpected":true}'));
  assert.throws(() => responseSchema.parse(parseCodexPayload('{"payload_json":"{}"}')));
});
