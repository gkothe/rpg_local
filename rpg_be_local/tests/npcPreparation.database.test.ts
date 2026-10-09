import { RuleStore } from '../src/services/ruleStore.js';
import { emptyRuleColumns, RuleReview } from '../src/domain/rules.js';
import type { NpcPrepareInput } from '../src/domain/npcPreparation.js';
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
import { LibraryService, remapArchive } from '../src/services/library.js';
import { publicCampaign } from '../src/domain/playerProjection.js';
import { gmIntroduction, gmResponse, emptyResponse } from './ownedGameplayFixture.js';
import { core } from './npcFixture.js';
import { CharacterType, TurnStatus } from '../src/domain/options.js';
import type { Generator } from '../src/providers/service.js';
import type { NpcPreparationPayload } from '../src/domain/npcPreparation.js';
import type { GameplayResponse } from '../src/domain/gameplayResponse.js';
import type { GameplayToolDispatch } from '../src/providers/gameplayTools.js';
import { Problem } from '../src/errors.js';

const enabled = process.env.NODE_ENV === 'test' && !!process.env.RPG_TEST_DATABASE_URL;
const schema = `npc_fixture_${randomUUID().replaceAll('-', '')}`;
let store: Store;
before(async () => {
  if (!enabled) return;
  const bootstrap = new Store();
  await bootstrap.pool.query(`CREATE SCHEMA ${schema}`);
  await bootstrap.close();
  const url = new URL(databaseUrl());
  url.searchParams.set('options', `-c search_path=${schema}`);
  store = new Store(url.toString());
  for (const f of (await readdir(path.join(appRoot, 'migrationssql')))
    .filter((x) => x.endsWith('.sql'))
    .sort())
    await store.pool.query(await readFile(path.join(appRoot, 'migrationssql', f), 'utf8'));
});
after(async () => {
  if (enabled) {
    await store.pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await store.close();
  }
});
async function terminal(campaignId: string, turnId: string) {
  for (let i = 0; i < 300; i++) {
    const t = await store.turn(campaignId, turnId);
    if (![TurnStatus.Pending, TurnStatus.Running].includes(t.status as TurnStatus)) return t;
    await delay(20);
  }
  throw new Error('Synthetic NPC turn did not finish');
}
async function campaign() {
  const c = newCampaign({
    name: 'Flooded crossroads',
    settings: { provider: 'openrouter', model: 'mock', effort: null },
  });
  await store.insert(c);
  return c;
}
const args: NpcPrepareInput = {
  localKey: 'mara',
  intent: 'Create a practical innkeeper',
  roleHint: 'Innkeeper',
  introduction: gmIntroduction,
  establishedCharacter: {
    name: 'Mara',
    type: CharacterType.Npc,
    attributes: { hp: 8 },
    inventory: {},
    description: {},
  },
};
type Result = NpcPreparationPayload & {
  createOperation: GameplayResponse['operations'][number];
  profileChange: NonNullable<GameplayResponse['continuityChanges']>[number];
};
function generator(
  gm: NonNullable<Generator['generateOwnedGameplay']>,
  counter: { creator: number },
  child?: Generator['generate']
): Generator {
  return {
    capacity: async () => 16000,
    gameplayCapacity: async () => 16000,
    bookGameplayCapacity: async () => 16000,
    generate: async (settings, prompt, schema, signal, trace) => {
      if (prompt.startsWith('{"task":')) {
        counter.creator++;
        if (child) return child(settings, prompt, schema, signal, trace);
        return {
          name: 'Mara',
          description: { role: 'Innkeeper', voice: 'Practical dry humor' },
          profile: core,
        };
      }
      assert.ok(!prompt.includes(core.secret), 'private core must not enter narrative-only editor');
      return JSON.parse(/^\{"narrative":.*\}$/m.exec(prompt)![0]!);
    },
    generateOwnedGameplay: gm,
  };
}
test(
  'creator receipt replays once, staged lookup updates, commit/undo/import/template are atomic and private',
  { skip: !enabled },
  async () => {
    const c = await campaign();
    const count = { creator: 0 };
    let prepared: Result;
    const gen = generator(async (_settings, _prompt, _schema, _system, tools) => {
      prepared = (await tools('npc_prepare', args, 'prepare')) as Result;
      assert.deepEqual(await tools('npc_prepare', args, 'replay'), prepared);
      await assert.rejects(
        tools('npc_prepare', { ...args, intent: 'changed' }, 'bad-key'),
        /different arguments/
      );
      const staged = (await tools('campaign_npcs_get', { id: prepared.characterId }, 'get')) as {
        npc: { privateCore: { secret: string } };
      };
      assert.equal(staged.npc.privateCore.secret, core.secret);
      assert.equal((await store.campaign(c.id)).characters.length, 0);
      const roll = (await tools(
        'roll_dice',
        {
          slot: 0,
          groups: [{ label: 'check', count: 1, sides: 6 }],
          reason: 'Bargaining',
          declaration: 'Mara bargains over escort payment',
          scope: 'character',
          actorId: prepared.characterId,
        },
        'dice'
      )) as { rollId: string };
      return gmResponse('Mara offers a supply-cart escort contract.', [prepared.createOperation], {
        continuityChanges: [prepared.profileChange],
        rollInterpretations: [
          { rollId: roll.rollId, explanation: 'Bargaining', afterParagraph: 1 },
        ],
      });
    }, count);
    const turns = new TurnService(store, gen);
    const request = { requestId: randomUUID(), revision: 0, action: 'Meet the innkeeper' };
    const submitted = await turns.submit(c.id, request);
    const done = await terminal(c.id, submitted.id);
    assert.equal(done.status, TurnStatus.Completed, done.error ?? '');
    assert.equal(count.creator, 1);
    assert.equal((await turns.submit(c.id, request)).id, submitted.id);
    const saved = await store.campaign(c.id);
    assert.equal(saved.characters[0]!.id, prepared!.characterId);
    assert.equal(saved.continuity!.npcProfiles[0]!.secret, core.secret);
    assert.ok(!JSON.stringify(publicCampaign(saved)).includes(core.secret));
    const library = new LibraryService(store);
    const archive = await library.export(c.id);
    assert.equal(archive.npcPreparations!.length, 1);
    const remapped = remapArchive(archive);
    assert.notEqual(remapped.campaign.characters[0]!.id, saved.characters[0]!.id);
    assert.equal(
      remapped.npcPreparations![0]!.result!.characterId,
      remapped.campaign.characters[0]!.id
    );
    const imported = await library.import(archive);
    assert.equal(imported.continuity!.npcProfiles[0]!.characterId, imported.characters[0]!.id);
    const template = await library.template('Inn setup', c.id, saved.revision);
    const instantiated = await library.instantiate(template.id);
    assert.equal(instantiated.continuity, undefined);
    const undone = await turns.undo(c.id, saved.revision);
    assert.equal(undone.characters.length, 0);
    assert.equal(undone.continuity?.npcProfiles.length, 0);
    const afterUndo = await library.export(c.id);
    assert.equal(afterUndo.npcPreparations!.length, 1);
    remapArchive(afterUndo);
  }
);
test(
  'creator identity enters combat with a dual receipt and rejects missing mechanics',
  { skip: !enabled },
  async () => {
    const c = await campaign();
    const count = { creator: 0 };
    const gen = generator(async (_settings, _prompt, _schema, _system, tools) => {
      const p = (await tools('npc_prepare', args, 'prepare')) as Result;
      const batch = {
        localKey: 'encounter',
        participants: [
          {
            npcPreparationReceiptId: p.receiptId,
            label: 'Mara',
            trackedFields: [{ path: ['hp'], kind: 'vitality', label: 'HP' }],
          },
        ],
      };
      await assert.rejects(
        tools(
          'combat_prepare',
          {
            ...batch,
            localKey: 'missing-mechanics',
            participants: [
              {
                ...batch.participants[0],
                trackedFields: [{ path: ['missing'], kind: 'vitality', label: 'Missing' }],
              },
            ],
          },
          'bad-mechanics'
        ),
        /lacks authoritative/
      );
      const combat = (await tools('combat_prepare', batch, 'combat')) as {
        encounterId: string;
        participants: { characterId: string; label: string; trackedFields: unknown }[];
        createOperations: GameplayResponse['operations'];
      };
      const op = combat.createOperations[0]!;
      assert.equal((op as { characterId: string }).characterId, p.characterId);
      const roll = (await tools(
        'roll_dice',
        {
          slot: 0,
          groups: [{ label: 'check', count: 1, sides: 6 }],
          reason: 'Alertness',
          declaration: 'Mara checks the doorway',
          scope: 'combat',
          encounterId: combat.encounterId,
          combatKind: 'awareness',
          actorId: p.characterId,
        },
        'dice'
      )) as { rollId: string };
      return gmResponse(
        'Mara guards the doorway.',
        [
          op,
          {
            op: 'state',
            expected: {},
            value: {
              combat: {
                id: combat.encounterId,
                active: true,
                round: 1,
                participants: combat.participants.map(({ characterId, label, trackedFields }) => ({
                  characterId,
                  label,
                  trackedFields,
                })),
              },
            },
          },
        ],
        {
          continuityChanges: [p.profileChange],
          rollInterpretations: [
            { rollId: roll.rollId, explanation: 'Alertness', afterParagraph: 1 },
          ],
          participantReferences: [{ afterParagraph: 1, characterIds: [p.characterId] }],
        }
      );
    }, count);
    const turns = new TurnService(store, gen);
    const submitted = await turns.submit(c.id, {
      requestId: randomUUID(),
      revision: 0,
      action: 'Mara guards the door',
    });
    const done = await terminal(c.id, submitted.id);
    assert.equal(done.status, TurnStatus.Completed, done.error ?? '');
    assert.equal((await store.campaign(c.id)).characters.length, 1);
    assert.equal(count.creator, 1);
    const archive = await new LibraryService(store).export(c.id);
    const remapped = remapArchive(archive);
    const op = remapped.combatPreparations[0]!.payload.createOperations[0]!;
    assert.equal(op.npcPreparationReceiptId, remapped.npcPreparations![0]!.id);
  }
);
test(
  'failed child call stays explicit; an explicit turn retry reuses the session and can finish',
  { skip: !enabled },
  async () => {
    const c = await campaign();
    const count = { creator: 0 };
    let childFails = true;
    const gen = generator(
      async (_settings, _prompt, _schema, _system, tools) => {
        const p = (await tools('npc_prepare', args, 'prepare')) as Result;
        return gmResponse('Mara offers the contract.', [p.createOperation], {
          continuityChanges: [p.profileChange],
        });
      },
      count,
      async () => {
        if (childFails) throw new Problem(429, 'provider_quota', 'Synthetic quota');
        return { name: 'Mara', description: { role: 'Innkeeper' }, profile: core };
      }
    );
    const turns = new TurnService(store, gen);
    const first = await turns.submit(c.id, {
      requestId: randomUUID(),
      revision: 0,
      action: 'Meet Mara',
    });
    const failed = await terminal(c.id, first.id);
    assert.equal(failed.status, TurnStatus.Failed);
    assert.equal(count.creator, 1);
    assert.equal((await store.campaign(c.id)).characters.length, 0);
    childFails = false;
    const retry = await turns.retry(c.id, first.id, { requestId: randomUUID(), revision: 0 });
    const done = await terminal(c.id, retry.id);
    assert.equal(done.status, TurnStatus.Completed, done.error ?? '');
    assert.equal(count.creator, 2);
    assert.equal(done.diceSessionId, failed.diceSessionId);
  }
);
test(
  'cancellation after generation starts prevents receipt publication and character creation',
  { skip: !enabled },
  async () => {
    const c = await campaign();
    const count = { creator: 0 };
    let started!: () => void;
    const childStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    let finish!: (value: unknown) => void;
    const gen = generator(
      async (_s, _p, _sc, _sy, tools: GameplayToolDispatch) => {
        await tools('npc_prepare', args, 'prepare');
        return emptyResponse;
      },
      count,
      async () => {
        started();
        return new Promise((resolve) => {
          finish = resolve;
        });
      }
    );
    const turns = new TurnService(store, gen);
    const first = await turns.submit(c.id, {
      requestId: randomUUID(),
      revision: 0,
      action: 'Meet Mara',
    });
    await childStarted;
    await turns.cancel(c.id, first.id);
    finish({ name: 'Mara', description: { role: 'Innkeeper' }, profile: core });
    for (let i = 0; i < 100; i++) {
      const row = await store.pool.query('SELECT status FROM npc_preparations WHERE turn_id=$1', [
        first.id,
      ]);
      if (row.rows[0]?.status !== 'running') break;
      await delay(20);
    }
    const rows = await store.pool.query(
      'SELECT status,result FROM npc_preparations WHERE turn_id=$1',
      [first.id]
    );
    assert.equal(rows.rows[0]!.result, null);
    assert.notEqual(rows.rows[0]!.status, 'ready');
    assert.equal((await store.campaign(c.id)).characters.length, 0);
  }
);

