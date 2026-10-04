import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  createPromptTrace,
  traceEvent,
  safeTraceFailure,
  type PromptTraceContext,
} from '../src/providers/promptLog.js';

test('trace snapshots a mutable caller context before attaching itself', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rpg-mutable-trace-'));
  try {
    const context: PromptTraceContext = { executionId: 'first' };
    context.trace = await createPromptTrace('turn', context, directory);
    context.executionId = 'next';
    await traceEvent(context, 'request', { prompt: 'fixture' }, true);
    assert.equal(context.trace.incomplete, false);
    assert.equal(context.trace.context.executionId, 'first');
    const row = JSON.parse((await readFile(context.trace.file, 'utf8')).trim());
    assert.equal(row.executionId, 'next');
    assert.ok(!Object.hasOwn(row, 'trace'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('correlated traces preserve serial events and isolate colliding invocations', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rpg-trace-test-'));
  try {
    const a = await createPromptTrace(
      'action',
      { executionId: 'a', campaignId: 'c', turnId: 't' },
      directory
    );
    const b = await createPromptTrace('action', { executionId: 'b' }, directory);
    assert.notEqual(a.file, b.file);
    await traceEvent(
      { ...a.context, trace: a, correctionAttempt: 1 },
      'request',
      {
        prompt: 'private campaign text',
        authorization: 'bearer-secret',
        environment: { KEY: 'secret' },
      },
      true
    );
    await a.event('tool_result', { slot: 0, faces: [6], usage: { inputTokens: 10 } });
    await b.event('failure', safeTraceFailure(new Error('secret-native-stderr')));
    const rows = (await readFile(a.file, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      rows.map((row) => row.sequence),
      [1, 2]
    );
    assert.equal(rows[0].executionId, 'a');
    assert.equal(rows[0].correctionAttempt, 1);
    assert.equal(rows[1].payload.usage.inputTokens, 10);
    assert.ok(!(await readFile(a.file, 'utf8')).includes('bearer-secret'));
    assert.ok(!(await readFile(b.file, 'utf8')).includes('secret-native-stderr'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('post-result trace write failure marks incomplete and never fails completed gameplay', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rpg-trace-failure-'));
  const trace = await createPromptTrace('commit', { executionId: 'completed' }, directory);
  await rm(directory, { recursive: true, force: true });
  assert.equal(await trace.event('commit', { committed: true }), false);
  assert.equal(trace.incomplete, true);
  await assert.rejects(trace.event('request', {}, true), /Prompt logging failed/);
});
