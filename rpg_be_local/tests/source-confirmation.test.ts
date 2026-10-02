import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFile, textSource } from '../src/services/sources.js';
import { SourceStatus } from '../src/domain/options.js';

test('UTF-8 Markdown and plain-text imports are confirmed without a review step', async () => {
  for (const name of ['campaign.md', 'sheet.txt', 'background.markdown']) {
    const text = '# Sigurd\nVampire — São Paulo\n';
    const source = await extractFile(Buffer.from(text), name);
    assert.equal(source.status, SourceStatus.Confirmed);
    assert.equal(source.text, text);
    assert.equal(source.name, name);
    assert.equal(source.kind, 'file');
  }
});

test('blank and invalid UTF-8 files cannot become usable sources', async () => {
  await assert.rejects(extractFile(Buffer.from('  '), 'blank.md'), /no text/);
  await assert.rejects(extractFile(Buffer.from([0xff]), 'invalid.md'));
  assert.equal(
    textSource('PDF extracted text', 'Review extraction', 'pdf').status,
    SourceStatus.Confirmed
  );
  assert.equal(textSource('Pasted text', 'Review draft').status, SourceStatus.Confirmed);
});
