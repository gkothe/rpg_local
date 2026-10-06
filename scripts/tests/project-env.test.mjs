import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFileSync, mkdirSync } from 'node:fs';
import { readProjectEnvironment, saveDatabaseEnvironment } from '../project-env.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'rpg-env-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, '.env');
}

const url = 'postgresql://fixture:synthetic%23password@127.0.0.1:5432/fixture';

test('setup writes a quoted database URL and preserves other .env settings', (t) => {
  const file = fixture(t);
  writeFileSync(file, '# Keep this comment\r\nRPG_PORT=4200\r\nexport RPG_DATABASE_URL="old"\r\n');
  saveDatabaseEnvironment(url, file);
  assert.equal(readProjectEnvironment(file).RPG_DATABASE_URL, url);
  assert.equal(readProjectEnvironment(file).RPG_PORT, '4200');
  assert.match(readFileSync(file, 'utf8'), /# Keep this comment\r\n/);
  saveDatabaseEnvironment(url, file);
  assert.equal(readFileSync(file, 'utf8').match(/RPG_DATABASE_URL=/g).length, 1);
});

test('setup creates a missing .env and eliminates duplicate database assignments', (t) => {
  const file = fixture(t);
  assert.deepEqual(Object.keys(readProjectEnvironment(file)), []);
  saveDatabaseEnvironment(url, file);
  assert.equal(readProjectEnvironment(file).RPG_DATABASE_URL, url);
  writeFileSync(file, 'RPG_DATABASE_URL=first\nRPG_PORT=4100\nRPG_DATABASE_URL=second\n');
  saveDatabaseEnvironment(url, file);
  assert.equal(readFileSync(file, 'utf8').match(/RPG_DATABASE_URL=/g).length, 1);
  assert.equal(readProjectEnvironment(file).RPG_DATABASE_URL, url);
});

test('setup rejects invalid or nonlocal URLs without overwriting existing settings', (t) => {
  const file = fixture(t);
  writeFileSync(file, '# retained\nRPG_PORT=4100\n');
  for (const value of [
    undefined,
    'invalid',
    'postgresql://example.com/game',
    'postgresql://localhost/postgres',
  ])
    assert.throws(() => saveDatabaseEnvironment(value, file), /dedicated loopback/);
  assert.equal(readFileSync(file, 'utf8'), '# retained\nRPG_PORT=4100\n');
});

test(
  'Windows launcher loads .env, respects overrides, and ignores old database.json',
  {
    skip: process.platform !== 'win32',
  },
  async (t) => {
    const file = fixture(t);
    const directory = join(file, '..');
    const scripts = join(directory, 'scripts');
    mkdirSync(scripts);
    mkdirSync(join(directory, 'LocalRPG'));
    copyFileSync(new URL('../project-env.mjs', import.meta.url), join(scripts, 'project-env.mjs'));
    copyFileSync(
      new URL('../local-settings.ps1', import.meta.url),
      join(scripts, 'local-settings.ps1')
    );
    writeFileSync(file, `RPG_DATABASE_URL="${url}"\nRPG_PORT=4200\n`);
    writeFileSync(
      join(directory, 'LocalRPG', 'database.json'),
      '{"databaseUrl":"invalid legacy data"}'
    );
    const command = [
      '$env:RPG_DATABASE_URL = $null',
      '. (Join-Path $env:RPG_ENV_FIXTURE_DIR "scripts/local-settings.ps1")',
      "if ($env:RPG_PORT -ne '4999') { throw 'Override was lost' }",
      "if ($env:RPG_DATABASE_URL -ne $env:RPG_ENV_EXPECTED_URL) { throw 'Database value was not loaded' }",
      "Write-Output 'loaded'",
    ].join('\n');
    const { stdout } = await promisify(execFile)(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
      {
        windowsHide: true,
        env: {
          ...process.env,
          LOCALAPPDATA: directory,
          RPG_ENV_FIXTURE_DIR: directory,
          RPG_ENV_EXPECTED_URL: url,
          RPG_PORT: '4999',
        },
      }
    );
    assert.equal(stdout.trim(), 'loaded');
  }
);
