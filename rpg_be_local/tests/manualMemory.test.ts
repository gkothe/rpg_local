import { CONTEXT_DEFAULTS } from '../src/domain/options.js';
import { campaignPatchSchema } from '../src/domain/schemas.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { newCampaign } from '../src/domain/campaign.js';
import { TurnService } from '../src/services/turns.js';
import type { Store } from '../src/store.js';
import type { Generator } from '../src/providers/service.js';
import type { Memory } from '../src/domain/types.js';

test('manual memory preserves text above the soft target and still checks coverage', async () => {
  const campaign = newCampaign({ name: 'Synthetic memory' });
  const turnId = randomUUID();
  const saved: Memory[] = [];
  const store = {
    edit: async (
      _id: string,
      _revision: number,
      apply: (c: typeof campaign, client: unknown) => Promise<unknown>
    ) => apply(campaign, {}),
    assertIdle: async () => {},
    activeTurns: async () => [{ id: turnId }],
    memory: async (_campaign: unknown, memory: Memory) => saved.push(memory),
  } as unknown as Store;
  const service = new TurnService(store, {} as Generator);
  const text = 'Established campaign history. '.repeat(1500);
  await service.manualMemory(campaign.id, {
    revision: 0,
    text,
    coveredTurnIds: [turnId],
    confirm: true,
  });
  assert.equal(saved[0]?.text, text);
  await assert.rejects(
    service.manualMemory(campaign.id, {
      revision: 0,
      text,
      coveredTurnIds: [randomUUID()],
      confirm: true,
    }),
    /consecutive prefix/
  );
  assert.equal(saved.length, 1);
});

test('retired memory budget is absent from defaults and discarded from legacy edits', () => {
  assert.deepEqual(Object.keys(CONTEXT_DEFAULTS), ['compaction']);
  const parsed = campaignPatchSchema.parse({
    revision: 0,
    budgets: { gameplay: 16000, compaction: 8000, memory: 2000 },
  });
  assert.deepEqual(parsed.budgets, { compaction: 8000 });
});
