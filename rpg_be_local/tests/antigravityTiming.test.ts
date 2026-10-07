import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  ANTIGRAVITY_HOOKS_VERIFIED_TTL_MS,
  antigravityHooksClock,
  generateAntigravity,
  hooksVerified,
  recordHooksCheck,
  resetAntigravityHooksCacheForTests,
} from '../src/providers/antigravity.js';
import { PromptTrace } from '../src/providers/promptLog.js';

const fixture = `
const hooks = process.argv.includes('/hooks');
if (hooks) {
  if (process.env.RPG_HOOKS_COUNTER) require('node:fs').appendFileSync(process.env.RPG_HOOKS_COUNTER, 'x\\n');
  console.log(JSON.stringify({ command: { data: { hooks: process.env.RPG_TIMING_MODE === 'hooks_failure' ? ['fixture'] : [] } } }));
} else {
  process.stdin.resume();
  process.stdin.on('end', () => {
    if (process.env.RPG_TIMING_MODE === 'generation_failure') {
      console.error('PRIVATE_DIAGNOSTIC');
      process.exitCode = 1;
    } else console.log('synthetic response');
  });
}
`;

beforeEach(() => resetAntigravityHooksCacheForTests());

for (const mode of ['success', 'hooks_failure', 'generation_failure']) {
  test(`Antigravity stage timing correlates ${mode} without logging process diagnostics`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rpg-agy-timing-'));
    try {
      const script = path.join(root, 'cli.mjs');
      const traceFile = path.join(root, 'trace.jsonl');
      await writeFile(script, fixture);
      const context = {
        executionId: 'timing-execution',
        turnId: 'timing-turn',
        purpose: 'narrative_humanize',
        trace: new PromptTrace(traceFile, { executionId: 'timing-execution' }),
      };
      const invoke = () =>
        generateAntigravity(
          { binary: process.execPath, prefix: [script] },
          { provider: 'agy', model: 'fixture', effort: null },
          'Synthetic prompt',
          { type: 'object' },
          root,
          { ...process.env, RPG_TIMING_MODE: mode },
          undefined,
          { ownedProfile: root, trace: context }
        );
      if (mode === 'success') assert.equal(await invoke(), 'synthetic response\n');
      else
        await assert.rejects(
          invoke(),
          (error: unknown) =>
            (error as { code: string }).code ===
            (mode === 'hooks_failure' ? 'provider_isolation' : 'provider_failure')
        );
      const raw = await readFile(traceFile, 'utf8');
      const rows = raw
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      const starts = rows.filter((row) => row.kind === 'provider_stage_start');
      const ends = rows.filter((row) => row.kind === 'provider_stage_end');
      const stages =
        mode === 'hooks_failure'
          ? ['hooks']
          : ['hooks', 'agent_setup', 'prompt_logging', 'generation_process', 'agent_cleanup'];
      const failedStage =
        mode === 'hooks_failure'
          ? 'hooks'
          : mode === 'generation_failure'
            ? 'generation_process'
            : undefined;
      assert.deepEqual(
        starts.map((row) => row.payload.stage),
        stages
      );
      assert.deepEqual(
        ends.map((row) => row.payload.stage),
        stages
      );
      for (let index = 0; index < ends.length; index++) {
        const row = ends[index];
        assert.equal(row.executionId, context.executionId);
        assert.equal(row.turnId, context.turnId);
        assert.equal(row.purpose, context.purpose);
        assert.equal(row.payload.provider, 'agy');
        assert.ok(Number.isFinite(row.payload.durationMs) && row.payload.durationMs >= 0);
        assert.ok(row.payload.elapsedMs >= starts[index].payload.elapsedMs);
        assert.equal(row.payload.status, row.payload.stage === failedStage ? 'error' : 'success');
        if (row.payload.stage === failedStage)
          assert.equal(
            row.payload.failure.code,
            mode === 'hooks_failure' ? 'provider_isolation' : 'provider_failure'
          );
      }
      assert.doesNotMatch(raw, /PRIVATE_DIAGNOSTIC/);
      if (mode !== 'hooks_failure')
        assert.deepEqual(await readdir(path.join(root, '.gemini', 'config', 'agents')), []);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

async function hooksHarness(extraEnv: Record<string, string> = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rpg-agy-hooks-'));
  const script = path.join(root, 'cli.cjs');
  const counter = path.join(root, 'hooks.count');
  await writeFile(script, fixture);
  await appendFile(counter, '');
  const traceFile = path.join(root, 'trace.jsonl');
  const context = {
    executionId: 'hooks-execution',
    turnId: 'hooks-turn',
    purpose: 'gameplay',
    trace: new PromptTrace(traceFile, { executionId: 'hooks-execution' }),
  };
  const run = (profile: string, env: Record<string, string> = {}) =>
    generateAntigravity(
      { binary: process.execPath, prefix: [script] },
      { provider: 'agy', model: 'fixture', effort: null },
      'Synthetic prompt',
      { type: 'object' },
      root,
      { ...process.env, ...extraEnv, ...env, RPG_HOOKS_COUNTER: counter, USERPROFILE: profile },
      undefined,
      { ownedProfile: profile, trace: context }
    );
  const spawns = async () => (await readFile(counter, 'utf8')).split('\n').filter(Boolean).length;
  const hookEnds = async () =>
    (await readFile(traceFile, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
      .filter((row) => row.kind === 'provider_stage_end' && row.payload.stage === 'hooks');
  return { root, run, spawns, hookEnds };
}

test('verified hooks are reused for the same launch environment and traced as cached', async () => {
  const h = await hooksHarness();
  try {
    await h.run(path.join(h.root, 'p1'));
    await h.run(path.join(h.root, 'p1'));
    assert.equal(await h.spawns(), 1);
    assert.deepEqual(
      (await h.hookEnds()).map((row) => row.payload.cached),
      [false, true]
    );
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test('different owned profiles share one hooks verification', async () => {
  const h = await hooksHarness();
  try {
    await h.run(path.join(h.root, 'p1'));
    await h.run(path.join(h.root, 'p2'));
    assert.equal(await h.spawns(), 1);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test('a different launch environment is verified separately', async () => {
  const h = await hooksHarness();
  try {
    await h.run(path.join(h.root, 'p1'), { RPG_TIMING_MODE: 'success' });
    await h.run(path.join(h.root, 'p1'), { RPG_TIMING_MODE: 'other' });
    assert.equal(await h.spawns(), 2);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test('hook isolation failures are never cached', async () => {
  const h = await hooksHarness({ RPG_TIMING_MODE: 'hooks_failure' });
  try {
    for (let attempt = 0; attempt < 2; attempt++)
      await assert.rejects(
        h.run(path.join(h.root, 'p1')),
        (error: unknown) => (error as { code: string }).code === 'provider_isolation'
      );
    assert.equal(await h.spawns(), 2);
  } finally {
    await rm(h.root, { recursive: true, force: true });
  }
});

test('hooks verification expires after the TTL', async () => {
  const h = await hooksHarness();
  const realNow = antigravityHooksClock.now;
  let now = 1_000_000;
  antigravityHooksClock.now = () => now;
  try {
    await h.run(path.join(h.root, 'p1'));
    now += ANTIGRAVITY_HOOKS_VERIFIED_TTL_MS - 1;
    await h.run(path.join(h.root, 'p1'));
    assert.equal(await h.spawns(), 1);
    now += 1;
    await h.run(path.join(h.root, 'p1'));
    assert.equal(await h.spawns(), 2);
  } finally {
    antigravityHooksClock.now = realNow;
    await rm(h.root, { recursive: true, force: true });
  }
});

test('an older overlapping success cannot overwrite a newer failure', () => {
  const realNow = antigravityHooksClock.now;
  antigravityHooksClock.now = () => 10;
  try {
    recordHooksCheck('key', 2, false);
    recordHooksCheck('key', 1, true);
    assert.equal(hooksVerified('key'), false);
    recordHooksCheck('key', 3, true);
    assert.equal(hooksVerified('key'), true);
  } finally {
    antigravityHooksClock.now = realNow;
  }
});
