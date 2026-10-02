import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.js';
import { appRoot } from '../src/config.js';
import { newCampaign } from '../src/domain/campaign.js';
import { TurnService } from '../src/services/turns.js';
import { LibraryService } from '../src/services/library.js';
import type { Generator } from '../src/providers/service.js';
import type { GMResponse, Turn, Campaign } from '../src/domain/types.js';
import { Problem } from '../src/errors.js';
import { SourceLibrary } from '../src/services/sourceLibrary.js';
import { textSource } from '../src/services/sources.js';
const enabled = !!process.env.RPG_TEST_DATABASE_URL && process.env.NODE_ENV === 'test';
let store: Store;
before(async () => {
  if (!enabled) return;
  store = new Store();
  await store.transaction(async (client) => {
    await client.query(
      await readFile(path.join(appRoot, 'migrationssql', '0001_local.sql'), 'utf8')
    );
    const artifacts = await client.query(
      "SELECT to_regclass('public.source_artifacts') AS table_name"
    );
    if (!artifacts.rows[0].table_name)
      await client.query(
        await readFile(path.join(appRoot, 'migrationssql', '0002_source_artifacts.sql'), 'utf8')
      );
  });
});

test(
  'PostgreSQL sends complete mandatory context above the soft planning target',
  { skip: !enabled },
  async () => {
    const initial = await create();
    try {
      const campaign = await store.edit(initial.id, initial.revision, (c) => {
        c.instructions = 'x'.repeat(16000);
      });
      let generated = 0;
      const service = new TurnService(store, {
        capacity: async () => 16000,
        generate: async (_settings, prompt) => {
          generated++;
          assert.equal(JSON.parse(prompt).mandatory.campaignInstructions, 'x'.repeat(16000));
          return { version: 1, narrative: 'Accepted', operations: [] };
        },
      });
      const submitted = await service.submit(campaign.id, {
        revision: campaign.revision,
        requestId: randomUUID(),
        action: 'Open the door',
      });
      let terminal = await store.turn(campaign.id, submitted.id);
      for (let i = 0; terminal.status === 'pending' || terminal.status === 'running'; i++) {
        assert.ok(i < 400);
        await new Promise((resolve) => setTimeout(resolve, 10));
        terminal = await store.turn(campaign.id, submitted.id);
      }
      assert.equal(terminal.status, 'completed');
      assert.equal(generated, 1);
      assert.equal((await store.campaign(campaign.id)).memory, null);
    } finally {
      await store.pool.query('DELETE FROM campaigns WHERE id=$1', [initial.id]);
    }
  }
);

