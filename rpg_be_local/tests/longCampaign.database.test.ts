import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/store.js';
import { newCampaign } from '../src/domain/campaign.js';
import { TurnService } from '../src/services/turns.js';
import type { Generator } from '../src/providers/service.js';

const enabled =
  process.env.NODE_ENV === 'test' &&
  !!process.env.RPG_TEST_DATABASE_URL &&
  process.env.RPG_LONG_CAMPAIGN_TESTS === '1';

test(
  'PostgreSQL executes 1000 real service turns with bounded automatic compaction, provider/model switches and undo invalidation',
  { skip: !enabled, timeout: 180000 },
  async (testContext) => {
    const store = new Store();
    const c = newCampaign({ name: 'Isolated 1000-turn service regression' });
    c.pinnedFacts = ['Marta owes you a favor.'];
    c.state = { step: 0 };
    const requests: {
      kind: 'gameplay' | 'memory';
      provider: string;
      model: string;
      bytes: number;
    }[] = [];
    const generator: Generator = {
      // Exercise the same separate envelope reserve as the production provider boundary.
      capacity: async (_settings, ceiling = 16000) => ceiling - 3200,
      generate: async (settings, prompt, schema) => {
        const memory = !!(schema as { properties?: { text?: unknown } }).properties?.text;
        const bytes = Buffer.byteLength(prompt, 'utf8');
        assert.ok(bytes + 3200 <= (memory ? 8000 : 16000));
        assert.ok(prompt.includes('Marta owes you a favor.'));
        const input = JSON.parse(prompt);
        requests.push({
          kind: memory ? 'memory' : 'gameplay',
          provider: settings.provider,
          model: settings.model,
          bytes,
        });
        if (memory) {
          assert.ok(input.turns.length > 0 && input.turns.length < 20);
          return { text: 'Marta owes you a favor. Unresolved: find the silver key.' };
        }
        assert.ok(input.history.length < 20);
        const step = input.mandatory.state.step as number;
        return {
          version: 1,
          narrative: `Room ${step}: a locked chest remains. ${'Dust covers the floor. '.repeat(20)}`,
          operations: [{ op: 'state', expected: { step }, value: { step: step + 1 } }],
        };
      },
    };
    const service = new TurnService(store, generator);
    try {
      await store.insert(c);
      for (let index = 0; index < 1000; index++) {
        const current = await store.campaign(c.id);
        const settings = {
          provider: index % 2 ? 'fixture-a' : 'fixture-b',
          model: index % 3 ? 'model-one' : 'model-two',
          effort: index % 2 ? 'high' : 'low',
        };
        const turn = await service.submit(c.id, {
          revision: current.revision,
          requestId: randomUUID(),
          action: `Find the silver key in room ${index}`,
          settings,
        });
        for (let poll = 0; ; poll++) {
          const saved = await store.turn(c.id, turn.id);
          if (!['pending', 'running'].includes(saved.status)) {
            assert.equal(saved.status, 'completed', saved.error ?? `Turn ${index} failed`);
            assert.deepEqual(saved.settings, settings);
            break;
          }
          assert.ok(poll < 2000, `Turn ${index} did not settle`);
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
      }
      const final = await store.campaign(c.id);
      assert.deepEqual(final.state, { step: 1000 });
      const turns = await store.activeTurns(c.id);
      assert.equal(turns.length, 1000);
      const summaries = requests.filter((request) => request.kind === 'memory');
      assert.ok(summaries.length > 50 && summaries.length < 500);
      assert.equal(requests.filter((request) => request.kind === 'gameplay').length, 1000);
      assert.equal(new Set(requests.map((request) => request.provider)).size, 2);
      assert.equal(new Set(requests.map((request) => request.model)).size, 2);
      assert.ok(final.memory && final.memory.coveredTurnIds.length > 900);
      const reviewed = await service.manualMemory(c.id, {
        revision: final.revision,
        text: 'Marta owes you a favor. All explored rooms are recorded.',
        coveredTurnIds: turns.map((turn) => turn.id),
        confirm: true,
      });
      const coveringMemoryId = reviewed.memory!.id;
      const restored = await service.undo(c.id, reviewed.revision);
      assert.deepEqual(restored.state, { step: 999 });
      assert.ok(restored.memory && !restored.memory.coveredTurnIds.includes(turns.at(-1)!.id));
      const checkpoint = await store.pool.query('SELECT document FROM memories WHERE id=$1', [
        coveringMemoryId,
      ]);
      assert.equal(checkpoint.rows[0].document.valid, false);
      assert.equal((await store.activeTurns(c.id)).length, 999);
      testContext.diagnostic(
        `1000 completed gameplay calls, ${summaries.length} automatic bounded compactions; every prompt inspected; latest state restored and covering memory invalidated`
      );
    } finally {
      await store.pool.query('DELETE FROM campaigns WHERE id=$1', [c.id]);
      await store.close();
    }
  }
);
