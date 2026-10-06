import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
import { Problem } from './errors.js';
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const appRoot = path.resolve(
  moduleDir,
  moduleDir.endsWith(`${path.sep}dist${path.sep}src`) ? '../..' : '..'
);
export function loadEnvironment(filename = path.resolve(appRoot, '..', '.env')): void {
  try {
    loadEnvFile(filename);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new Problem(503, 'environment_setup', 'Could not read the project .env file');
  }
}
loadEnvironment();
export function databaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.NODE_ENV === 'test' ? env.RPG_TEST_DATABASE_URL : env.RPG_DATABASE_URL;
  if (!value)
    throw new Problem(
      503,
      'database_setup',
      'Set RPG_DATABASE_URL to a dedicated local PostgreSQL database (tests require RPG_TEST_DATABASE_URL)'
    );
  const u = new URL(value);
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) ||
    !['postgres:', 'postgresql:'].includes(u.protocol)
  )
    throw new Problem(
      503,
      'database_setup',
      'Only loopback PostgreSQL is supported; do not use old production credentials'
    );
  if (env.NODE_ENV === 'test' && (!u.pathname.endsWith('_test') || value === env.RPG_DATABASE_URL))
    throw new Problem(
      503,
      'database_setup',
      'Test URL must target a distinct database whose name ends in _test'
    );
  return value;
}
export const uploadBytes = 20 * 1024 * 1024;
