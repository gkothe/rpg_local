import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const filename = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env');

function readText(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw new Error('Could not read the project .env file', { cause: error });
  }
}

export function readProjectEnvironment(file = filename) {
  return parseEnv(readText(file));
}

export function saveDatabaseEnvironment(value, file = filename) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('A dedicated loopback PostgreSQL URL is required');
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    ['', '/', '/postgres', '/template0', '/template1'].includes(url.pathname) ||
    /[\r\n]/.test(value)
  )
    throw new Error('A dedicated loopback PostgreSQL URL is required');
  const quote = ['"', "'", '`'].find((candidate) => !value.includes(candidate));
  if (!quote) throw new Error('URL characters must be percent-encoded before saving');
  const assignment = `RPG_DATABASE_URL=${quote}${value}${quote}`;
  if (parseEnv(assignment).RPG_DATABASE_URL !== value)
    throw new Error('URL characters must be percent-encoded before saving');
  const text = readText(file);
  const previous = readProjectEnvironment(file).RPG_DATABASE_URL;
  if (previous && /[\r\n]/.test(previous))
    throw new Error('RPG_DATABASE_URL in .env must be a single-line URL');
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  let replaced = false;
  const lines = text.split(/\r?\n/).flatMap((line) => {
    if (!/^\s*(?:export\s+)?RPG_DATABASE_URL\s*=/.test(line)) return [line];
    if (replaced) return [];
    replaced = true;
    return [assignment];
  });
  if (!replaced) {
    if (lines.at(-1) === '') lines.pop();
    lines.push(assignment);
  }
  const updated = lines.join(newline);
  if (parseEnv(updated).RPG_DATABASE_URL !== value)
    throw new Error('Could not update RPG_DATABASE_URL in .env');
  writeFileSync(file, updated.endsWith(newline) ? updated : updated + newline, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === 'read') {
      const settings = readProjectEnvironment();
      process.stdout.write(
        JSON.stringify(
          Object.fromEntries(Object.entries(settings).filter(([key]) => /^RPG_/.test(key)))
        )
      );
    } else if (process.argv[2] === 'save-database') {
      saveDatabaseEnvironment(process.env.RPG_DATABASE_URL);
    } else {
      throw new Error('Use read or save-database');
    }
  } catch (error) {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  }
}
