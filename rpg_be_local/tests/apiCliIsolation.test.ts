import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runProcess } from '../src/providers/processRunner.js';
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