test(
  'PostgreSQL character parsing requires review, stays bounded and rejects stale drafts without persisting a character',
  { skip: !enabled },
  async () => {
    const initial = await create();
    const sources = new SourceLibrary(store);
    let calls = 0;
    const generator: Generator = {
      capacity: async () => 16000,
      generate: async () => {
        calls++;
        return {
          name: 'Mira',
          type: 'player',
          attributes: { hp: 12 },
          inventory: {},
          description: {},
        };
      },
    };
    try {
      const source = textSource('Sheet', 'Mira has twelve health points.');
      source.status = 'draft'; // Exercise the retained explicit-draft workflow, not normal import.
      let c = await sources.add(initial.id, initial.revision, source);
      await assert.rejects(
        sources.characterDraft(c.id, { revision: c.revision, sourceId: source.id }, generator),
        /Confirm extracted text/
      );
      assert.equal(calls, 0);
      c = await sources.correct(c.id, source.id, {
        revision: c.revision,
        text: source.text,
        confirmed: true,
      });
      const parsed = await sources.characterDraft(
        c.id,
        { revision: c.revision, sourceId: source.id },
        generator
      );
      assert.equal(parsed.draft.name, 'Mira');
      assert.deepEqual((await store.campaign(c.id)).characters, []);
      c = await sources.correct(c.id, source.id, {
        revision: c.revision,
        text: 'x'.repeat(9000),
        confirmed: true,
      });
      const longer = await sources.characterDraft(
        c.id,
        { revision: c.revision, sourceId: source.id },
        generator
      );
      assert.equal(longer.draft.name, 'Mira');
      assert.equal(calls, 2);
      c = await sources.correct(c.id, source.id, {
        revision: c.revision,
        text: 'Mira has twelve health points.',
        confirmed: true,
      });
      const staleGenerator: Generator = {
        capacity: generator.capacity,
        generate: async (...args) => {
          await store.edit(c.id, c.revision, (current) => {
            current.name = 'Edited during parsing';
          });
          return generator.generate(...args);
        },
      };
      await assert.rejects(
        sources.characterDraft(c.id, { revision: c.revision, sourceId: source.id }, staleGenerator),
        /changed during parsing/
      );
      assert.deepEqual((await store.campaign(c.id)).characters, []);
    } finally {
      await store.pool.query('DELETE FROM campaigns WHERE id=$1', [initial.id]);
    }
  }
);
after(async () => {
  if (enabled) await store.close();
});
const settings = { provider: 'fixture', model: 'synthetic', effort: null };
const immediate: Generator = {
  capacity: async () => 16000,
  generate: async () =>
    ({
      version: 1,
      narrative: 'The door opens.',
      operations: [{ op: 'state', expected: {}, value: { door: 'open' } }],
    }) satisfies GMResponse,
};
async function wait(campaignId: string, id: string): Promise<Turn> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const t = await store.turn(campaignId, id);
    if (!['pending', 'running'].includes(t.status)) return t;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Fixture turn did not finish');
}
async function create(): Promise<Campaign> {
  const c = newCampaign({ name: 'Isolated integration campaign', settings });
  await store.insert(c);
  return c;
}
function deferredGenerator() {
  let resolve: (value: unknown) => void = () => {};
  let started = () => {};
  const ready = new Promise<void>((r) => {
    started = r;
  });
  const generator: Generator = {
    capacity: async () => 16000,
    generate: async (_settings, _prompt, _schema, signal) => {
      started();
      return new Promise((r, reject) => {
        resolve = r;
        signal?.addEventListener(
          'abort',
          () => reject(new Problem(409, 'cancelled', 'Cancelled')),
          { once: true }
        );
      });
    },
  };
  return { generator, ready, resolve: (value: unknown) => resolve(value) };
}

