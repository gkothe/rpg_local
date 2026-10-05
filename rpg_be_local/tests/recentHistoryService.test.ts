import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { Store, ownerId } from '../src/store.js';
import { TurnService } from '../src/services/turns.js';
import { newCampaign } from '../src/domain/campaign.js';
import { buildContext } from '../src/domain/context.js';
import { TurnStatus } from '../src/domain/options.js';
import { RuleSystemKind, DEFAULT_RULE_SYSTEM_ID, emptyRuleColumns } from '../src/domain/rules.js';
import type { Turn, Memory } from '../src/domain/types.js';
import type { Generator } from '../src/providers/service.js';

async function execute(
  count: number,
  options: { missing?: boolean; retry?: boolean; fail?: boolean } = {}
) {
  const campaign = newCampaign({ name: 'Synthetic recent history' });
  const prior: Turn[] = Array.from({ length: count }, (_, i) => ({
    id: randomUUID(),
    campaignId: campaign.id,
    requestId: randomUUID(),
    status: TurnStatus.Completed,
    action: `Player ${i}`,
    narrative: `Delivered ${i}. ` + 'Old event. '.repeat(800),
    changes: [],
    error: null,
    undone: false,
    settings: campaign.settings,
    context: null,
    createdAt: '',
    completedAt: '',
  }));
  const current: Turn = {
    ...prior[0]!,
    id: randomUUID(),
    campaignId: campaign.id,
    requestId: randomUUID(),
    status: TurnStatus.Pending,
    action: 'Current action',
    narrative: null,
    changes: [],
    error: null,
    undone: false,
    settings: campaign.settings,
    createdAt: '',
    completedAt: null,
    context: buildContext(campaign, prior, 'Current action', [], Infinity),
    ...(options.retry ? { retryOfTurnId: randomUUID() } : {}),
  };
  if (options.missing) current.context!.prompt = '';
  const frozenPrompt = current.context!.prompt;
  const summaries: string[][] = [];
  const checkpoints: Memory[] = [];
  const gameplay: string[] = [];
  const client = {
    query: async (sql: string) => {
      if (sql.startsWith('SELECT owner,lease_until'))
        return { rows: [{ owner: ownerId, lease_until: new Date(Date.now() + 60000) }] };
      if (sql.startsWith('SELECT * FROM rule_systems'))
        return {
          rows: [
            {
              id: DEFAULT_RULE_SYSTEM_ID,
              system_key: 'model',
              system_name: 'Model knowledge',
              kind: RuleSystemKind.ModelKnowledge,
              revision: 1,
              content_hash: 'fixture',
              created_at: new Date(),
              updated_at: new Date(),
              instructions: '',
              sources: [],
              mapping: {},
              ...emptyRuleColumns(),
            },
          ],
        };
      if (sql.startsWith('INSERT INTO snapshots')) return { rows: [] };
      throw new Error(`Unexpected synthetic query: ${sql}`);
    },
  } as unknown as PoolClient;
  const store = {
    pool: client,
    transaction: async <T>(callback: (client: PoolClient) => Promise<T>) => callback(client),
    campaign: async () => campaign,
    activeTurns: async () => prior,
    turn: async () => current,
    retrieve: async () => [],
    saveTurn: async () => {},
    save: async () => {},
    memory: async (_campaign: unknown, memory: Memory) => {
      checkpoints.push(memory);
      campaign.memory = memory;
    },
  } as unknown as Store;
  const generator: Generator = {
    capacity: async (_settings, ceiling = Infinity) => ceiling,
    generate: async (_settings, prompt, schema) => {
      if ('text' in (schema as { properties: object }).properties) {
        summaries.push(JSON.parse(prompt).turns.map((turn: { id: string }) => turn.id));
        if (options.fail) throw new Error('Synthetic summarizer failure');
        return { text: 'Summary of older events' };
      }
      gameplay.push(prompt);
      return { version: 1, narrative: 'Delivered new scene.', operations: [] };
    },
  };
  const service = new TurnService(store, generator);
  // Call the real orchestration, with only persistence and CLI I/O mocked.
  await (service as unknown as { run(turn: Turn): Promise<void> }).run(current);
  return { campaign, prior, current, summaries, checkpoints, gameplay, frozenPrompt };
}

test('protected-only history never invokes compaction, including a missing initial prompt', async () => {
  for (const count of [0, 1, 3]) {
    const result = await execute(count, { missing: true });
    assert.equal(result.current.status, TurnStatus.Completed, result.current.error ?? 'failed');
    assert.equal(result.summaries.length, 0);
    assert.equal(JSON.parse(result.gameplay[0]!).history.length, count);
  }
});
test('one older turn compacts and multiple batches stop before the latest three', async () => {
  for (const count of [4, 10]) {
    const result = await execute(count);
    assert.equal(result.current.status, TurnStatus.Completed, result.current.error ?? 'failed');
    assert.deepEqual(
      result.summaries.flat(),
      result.prior.slice(0, -3).map((t) => t.id)
    );
    assert.deepEqual(
      result.campaign.memory!.coveredTurnIds,
      result.prior.slice(0, -3).map((t) => t.id)
    );
    assert.deepEqual(
      JSON.parse(result.gameplay[0]!).history,
      result.prior.slice(-3).map((t) => ({ player: t.action, gm: t.narrative }))
    );
    assert.ok(result.summaries.length >= (count === 4 ? 1 : 2));
  }
});
test('retry retains frozen context and does not compact history', async () => {
  const result = await execute(4, { retry: true });
  assert.equal(result.current.status, TurnStatus.Completed, result.current.error ?? 'failed');
  assert.equal(result.summaries.length, 0);
  assert.equal(result.gameplay[0], result.frozenPrompt);
});
test('failed summary does not persist coverage or silently discard old history', async () => {
  const result = await execute(4, { fail: true });
  assert.equal(result.current.status, TurnStatus.Failed);
  assert.equal(result.checkpoints.length, 0);
  assert.equal(result.campaign.memory, null);
  assert.equal(result.gameplay.length, 0);
  assert.equal(JSON.parse(result.current.context!.prompt).history.length, 4);
});
