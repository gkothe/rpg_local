import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, copyFile, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.RPG_GITLEAKS_BIN ?? 'gitleaks';
const work = await mkdtemp(path.join(os.tmpdir(), 'rpg-public-audit-'));
const stage = path.join(work, 'public');
await mkdir(stage);
const { stdout: listed } = await exec(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { cwd: root, windowsHide: true, maxBuffer: 5_000_000 }
);
const files = [...new Set(listed.split('\0').filter(Boolean))];
for (const file of files) {
  const source = path.resolve(root, file);
  if (!source.startsWith(`${root}${path.sep}`)) throw new Error('Public file escaped repository');
  const target = path.join(stage, file);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
}
// Bundles are deliberately audited even though build output is excluded from Git.
const assets = path.join(root, 'rpg_fe_local', 'dist', 'assets');
let bundleFiles;
try {
  bundleFiles = await readdir(assets);
} catch {
  throw new Error('Build the frontend before auditing its shipped bundle');
}
for (const file of bundleFiles) {
  await mkdir(path.join(stage, 'built-assets'), { recursive: true });
  await copyFile(path.join(assets, file), path.join(stage, 'built-assets', file));
}
const report = path.join(work, 'findings.redacted.json');
let scannerFailed = false;
try {
  await exec(
    binary,
    [
      'dir',
      stage,
      '--redact=100',
      '--no-banner',
      '--report-format',
      'json',
      '--report-path',
      report,
    ],
    { cwd: work, windowsHide: true, maxBuffer: 16_000_000 }
  );
} catch (error) {
  if (error.code !== 1)
    throw new Error('Secret scanner could not complete; install/configure Gitleaks', {
      cause: error,
    });
  scannerFailed = true;
}
const findings = JSON.parse(await readFile(report, 'utf8')) ?? [];
let commitCount = 0;
try {
  const { stdout } = await exec('git', ['rev-list', '--all', '--count'], {
    cwd: root,
    windowsHide: true,
  });
  commitCount = Number(stdout.trim());
} catch {
  // A fresh repository with no commits has no inherited history.
}
if (commitCount > 0) {
  try {
    await exec(
      binary,
      [
        'git',
        root,
        '--redact=100',
        '--no-banner',
        '--report-format',
        'json',
        '--report-path',
        path.join(work, 'history.redacted.json'),
      ],
      { cwd: work, windowsHide: true, maxBuffer: 16_000_000 }
    );
  } catch {
    scannerFailed = true;
  }
}
console.log(
  JSON.stringify(
    {
      publicFiles: files.length,
      bundles: bundleFiles.length,
      commitCount,
      findings: findings.map(({ File, RuleID, StartLine }) => ({
        file: path.relative(stage, File),
        rule: RuleID,
        line: StartLine,
      })),
      externalReport: report,
    },
    null,
    2
  )
);
if (scannerFailed || findings.length > 0) process.exitCode = 1;
