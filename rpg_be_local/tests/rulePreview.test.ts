import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { RulePreview } from '../src/services/rulePreview.js';
import { RULE_LIMITS } from '../src/domain/rules.js';
test('owned staging expires, enforces per-key quotas, consumes/cancels and cleans startup remnants', async () => {
  const directory = path.join(os.tmpdir(), `rpg-rules-preview-test-${randomUUID()}`);
  let now = Date.now();
  const previews = new RulePreview(directory, () => now);
  try {
    const first = await previews.stage('system', { data: 'synthetic' });
    const second = await previews.stage('system', { data: 'second' });
    assert.deepEqual(await previews.get(first.id, 'system'), { data: 'synthetic' });
    await assert.rejects(previews.get(first.id, 'another'), /does not belong/);
    await assert.rejects(previews.stage('system', {}), /quota/);
    await previews.cancel(second.id);
    assert.equal((await readdir(directory)).length, 1);
    now += RULE_LIMITS.previewTtlMs;
    await assert.rejects(previews.get(first.id, 'system'), /expired/);
    assert.equal((await readdir(directory)).length, 0);
    await previews.stage('system', { data: 'orphan' });
    const restarted = new RulePreview(directory);
    await restarted.expire();
    assert.equal((await readdir(directory)).length, 0);
    await restarted.close();
  } finally {
    await previews.close();
    await rm(directory, { recursive: true, force: true });
  }
});
test('backup staging permits content above the book limit while each route retains its own bound', async () => {
  const directory = path.join(os.tmpdir(), `rpg-rules-preview-test-${randomUUID()}`);
  const previews = new RulePreview(directory);
  try {
    const value = { synthetic: 'x'.repeat(RULE_LIMITS.importBytes) };
    await assert.rejects(previews.stage('system', value), /byte limit/);
    const backup = await previews.stage('system', value, true);
    await previews.cancel(backup.id);
    await assert.rejects(
      previews.stage('system', { synthetic: 'x'.repeat(RULE_LIMITS.backupBytes) }, true),
      /byte limit/
    );
  } finally {
    await previews.close();
    await rm(directory, { recursive: true, force: true });
  }
});
