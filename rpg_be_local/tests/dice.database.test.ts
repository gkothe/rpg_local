import { ARCHIVE_FORMAT_VERSION } from '../src/domain/versions.js';
import type { GameplayToolDispatch } from '../src/providers/gameplayTools.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { Store, ownerId } from '../src/store.js';
import { appRoot, databaseUrl } from '../src/config.js';
import { newCampaign } from '../src/domain/campaign.js';
import { DiceService } from '../src/services/dice.js';
import type { Turn } from '../src/domain/types.js';
import { TurnService } from '../src/services/turns.js';
import { LibraryService } from '../src/services/library.js';
import { Problem } from '../src/errors.js';
import { TurnStatus } from '../src/domain/options.js';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { ProviderService } from '../src/providers/service.js';
import type { ProviderSettings } from '../src/domain/types.js';
import type { RollCallback } from '../src/providers/diceProtocol.js';
import { DICE_LIMITS } from '../src/domain/dice.js';

const enabled = process.env.NODE_ENV === 'test' && !!process.env.RPG_TEST_DATABASE_URL;
let store: Store;
const fixtureSchema = `dice_fixture_${randomUUID().replaceAll('-', '')}`;
const executeFile = promisify(execFile);
before(async () => {
  if (!enabled) return;
  const setup = new Store();
  await setup.pool.query(`CREATE SCHEMA ${fixtureSchema}`);
  await setup.close();
  const url = new URL(databaseUrl());
  url.searchParams.set('options', `-c search_path=${fixtureSchema}`);
  store = new Store(url.toString());
  for (const file of (await readdir(path.join(appRoot, 'migrationssql')))
    .filter((name) => name.endsWith('.sql'))
    .sort())
    await store.pool.query(await readFile(path.join(appRoot, 'migrationssql', file), 'utf8'));
});
after(async () => {
  if (enabled) {
    await store.pool.query(`DROP SCHEMA ${fixtureSchema} CASCADE`);
    await store.close();
  }
});
test(
  'long-running attempts keep their dice until explicit player cancellation',
  { skip: !enabled },
  async (context) => {
    const campaign = newCampaign({ name: 'Timeout dice fixture' });
    await store.insert(campaign);
    let revealed!: () => void;
    const ready = new Promise<void>((resolve) => {
      revealed = resolve;
    });
    const service = new TurnService(store, {
      capacity: async () => 16000,
      gameplayCapacity: async () => 16000,
      generate: async () => {
        throw new Error('Unexpected no-tools call');
      },
      generateGameplay: async (_settings, _prompt, roll, signal) => {
        await roll(
          {
            slot: 0,
            groups: [{ label: 'check', count: 1, sides: 6 }],
            reason: 'Door',
            declaration: 'Target 4',
          },
          'first'
        );
        return new Promise((_resolve, reject) => {
          signal!.addEventListener(
            'abort',
            () => reject(new Problem(409, 'cancelled', 'Synthetic abort')),
            { once: true }
          );
          revealed();
        });
      },
    });
    context.mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const submitted = await service.submit(campaign.id, {
        revision: 0,
        requestId: randomUUID(),
        action: 'Door',
      });
      await ready;
      context.mock.timers.tick(DICE_LIMITS.attemptMs + 1);
      assert.equal((await store.turn(campaign.id, submitted.id)).status, TurnStatus.Running);
      await service.cancel(campaign.id, submitted.id);
      let terminal = await store.turn(campaign.id, submitted.id);
      const cleanupDeadline = Date.now() + 5000;
      while (terminal.status !== TurnStatus.Cancelled && Date.now() < cleanupDeadline) {
        await new Promise<void>((resolve) => setImmediate(resolve));
        terminal = await store.turn(campaign.id, submitted.id);
      }
      assert.equal(terminal.status, TurnStatus.Cancelled);
      assert.match(terminal.error!, /Cancelled/);
      assert.equal(terminal.rolls?.length, 1);
      assert.equal((await store.campaign(campaign.id)).revision, 0);
    } finally {
      context.mock.timers.reset();
      await store.pool.query('DELETE FROM campaigns WHERE id=$1', [campaign.id]);
    }
  }
);

