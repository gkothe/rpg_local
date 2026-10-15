import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { cleanProfile } from '../src/providers/antigravityMcpBook.js';

test('owned Antigravity cleanup retries transient updater locks within the verified profile', async () => {
  let calls = 0;
  const profile = path.join(os.tmpdir(), 'rpg-agy-private-cleanup-fixture');
  await cleanProfile(profile, async (target, options) => {
    assert.equal(target, profile);
    assert.deepEqual(options, { recursive: true, force: true });
    calls++;
    if (calls < 3) throw Object.assign(Error('Updater lock'), { code: 'EBUSY' });
  });
  assert.equal(calls, 3);
  await assert.rejects(
    cleanProfile(path.join(os.tmpdir(), 'outside-profile'), async () => {
      throw Error('Must never remove');
    }),
    /validation/
  );
});

test('owned cleanup preserves permanent filesystem failures without retrying them', async () => {
  let calls = 0;
  const failure = Object.assign(Error('Permanent failure'), { code: 'EIO' });
  await assert.rejects(
    cleanProfile(path.join(os.tmpdir(), 'rpg-agy-private-cleanup-fixture'), async () => {
      calls++;
      throw failure;
    }),
    (error) => error === failure
  );
  assert.equal(calls, 1);
});

test('Codex session driver: child exit while awaiting continuation rejects subsequent phase', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { runCodexDicePhases } = await import('../src/providers/codexDice.js');
  const { GameplaySessionBridge } = await import('../src/providers/gameplaySession.js');
  const { Problem } = await import('../src/errors.js');
  type GameplayToolDispatch = import('../src/providers/gameplayTools.js').GameplayToolDispatch;

  const root = await mkdtemp(path.join(os.tmpdir(), 'rpg-codex-cleanup-exit-'));
  const file = path.join(root, 'cli.mjs');
  await writeFile(
    file,
    `
import readline from 'node:readline';
const send = o => console.log(JSON.stringify(o));
readline.createInterface({ input: process.stdin }).on('line', raw => {
  const m = JSON.parse(raw);
  if (m.id === 1) send({ id: 1, result: {} });
  else if (m.id === 2) send({ id: 2, result: { thread: { id: 't-1' } } });
  else if (m.id === 100) {
    send({ id: 100, result: { turn: { id: 'turn-1' } } });
    send({
      method: 'turn/completed',
      params: {
        threadId: 't-1',
        turn: {
          id: 'turn-1',
          status: 'completed',
          items: [{ type: 'agentMessage', text: JSON.stringify({ payload_json: JSON.stringify({ narrative: 'done', operations: [], rollInterpretations: [] }) }) }],
        },
      },
    });
    setTimeout(() => process.exit(0), 10);
  }
});
`
  );

  const bridge = new GameplaySessionBridge();
  const tools: GameplayToolDispatch = Object.assign(async () => ({ ok: true }), {
    definitions: [],
  });
  let driverPromise: Promise<unknown> | undefined;

  try {
    driverPromise = runCodexDicePhases(
      { binary: process.execPath, prefix: [file] },
      { provider: 'codex', model: 'fixture', effort: null },
      'Turn 1 prompt',
      root,
      process.env,
      {},
      { dispatch: tools, definitions: [], schema: {}, systemPrompt: 'System GM' },
      undefined,
      undefined,
      bridge
    );

    const r1 = await bridge.runPhase({
      prompt: 'Turn 1 prompt',
      schema: {},
      systemPrompt: 'System GM',
      tools,
    });
    assert.deepEqual(r1, { narrative: 'done', operations: [], rollInterpretations: [] });

    await driverPromise.catch(() => {});

    await assert.rejects(
      bridge.runPhase({
        prompt: 'Turn 2 prompt',
        schema: {},
        systemPrompt: 'System GM',
        tools,
      }),
      (err: unknown) =>
        err instanceof Problem &&
        (err.code === 'gm_session_lost' || err.code === 'provider_protocol')
    );
  } finally {
    bridge.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('Claude session driver: child exit while awaiting continuation rejects subsequent phase and closes MCP', async () => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { generateClaudeDice } = await import('../src/providers/claudeDice.js');
  const { GameplaySessionBridge } = await import('../src/providers/gameplaySession.js');
  const { Problem } = await import('../src/errors.js');
  type GameplayToolDispatch = import('../src/providers/gameplayTools.js').GameplayToolDispatch;

  const root = await mkdtemp(path.join(os.tmpdir(), 'rpg-claude-cleanup-exit-'));
  const file = path.join(root, 'cli.mjs');
  await writeFile(
    file,
    `
const args = process.argv.slice(2);
const tools = args[args.indexOf('--allowedTools') + 1]?.split(',') ?? [];
const sessionId = args[args.indexOf('--session-id') + 1];
console.log(JSON.stringify({
  type: 'system',
  subtype: 'init',
  session_id: sessionId,
  tools,
  mcp_servers: [{ name: 'dice', status: 'connected' }],
}));
console.log(JSON.stringify({
  type: 'result',
  subtype: 'success',
  session_id: sessionId,
  uuid: 'res-1',
  is_error: false,
  num_turns: 1,
  result: JSON.stringify({ narrative: 'done', operations: [], rollInterpretations: [] }),
  modelUsage: { fixture: { contextWindow: 128000, outputTokens: 100 } },
}));
setTimeout(() => process.exit(0), 10);
`
  );

  const bridge = new GameplaySessionBridge();
  const tools: GameplayToolDispatch = Object.assign(async () => ({ ok: true }), {
    definitions: [
      { name: 'dummy_tool', description: 'test', inputSchema: { type: 'object' as const } },
    ],
  });
  let driverPromise: Promise<unknown> | undefined;

  try {
    driverPromise = generateClaudeDice(
      { binary: process.execPath, prefix: [file] },
      { provider: 'claude', model: 'fixture', effort: null },
      'Turn 1 prompt',
      root,
      process.env,
      { dispatch: tools, definitions: tools.definitions!, schema: {}, systemPrompt: 'System GM' },
      undefined,
      undefined,
      bridge
    );

    const r1 = await bridge.runPhase({
      prompt: 'Turn 1 prompt',
      schema: {},
      systemPrompt: 'System GM',
      tools,
    });
    assert.deepEqual(r1, { narrative: 'done', operations: [], rollInterpretations: [] });

    await driverPromise.catch(() => {});

    await assert.rejects(
      bridge.runPhase({
        prompt: 'Turn 2 prompt',
        schema: {},
        systemPrompt: 'System GM',
        tools,
      }),
      (err: unknown) =>
        err instanceof Problem &&
        (err.code === 'gm_session_lost' || err.code === 'provider_protocol')
    );
  } finally {
    bridge.close();
    await rm(root, { recursive: true, force: true });
  }
});
