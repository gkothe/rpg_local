import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { runProcess } from '../src/providers/processRunner.js';
import { responseRetryFeedback } from '../src/domain/responseRetry.js';

const run = (script: string, line: (value: unknown) => Promise<void>) =>
  runProcess(process.execPath, ['-e', script], '', {
    timeoutMs: 0,
    protocol: {
      start(_send, end) {
        end();
      },
      line,
    },
  });
test('EOF delivers the final UTF-8 event once and in order without requiring a newline', async () => {
  const events: unknown[] = [];
  await run(
    `process.stdout.write('{"n":1}\\n');process.stdout.write(JSON.stringify({n:2,text:'a\u00e7\u00e3o'}));`,
    async (value) => {
      events.push(value);
    }
  );
  assert.deepEqual(events, [{ n: 1 }, { n: 2, text: 'a\u00e7\u00e3o' }]);
});
test('invalid final EOF frame is rejected rather than ignored', async () => {
  await assert.rejects(
    run(`process.stdout.write('{bad');`, async () => {}),
    (e: unknown) => (e as { code: string }).code === 'provider_protocol'
  );
});
test('protocol schema rejection retains safe field diagnostics without rejected values', async () => {
  try {
    await run(`console.log(JSON.stringify({n:'PRIVATE_VALUE'}));`, async (value) => {
      z.object({ n: z.number() }).parse(value);
    });
    assert.fail('Must reject');
  } catch (e) {
    assert.match(responseRetryFeedback(e) ?? '', /n: invalid_type/);
    assert.doesNotMatch(String(e), /PRIVATE_VALUE/);
  }
});
for (const [text, code] of [
  ['Please login with your account', 'provider_auth'],
  ['You have hit your usage limit', 'provider_quota'],
] as const) {
  test(`operational ${code} stops repair and hides provider diagnostics`, async () => {
    try {
      await runProcess(
        process.execPath,
        [
          '-e',
          `process.stderr.write(${JSON.stringify(text + ' PRIVATE_TOKEN')});process.exitCode=1;`,
        ],
        ''
      );
      assert.fail('Must reject');
    } catch (e) {
      assert.equal((e as { code: string }).code, code);
      assert.equal(responseRetryFeedback(e), null);
      assert.doesNotMatch(String(e), /PRIVATE_TOKEN/);
    }
  });
}

test('failure persistence outage remains observable without leaking SQL or credentials', async () => {
  const { TurnService } = await import('../src/services/turns.js');
  const { Store } = await import('../src/store.js');
  const pool = {
    connect: async () => {
      throw Object.assign(new Error('PRIVATE_SQL PRIVATE_PASSWORD'), { code: 'ECONNREFUSED' });
    },
  };
  const { newCampaign } = await import('../src/domain/campaign.js');
  const campaign = newCampaign({ name: 'Synthetic' });
  const service = new TurnService(new Store(pool as never), {} as never);
  const logs: string[] = [];
  const original = console.error;
  console.error = (value: string) => {
    logs.push(value);
  };
  try {
    await (service as unknown as { run(t: unknown): Promise<void> }).run({
      id: 'synthetic-turn',
      campaignId: campaign.id,
    });
  } finally {
    console.error = original;
  }
  assert.deepEqual(
    logs.map((l) => JSON.parse(l).stage),
    ['turn_generation', 'turn_failure_persistence']
  );
  assert.ok(logs.every((l) => JSON.parse(l).code === 'local_service'));
  assert.doesNotMatch(logs.join(''), /PRIVATE_SQL|PRIVATE_PASSWORD/);
});

test('cleanup does not mask the primary failure and successful cleanup failure is actionable', async () => {
  const { finishProcessingCleanup } = await import('../src/processingErrors.js');
  const logs: string[] = [];
  const original = console.error;
  console.error = (value: string) => {
    logs.push(value);
  };
  const cleanup = async () => {
    throw Object.assign(new Error('PRIVATE_PATH'), { code: 'EACCES' });
  };
  try {
    await finishProcessingCleanup(cleanup, true);
    await assert.rejects(
      finishProcessingCleanup(cleanup, false),
      (e: unknown) => (e as { code: string }).code === 'provider_cleanup'
    );
  } finally {
    console.error = original;
  }
  assert.equal(logs.length, 2);
  assert.doesNotMatch(logs.join(''), /PRIVATE_PATH/);
});

for (const mode of ['incomplete', 'quota', 'auth'] as const) {
  test(`Claude distinguishes recoverable missing response from account failures: ${mode}`, async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const { generateClaudeDice } = await import('../src/providers/claudeDice.js');
    const root = await mkdtemp(path.join(os.tmpdir(), 'rpg-claude-error-'));
    try {
      const file = path.join(root, 'cli.mjs');
      const result =
        mode === 'incomplete'
          ? { subtype: 'success', is_error: false, num_turns: 1 }
          : {
              subtype: 'error_during_execution',
              is_error: true,
              num_turns: 1,
              result:
                mode === 'quota'
                  ? 'You have hit your usage limit PRIVATE_ACCOUNT'
                  : 'Please login PRIVATE_ACCOUNT',
            };
      await writeFile(
        file,
        `process.stdin.resume();process.stdin.on('end',()=>{console.log(JSON.stringify({type:'system',subtype:'init',tools:['mcp__dice__roll_dice'],mcp_servers:[{name:'dice',status:'connected'}]}));console.log(JSON.stringify({type:'result',...${JSON.stringify(result)}}));});`
      );
      try {
        await generateClaudeDice(
          { binary: process.execPath, prefix: [file] },
          { provider: 'claude', model: 'fixture', effort: null },
          'Synthetic',
          root,
          process.env,
          async () => {
            assert.fail('Must not roll');
          }
        );
        assert.fail('Must reject');
      } catch (e) {
        assert.equal(
          (e as { code: string }).code,
          mode === 'incomplete'
            ? 'provider_protocol'
            : mode === 'quota'
              ? 'provider_quota'
              : 'provider_auth'
        );
        assert.equal(responseRetryFeedback(e) !== null, mode === 'incomplete');
        assert.doesNotMatch(String(e), /PRIVATE_ACCOUNT/);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test('authoritative-output failures are not mistaken for account authentication failures', async () => {
  const { cliFailure } = await import('../src/processingErrors.js');
  assert.equal(cliFailure('Invalid authoritative response').code, 'provider_failure');
});

test('storage, permission and missing-schema errors have actionable diagnostics without internal details', async () => {
  const { operationalProblem } = await import('../src/processingErrors.js');
  for (const [code, expected] of [
    ['ENOSPC', 'local_storage'],
    ['EACCES', 'local_permissions'],
    ['42P01', 'database_setup'],
    ['42703', 'database_setup'],
    ['ECONNREFUSED', 'local_service'],
    ['23514', 'database_constraint'],
  ]) {
    const problem = operationalProblem(
      Object.assign(new Error('PRIVATE_SQL PRIVATE_PATH'), { code })
    );
    assert.equal(problem.code, expected);
    assert.equal(responseRetryFeedback(problem), null);
    assert.doesNotMatch(problem.message, /PRIVATE_SQL|PRIVATE_PATH/);
  }
});
