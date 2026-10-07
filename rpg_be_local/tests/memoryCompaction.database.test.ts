import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Store } from '../src/store.js';
import { appRoot, databaseUrl } from '../src/config.js';
import { newCampaign } from '../src/domain/campaign.js';
import { TurnService } from '../src/services/turns.js';
import { TurnStatus } from '../src/domain/options.js';
import type { Generator } from '../src/providers/service.js';

const enabled = process.env.NODE_ENV === 'test' && !!process.env.RPG_TEST_DATABASE_URL;
const schema = `compaction_fixture_${randomUUID().replaceAll('-', '')}`;
let store: Store;
before(async () => {
  if (!enabled) return;
  const bootstrap = new Store();
  await bootstrap.pool.query(`CREATE SCHEMA ${schema}`);
  await bootstrap.close();
  const url = new URL(databaseUrl());
  url.searchParams.set('options', `-c search_path=${schema}`);
  store = new Store(url.toString());
  for (const file of (await readdir(path.join(appRoot, 'migrationssql')))
    .filter((name) => name.endsWith('.sql'))
    .sort())
    await store.pool.query(await readFile(path.join(appRoot, 'migrationssql', file), 'utf8'));
});
after(async () => {
  if (!enabled) return;
  await store.pool.query(`DROP SCHEMA ${schema} CASCADE`);
  await store.close();
});

const LONG_SCENE = 'The arena crowd roars while the Embrace takes hold. '.repeat(40);

test(
  'automatic compaction appends each batch to the exact prior memory even when the model returns only new events',
  { skip: !enabled },
  async () => {
    const memoryOutputs: string[] = [];
    let lastNarrative = '';
    const generator: Generator = {
      capacity: async (_settings, ceiling = 16000) => ceiling,
      gameplayCapacity: async () => 16000,
      generate: async (_settings, _prompt, schemaArg) => {
        const memory = !!(schemaArg as { properties?: { text?: unknown } }).properties?.text;
        if (!memory) return { narrative: lastNarrative };
        const text = `- Batch ${memoryOutputs.length}: only the new events.`;
        memoryOutputs.push(text);
        return { text };
      },
      generateOwnedGameplay: async (_settings, prompt) => {
        const action = JSON.parse(prompt).mandatory.action as string;
        lastNarrative = `${LONG_SCENE} ${action}.`;
        return {
          combatEffects: [],
          participantReferences: [],
          narrative: lastNarrative,
          operations: [],
          rollInterpretations: [],
          ruleCitations: [],
          knowledgeChanges: [],
          operationExplanations: [],
        };
      },
    };
    const service = new TurnService(store, generator);
    const c = newCampaign({ name: 'Synthetic compaction' });
    await store.insert(c);
    const seen: string[] = [];
    for (let index = 0; index < 14; index++) {
      const current = await store.campaign(c.id);
      const turn = await service.submit(c.id, {
        revision: current.revision,
        requestId: randomUUID(),
        action: `Explore room ${index}`,
      });
      for (let poll = 0; poll < 2000; poll++) {
        const saved = await store.turn(c.id, turn.id);
        if (![TurnStatus.Pending, TurnStatus.Running].includes(saved.status as TurnStatus)) {
          assert.equal(saved.status, 'completed', saved.error ?? `Turn ${index} failed`);
          break;
        }
        await delay(1);
      }
      const memory = (await store.campaign(c.id)).memory;
      if (memory && seen.at(-1) !== memory.text) {
        const previous = seen.at(-1);
        if (previous)
          assert.ok(memory.text.startsWith(previous), 'prior memory text was rewritten');
        seen.push(memory.text);
      }
    }
    assert.ok(memoryOutputs.length >= 2, 'fixture must trigger several compactions');
    const final = (await store.campaign(c.id)).memory!;
    for (const output of memoryOutputs) assert.ok(final.text.includes(output));
    // Coverage is a duplicate-free consecutive prefix of active turns.
    const active = (await store.activeTurns(c.id)).map((t) => t.id);
    assert.deepEqual(final.coveredTurnIds, active.slice(0, final.coveredTurnIds.length));
    assert.equal(new Set(final.coveredTurnIds).size, final.coveredTurnIds.length);
  }
);
