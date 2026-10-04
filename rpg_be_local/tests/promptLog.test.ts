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
    const readable = await readFile(first.replace(/\.json$/, '.md'), 'utf8');
    assert.ok(readable.includes('## System instructions\n\n```text\nSystem instructions'));
    assert.ok(readable.includes(`## Prompt\n\n\`\`\`text\n${prompt}`));
    assert.ok((await readFile(second.replace(/\.json$/, '.md'), 'utf8')).includes(prompt));
    const blocked = path.join(directory, 'not-a-directory');
    await writeFile(blocked, 'fixture');
    await assert.rejects(logPrompt('failure', settings, prompt, undefined, blocked));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('readable logs indent nested JSON without changing the exact audit prompt', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rpg-readable-log-'));
  try {
    const prompt = JSON.stringify({ mandatory: { characters: [{ name: 'Mira', hp: 10 }] } });
    const instructions = 'First line\n```\n### Literal prompt heading\nLast line';
    const file = await logPrompt(
      'generate',
      { provider: 'codex', model: 'fixture', effort: null },
      prompt,
      instructions,
      directory
    );
    const readable = await readFile(file.replace(/\.json$/, '.md'), 'utf8');
    assert.ok(
      readable.includes(`\`\`\`json\n${JSON.stringify(JSON.parse(prompt), null, 2)}\n\`\`\``)
    );
    assert.ok(readable.includes(`\`\`\`\`text\n${instructions}\n\`\`\`\``));
    const exact = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(exact.prompt, prompt);
    assert.equal(exact.systemInstructions, instructions);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('readable logs separate appended transport instructions and preserve non-JSON prompts', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rpg-readable-text-log-'));
  try {
    const settings = { provider: 'codex', model: 'fixture', effort: null };
    const json = JSON.stringify({ action: 'Cross the bridge' });
    const suffix = 'Use the owned tools.\nReturn the final response.';
    const file = await logPrompt('mixed', settings, `${json}\n${suffix}`, undefined, directory);
    const readable = await readFile(file.replace(/\.json$/, '.md'), 'utf8');
    assert.ok(
      readable.includes(`\`\`\`json\n${JSON.stringify(JSON.parse(json), null, 2)}\n\`\`\``)
    );
    assert.ok(readable.includes(`\`\`\`text\n${suffix}\n\`\`\``));
    assert.ok(!readable.includes('## System instructions'));
    for (const prompt of ['{malformed', 'Plain text\nNext line', 'null', '"JSON scalar"']) {
      const plain = await logPrompt('plain', settings, prompt, undefined, directory);
      assert.ok((await readFile(plain.replace(/\.json$/, '.md'), 'utf8')).includes(prompt));
      assert.equal(JSON.parse(await readFile(plain, 'utf8')).prompt, prompt);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('prompt log I/O failures are actionable and never expose source content or private paths', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rpg-log-error-'));
  try {
    const file = path.join(directory, 'PRIVATE_PATH');
    await writeFile(file, 'occupied');
    await assert.rejects(
      logPrompt(
        'test',
        { provider: 'codex', model: 'fixture', effort: null },
        'PRIVATE_PROMPT',
        undefined,
        file
      ),
      (e: unknown) => {
        assert.equal((e as { code: string }).code, 'prompt_log');
        assert.doesNotMatch(String(e), /PRIVATE_PROMPT|PRIVATE_PATH/);
        return true;
      }
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
