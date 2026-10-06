import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { databaseUrl, loadEnvironment } from '../src/config.js';

test('the .env loader parses quoted values and preserves explicit environment overrides', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'rpg-config-'));
  const file = join(directory, '.env');
  const previous = process.env.RPG_ENV_FIXTURE;
  t.after(() => {
    if (previous === undefined) delete process.env.RPG_ENV_FIXTURE;
    else process.env.RPG_ENV_FIXTURE = previous;
    rmSync(directory, { recursive: true, force: true });
  });
  writeFileSync(file, 'RPG_ENV_FIXTURE="quoted#value"\n');
  delete process.env.RPG_ENV_FIXTURE;
  loadEnvironment(file);
  assert.equal(process.env.RPG_ENV_FIXTURE, 'quoted#value');
  process.env.RPG_ENV_FIXTURE = 'explicit';
  loadEnvironment(file);
  assert.equal(process.env.RPG_ENV_FIXTURE, 'explicit');
  assert.doesNotThrow(() => loadEnvironment(join(directory, 'missing.env')));
  assert.throws(() => loadEnvironment(directory), /Could not read the project .env file/);
});

test('test database configuration remains isolated from the normal .env database', () => {
  const game = 'postgresql://fixture:synthetic@127.0.0.1:5432/game';
  const isolated = 'postgresql://fixture:synthetic@127.0.0.1:5432/game_test';
  assert.equal(databaseUrl({ RPG_DATABASE_URL: game }), game);
  assert.equal(
    databaseUrl({ NODE_ENV: 'test', RPG_DATABASE_URL: game, RPG_TEST_DATABASE_URL: isolated }),
    isolated
  );
  assert.throws(
    () => databaseUrl({ NODE_ENV: 'test', RPG_DATABASE_URL: game }),
    /RPG_TEST_DATABASE_URL/
  );
  assert.throws(
    () => databaseUrl({ NODE_ENV: 'test', RPG_DATABASE_URL: game, RPG_TEST_DATABASE_URL: game }),
    /distinct database/
  );
});
