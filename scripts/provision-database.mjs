import pg from 'pg';
import { randomBytes } from 'node:crypto';

let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (Buffer.byteLength(input) > 16384) throw new Error('Setup input exceeds limit');
}
const { port, user, password } = JSON.parse(input);
const role = 'rpg_local_owner';
const database = 'rpg_local';
const localPassword = randomBytes(32).toString('hex');
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
  await client.query('SELECT pg_advisory_lock(148254732)');
  const existing = await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [database]);
  const existingRole = await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role]);
  if (existing.rowCount || existingRole.rowCount) {
    throw new Error(
      'rpg_local database or role already exists. Use setup-database.ps1 -ConfigureExisting with its existing connection URL.'
    );
  }
  const statement = await client.query(
    "SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE', $1::text, $2::text) AS sql",
    [role, localPassword]
  );
  await client.query(statement.rows[0].sql);
  try {
    await client.query('CREATE DATABASE rpg_local OWNER rpg_local_owner');
  } catch (error) {
    await client.query('DROP ROLE rpg_local_owner');
    throw error;
  }
  const url = new URL(`postgresql://127.0.0.1:${port}/${database}`);
  url.username = role;
  url.password = localPassword;
  process.stdout.write(JSON.stringify({ databaseUrl: url.href }));
} catch (error) {
  // Do not print credentials, URLs or the password-containing SQL.
  console.error(
    error.message?.startsWith('rpg_local')
      ? error.message
      : 'Could not create the dedicated database. Check PostgreSQL, administrator login and CREATE ROLE/DATABASE privileges.'
  );
  process.exitCode = 1;
} finally {
  await client.end();
}
