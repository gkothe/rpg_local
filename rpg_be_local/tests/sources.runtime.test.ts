import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { appRoot } from '../src/config.js';
import { runProcess } from '../src/providers/processRunner.js';
import { audioDiagnostics, extractFile, transcribe } from '../src/services/sources.js';

const runtime = process.env.RPG_RUNTIME_TESTS === '1';

test(
  'actual Node wrapper extracts mixed/scanned PDF, retains UTF-8, and rejects blank PDFs',
  { skip: !runtime },
  async () => {
    const work = await mkdtemp(path.join(os.tmpdir(), 'rpg-wrapper-test-'));
    try {
      await runProcess(
        process.env.RPG_PYTHON_BIN ?? 'python',
        [path.join(appRoot, 'python', 'tests', 'make_fixtures.py'), work],
        '',
        { maxOutputBytes: 10000 }
      );
      const source = await extractFile(
        await readFile(path.join(work, 'mixed.pdf')),
        'mixed.pdf',
        'eng'
      );
      assert.equal(source.kind, 'pdf');
      assert.equal(source.status, 'confirmed');
      assert.equal(source.pages.length, 2);
      assert.equal(source.pages[1]!.method, 'tesseract');
      assert.match(source.text, /12 health/);
      assert.ok(source.warnings.length > 0);
      const portuguese = await extractFile(
        await readFile(path.join(work, 'portuguese.pdf')),
        'portuguese.pdf',
        'por'
      );
      assert.match(portuguese.text, /sa\u00fade 12/);
      await assert.rejects(
        extractFile(await readFile(path.join(work, 'blank.pdf')), 'blank.pdf', 'eng')
      );
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }
);

test(
  'actual Node local audio wrapper transcribes synthetic speech without cloud fallback',
  { skip: !runtime || !process.env.RPG_AUDIO_TEST_FILE },
  async () => {
    assert.equal((await audioDiagnostics()).available, true);
    const result = await transcribe(await readFile(process.env.RPG_AUDIO_TEST_FILE!), 'en');
    assert.match(result.text.toLowerCase(), /old tower/);
    assert.match(result.text.toLowerCase(), /healing potion/);
  }
);
