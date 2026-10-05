import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { Store } from '../src/store.js';
import { appRoot, databaseUrl } from '../src/config.js';
import { newCampaign } from '../src/domain/campaign.js';
import { TurnService } from '../src/services/turns.js';
import { LibraryService } from '../src/services/library.js';
import { CampaignService } from '../src/services/campaigns.js';
import { Problem } from '../src/errors.js';
import {
  KnowledgeKind as K,
  KnowledgeOrigin as O,
  KnowledgeCertainty as C,
  KnowledgeStatus as S,
} from '../src/domain/knowledge.js';
import type { Generator } from '../src/providers/service.js';
import type { Turn } from '../src/domain/types.js';
const enabled = process.env.NODE_ENV === 'test' && !!process.env.RPG_TEST_DATABASE_URL;
let store: Store;
const schema = `knowledge_fixture_${randomUUID().replaceAll('-', '')}`;
before(async () => {
  if (!enabled) return;
  const setup = new Store();
  await setup.pool.query(`CREATE SCHEMA ${schema}`);
  await setup.close();
  const url = new URL(databaseUrl());
  url.searchParams.set('options', `-c search_path=${schema}`);
  store = new Store(url.toString());
  for (const file of (await readdir(path.join(appRoot, 'migrationssql')))
    .filter((f) => f.endsWith('.sql'))
    .sort())
    await store.pool.query(await readFile(path.join(appRoot, 'migrationssql', file), 'utf8'));
});
after(async () => {
  if (enabled) {
    await store.pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await store.close();
  }
});
const fact = {
  op: 'create',
  kind: K.Place,
  title: 'Secret inn',
  text: 'The keeper hides a silver key',
  origin: O.Gm,
  certainty: C.Rumor,
  status: S.Active,
  characterIds: [],
  evidence: [],
};
const answer = {
  version: 4,
  narrative: 'At the inn',
  operations: [],
  rollInterpretations: [],
  ruleCitations: [],
  knowledgeChanges: [fact],
};
const base: Generator = {
  capacity: async () => 16000,
  gameplayCapacity: async () => 16000,
  generate: async () => {
    throw Error('Unexpected extraction');
  },
  generateOwnedGameplay: async () => answer,
};