test(
  'HTTP dice retry binds identity, terminal status and switched-provider capacity',
  { skip: !enabled },
  async () => {
    const campaign = newCampaign({ name: 'HTTP dice fixture' });
    await store.insert(campaign);
    class FixtureProviders extends ProviderService {
      fail = true;
      override async capacity() {
        return 16000;
      }
      override async gameplayCapacity(settings: ProviderSettings) {
        if (settings.model === 'too-small')
          throw new Problem(422, 'context_overflow', 'Fixture provider has insufficient capacity');
        return 16000;
      }
      override async generate() {
        return { narrative: 'Door opens' };
      }
      override async generateOwnedGameplay(
        settings: ProviderSettings,
        prompt: string,
        _schema: unknown,
        _systemPrompt: string,
        tools: GameplayToolDispatch
      ) {
        const result = await this.generateGameplay(
          settings,
          prompt,
          async (input, id) =>
            tools('roll_dice', input, id) as Promise<import('../src/domain/dice.js').DiceResult>
        );
        return {
          ...result,
          version: 5,
          ruleCitations: [],
          knowledgeChanges: [],
          operationExplanations: [],
        };
      }
      override async generateGameplay(
        _settings: ProviderSettings,
        _prompt: string,
        roll: RollCallback
      ) {
        const result = await roll(
          {
            slot: 0,
            groups: [{ label: 'check', count: 1, sides: 6 }],
            reason: 'Door',
            declaration: 'Target 4',
          },
          'first'
        );
        if (this.fail) throw new Problem(502, 'fixture_failure', 'Synthetic failure');
        return {
          version: 2,
          narrative: 'Door',
          operations: [],
          rollInterpretations: [{ rollId: result.rollId, explanation: 'Interpretation' }],
        };
      }
    }
    const providers = new FixtureProviders();
    const { app } = createApp({ store, providers });
    const post = (path: string, body: object) =>
      request(app)
        .post(path)
        .set('Host', 'localhost:4100')
        .set('X-RPG-Client', 'local-rpg')
        .send(body);
    const finish = async (id: string) => {
      for (let count = 0; count < 100; count++) {
        const turn = await store.turn(campaign.id, id);
        if (turn.status !== TurnStatus.Pending && turn.status !== TurnStatus.Running) return turn;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error('HTTP fixture did not finish');
    };
    try {
      const submitted = await post(`/api/campaigns/${campaign.id}/turns`, {
        revision: 0,
        requestId: randomUUID(),
        action: 'Door',
      }).expect(202);
      const failed = await finish(submitted.body.data.id);
      const path = `/api/campaigns/${campaign.id}/turns/${failed.id}/retry`;
      await post(path, { revision: 0, requestId: randomUUID(), action: 'Different action' }).expect(
        422
      );
      await post(path, {
        revision: 0,
        requestId: randomUUID(),
        settings: { provider: 'codex', model: 'too-small', effort: null },
      }).expect(422);
      assert.equal((await store.turns(campaign.id)).length, 1);
      providers.fail = false;
      const input = {
        revision: 0,
        requestId: randomUUID(),
        settings: { provider: 'codex', model: 'fixture', effort: null },
      };
      const retry = await post(path, input).expect(202);
      const completed = await finish(retry.body.data.id);
      assert.equal(completed.status, TurnStatus.Completed);
      assert.equal(completed.rolls![0]!.id, failed.rolls![0]!.id);
      const replay = await post(path, input).expect(202);
      assert.equal(replay.body.data.id, completed.id);
      await post(path, { ...input, settings: campaign.settings }).expect(409);
      await post(`/api/campaigns/${campaign.id}/turns/${completed.id}/retry`, {
        revision: 1,
        requestId: randomUUID(),
      }).expect(409);
    } finally {
      await store.pool.query('DELETE FROM campaigns WHERE id=$1', [campaign.id]);
    }
  }
);

test(
  'trusted gameplay persists failed rolls, retries exact faces across providers, validates interpretation, undoes and archives audit',
  { skip: !enabled },
  async () => {
    const campaign = newCampaign({ name: 'Trusted gameplay fixture' });
    await store.insert(campaign);
    let mode = 'fail';
    const input = {
      slot: 0,
      groups: [{ label: 'check', count: 1, sides: 6 }],
      reason: 'Open a door',
      declaration: 'No modifiers; target 4',
    };
    const service = new TurnService(store, {
      capacity: async () => 16000,
      gameplayCapacity: async () => 16000,
      generate: async () => {
        throw new Error('Unexpected no-tools call');
      },
      generateGameplay: async (_settings, prompt, roll) => {
        assert.ok(prompt.includes('rollInterpretations'));
        const first = await roll(input, 'first');
        if (mode === 'fail')
          throw new Problem(502, 'fixture_failure', 'Synthetic failure after reveal');
        if (mode === 'unknown')
          return {
            version: 2,
            narrative: 'Invalid',
            operations: [],
            rollInterpretations: [{ rollId: randomUUID(), explanation: 'Unknown' }],
          };
        const second = await roll(
          {
            ...input,
            slot: 1,
            reason: 'Follow-up',
            declaration: `First face ${first.groups[0]!.faces[0]}; no modifiers`,
          },
          'second'
        );
        return {
          version: 2,
          narrative: `Faces ${first.groups[0]!.faces[0]}, ${second.groups[0]!.faces[0]}`,
          operations: [{ op: 'state', expected: {}, value: { door: 'open' } }],
          rollInterpretations: [first, second].map((result) => ({
            rollId: result.rollId,
            explanation: 'The GM interprets the trusted face',
          })),
        };
      },
    });
    const finish = async (id: string) => {
      for (let count = 0; count < 200; count++) {
        const turn = await store.turn(campaign.id, id);
        if (![TurnStatus.Pending, TurnStatus.Running].includes(turn.status as TurnStatus))
          return turn;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error('Fixture turn did not finish');
    };
    try {
      const failed = await finish(
        (
          await service.submit(campaign.id, {
            revision: 0,
            requestId: randomUUID(),
            action: 'Open a door',
          })
        ).id
      );
      assert.equal(failed.status, TurnStatus.Failed);
      assert.equal(failed.rolls?.length, 1);
      await store.pool.query(
        "UPDATE turns SET status=$2,document=jsonb_set(document,'{status}',to_jsonb($2::text)),lease_until=now()-interval '1 second' WHERE id=$1",
        [failed.id, TurnStatus.Running]
      );
      assert.equal(await store.recover(), 1);
      assert.equal((await store.turn(campaign.id, failed.id)).status, TurnStatus.Interrupted);
      const originalFace = failed.rolls![0]!.groups[0]!.faces[0];
      mode = 'success';
      const retryInput = {
        revision: 0,
        requestId: randomUUID(),
        settings: { provider: 'codex', model: 'fixture', effort: null },
      };
      const completed = await finish((await service.retry(campaign.id, failed.id, retryInput)).id);
      assert.equal(completed.status, TurnStatus.Completed, completed.error ?? undefined);
      assert.equal(completed.rolls?.length, 2);
      assert.equal(completed.rolls![0]!.groups[0]!.faces[0], originalFace);
      assert.equal(completed.rolls![0]!.id, failed.rolls![0]!.id);
      assert.equal((await store.turn(campaign.id, failed.id)).rolls?.length, 1);
      assert.equal((await service.retry(campaign.id, failed.id, retryInput)).id, completed.id);
      assert.deepEqual((await store.campaign(campaign.id)).state, { door: 'open' });
      mode = 'unknown';
      const rejected = await finish(
        (
          await service.submit(campaign.id, {
            revision: 1,
            requestId: randomUUID(),
            action: 'Another roll',
          })
        ).id
      );
      assert.equal(rejected.status, TurnStatus.Failed);
      assert.match(rejected.error!, /acknowledge exactly/);
      assert.deepEqual((await store.campaign(campaign.id)).state, { door: 'open' });
      await service.undo(campaign.id, 1);
      assert.deepEqual((await store.campaign(campaign.id)).state, {});
      assert.equal((await store.turn(campaign.id, completed.id)).rolls?.length, 2);
      await assert.rejects(
        service.retry(campaign.id, rejected.id, { revision: 2, requestId: randomUUID() }),
        /context changed/
      );
      const library = new LibraryService(store);
      const archive = await library.export(campaign.id);
      assert.equal(archive.version, ARCHIVE_FORMAT_VERSION);
      assert.equal(archive.diceRecords?.length, 3);
      const malformed = structuredClone(archive);
      malformed.diceRecords![0]!.groups[0]!.faces[0] = 7;
      await assert.rejects(library.import(malformed));
      const missingReference = structuredClone(archive);
      missingReference.diceRecords![0]!.sessionId = randomUUID();
      await assert.rejects(library.import(missingReference));
      const imported = await library.import(archive);
      try {
        const importedTurns = await store.turns(imported.id);
        assert.equal(importedTurns[0]!.rolls?.length, 1);
        assert.equal(importedTurns[1]!.rolls?.length, 2);
        assert.notEqual(importedTurns[0]!.rolls![0]!.id, failed.rolls![0]!.id);
        assert.equal(importedTurns[0]!.rolls![0]!.groups[0]!.faces[0], originalFace);
        await assert.rejects(
          service.retry(imported.id, importedTurns.at(-1)!.id, {
            revision: imported.revision,
            requestId: randomUUID(),
          }),
          /non-executable/
        );
      } finally {
        await store.pool.query('DELETE FROM campaigns WHERE id=$1', [imported.id]);
      }
    } finally {
      await store.pool.query('DELETE FROM campaigns WHERE id=$1', [campaign.id]);
    }
  }
);

test(
  'cancelled dice attempts retain faces and reject late mutation before explicit replay',
  { skip: !enabled },
  async () => {
    const campaign = newCampaign({ name: 'Cancellation dice fixture' });
    await store.insert(campaign);
    let reveal!: () => void;
    const revealed = new Promise<void>((resolve) => {
      reveal = resolve;
    });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let first = true;
    let lateRejected = false;
    const input = {
      slot: 0,
      groups: [{ label: 'check', count: 1, sides: 6 }],
      reason: 'Door',
      declaration: 'No modifiers; target 4',
    };
    const service = new TurnService(store, {
      capacity: async () => 16000,
      gameplayCapacity: async () => 16000,
      generate: async () => {
        throw new Error('Unexpected no-tools call');
      },
      generateGameplay: async (_settings, _prompt, roll) => {
        const result = await roll(input, 'first');
        if (first) {
          first = false;
          reveal();
          await held;
          await assert.rejects(roll({ ...input, slot: 1 }, 'late'), /active/);
          lateRejected = true;
        }
        return {
          version: 2,
          narrative: 'Door check',
          operations: [],
          rollInterpretations: [{ rollId: result.rollId, explanation: 'Interpretation' }],
        };
      },
    });
    try {
      const submitted = await service.submit(campaign.id, {
        revision: 0,
        requestId: randomUUID(),
        action: 'Door',
      });
      await revealed;
      assert.equal((await store.turn(campaign.id, submitted.id)).rolls?.length ?? 0, 0);
      await service.cancel(campaign.id, submitted.id);
      release();
      for (let count = 0; !lateRejected && count < 100; count++)
        await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(lateRejected, true);
      const cancelled = await store.turn(campaign.id, submitted.id);
      assert.equal(cancelled.status, TurnStatus.Cancelled);
      assert.equal(cancelled.rolls?.length, 1);
      assert.equal((await store.campaign(campaign.id)).revision, 0);
      const retry = await service.retry(campaign.id, submitted.id, {
        revision: 0,
        requestId: randomUUID(),
      });
      let completed = await store.turn(campaign.id, retry.id);
      for (let count = 0; completed.status !== TurnStatus.Completed && count < 100; count++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        completed = await store.turn(campaign.id, retry.id);
      }
      assert.equal(completed.status, TurnStatus.Completed);
      assert.equal(completed.rolls![0]!.id, cancelled.rolls![0]!.id);
      assert.deepEqual(completed.rolls![0]!.groups, cancelled.rolls![0]!.groups);
    } finally {
      release();
      await store.pool.query('DELETE FROM campaigns WHERE id=$1', [campaign.id]);
    }
  }
);
test(
  'migration runner applies dice on fresh and already-migrated isolated schemas and replays without edits',
  { skip: !enabled },
  async () => {
    for (const upgraded of [false, true]) {
      const schema = `dice_migration_${randomUUID().replaceAll('-', '')}`;
      await store.pool.query(`CREATE SCHEMA ${schema}`);
      const url = new URL(databaseUrl());
      url.searchParams.set('options', `-c search_path=${schema}`);
      const migrated = new Store(url.toString());
      try {
        if (upgraded) {
          await migrated.pool.query(
            'CREATE TABLE migration_history(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())'
          );
          for (const name of [
            '0001_local.sql',
            '0002_source_artifacts.sql',
            '0003_character_templates.sql',
          ]) {
            await migrated.pool.query(
              await readFile(path.join(appRoot, 'migrationssql', name), 'utf8')
            );
            await migrated.pool.query('INSERT INTO migration_history(name) VALUES($1)', [name]);
          }
        }
        const run = () =>
          executeFile(
            process.execPath,
            [
              path.join(appRoot, '../node_modules/tsx/dist/cli.mjs'),
              path.join(appRoot, 'src/migrate.ts'),
            ],
            {
              env: { ...process.env, NODE_ENV: 'test', RPG_TEST_DATABASE_URL: url.toString() },
              timeout: 15000,
              windowsHide: true,
            }
          );
        assert.match((await run()).stdout, /Applied 0004_dice_rolls.sql/);
        assert.equal(
          (await migrated.pool.query('SELECT count(*)::int AS count FROM migration_history'))
            .rows[0].count,
          (await readdir(path.join(appRoot, 'migrationssql'))).filter((name) =>
            name.endsWith('.sql')
          ).length
        );
        assert.equal((await run()).stdout.trim(), '');
        assert.equal(
          (
            await migrated.pool.query(
              'SELECT valid_dice_groups(\'[{"label":"check","sides":6,"faces":[4]}]\'::jsonb) AS valid'
            )
          ).rows[0].valid,
          true
        );
      } finally {
        await migrated.close();
        await store.pool.query(`DROP SCHEMA ${schema} CASCADE`);
      }
    }
  }
);
test(
  'PostgreSQL persists before reveal, replays duplicate rolls and rejects stale ownership or immutable updates',
  { skip: !enabled },
  async () => {
    const c = newCampaign({ name: 'Dice fixture' });
    const turn: Turn = {
      id: randomUUID(),
      campaignId: c.id,
      requestId: randomUUID(),
      status: 'running',
      action: 'Check',
      narrative: null,
      changes: [],
      error: null,
      undone: false,
      settings: c.settings,
      context: {
        revision: 0,
        prompt: '{}',
        estimatedTokens: 2,
        estimator: 'fixture',
        sourceVersions: [],
        historyIds: [],
        memoryId: null,
      },
      createdAt: new Date().toISOString(),
      completedAt: null,
    };
    const service = new DiceService(store);
    try {
      await store.insert(c);
      await store.pool.query(
        "INSERT INTO turns(id,campaign_id,request_id,payload_hash,status,document,owner,lease_until) VALUES($1,$2,$3,'fixture','running',$4,$5,now()+interval '45 seconds')",
        [turn.id, c.id, turn.requestId, turn, ownerId]
      );
      const sessionId = await service.createSession(turn, 'a'.repeat(64), []);
      await assert.rejects(
        store.pool.query('UPDATE dice_sessions SET frozen_prompt=$2 WHERE id=$1', [
          sessionId,
          'changed',
        ]),
        /immutable/
      );
      const input = {
        slot: 0,
        groups: [{ label: 'check', count: 3, sides: 10 }],
        reason: 'Check',
        declaration: 'No modifier; target unknown',
      };
      const first = await service.roll(sessionId, turn, input);
      const records = await service.records(sessionId);
      assert.equal(records.length, 1);
      assert.deepEqual(records[0]!.groups, first.groups);
      const replay = await service.roll(sessionId, turn, input);
      assert.equal(replay.rollId, first.rollId);
      assert.deepEqual(replay.groups, first.groups);
      assert.equal(replay.reused, true);
      await assert.rejects(
        store.pool.query(
          'INSERT INTO dice_records(id,campaign_id,session_id,slot,spec_digest,input,groups) SELECT $2,campaign_id,session_id,slot,spec_digest,input,groups FROM dice_records WHERE id=$1',
          [first.rollId, randomUUID()]
        ),
        /unique/i
      );
      for (const groups of [
        [],
        [{ label: 'x', sides: 6 }],
        [{ label: 'x', sides: 6, faces: [7] }],
      ]) {
        assert.equal(
          (
            await store.pool.query('SELECT valid_dice_groups($1::jsonb) AS valid', [
              JSON.stringify(groups),
            ])
          ).rows[0].valid,
          false
        );
      }
      await assert.rejects(
        service.roll(sessionId, turn, {
          ...input,
          groups: [{ label: 'check', count: 3, sides: 20 }],
        }),
        /specification/i
      );
      await assert.rejects(service.roll(sessionId, turn, { ...input, slot: 2 }), /order/i);
      await assert.rejects(
        service.roll(sessionId, turn, { ...input, actorId: randomUUID() }),
        /character/i
      );
      await assert.rejects(service.roll(sessionId, turn, { ...input, slot: 12 }), /input/i);
      assert.equal(
        (await store.pool.query('SELECT requests FROM dice_attempts WHERE turn_id=$1', [turn.id]))
          .rows[0].requests,
        6
      );
      await assert.rejects(
        store.pool.query('UPDATE dice_records SET groups=$2 WHERE id=$1', [
          first.rollId,
          JSON.stringify([{ label: 'check', sides: 10, faces: [10, 10, 10] }]),
        ]),
        /append-only/
      );
      await store.pool.query('UPDATE turns SET owner=$2 WHERE id=$1', [turn.id, randomUUID()]);
      await assert.rejects(service.roll(sessionId, turn, { ...input, slot: 1 }), /active/i);
      assert.equal((await service.records(sessionId)).length, 1);
    } finally {
      await store.pool.query('DELETE FROM campaigns WHERE id=$1', [c.id]);
    }
  }
);

test(
  'automatic response repair preserves rolled faces and commits state exactly once',
  { skip: !enabled },
  async () => {
    const campaign = newCampaign({ name: 'Automatic repair fixture' });
    await store.insert(campaign);
    const rollIds: string[] = [];
    let calls = 0;
    const service = new TurnService(store, {
      capacity: async () => 16000,
      gameplayCapacity: async () => 16000,
      generate: async () => {
        throw new Error('Unexpected no-tools call');
      },
      generateGameplay: async (_settings, prompt, roll) => {
        calls++;
        const result = await roll(
          {
            slot: 0,
            groups: [{ label: 'Check', count: 1, sides: 6 }],
            reason: 'Check',
            declaration: 'No modifiers',
          },
          'roll'
        );
        rollIds.push(result.rollId);
        if (calls === 1) throw new SyntaxError('Malformed JSON');
        assert.match(prompt, /previous response was rejected/);
        assert.match(prompt, /Replay the original requests/);
        assert.equal(result.reused, true);
        return {
          version: 2,
          narrative: 'Recovered result',
          operations: [{ op: 'state', expected: {}, value: { recovered: true } }],
          rollInterpretations: [{ rollId: result.rollId, explanation: 'Saved roll' }],
        };
      },
    });
    try {
      const submitted = await service.submit(campaign.id, {
        revision: 0,
        requestId: randomUUID(),
        action: 'Check the door',
      });
      let turn = await store.turn(campaign.id, submitted.id);
      for (let i = 0; turn.status === 'pending' || turn.status === 'running'; i++) {
        assert.ok(i < 400);
        await new Promise((resolve) => setTimeout(resolve, 10));
        turn = await store.turn(campaign.id, submitted.id);
      }
      assert.equal(turn.status, TurnStatus.Completed, turn.error ?? undefined);
      assert.equal(calls, 2);
      assert.equal(new Set(rollIds).size, 1);
      assert.equal(turn.rolls?.length, 1);
      const saved = await store.campaign(campaign.id);
      assert.equal(saved.revision, 1);
      assert.deepEqual(saved.state, { recovered: true });
      assert.equal(
        (
          await store.pool.query('SELECT count(*)::int AS count FROM snapshots WHERE turn_id=$1', [
            turn.id,
          ])
        ).rows[0].count,
        1
      );
    } finally {
      await store.pool.query('DELETE FROM campaigns WHERE id=$1', [campaign.id]);
    }
  }
);
