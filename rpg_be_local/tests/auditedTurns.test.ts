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
import { DiceService } from '../src/services/dice.js';
import { textSource } from '../src/services/sources.js';
import { SourcePurpose, TurnStatus } from '../src/domain/options.js';
import { Problem } from '../src/errors.js';
import type { Generator } from '../src/providers/service.js';
import type { Turn } from '../src/domain/types.js';

const enabled = process.env.NODE_ENV === 'test' && !!process.env.RPG_TEST_DATABASE_URL;
const schema = `audited_fixture_${randomUUID().replaceAll('-', '')}`;
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
async function terminal(campaignId: string, turnId: string): Promise<Turn> {
  for (let attempt = 0; attempt < 250; attempt++) {
    const turn = await store.turn(campaignId, turnId);
    if (![TurnStatus.Pending, TurnStatus.Running].includes(turn.status as TurnStatus)) return turn;
    await delay(20);
  }
  throw new Error('Synthetic turn did not reach a terminal status');
}
function fixtureGenerator() {
  const counts = { gm: 0, editor: 0 };
  let failEditor = true;
  const generator: Generator = {
    capacity: async () => 16000,
    gameplayCapacity: async () => 16000,
    generate: async (_settings, _prompt) => {
      counts.editor++;
      if (failEditor)
        throw new Problem(429, 'provider_quota', 'Synthetic editor quota unavailable');
      return { narrative: 'You stand beside the old gate.' };
    },
    generateOwnedGameplay: async (_settings, prompt, _schema, _system, tools) => {
      counts.gm++;
      assert.match(prompt, /The old gate is locked/);
      const catalog = JSON.parse(prompt).mandatory.campaignSources as {
        id: string;
        version: number;
      }[];
      const source = await tools(
        'campaign_sources_get',
        { sourceId: catalog[0]!.id, version: catalog[0]!.version, sectionIndex: 0 },
        'source'
      );
      assert.equal(
        ((source as Record<string, unknown>).sourceSpan as { text: string }).text,
        'The old gate is locked.'
      );
      const result = await tools(
        'roll_dice',
        {
          slot: 0,
          groups: [{ label: 'gate', count: 1, sides: 6 }],
          reason: 'Check the gate',
          declaration: 'A single die records the attempt',
        },
        'roll'
      );
      const id = (result as { rollId: string }).rollId;
      return {
        version: 5,
        narrative: 'You stand beside the old gate.',
        operations: [],
        rollInterpretations: [{ rollId: id, explanation: 'The gate remains closed.' }],
        ruleCitations: [],
        knowledgeChanges: [],
        operationExplanations: [],
      };
    },
  };
  return {
    generator,
    counts,
    allowEditor: () => {
      failEditor = false;
    },
  };
}
async function begin() {
  const campaign = newCampaign({ name: 'Audited editor fixture' });
  campaign.sources = [
    { ...textSource('Preparation', 'The old gate is locked.'), purpose: SourcePurpose.Campaign },
  ];
  await store.insert(campaign);
  await store.transaction(async (client) => {
    await store.reindex(campaign, client);
  });
  const fixture = fixtureGenerator();
  const service = new TurnService(store, fixture.generator, 5);
  const turn = await service.submit(campaign.id, {
    revision: 0,
    requestId: randomUUID(),
    action: 'start',
  });
  return { campaign, service, turn, ...fixture };
}
test(
  'required editor failure preserves candidate and rolls; editing-only idempotent resume commits once without rerunning GM',
  { skip: !enabled },
  async () => {
    const f = await begin();
    const failed = await terminal(f.campaign.id, f.turn.id);
    assert.equal(failed.status, TurnStatus.Failed);
    assert.equal(failed.editingPending, true);
    assert.equal(failed.narrative, null);
    assert.equal((await store.campaign(f.campaign.id)).revision, 0);
    assert.equal(f.counts.gm, 1);
    assert.equal(f.counts.editor, 1);
    const originalRolls = await new DiceService(store).records(failed.diceSessionId!);
    assert.equal(originalRolls.length, 1);
    const reads = await store.pool.query(
      'SELECT payload FROM turn_campaign_source_reads WHERE turn_id=$1',
      [f.turn.id]
    );
    assert.equal(reads.rows.length, 1);
    assert.equal(reads.rows[0].payload.sourceSpan.text, 'The old gate is locked.');
    await assert.rejects(
      () =>
        store.pool.query("UPDATE dice_sessions SET frozen_sources='{}'::jsonb WHERE id=$1", [
          failed.diceSessionId,
        ]),
      /immutable/
    );
    await assert.rejects(() =>
      f.service.submit(f.campaign.id, {
        revision: 0,
        requestId: randomUUID(),
        action: 'Another action',
      })
    );
    f.allowEditor();
    const requestId = randomUUID();
    await f.service.resumeEditing(f.campaign.id, f.turn.id, { revision: 0, requestId });
    await f.service.resumeEditing(f.campaign.id, f.turn.id, { revision: 0, requestId });
    const done = await terminal(f.campaign.id, f.turn.id);
    assert.equal(done.status, TurnStatus.Completed);
    assert.equal(done.narrative, 'You stand beside the old gate.');
    assert.equal(done.editingPending, false);
    assert.equal(f.counts.gm, 1);
    assert.equal(f.counts.editor, 2);
    assert.deepEqual(await new DiceService(store).records(failed.diceSessionId!), originalRolls);
    assert.equal((await store.campaign(f.campaign.id)).revision, 1);
    await f.service.resumeEditing(f.campaign.id, f.turn.id, { revision: 0, requestId });
    assert.equal(f.counts.editor, 2);
    const snapshots = await store.pool.query(
      'SELECT count(*)::int AS count FROM snapshots WHERE turn_id=$1',
      [f.turn.id]
    );
    assert.equal(snapshots.rows[0].count, 1);
  }
);
test(
  'cancelling an awaiting editor prevents resume and preserves uncommitted state/dice',
  { skip: !enabled },
  async () => {
    const f = await begin();
    const failed = await terminal(f.campaign.id, f.turn.id);
    assert.equal(failed.editingPending, true);
    const cancelled = await f.service.cancel(f.campaign.id, f.turn.id);
    assert.equal(cancelled.status, TurnStatus.Cancelled);
    assert.equal(cancelled.editingPending, false);
    f.allowEditor();
    await assert.rejects(() =>
      f.service.resumeEditing(f.campaign.id, f.turn.id, { revision: 0, requestId: randomUUID() })
    );
    assert.equal((await store.campaign(f.campaign.id)).revision, 0);
    assert.equal(f.counts.gm, 1);
    assert.equal(f.counts.editor, 1);
    assert.equal((await new DiceService(store).records(failed.diceSessionId!)).length, 1);
  }
);
test(
  'editing resume rejects changed campaign context without rerunning any provider',
  { skip: !enabled },
  async () => {
    const f = await begin();
    await terminal(f.campaign.id, f.turn.id);
    await store.transaction(async (client) => {
      const campaign = await store.campaign(f.campaign.id, client, true);
      campaign.revision++;
      campaign.description = 'Changed while the editor was unavailable';
      await store.save(campaign, client);
    });
    f.allowEditor();
    await assert.rejects(
      () =>
        f.service.resumeEditing(f.campaign.id, f.turn.id, { revision: 1, requestId: randomUUID() }),
      /changed|context/i
    );
    assert.equal(f.counts.gm, 1);
    assert.equal(f.counts.editor, 1);
    assert.equal((await store.turn(f.campaign.id, f.turn.id)).narrative, null);
  }
);
test(
  'a privately persisted completed edit is reused after recovery without another editor or GM call',
  { skip: !enabled },
  async () => {
    const f = await begin();
    await terminal(f.campaign.id, f.turn.id);
    await store.pool.query(
      "UPDATE narrative_edit_candidates SET status='completed',edited_narrative=$2 WHERE turn_id=$1",
      [f.turn.id, 'You stand beside the old gate.']
    );
    await f.service.resumeEditing(f.campaign.id, f.turn.id, {
      revision: 0,
      requestId: randomUUID(),
    });
    const done = await terminal(f.campaign.id, f.turn.id);
    assert.equal(done.status, TurnStatus.Completed);
    assert.equal(done.narrative, 'You stand beside the old gate.');
    assert.equal(f.counts.gm, 1);
    assert.equal(f.counts.editor, 1);
    assert.equal((await store.campaign(f.campaign.id)).revision, 1);
  }
);