test(
  'missing metadata migration gives an actionable message before any CLI call',
  { skip: !enabled },
  async () => {
    const c = newCampaign({ name: 'Missing migration fixture' });
    await store.insert(c);
    let called = false;
    const service = new TurnService(
      store,
      {
        ...base,
        generateOwnedGameplay: async () => {
          called = true;
          return answer;
        },
      },
      4
    );
    await store.pool.query('ALTER TABLE dice_sessions DROP COLUMN tool_definitions');
    try {
      const submitted = await service.submit(c.id, {
        revision: 0,
        requestId: randomUUID(),
        action: 'Begin',
      });
      const failed = await finish(c.id, submitted.id);
      assert.equal(failed.status, 'failed');
      assert.match(failed.error!, /migrations are missing.*setup-database\.cmd/);
      assert.equal(called, false);
      assert.deepEqual((await store.campaign(c.id)).knowledge, []);
      assert.equal(
        (await store.pool.query('SELECT id FROM dice_sessions WHERE campaign_id=$1', [c.id]))
          .rowCount,
        0
      );
    } finally {
      await store.pool.query('ALTER TABLE dice_sessions ADD COLUMN tool_definitions jsonb');
    }
  }
);
async function finish(campaignId: string, id: string): Promise<Turn> {
  for (let n = 0; n < 300; n++) {
    const t = await store.turn(campaignId, id);
    if (!['pending', 'running'].includes(t.status)) return t;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error('Fixture did not complete');
}
test(
  'v4 migration repeats safely; turn/idempotency/empty registry/envelope export import and undo retain complete metadata',
  { skip: !enabled },
  async () => {
    const c = newCampaign({ name: 'Knowledge DB', instructions: '  Keep exactly\n' });
    await store.insert(c);
    await store.pool.query(
      await readFile(path.join(appRoot, 'migrationssql/0008_campaign_knowledge.sql'), 'utf8')
    );
    assert.deepEqual((await store.campaign(c.id)).knowledge, []);
    const service = new TurnService(store, base, 4);
    const input = { revision: 0, requestId: randomUUID(), action: 'Enter' };
    const t = await service.submit(c.id, input);
    assert.equal((await service.submit(c.id, input)).id, t.id);
    const completed = await finish(c.id, t.id);
    assert.equal(completed.status, 'completed', completed.error ?? '');
    const saved = (
      await store.pool.query('SELECT * FROM dice_sessions WHERE root_turn_id=$1', [t.id])
    ).rows[0];
    assert.equal(saved.prompt_contract_version, 4);
    assert.equal(saved.digest_version, 2);
    assert.equal(saved.frozen_knowledge.records.length, 0);
    assert.ok(saved.system_prompt.includes(c.instructions));
    assert.equal(saved.tool_definitions.length, 3);
    await assert.rejects(
      () =>
        store.pool.query('UPDATE dice_sessions SET system_prompt=$2 WHERE id=$1', [
          saved.id,
          'changed',
        ]),
      /immutable/
    );
    const library = new LibraryService(store);
    const archive = await library.export(c.id);
    assert.equal(archive.version, 6);
    const imported = await library.import(archive);
    assert.equal(imported.knowledge?.[0]?.certainty, C.Rumor);
    assert.notEqual(imported.knowledge?.[0]?.id, (await store.campaign(c.id)).knowledge![0]!.id);
    assert.equal(
      (await new TurnService(store, base, 4).undo(imported.id, imported.revision)).knowledge
        ?.length,
      0
    );
    assert.equal((await service.undo(c.id, 1)).knowledge?.length, 0);
    const empty = new TurnService(
      store,
      { ...base, generateOwnedGameplay: async () => ({ ...answer, knowledgeChanges: [] }) },
      4
    );
    const emptyTurn = await empty.submit(c.id, {
      revision: 2,
      requestId: randomUUID(),
      action: 'Wait',
    });
    assert.equal((await finish(c.id, emptyTurn.id)).status, 'completed');
    const emptyImported = await library.import(await library.export(c.id));
    assert.deepEqual(emptyImported.knowledge, []);
  }
);
test(
  'invalid/cancelled attempts save no facts; saved face retry uses frozen metadata across provider switch',
  { skip: !enabled },
  async () => {
    const c = newCampaign({ name: 'Retry DB' });
    await store.insert(c);
    let mode = 'fail';
    let rollId = '';
    let faces: unknown;
    let ready!: () => void;
    const arrived = new Promise<void>((r) => (ready = r));
    const generator: Generator = {
      ...base,
      generateOwnedGameplay: async (_settings, _prompt, _schema, system, tools, signal) => {
        assert.ok(system);
        const roll = await tools(
          'roll_dice',
          {
            slot: 0,
            groups: [{ label: 'check', count: 1, sides: 6 }],
            reason: 'Inn',
            declaration: 'Target four',
          },
          'dice'
        );
        if ('groups' in roll) {
          if (faces) assert.deepEqual(roll.groups, faces);
          else faces = roll.groups;
        }
        rollId = String(roll.rollId);
        if (mode === 'fail') throw new Problem(502, 'fixture_failure', 'Synthetic failure');
        if (mode === 'invalid')
          return {
            ...answer,
            rollInterpretations: [{ rollId, explanation: 'check' }],
            knowledgeChanges: [{ ...fact, origin: O.Source }],
          };
        if (mode === 'cancel') {
          ready();
          return new Promise((_resolve, reject) =>
            signal!.addEventListener(
              'abort',
              () => reject(new Problem(409, 'cancelled', 'Fixture abort')),
              { once: true }
            )
          );
        }
        const lookup = await tools('campaign_knowledge_search', { query: '' }, 'recall');
        assert.ok('records' in lookup);
        assert.deepEqual(lookup.records, []);
        return { ...answer, rollInterpretations: [{ rollId, explanation: 'check' }] };
      },
    };
    const service = new TurnService(store, generator, 4);
    const t = await service.submit(c.id, { revision: 0, requestId: randomUUID(), action: 'Inn' });
    assert.equal((await finish(c.id, t.id)).status, 'failed');
    assert.deepEqual((await store.campaign(c.id)).knowledge ?? [], []);
    mode = 'invalid';
    const bad = await service.retry(c.id, t.id, {
      revision: 0,
      requestId: randomUUID(),
      settings: { provider: 'other', model: 'fixture', effort: null },
    });
    assert.equal((await finish(c.id, bad.id)).status, 'failed');
    assert.deepEqual((await store.campaign(c.id)).knowledge ?? [], []);
    mode = 'cancel';
    const cancelled = await service.retry(c.id, bad.id, { revision: 0, requestId: randomUUID() });
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        arrived,
        new Promise((_, reject) => {
          deadline = setTimeout(
            () => reject(Error('Cancellation fixture did not reach provider')),
            3000
          );
        }),
      ]);
    } finally {
      clearTimeout(deadline);
    }
    await service.cancel(c.id, cancelled.id);
    assert.equal((await finish(c.id, cancelled.id)).status, 'cancelled');
    assert.deepEqual((await store.campaign(c.id)).knowledge ?? [], []);
    mode = 'success';
    const retry = await service.retry(c.id, cancelled.id, {
      revision: 0,
      requestId: randomUUID(),
      settings: { provider: 'other', model: 'fixture', effort: null },
    });
    const completed = await finish(c.id, retry.id);
    assert.equal(completed.status, 'completed', completed.error ?? '');
    assert.equal(completed.rolls?.[0]?.id, rollId);
    assert.equal((await store.campaign(c.id)).knowledge?.length, 1);
  }
);
test(
  'deleted NPC historical identity survives recall export and import, while deleting created NPC conflicts with undo',
  { skip: !enabled },
  async () => {
    const c = newCampaign({ name: 'Historical DB' });
    await store.insert(c);
    const generator = {
      ...base,
      generateOwnedGameplay: async () => ({
        ...answer,
        knowledgeChanges: [],
        operations: [
          {
            op: 'create',
            character: {
              name: 'Guide',
              type: 'npc',
              attributes: {},
              inventory: {},
              description: {},
            },
            introduction: { origin: O.Gm, evidence: [] },
          },
        ],
      }),
    };
    const service = new TurnService(store, generator, 4);
    const t = await service.submit(c.id, {
      revision: 0,
      requestId: randomUUID(),
      action: 'Meet guide',
    });
    assert.equal((await finish(c.id, t.id)).status, 'completed');
    const current = await store.campaign(c.id);
    const id = current.characters[0]!.id;
    await new CampaignService(store, generator).deleteCharacter(c.id, id, 1);
    const deleted = await store.campaign(c.id);
    assert.equal(deleted.knowledge![0]!.characterNames[id], 'Guide');
    const imported = await new LibraryService(store).import(
      await new LibraryService(store).export(c.id)
    );
    assert.equal(imported.characters.length, 0);
    assert.equal(Object.values(imported.knowledge![0]!.characterNames)[0], 'Guide');
    await assert.rejects(() => service.undo(c.id, 2), /manually changed/);
  }
);
test(
  'real turn compaction preserves old rumor provenance across provider switch and long exact instructions archive roundtrip',
  { skip: !enabled },
  async () => {
    const c = newCampaign({
      name: 'Long knowledge DB',
      instructions: 'Exact campaign instructions:\n' + 'Keep this whitespace.  \n'.repeat(900),
    });
    // A mandatory sheet keeps this test's oversized-prompt assertion independent of compaction.
    c.characters.push({
      id: randomUUID(),
      name: 'Traveler',
      type: 'player',
      attributes: {},
      inventory: {},
      description: { dossier: 'x'.repeat(18000) },
      notes: '',
      revision: 1,
    });
    await store.insert(c);
    let compactions = 0;
    let count = 0;
    let recalled = false;
    let inlineTitles: string[] = [];
    const generator: Generator = {
      ...base,
      capacity: async () => 100000,
      gameplayCapacity: async () => 100000,
      generate: async (_settings, prompt) => {
        const payload = JSON.parse(prompt);
        for (const record of payload.knowledge) {
          assert.equal(record.certainty, C.Rumor);
          assert.equal(record.origin, O.Gm);
        }
        compactions++;
        return {
          text: 'Derived memory: travel continues. The old rumor remains an attributed rumor.',
        };
      },
      generateOwnedGameplay: async (settings, prompt, _schema, system, tools) => {
        assert.ok(system.includes(c.instructions));
        count++;
        if (count === 1)
          return {
            ...answer,
            narrative: 'A keeper whispers of a hidden key. ' + 'Scene detail. '.repeat(180),
            knowledgeChanges: [fact],
          };
        if (settings.provider === 'switched') {
          const payload = JSON.parse(prompt);
          inlineTitles = payload.mandatory.knowledge.map((r: { title: string }) => r.title);
          const result = await tools(
            'campaign_knowledge_search',
            { query: 'Secret inn' },
            'old-search'
          );
          assert.ok('records' in result);
          const summaries = result.records as { id: string }[];
          assert.equal(summaries.length, 1);
          const record = await tools('campaign_knowledge_get', { id: summaries[0]!.id }, 'old-get');
          assert.ok('text' in record);
          assert.equal(record.text, fact.text);
          assert.equal(record.certainty, C.Rumor);
          assert.equal(record.origin, O.Gm);
          recalled = true;
        }
        return {
          ...answer,
          narrative: 'Travel continues. ' + 'Unrelated distant landscape. '.repeat(110),
          knowledgeChanges: [],
        };
      },
    };
    const service = new TurnService(store, generator, 4);
    let priorRecord: unknown;
    for (let i = 0; i < 5; i++) {
      const current = await store.campaign(c.id);
      const t = await service.submit(c.id, {
        revision: current.revision,
        requestId: randomUUID(),
        action: i === 0 ? 'Listen' : 'Travel elsewhere',
      });
      assert.equal((await finish(c.id, t.id)).status, 'completed');
      if (i === 0) priorRecord = structuredClone((await store.campaign(c.id)).knowledge![0]);
    }
    assert.ok(compactions > 0);
    assert.deepEqual((await store.campaign(c.id)).knowledge![0], priorRecord);
    const current = await store.campaign(c.id);
    const switched = await service.submit(c.id, {
      revision: current.revision,
      requestId: randomUUID(),
      action: 'Remember old rumors',
      settings: { provider: 'switched', model: 'fixture', effort: null },
    });
    assert.equal((await finish(c.id, switched.id)).status, 'completed');
    assert.ok(recalled);
    assert.ok(!inlineTitles.includes(fact.title), JSON.stringify(inlineTitles));
    const library = new LibraryService(store);
    const exported = await library.export(c.id);
    const session = exported.diceSessions!.find((s) => s.rootTurnId === switched.id)!;
    assert.ok(session.systemPrompt!.length > 16000);
    assert.ok(session.frozenPrompt.length > 16000);
    const imported = await library.import(exported);
    assert.equal(imported.instructions, c.instructions);
    const reexported = await library.export(imported.id);
    assert.deepEqual(
      reexported.diceSessions!.map((s) => s.systemPrompt),
      exported.diceSessions!.map((s) => s.systemPrompt)
    );
    assert.deepEqual(
      reexported.diceSessions!.map((s) => s.frozenPrompt),
      exported.diceSessions!.map((s) => s.frozenPrompt)
    );
  }
);
import request from 'supertest';
import { createApp } from '../src/app.js';
import { ProviderService } from '../src/providers/service.js';
import { CharacterType } from '../src/domain/options.js';
import { freezeKnowledge, type FrozenKnowledge } from '../src/domain/knowledgeRecall.js';
import { gameplayInstructionEnvelope } from '../src/domain/gameplayNarrator.js';
import { GameplayTools } from '../src/providers/gameplayTools.js';
import { buildContext } from '../src/domain/context.js';
import { gameplayDigest } from '../src/domain/diceContext.js';