test(
  'PostgreSQL concurrent duplicate requests replay one turn and distinct requests have one winner',
  { skip: !enabled },
  async () => {
    const c = await create();
    const fixture = deferredGenerator();
    const service = new TurnService(store, fixture.generator);
    try {
      const input = { revision: c.revision, requestId: randomUUID(), action: 'Open the door' };
      // Deliberate concurrency proves the database lock and payload-bound request semantics.
      const duplicate = await Promise.allSettled([
        service.submit(c.id, input),
        service.submit(c.id, input),
      ]);
      assert.ok(duplicate.every((result) => result.status === 'fulfilled'));
      const same = duplicate.map((result) => {
        assert.equal(result.status, 'fulfilled');
        return result.value;
      });
      assert.equal(same[0]!.id, same[1]!.id);
      await fixture.ready;
      await service.cancel(c.id, same[0]!.id);
      const distinct = await Promise.allSettled([
        service.submit(c.id, { ...input, requestId: randomUUID(), action: 'First contender' }),
        service.submit(c.id, { ...input, requestId: randomUUID(), action: 'Second contender' }),
      ]);
      const winners = distinct.filter((result) => result.status === 'fulfilled');
      const losers = distinct.filter((result) => result.status === 'rejected');
      assert.equal(winners.length, 1);
      assert.equal(losers.length, 1);
      assert.match(String(losers[0]!.reason), /active turn/);
      await service.cancel(c.id, winners[0]!.value.id);
      assert.equal((await store.turns(c.id)).length, 2);
      assert.deepEqual((await store.campaign(c.id)).state, {});
    } finally {
      await store.pool.query('DELETE FROM campaigns WHERE id=$1', [c.id]);
    }
  }
);
test(
  'PostgreSQL commits complete turn, binds idempotency and preserves undo through archive roundtrip',
  { skip: !enabled },
  async () => {
    const c = await create();
    const service = new TurnService(store, immediate);
    const input = { revision: 0, requestId: randomUUID(), action: 'Open door' };
    const t = await service.submit(c.id, input);
    const completed = await wait(c.id, t.id);
    assert.equal(completed.status, 'completed');
    assert.deepEqual((await store.campaign(c.id)).state, { door: 'open' });
    const same = await service.submit(c.id, input);
    assert.equal(same.id, t.id);
    await assert.rejects(
      service.submit(c.id, { ...input, action: 'different' }),
      /different input/
    );
    const library = new LibraryService(store);
    const imported = await library.import(await library.export(c.id));
    assert.notEqual(imported.id, c.id);
    const undone = await service.undo(imported.id, imported.revision);
    assert.deepEqual(undone.state, {});
    assert.equal((await store.activeTurns(imported.id)).length, 0);
    const original = await service.undo(c.id, 1);
    assert.deepEqual(original.state, {});
    assert.equal((await service.submit(c.id, input)).status, 'completed');
  }
);
test(
  'PostgreSQL rejects stale provider output and cancellation wins against late output',
  { skip: !enabled },
  async () => {
    const c = await create();
    const fixture = deferredGenerator();
    const service = new TurnService(store, fixture.generator);
    const t = await service.submit(c.id, { revision: 0, requestId: randomUUID(), action: 'Look' });
    await fixture.ready;
    await store.edit(c.id, 0, (c) => {
      c.state = { manual: 'preserved' };
    });
    fixture.resolve({
      version: 1,
      narrative: 'late',
      operations: [{ op: 'state', expected: {}, value: { door: 'open' } }],
    });
    assert.equal((await wait(c.id, t.id)).status, 'failed');
    assert.deepEqual((await store.campaign(c.id)).state, { manual: 'preserved' });
    const second = deferredGenerator();
    const other = new TurnService(store, second.generator);
    const current = await store.campaign(c.id);
    const t2 = await other.submit(c.id, {
      revision: current.revision,
      requestId: randomUUID(),
      action: 'again',
    });
    await second.ready;
    await other.cancel(c.id, t2.id);
    second.resolve({ version: 1, narrative: 'too late', operations: [] });
    assert.equal((await wait(c.id, t2.id)).status, 'cancelled');
    assert.deepEqual((await store.campaign(c.id)).state, { manual: 'preserved' });
  }
);
test(
  'PostgreSQL one-active-turn constraint, source correction reindex, memory undo invalidation and restart recovery',
  { skip: !enabled },
  async () => {
    const c = await create();
    const fixture = deferredGenerator();
    const service = new TurnService(store, fixture.generator);
    const t = await service.submit(c.id, { revision: 0, requestId: randomUUID(), action: 'a' });
    await fixture.ready;
    await assert.rejects(
      service.submit(c.id, { revision: 0, requestId: randomUUID(), action: 'b' }),
      /active turn/
    );
    fixture.resolve({ version: 1, narrative: 'Marta lost health.', operations: [] });
    await wait(c.id, t.id);
    const saved = await store.campaign(c.id);
    await service.manualMemory(c.id, {
      revision: saved.revision,
      text: 'Marta lost health.',
      coveredTurnIds: [t.id],
      confirm: true,
    });
    const withMemory = await store.campaign(c.id);
    assert.ok(withMemory.memory);
    const undone = await service.undo(c.id, withMemory.revision);
    assert.equal(undone.memory, null);
    const sourceId = randomUUID();
    const corrected = await store.edit(c.id, undone.revision, async (c, client) => {
      c.sources.push({
        id: sourceId,
        name: 'Rules',
        kind: 'text',
        text: 'Stealth grants advantage',
        status: 'confirmed',
        version: 1,
        pages: [],
        warnings: [],
      });
      await store.reindex(c, client);
    });
    assert.equal((await store.retrieve(corrected, 'Stealth'))[0]!.version, 1);
    const updated = await store.edit(c.id, corrected.revision, async (c, client) => {
      c.sources[0]!.text = 'Diplomacy grants advantage';
      c.sources[0]!.version = 2;
      await store.reindex(c, client);
    });
    assert.equal((await store.retrieve(updated, 'Stealth')).length, 0);
    assert.equal((await store.retrieve(updated, 'Diplomacy'))[0]!.version, 2);
    const next = deferredGenerator();
    const other = new TurnService(store, next.generator);
    const pending = await other.submit(c.id, {
      revision: updated.revision,
      requestId: randomUUID(),
      action: 'final',
    });
    await next.ready;
    await store.pool.query("UPDATE turns SET lease_until=now()-interval '1 minute' WHERE id=$1", [
      pending.id,
    ]);
    assert.ok(await store.recover());
    next.resolve({ version: 1, narrative: 'late after restart', operations: [] });
    assert.equal((await wait(c.id, pending.id)).status, 'interrupted');
  }
);
test(
  'PostgreSQL threshold compaction is bounded, occasional and shared across provider switches',
  { skip: !enabled },
  async () => {
    const campaign = await create();
    await store.edit(campaign.id, 0, (c) => {
      c.pinnedFacts = ['Marta owes a favor.'];
    });
    const prompts: { provider: string; prompt: string; memory: boolean }[] = [];
    const generator: Generator = {
      capacity: async () => 16000,
      generate: async (settings, prompt, schema) => {
        const isMemory = !!(schema as { properties?: { text?: unknown } }).properties?.text;
        prompts.push({ provider: settings.provider, prompt, memory: isMemory });
        return isMemory
          ? { text: 'Marta owes a favor. The party explored old rooms.' }
          : {
              version: 1,
              narrative: 'Dust covers the floor and a door opens. '.repeat(30),
              operations: [],
            };
      },
    };
    const service = new TurnService(store, generator);
    for (let index = 0; index < 20; index++) {
      const c = await store.campaign(campaign.id);
      const submitted = await service.submit(c.id, {
        revision: c.revision,
        requestId: randomUUID(),
        action: `Inspect room ${index}`,
        settings: { ...settings, provider: index % 2 ? 'fixture-a' : 'fixture-b' },
      });
      assert.equal((await wait(c.id, submitted.id)).status, 'completed');
    }
    const summaries = prompts.filter((p) => p.memory);
    assert.ok(summaries.length >= 2 && summaries.length < 10);
    for (const p of prompts) {
      assert.ok(Buffer.byteLength(p.prompt) <= (p.memory ? 8000 : 16000));
      assert.ok(p.prompt.includes('Marta owes a favor.'));
    }
    assert.equal((await store.activeTurns(campaign.id)).length, 20);
    assert.ok((await store.campaign(campaign.id)).memory);
    assert.ok(prompts.some((p) => p.provider === 'fixture-a'));
    assert.ok(prompts.some((p) => p.provider === 'fixture-b'));
  }
);

