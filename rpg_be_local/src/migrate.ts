import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { Store } from './store.js';
import { appRoot } from './config.js';
const store = new Store();
try {
  await store.transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(148254731)');
    await client.query(
      'CREATE TABLE IF NOT EXISTS migration_history(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())'
    );
    for (const name of (await readdir(path.join(appRoot, 'migrationssql')))
      .filter((x) => x.endsWith('.sql'))
      .sort()) {
      const old = await client.query('SELECT name FROM migration_history WHERE name=$1', [name]);
      if (old.rowCount) continue;
      await client.query(await readFile(path.join(appRoot, 'migrationssql', name), 'utf8'));
      await client.query('INSERT INTO migration_history(name) VALUES($1)', [name]);
      console.log(`Applied ${name}`);
    }
  });
} finally {
  await store.close();
}
