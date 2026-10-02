import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { logPrompt } from '../src/providers/promptLog.js';

test('prompt logs preserve full text, safe filenames and repeated calls without overwriting', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rpg-prompt-log-'));
  try {
    const settings = { provider: 'agy', model: 'synthetic', effort: 'high' };
    const prompt = 'Full UTF-8 prompt\nVampire — ação';
    const first = await logPrompt(
      '../generate/Test',
      settings,
      prompt,
      'System instructions',
      directory
    );
    const second = await logPrompt(
      '../generate/Test',
      settings,
      prompt,
      'System instructions',
      directory
    );
    assert.notEqual(first, second);
    assert.equal(path.dirname(first), directory);
    assert.match(path.basename(first), /^\d{8}__\d{6}__[a-zA-Z0-9_-]+\.json$/);
    const data = JSON.parse(await readFile(first, 'utf8'));
    assert.equal(data.prompt, prompt);
    assert.equal(data.systemInstructions, 'System instructions');
    assert.equal(data.provider, 'agy');
    const blocked = path.join(directory, 'not-a-directory');
    await writeFile(blocked, 'fixture');
    await assert.rejects(logPrompt('failure', settings, prompt, undefined, blocked));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
