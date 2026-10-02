import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { locate } from '../src/providers/discovery.js';
import { ProviderService, parseClaudeHelpCatalog } from '../src/providers/service.js';

test('Claude choices come from installed help aliases and accepted effort levels only', () => {
  const help = [
    '  --model <model> Model. Provide an alias for the latest model (e.g.',
    "                  'opus', or 'sonnet') or a full name (e.g. 'claude-fixture-1').",
    '  --effort <level> Effort level for the current session',
    '                   (low, medium, high, xhigh, max)',
    "  --other <value> Unrelated example (e.g. 'invented')",
  ].join('\n');
  const models = parseClaudeHelpCatalog(help);
  assert.deepEqual(
    models.map((model) => model.id),
    ['opus', 'sonnet']
  );
  assert.deepEqual(models[0]!.efforts, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.equal(models[0]!.inputTokens, 8000);
  assert.deepEqual(parseClaudeHelpCatalog('  --model <model> Free text'), []);
  assert.deepEqual(parseClaudeHelpCatalog(help.replace(/--effort/, '--unknown'))[0]!.efforts, []);
});

test('Windows discovery supports current native npm Claude and legacy JavaScript layouts', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'rpg-discovery-'));
  try {
    const npm = path.join(home, 'npm');
    const root = path.join(npm, 'node_modules', '@anthropic-ai', 'claude-code');
    await mkdir(path.join(root, 'bin'), { recursive: true });
    await writeFile(path.join(npm, 'claude.cmd'), 'This wrapper must never be executed');
    await writeFile(path.join(root, 'bin', 'claude.exe'), 'native fixture');
    const context = {
      platform: 'win32' as const,
      env: { PATH: `"${npm}"` },
      home,
      node: path.join(home, 'node.exe'),
    };
    assert.deepEqual(await locate('claude', context), {
      binary: path.join(root, 'bin', 'claude.exe'),
      prefix: [],
    });
    await rm(path.join(root, 'bin', 'claude.exe'));
    await writeFile(path.join(root, 'cli.js'), 'legacy fixture');
    assert.deepEqual(await locate('claude', context), {
      binary: context.node,
      prefix: [path.join(root, 'cli.js')],
    });
    await rm(path.join(root, 'cli.js'));
    assert.equal(await locate('claude', context), null);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('Windows desktop Codex and native user Claude are found without PATH injection', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'rpg-discovery-'));
  try {
    const local = path.join(home, 'appdata');
    const codex = path.join(local, 'OpenAI', 'Codex', 'bin', 'version-fixture');
    const native = path.join(home, '.local', 'bin');
    await mkdir(codex, { recursive: true });
    await mkdir(native, { recursive: true });
    await writeFile(path.join(codex, 'codex.exe'), 'desktop fixture');
    await writeFile(path.join(native, 'claude.exe'), 'native fixture');
    const context = {
      platform: 'win32' as const,
      env: { PATH: '', LOCALAPPDATA: local },
      home,
      node: path.join(home, 'node.exe'),
    };
    assert.equal((await locate('codex', context))?.binary, path.join(codex, 'codex.exe'));
    assert.equal((await locate('claude', context))?.binary, path.join(native, 'claude.exe'));
    await assert.rejects(
      locate('claude', { ...context, env: { RPG_CLAUDE_BIN: path.join(home, 'claude.cmd') } }),
      /not a shell wrapper/
    );
    await assert.rejects(
      locate('claude', { ...context, env: { RPG_CLAUDE_BIN: path.join(home, 'missing.exe') } }),
      /does not exist/
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('refresh reports failed help inspection and cannot keep a previously usable adapter', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'rpg-discovery-'));
  const keys = ['RPG_CLAUDE_BIN', 'RPG_CODEX_BIN', 'RPG_AGY_BIN', 'RPG_MODEL_CATALOG'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    const entrypoint = path.join(home, 'cli.mjs');
    await writeFile(
      entrypoint,
      'console.log("--safe-mode --no-session-persistence --tools --json-schema")'
    );
    process.env.RPG_CLAUDE_BIN = entrypoint;
    process.env.RPG_CODEX_BIN = path.join(home, 'missing.exe');
    process.env.RPG_AGY_BIN = path.join(home, 'missing.exe');
    process.env.RPG_MODEL_CATALOG = JSON.stringify([
      {
        provider: 'claude',
        models: [{ id: 'fixture', label: 'Fixture', efforts: [], inputTokens: 8000 }],
      },
    ]);
    const service = new ProviderService();
    assert.equal((await service.list())[0]?.supported, true);
    await writeFile(entrypoint, 'process.exit(1)');
    const provider = (await service.list(true))[0]!;
    assert.equal(provider.available, true);
    assert.equal(provider.supported, false);
    assert.match(provider.reason!, /Local process failed/);
    await assert.rejects(
      service.capacity({ provider: 'claude', model: 'fixture', effort: null }),
      /Local process failed/
    );
    process.env.RPG_CLAUDE_BIN = path.join(home, 'missing.exe');
    assert.match(
      (await service.list(true))[0]!.reason!,
      /Configured CLI executable does not exist/
    );
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    await rm(home, { recursive: true, force: true });
  }
});

test('Antigravity dice enables installed catalog models and uses soft planning targets without reserving native inference capacity', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'rpg-agy-catalog-'));
  const keys = ['RPG_CLAUDE_BIN', 'RPG_CODEX_BIN', 'RPG_AGY_BIN', 'RPG_MODEL_CATALOG'];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    const entrypoint = path.join(home, 'cli.mjs');
    await writeFile(
      entrypoint,
      `
const args=process.argv.slice(2);
if(args.includes('changelog')) console.log('1.2.14:');
else if(args.includes('/hooks')) console.log(JSON.stringify({command:{data:{hooks:[]}}}));
else if(args.includes('models')) console.log('gemini-fixture-low\\tGemini Fixture (Low)');
else console.log('--agent');
`
    );
    process.env.RPG_AGY_BIN = entrypoint;
    process.env.RPG_CLAUDE_BIN = path.join(home, 'missing.exe');
    process.env.RPG_CODEX_BIN = path.join(home, 'missing.exe');
    delete process.env.RPG_MODEL_CATALOG;
    const service = new ProviderService();
    const installed = (await service.list()).find((provider) => provider.id === 'agy')!;
    assert.equal(installed.dice?.supported, true);
    assert.deepEqual(installed.models[0]?.efforts, ['low']);
    const settings = { provider: 'agy', model: 'gemini-fixture', effort: 'low' };
    assert.equal(await service.capacity(settings), 16000);
    assert.equal(await service.gameplayCapacity(settings), 16000);
    process.env.RPG_MODEL_CATALOG = JSON.stringify([
      {
        provider: 'agy',
        models: [{ id: 'unverified', label: 'Custom', efforts: [], inputTokens: 16000 }],
      },
    ]);
    const custom = (await service.list(true)).find((provider) => provider.id === 'agy')!;
    assert.equal(custom.models[0]?.dice?.supported, false);
    await assert.rejects(
      service.gameplayCapacity({ provider: 'agy', model: 'unverified', effort: null }),
      /verified installed CLI catalog/
    );
    assert.equal(
      await service.capacity({ provider: 'agy', model: 'unverified', effort: null }),
      16000
    );
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    await rm(home, { recursive: true, force: true });
  }
});
