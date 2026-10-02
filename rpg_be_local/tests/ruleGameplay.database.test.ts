import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { Store } from '../src/store.js';
import { appRoot, databaseUrl } from '../src/config.js';
import { RuleStore, ruleContent } from '../src/services/ruleStore.js';
import { TurnService } from '../src/services/turns.js';
import { newCampaign } from '../src/domain/campaign.js';
import { TurnStatus } from '../src/domain/options.js';
import { RuleReview, emptyRuleColumns } from '../src/domain/rules.js';
import type { Turn } from '../src/domain/types.js';
import { gameplayDigest } from '../src/domain/diceContext.js';
const enabled = process.env.NODE_ENV === 'test' && !!process.env.RPG_TEST_DATABASE_URL;
const schema = `rules_turns_${randomUUID().replaceAll('-', '')}`;
let store: Store;
before(async () => {
  if (!enabled) return;
  const setup = new Store();
  await setup.pool.query(`CREATE SCHEMA ${schema}`);
  await setup.close();
  const url = new URL(databaseUrl());
  url.searchParams.set('options', `-c search_path=${schema}`);
  store = new Store(url.toString());
  for (const file of (await readdir(path.join(appRoot, 'migrationssql')))
    .filter((file) => file.endsWith('.sql'))
    .sort())
    await store.pool.query(await readFile(path.join(appRoot, 'migrationssql', file), 'utf8'));
});
after(async () => {
  if (enabled) {
    await store.pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await store.close();
  }
});