test(
  'NPC-enabled gameplay retrieves off-prompt sheets, targets dice, retries frozen tools and round-trips persisted archives',
  { skip: !enabled },
  async () => {
    const c = newCampaign({ name: 'NPC retrieval integration' });
    const npcId = randomUUID();
    c.characters.push({
      id: npcId,
      name: 'Marcus',
      type: CharacterType.Npc,
      attributes: { strength: 3 },
      inventory: { coins: 7 },
      description: { role: 'merchant' },
      notes: 'PRIVATE_NPC',
      revision: 1,
    });
    await store.insert(c);
    let calls = 0;
    const generator: Generator = {
      ...base,
      generate: async () => ({ narrative: 'A familiar merchant greets you.' }),
      generateOwnedGameplay: async (_settings, prompt, _schema, system, tools) => {
        calls++;
        assert.match(system, /campaign_npcs_get/);
        assert.deepEqual(JSON.parse(prompt.split('\nReplay')[0]!).mandatory.characters, []);
        const found = await tools('campaign_npcs_search', { query: 'merchant' }, 'find');
        assert.equal((found as { npcs: { id: string }[] }).npcs[0]!.id, npcId);
        const sheet = await tools('campaign_npcs_get', { id: npcId }, 'sheet');
        assert.equal(
          (sheet as { npc: { attributes: { strength: number } } }).npc.attributes.strength,
          3
        );
        assert.doesNotMatch(JSON.stringify(sheet), /PRIVATE_NPC|notes/);
        await assert.rejects(
          tools('campaign_npcs_get', { id: randomUUID() }, 'missing'),
          /NPC is not/
        );
        await assert.rejects(
          tools(
            'roll_dice',
            {
              slot: 0,
              groups: [{ label: 'Check', count: 1, sides: 6 }],
              reason: 'Check merchant',
              declaration: 'No modifiers',
              actorId: randomUUID(),
            },
            'invalid-actor'
          ),
          /frozen context/
        );
        const roll = await tools(
          'roll_dice',
          {
            slot: 0,
            groups: [{ label: 'Check', count: 1, sides: 6 }],
            reason: 'Check merchant',
            declaration: 'No modifiers',
            actorId: npcId,
          },
          'roll'
        );
        if (calls === 1)
          throw new Problem(503, 'local_service', 'Synthetic interruption after NPC dice');
        return {
          version: 5,
          narrative: 'A familiar merchant greets you.',
          operations: [],
          rollInterpretations: [
            {
              rollId: (roll as { rollId: string }).rollId,
              explanation: 'The merchant greets you.',
            },
          ],
          ruleCitations: [],
          knowledgeChanges: [],
          operationExplanations: [],
        };
      },
    };
    const service = new TurnService(store, generator, 5);
    const first = await service.submit(c.id, {
      revision: 0,
      requestId: randomUUID(),
      action: 'Return to town',
    });
    const failed = await finish(c.id, first.id);
    assert.equal(failed.status, 'failed', failed.error ?? '');
    const retried = await service.retry(c.id, first.id, {
      revision: 0,
      requestId: randomUUID(),
      settings: { provider: 'switched', model: 'fixture', effort: null },
    });
    const completed = await finish(c.id, retried.id);
    assert.equal(completed.status, 'completed', completed.error ?? '');
    assert.equal(calls, 2);
    const library = new LibraryService(store);
    const exported = await library.export(c.id);
    assert.equal(exported.version, 6);
    const original: FrozenKnowledge = exported.diceSessions![0]!.frozenKnowledge!;
    assert.equal(original.npcCharacters![0]!.id, npcId);
    assert.ok(
      exported.diceSessions![0]!.toolDefinitions!.some((tool) => tool.name === 'campaign_npcs_get')
    );
    const imported = await library.import(exported);
    const reexported = await library.export(imported.id);
    const restored: FrozenKnowledge = reexported.diceSessions![0]!.frozenKnowledge!;
    assert.equal(restored.npcCharacters![0]!.id, imported.characters[0]!.id);
    assert.equal(restored.npcCharacters![0]!.inventory.coins, 7);
    assert.doesNotMatch(JSON.stringify(restored), /PRIVATE_NPC|notes/);
    await library.import(reexported);
  }
);

