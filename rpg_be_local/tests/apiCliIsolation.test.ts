import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runProcess } from '../src/providers/processRunner.js';
import { ApiConversation } from '../src/providers/apiConversation.js';
import { Problem } from '../src/errors.js';
import type { GameplayAdapter } from '../src/providers/gameplayTools.js';
import { ownedTools } from './ownedGameplayFixture.js';

const PROBE =
  'console.log(JSON.stringify([process.env.GEMINI_API_KEY, process.env.OPENROUTER_API_KEY, process.env.KEEP]))';

test('child processes never inherit API credentials, with explicit or default environments', async () => {
  const secrets = { GEMINI_API_KEY: 'gemini-secret', OPENROUTER_API_KEY: 'router-secret' };
  const explicit = await runProcess(process.execPath, ['-e', PROBE], '', {
    env: { ...process.env, ...secrets, KEEP: 'kept' },
  });
  assert.deepEqual(JSON.parse(explicit), [null, null, 'kept']);
  Object.assign(process.env, secrets, { KEEP: 'kept' });
  try {
    const inherited = await runProcess(process.execPath, ['-e', PROBE], '');
    assert.deepEqual(JSON.parse(inherited), [null, null, 'kept']);
  } finally {
    for (const key of [...Object.keys(secrets), 'KEEP']) delete process.env[key];
  }
});

test('the owned registry exposes an ownership check that follows ownership and cancellation', async () => {
  let active = true;
  const controller = new AbortController();
  const tools = ownedTools({
    signal: controller.signal,
    assertActive: async () => {
      if (!active) throw new Error('ownership lost');
    },
  });
  await tools.call.assertActive!();
  active = false;
  await assert.rejects(tools.call.assertActive!(), /ownership lost/);
  active = true;
  controller.abort();
  await assert.rejects(tools.call.assertActive!(), /cancelled/);
});

test('ApiConversation allocates unique call namespaces across phases and enforces current phase tool authority', async () => {
  const dispatches: { name: string; requestId: string | number }[] = [];
  const fakeDispatch = Object.assign(
    async (name: string, _args: unknown, requestId: string | number) => {
      dispatches.push({ name, requestId });
      return { ok: true };
    },
    {
      assertActive: async () => {},
      definitions: [
        { name: 'roll_dice', description: 'roll', inputSchema: { type: 'object' as const } },
        { name: 'rules_search', description: 'search', inputSchema: { type: 'object' as const } },
      ],
    }
  );

  const phase1Adapter: GameplayAdapter = {
    dispatch: fakeDispatch,
    definitions: fakeDispatch.definitions,
    schema: {},
    systemPrompt: 'Phase 1',
  };

  const conv1 = new ApiConversation(phase1Adapter);
  const conv2 = new ApiConversation(phase1Adapter);

  // Both conversations run a tool call with the same call id
  await conv1.run([{ id: 'call_1', name: 'roll_dice', arguments: { slot: 0 } }]);
  await conv2.run([{ id: 'call_1', name: 'roll_dice', arguments: { slot: 0 } }]);

  assert.equal(dispatches.length, 2);
  assert.match(String(dispatches[0]?.requestId), /^[0-9a-f-]{36}:call_1$/);
  assert.match(String(dispatches[1]?.requestId), /^[0-9a-f-]{36}:call_1$/);
  assert.notEqual(dispatches[0]?.requestId, dispatches[1]?.requestId);

  // Phase 2 adapter only has index tools
  const phase2Adapter: GameplayAdapter = {
    dispatch: fakeDispatch,
    definitions: [{ name: 'rules_search', description: 'search', inputSchema: { type: 'object' } }],
    schema: {},
    systemPrompt: 'Phase 2',
  };
  const convPhase2 = new ApiConversation(phase2Adapter);

  // Allowed index tool succeeds
  const outcomes = await convPhase2.run([
    { id: 'call_index', name: 'rules_search', arguments: { query: 'test' } },
  ]);
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0]?.ok, true);

  // Unallowed gameplay tool (roll_dice) in index phase throws 422 gm_index_tool
  await assert.rejects(
    convPhase2.run([{ id: 'call_dice', name: 'roll_dice', arguments: { slot: 0 } }]),
    (err: unknown) => err instanceof Problem && err.status === 422 && err.code === 'gm_index_tool'
  );
});