test(
  'a publication during no-tools compaction preserves the captured head and rejects memory/rebuilt gameplay before session creation',
  { skip: !enabled },
  async () => {
    const rules = new RuleStore(store);
    const head = await rules.get();
    const campaign = newCampaign({ name: 'Original compaction race' });
    await store.insert(campaign);
    for (let index = 0; index < 2; index++) {
      const prior: Turn = {
        id: randomUUID(),
        campaignId: campaign.id,
        requestId: randomUUID(),
        status: TurnStatus.Completed,
        action: 'Original previous event',
        narrative: 'Original event. '.repeat(230),
        changes: [],
        error: null,
        undone: false,
        settings: campaign.settings,
        context: null,
        createdAt: new Date(Date.now() - 2000 + index).toISOString(),
        completedAt: new Date().toISOString(),
      };
      await store.pool.query(
        'INSERT INTO turns(id,campaign_id,request_id,payload_hash,status,document) VALUES($1,$2,$3,$4,$5,$6)',
        [prior.id, campaign.id, prior.requestId, 'original', prior.status, prior]
      );
    }
    let compactions = 0;
    let gameplay = 0;
    const service = new TurnService(store, {
      capacity: async () => 16000,
      gameplayCapacity: async () => 16000,
      generate: async (_settings, prompt) => {
        compactions++;
        assert.match(prompt, /Summarize these consecutive events/);
        await rules.publish(head.systemId, head.revision, (current) => ({
          ...ruleContent(current),
          instructions: 'Original changed during compaction',
        }));
        return { text: 'Original bounded event memory' };
      },
      generateGameplay: async () => {
        gameplay++;
        throw new Error('Outdated rebuilt gameplay must never run');
      },
    });
    const submitted = await service.submit(campaign.id, {
      revision: 0,
      requestId: randomUUID(),
      action: 'Original new event',
    });
    let terminal: Turn | undefined;
    for (let index = 0; index < 400; index++) {
      const turn = await store.turn(campaign.id, submitted.id);
      if (turn.status === TurnStatus.Failed) {
        terminal = turn;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.ok(terminal, 'Outdated compaction must finish as a failed attempt');
    assert.match(terminal.error!, /Rule system changed/);
    assert.equal(terminal.ruleContext?.revision, head.revision);
    assert.equal(terminal.context?.ruleContext?.revision, head.revision);
    assert.equal(compactions, 1);
    assert.equal(gameplay, 0);
    assert.equal((await store.campaign(campaign.id)).memory, null);
    assert.equal(
      (
        await store.pool.query(
          'SELECT count(*)::int AS count FROM dice_sessions WHERE campaign_id=$1',
          [campaign.id]
        )
      ).rows[0].count,
      0
    );
  }
);
test(
  'book gameplay persists rule→dice→rule evidence, rejects late changed-head final/retry and accepts a new action at the latest head',
  { skip: !enabled },
  async () => {
    const rules = new RuleStore(store);
    const created = await rules.create('original-turns', 'Original gameplay fixture');
    const columns = emptyRuleColumns();
    const leaf = {
      name: 'Original check',
      aliases: [],
      source: 'original',
      text: 'Original authority.',
      review: RuleReview.Extracted,
      pdfPages: [1],
      printedPages: ['1'],
      children: {},
    };
    columns.core_rules.original = {
      ...leaf,
      text: '',
      structural: true,
      children: { check: leaf },
    };
    const published = await rules.publish(created.systemId, 1, () => ({
      ...columns,
      instructions: 'Original instructions',
      sources: [
        { slug: 'original', title: 'Original synthetic book', pageCount: 1, pdfHash: null },
      ],
      mapping: {},
    }));
    const campaign = newCampaign({
      name: 'Original latest-head campaign',
      systemId: published.systemId,
    });
    await store.insert(campaign);
    let mode: 'change' | 'valid' = 'change';
    const service = new TurnService(store, {
      capacity: async () => 16000,
      gameplayCapacity: async () => 16000,
      bookGameplayCapacity: async () => 16000,
      generate: async () => {
        throw new Error('No-tools fallback must not run');
      },
      generateBookGameplay: async (_settings, prompt, _schema, dispatch) => {
        assert.ok(prompt.includes('ruleCitations'));
        assert.equal(prompt.includes('Original authority.'), false);
        const read = await dispatch(
          'rules_get',
          { path: 'core_rules.original.check', view: 'text' },
          'read-before'
        );
        const rolled = await dispatch(
          'roll_dice',
          {
            slot: 0,
            reason: 'Original check',
            declaration: 'No modifiers',
            groups: [{ label: 'original', sides: 6, count: 1 }],
          },
          'roll'
        );
        await dispatch(
          'rules_get',
          { path: 'core_rules.original.check', view: 'text' },
          'read-after'
        );
        const active = await rules.get(published.systemId);
        if (mode === 'change')
          await rules.publish(active.systemId, active.revision, (current) => ({
            ...ruleContent(current),
            instructions: 'Updated B instructions',
          }));
        const record = rolled as { rollId: string };
        const receipt = read as {
          receipt: string;
          path: string;
          source: string;
          text: string;
          revision: number;
          contentHash: string;
        };
        return {
          version: 3,
          narrative: 'Complete original narration',
          operations: [{ op: 'state', expected: {}, value: { result: 'applied' } }],
          rollInterpretations: [
            { rollId: record.rollId, explanation: 'Original interpretation of genuine dice' },
          ],
          ruleCitations: [
            {
              receiptId: receipt.receipt,
              path: receipt.path,
              source: receipt.source,
              quote: 'Original authority.',
              start: 0,
              end: 19,
              systemId: active.systemId,
              revision: receipt.revision,
              contentHash: receipt.contentHash,
              precision: 'approximate',
              pdfPages: [1],
              printedPages: ['1'],
            },
          ],
        };
      },
    });
    const finish = async (id: string): Promise<Turn> => {
      for (let index = 0; index < 400; index++) {
        const turn = await store.turn(campaign.id, id);
        if (![TurnStatus.Pending, TurnStatus.Running].includes(turn.status as TurnStatus))
          return turn;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error('Synthetic turn did not finish');
    };
    const first = await finish(
      (
        await service.submit(campaign.id, {
          revision: 0,
          requestId: randomUUID(),
          action: 'Original action',
        })
      ).id
    );
    assert.equal(first.status, TurnStatus.Failed);
    assert.match(first.error!, /Rule system changed/);
    assert.deepEqual((await store.campaign(campaign.id)).state, {});
    assert.equal(first.rolls?.length, 1);
    assert.equal(first.ruleReads?.length, 2);
    assert.equal(first.diceRetry?.available, false);
    await assert.rejects(
      service.retry(campaign.id, first.id, { revision: 0, requestId: randomUUID() }),
      /Rule system changed|Game context changed/
    );
    const face = first.rolls![0]!.groups[0]!.faces[0];
    mode = 'valid';
    const next = await finish(
      (
        await service.submit(campaign.id, {
          revision: 0,
          requestId: randomUUID(),
          action: 'A new action',
        })
      ).id
    );
    assert.equal(next.status, TurnStatus.Completed, next.error ?? 'Expected a complete final');
    assert.equal(next.ruleContext?.revision, first.ruleContext!.revision + 1);
    assert.equal(next.ruleCitations?.length, 1);
    assert.equal(next.ruleReads?.length, 2);
    assert.equal((await store.turn(campaign.id, first.id)).rolls![0]!.groups[0]!.faces[0], face);
    assert.deepEqual((await store.campaign(campaign.id)).state, { result: 'applied' });
  }
);
test(
  'effective local rules revision blocks A→B→A retry identity while private notes and providers stay outside it',
  { skip: !enabled },
  async () => {
    const rules = new RuleStore(store);
    const original = await rules.get();
    const campaign = newCampaign({ name: 'Original identity fixture' });
    const context = {
      systemId: original.systemId,
      systemKey: original.systemKey,
      systemName: original.systemName,
      kind: original.kind,
      revision: original.revision,
      contentHash: original.contentHash,
    };
    const baseline = gameplayDigest(campaign, [], context);
    assert.equal(
      gameplayDigest(
        {
          ...campaign,
          notes: 'Private',
          settings: { provider: 'other', model: 'other', effort: null },
        },
        [],
        context
      ),
      baseline
    );
    assert.notEqual(
      gameplayDigest(campaign, [], { ...context, revision: context.revision + 2 }),
      baseline
    );
    assert.notEqual(gameplayDigest(campaign, [], { ...context, systemId: randomUUID() }), baseline);
  }
);