test(
  'pre-NPC v5 retries retain exact frozen definitions and do not backfill the new roster',
  { skip: !enabled },
  async () => {
    const c = newCampaign({ name: 'Legacy v5 NPC retry' });
    await store.insert(c);
    let calls = 0;
    const generator: Generator = {
      ...base,
      generate: async () => ({ narrative: 'You continue.' }),
      generateOwnedGameplay: async (_s, _p, _schema, system, tools) => {
        calls++;
        assert.doesNotMatch(system, /campaign_npcs_get/);
        assert.ok(
          !tools.definitions!.some((definition) => definition.name.startsWith('campaign_npcs_'))
        );
        const roll = await tools(
          'roll_dice',
          {
            slot: 0,
            groups: [{ label: 'Check', count: 1, sides: 6 }],
            reason: 'Check',
            declaration: 'No modifiers',
          },
          'roll'
        );
        return {
          version: 5,
          narrative: 'You continue.',
          operations: [],
          rollInterpretations: [
            { rollId: (roll as { rollId: string }).rollId, explanation: 'Continue.' },
          ],
          ruleCitations: [],
          knowledgeChanges: [],
          operationExplanations: [],
        };
      },
    };
    const service = new TurnService(store, generator, 5);
    const context = buildContext(c, [], 'Continue', [], 16000, true, undefined, 5);
    const knowledge = freezeKnowledge(c, 5);
    const definitions = new GameplayTools({
      book: false,
      knowledge,
      readCampaignSource: async () => ({}),
      assertActive: async () => {},
      roll: async () => {
        throw Error('Fixture only');
      },
    }).definitions;
    const sessionId = randomUUID();
    const first: Turn = {
      id: randomUUID(),
      campaignId: c.id,
      requestId: randomUUID(),
      status: 'failed',
      action: 'Continue',
      narrative: null,
      changes: [],
      error: 'Historical interruption',
      undone: false,
      settings: c.settings,
      context,
      createdAt: c.createdAt,
      completedAt: c.createdAt,
      diceSessionId: sessionId,
    };
    await store.pool.query(
      'INSERT INTO turns(id,campaign_id,request_id,payload_hash,status,document) VALUES($1,$2,$3,$4,$5,$6)',
      [first.id, c.id, first.requestId, 'fixture', first.status, first]
    );
    await store.pool.query(
      'INSERT INTO dice_sessions(id,campaign_id,root_turn_id,context_digest,frozen_prompt,frozen_revision,character_ids,prompt_contract_version,digest_version,system_prompt,frozen_knowledge,tool_definitions,frozen_sources) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
      [
        sessionId,
        c.id,
        first.id,
        gameplayDigest(c, [], undefined, 3),
        context.prompt,
        0,
        '[]',
        5,
        3,
        gameplayInstructionEnvelope('', '', false, 5),
        knowledge,
        JSON.stringify(definitions),
        context.frozenSources,
      ]
    );
    const retry = await service.retry(c.id, first.id, { revision: 0, requestId: randomUUID() });
    const completed = await finish(c.id, retry.id);
    assert.equal(completed.status, 'completed', completed.error ?? '');
    assert.equal(calls, 1);
  }
);
test(
  'on-demand context inspection hydrates exact root inputs without duplicating persisted registry and enforces campaign ownership',
  { skip: !enabled },
  async () => {
    const c = newCampaign({ name: 'Inspect context', instructions: '  Exact context\n' });
    await store.insert(c);
    const service = new TurnService(store, base, 4);
    const t = await service.submit(c.id, {
      revision: 0,
      requestId: randomUUID(),
      action: 'Inspect',
    });
    assert.equal((await finish(c.id, t.id)).status, 'completed');
    const canonical = (await store.pool.query('SELECT document FROM turns WHERE id=$1', [t.id]))
      .rows[0].document.context;
    assert.equal(canonical.systemPrompt, undefined);
    assert.equal(canonical.frozenKnowledge, undefined);
    const root = (
      await store.pool.query('SELECT * FROM dice_sessions WHERE root_turn_id=$1', [t.id])
    ).rows[0];
    const { app } = createApp({ store, providers: new ProviderService() });
    const response = await request(app)
      .get(`/api/campaigns/${c.id}/turns/${t.id}/context`)
      .set('Host', 'localhost:4100')
      .expect(200);
    assert.equal(response.body.data.prompt, root.frozen_prompt);
    assert.equal(response.body.data.systemPrompt, root.system_prompt);
    assert.deepEqual(response.body.data.frozenKnowledge, root.frozen_knowledge);
    assert.deepEqual(response.body.data.toolDefinitions, root.tool_definitions);
    await request(app)
      .get(`/api/campaigns/${randomUUID()}/turns/${t.id}/context`)
      .set('Host', 'localhost:4100')
      .expect(404);
    const legacy = new TurnService(
      store,
      {
        ...base,
        generateOwnedGameplay: undefined,
        generate: async () => ({ version: 1, narrative: 'Legacy', operations: [] }),
      },
      1
    );
    const old = await legacy.submit(c.id, { revision: 1, requestId: randomUUID(), action: 'Old' });
    assert.equal((await finish(c.id, old.id)).status, 'completed');
    assert.deepEqual(
      await store.turnContext(c.id, old.id),
      (await store.turn(c.id, old.id)).context
    );
  }
);
