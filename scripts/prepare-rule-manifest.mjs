import { createHash } from 'node:crypto';
import { readdir, lstat, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { RULE_COLUMNS, RULE_LIMITS } from '../rpg_be_local/src/domain/rules.ts';
import { parseRuleBook } from '../rpg_be_local/src/domain/ruleImport.ts';

try {
  const { values } = parseArgs({
    options: {
      columns: { type: 'string' },
      title: { type: 'string' },
      'page-count': { type: 'string' },
      out: { type: 'string' },
      'converter-id': { type: 'string', default: 'annotated-markdown' },
      'converter-version': { type: 'string', default: '1' },
      'pdf-hash': { type: 'string' },
      omission: { type: 'string', multiple: true },
    },
    strict: true,
    allowPositionals: false,
  });
  if (!values.columns || !values.title || !values['page-count'])
    throw new Error(
      'Required: --columns <directory> --title <title> --page-count <count>; optional --out <new manifest path>. Original columns are read-only.'
    );
  const directory = path.resolve(values.columns);
  const names = (await readdir(directory)).filter((name) => name.endsWith('.md'));
  if (names.some((name) => !RULE_COLUMNS.some((column) => name === `${column}.md`)))
    throw new Error('The column directory contains an unknown Markdown filename');
  const files = [];
  let bytes = 0;
  let source;
  for (const column of RULE_COLUMNS) {
    const name = `${column}.md`;
    if (!names.includes(name)) continue;
    const info = await lstat(path.join(directory, name));
    if (!info.isFile() || info.isSymbolicLink() || info.size > RULE_LIMITS.importFileBytes)
      throw new Error(`Invalid or oversized column file: ${name}`);
    bytes += info.size;
    if (bytes > RULE_LIMITS.importBytes)
      throw new Error('Combined column files exceed the book upload limit');
    const contents = await readFile(path.join(directory, name));
    const text = new TextDecoder('utf8', { fatal: true }).decode(contents);
    const match = /^<!-- column:\s*([a-z_]+)\s*\|\s*source:\s*([a-z0-9_-]+)/.exec(text);
    if (!match || match[1] !== column || (source && source !== match[2]))
      throw new Error(`Column/source header mismatch: ${name}`);
    source = match[2];
    files.push({ column, name, bytes: contents });
  }
  if (!files.length) throw new Error('No recognized column files found');
  const manifest = {
    format: 'rules-book',
    version: 1,
    markerFormatVersion: 1,
    source: {
      slug: source,
      title: values.title,
      pageCount: Number(values['page-count']),
      pdfHash: values['pdf-hash'] ?? null,
    },
    columns: files.map((file) => ({
      column: file.column,
      file: file.name,
      hash: createHash('sha256').update(file.bytes).digest('hex'),
    })),
    converter: { id: values['converter-id'], version: values['converter-version'] },
    coverage: {
      description: 'Prepared local Markdown columns; extraction completeness is a separate review.',
      omissions: values.omission ?? [
        'No independent PDF/image/OCR completeness check was performed by the packager.',
      ],
    },
  };
  const serialized = JSON.stringify(manifest, null, 2) + '\n';
  const parsed = parseRuleBook([
    { name: 'manifest.json', bytes: Buffer.from(serialized) },
    ...files,
  ]);
  if (values.out) {
    const output = path.resolve(values.out);
    const relative = path.relative(directory.toLowerCase(), output.toLowerCase());
    if (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))
      throw new Error(
        '--out must be outside the read-only column directory; select the generated manifest together with the unchanged original columns in the app'
      );
    await writeFile(output, serialized, { encoding: 'utf8', flag: 'wx' });
    console.log(
      JSON.stringify({
        manifest: output,
        columns: files.length,
        nodes: parsed.nodeCount,
        originalFiles: 'unchanged',
        pdfHash: manifest.source.pdfHash ? 'provided' : 'unknown',
      })
    );
  } else process.stdout.write(serialized);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Unable to prepare rule manifest');
  process.exitCode = 1;
}