test(
  'expired editor lease recovers the same private candidate and saved dice',
  { skip: !enabled },
  async () => {
    const f = await begin();
    const failed = await terminal(f.campaign.id, f.turn.id);
    await store.pool.query(
      "UPDATE turns SET status='running', document=jsonb_set(document,'{status}','\"running\"'::jsonb), lease_until=now()-interval '1 minute' WHERE id=$1",
      [f.turn.id]
    );
    assert.ok(await store.recover());
    const recovered = await store.turn(f.campaign.id, f.turn.id);
    assert.equal(recovered.editingPending, true);
    assert.equal(recovered.narrative, null);
    assert.match(recovered.error!, /resume editing/i);
    f.allowEditor();
    await f.service.resumeEditing(f.campaign.id, f.turn.id, {
      revision: 0,
      requestId: randomUUID(),
    });
    const done = await terminal(f.campaign.id, f.turn.id);
    assert.equal(done.status, TurnStatus.Completed);
    assert.equal(f.counts.gm, 1);
    assert.equal((await new DiceService(store).records(failed.diceSessionId!)).length, 1);
  }
);

test(
  'editing resume rejects a changed authoritative rule head without another CLI call',
  { skip: !enabled },
  async () => {
    const f = await begin();
    const failed = await terminal(f.campaign.id, f.turn.id);
    assert.ok(failed.ruleContext);
    await store.pool.query('UPDATE rule_systems SET revision=revision+1 WHERE id=$1', [
      failed.ruleContext.systemId,
    ]);
    f.allowEditor();
    await assert.rejects(
      () =>
        f.service.resumeEditing(f.campaign.id, f.turn.id, { revision: 0, requestId: randomUUID() }),
      /Rule (system|library) changed/i
    );
    assert.equal(f.counts.gm, 1);
    assert.equal(f.counts.editor, 1);
    assert.equal((await store.turn(f.campaign.id, f.turn.id)).narrative, null);
  }
);