for (const failChild of [false, true])
  test(
    `book-backed NPC preparation survives explicit retry (${failChild ? 'failed child' : 'ready receipt'}) and archive import`,
    { skip: !enabled },
    async () => {
      const rules = new RuleStore(store);
      const created = await rules.create(`npc-${randomUUID()}`, 'Synthetic NPC book');
      const columns = emptyRuleColumns();
      const quote = 'Mara keeps the crossroads inn.';
      columns.core_rules.example = {
        name: 'Innkeeper',
        aliases: [],
        text: quote,
        source: 'example',
        review: RuleReview.Extracted,
        pdfPages: [1],
        printedPages: ['1'],
        children: {},
      };
      const context = await rules.publish(created.systemId, created.revision, () => ({
        ...columns,
        instructions: 'Read originals',
        sources: [{ slug: 'example', title: 'Synthetic NPC book', pageCount: 1, pdfHash: null }],
        mapping: {},
      }));
      const c = newCampaign({
        name: 'Book NPC retry',
        systemId: context.systemId,
        settings: { provider: 'openrouter', model: 'mock', effort: null },
      });
      await store.insert(c);
      let input: NpcPrepareInput | undefined;
      let first = true;
      let throwChild = failChild;
      const count = { creator: 0 };
      const gen = generator(
        async (_s, _p, _schema, _sys, tools) => {
          if (!input) {
            const read = (await tools(
              'rules_get',
              { path: 'core_rules.example', view: 'text' },
              'book'
            )) as { receipt: string };
            input = {
              ...args,
              introduction: {
                origin: 'source' as NpcPrepareInput['introduction']['origin'],
                visibility: args.introduction.visibility,
                evidence: [
                  {
                    type: 'book',
                    citation: {
                      receiptId: read.receipt,
                      path: 'core_rules.example',
                      source: 'example',
                      systemId: context.systemId,
                      revision: context.revision,
                      contentHash: context.contentHash,
                      quote,
                      start: 0,
                      end: quote.length,
                      precision: 'unknown',
                      pdfPages: [],
                      printedPages: [],
                    },
                  },
                ],
              },
            };
          }
          const p = (await tools('npc_prepare', input, 'prepare')) as Result;
          if (first)
            throw new Problem(
              502,
              'synthetic_gm',
              'Synthetic gameplay failure after ready receipt'
            );
          return gmResponse('Mara offers an escort contract.', [p.createOperation], {
            continuityChanges: [p.profileChange],
          });
        },
        count,
        async () => {
          if (throwChild) throw new Problem(429, 'synthetic_child', 'Synthetic creator failure');
          return { name: 'Mara', description: { role: 'Innkeeper' }, profile: core };
        }
      );
      const turns = new TurnService(store, gen);
      const initial = await turns.submit(c.id, {
        requestId: randomUUID(),
        revision: 0,
        action: 'Meet Mara',
      });
      const failed = await terminal(c.id, initial.id);
      assert.equal(failed.status, TurnStatus.Failed);
      first = false;
      throwChild = false;
      const retry = await turns.retry(c.id, initial.id, { requestId: randomUUID(), revision: 0 });
      const done = await terminal(c.id, retry.id);
      assert.equal(done.status, TurnStatus.Completed, done.error ?? '');
      assert.equal(count.creator, failChild ? 2 : 1);
      const library = new LibraryService(store);
      const archive = await library.export(c.id);
      const imported = await library.import(archive);
      const importedArchive = await library.export(imported.id);
      remapArchive(importedArchive);
      assert.equal(imported.characters[0]!.name, 'Mara');
    }
  );
