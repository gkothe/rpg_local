import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateAntigravity } from '../src/providers/antigravity.js';
import { PromptTrace } from '../src/providers/promptLog.js';

const fixture = `
const hooks = process.argv.includes('/hooks');
if (hooks) {
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
