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