test(
  'PostgreSQL natural-action retrieval ignores unrelated character names and sections/artifacts/templates survive correctly',
  { skip: !enabled },
  async () => {
    const { SourceLibrary } = await import('../src/services/sourceLibrary.js');
    const { CampaignService } = await import('../src/services/campaigns.js');
    const { textSource } = await import('../src/services/sources.js');
    const c = await create();
    c.characters = [
      {
        id: randomUUID(),
        name: 'Mira',
        type: 'player',
        attributes: { hp: 10 },
        inventory: {},
        description: {},
        notes: 'private',
        revision: 0,
      },
    ];
    await store.transaction(async (client) => {
      await store.save(c, client);
    });
    const source = textSource('Stealth', 'Stealth: sneak silently to avoid detection.');
    source.status = 'confirmed';
    const sources = new SourceLibrary(store);
    const campaigns = new CampaignService(store, immediate);
    const library = new LibraryService(store);
    try {
      let current = await sources.add(c.id, c.revision, source, Buffer.from('original rule text'));
      const found = await store.retrieve(current, 'I sneak past the guard');
      assert.equal(found[0]?.id, source.id);
      current = await campaigns.patch(c.id, current.revision, {
        pinnedSourceSections: [{ sourceId: source.id, version: 1, index: 0 }],
      });
      assert.equal((await sources.sections(c.id, source.id))[0]?.pinned, true);
      assert.equal(
        (await sources.original(c.id, source.id)).bytes.toString(),
        'original rule text'
      );
      const template = await library.characterTemplate({
        name: 'Mira reusable',
        campaignId: c.id,
        characterId: c.characters[0]!.id,
        revision: current.revision,
      });
      current = await library.instantiateCharacter(c.id, template.id, current.revision);
      assert.equal(current.characters.length, 2);
      assert.equal(current.characters[1]?.notes, '');
      assert.notEqual(current.characters[1]?.id, c.characters[0]!.id);
      current = await sources.correct(c.id, source.id, {
        revision: current.revision,
        text: 'Corrected stealth rule',
        confirmed: true,
      });
      assert.deepEqual(current.pinnedSourceSections, []);
      await library.deleteTemplate('character', template.id);
    } finally {
      await store.pool.query('DELETE FROM campaigns WHERE id=$1', [c.id]);
    }
  }
);
