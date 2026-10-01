import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, copyFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this check through npm run test:clean-install');
// Canonicalize Windows' ADMINI~1 temporary-directory alias before Vite resolves setup files.
const work = await realpath(await mkdtemp(path.join(os.tmpdir(), 'rpg-clean-install-')));
const { stdout } = await exec(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { cwd: root, windowsHide: true, maxBuffer: 5_000_000 }
);
const files = [...new Set(stdout.split('\0').filter(Boolean))];
for (const file of files) {
  const target = path.resolve(work, file);
  if (!target.startsWith(`${work}${path.sep}`)) throw new Error('Unexpected public path');
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(path.join(root, file), target);
}
const env = {
  ...process.env,
  npm_config_cache: path.join(work, '.npm-cache'),
  NODE_ENV: 'test',
  RPG_DATABASE_URL: '',
  RPG_TEST_DATABASE_URL: '',
  RPG_RUNTIME_TESTS: '0',
  LOCAL_RPG_LIVE_SMOKE: '',
  RPG_LIVE_CLI_TESTS: '',
  RPG_MODEL_CATALOG: '',
  RPG_WHISPER_MODEL_PATH: '',
};
for (const args of [
  ['ci'],
  ['run', 'typecheck'],
  ['run', 'lint'],
  ['run', 'format:check'],
  ['test'],
  ['run', 'build'],
]) {
  console.log(`Clean checkout: npm ${args.join(' ')}`);
  const result = await exec(process.execPath, [npmCli, ...args], {
    cwd: work,
    env: args.includes('build') ? { ...env, NODE_ENV: 'production' } : env,
    windowsHide: true,
    maxBuffer: 10_000_000,
    timeout: 240000,
  });
  console.log(result.stdout.trim());
}
console.log(
  `Fresh source/lockfile installation passed in ${work}. No existing DB or live AI was used.`
);
