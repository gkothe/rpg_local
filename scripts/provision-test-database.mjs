import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Creates an isolated test role/database and records its URL in the ignored project .env.
let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (Buffer.byteLength(input) > 16384) throw new Error('Setup input exceeds limit');
}
const { port, user, password } = JSON.parse(input);
const role = 'rpg_local_test_owner';
const database = 'rpg_local_test';
const rolePassword = randomBytes(32).toString('hex');
const envFile = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env');
const client = new pg.Client({
  host: '127.0.0.1',
  port,
  user,
  password,
  database: 'postgres',
  connectionTimeoutMillis: 8000,
});
try {
  await client.connect();
  const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role]);
  const statement = await client.query(
    `SELECT format('${exists.rowCount ? 'ALTER' : 'CREATE'} ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE', $1::text, $2::text) AS sql`,
    [role, rolePassword]
  );
  await client.query(statement.rows[0].sql);
  const db = await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [database]);
  if (!db.rowCount) await client.query(`CREATE DATABASE ${database} OWNER ${role}`);
  const url = new URL(`postgresql://127.0.0.1:${port}/${database}`);
  url.username = role;
  url.password = rolePassword;
  const lines = existsSync(envFile)
    ? readFileSync(envFile, 'utf8')
        .split(/\r?\n/)
        .filter((line) => line && !line.startsWith('RPG_TEST_DATABASE_URL='))
    : [];
  lines.push(`RPG_TEST_DATABASE_URL=${url.href}`);
  writeFileSync(envFile, lines.join('\n') + '\n');
  console.log(`Test database ${database} is ready; RPG_TEST_DATABASE_URL was written to .env.`);
} catch {
  // Never print credentials or password-containing SQL.
  console.error(
    'Could not create the test database. Check PostgreSQL, the administrator login and CREATE ROLE/DATABASE privileges.'
  );
  process.exitCode = 1;
} finally {
  await client.end();
}
