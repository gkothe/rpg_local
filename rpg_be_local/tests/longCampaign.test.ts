import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { newCampaign } from '../src/domain/campaign.js';
import {
  buildContext,
  compactionBatch,
  estimateTokens,
  uncovered,
  uncoveredHistoryTokens,
} from '../src/domain/context.js';
import type { Turn } from '../src/domain/types.js';
test('1000-turn synthetic campaign preserves pinned facts and never sends full transcripts to gameplay or memory', () => {
  const c = newCampaign({ name: 'Long campaign' });
  c.pinnedFacts = ['Marta owes you a favor.'];
  const turns: Turn[] = [];
  let summaries = 0;
  for (let index = 0; index < 1000; index++) {
    if (uncoveredHistoryTokens(c, turns) > 5000) {
      const batch = compactionBatch(c, turns);
      assert.ok(estimateTokens(batch.prompt) <= 8000);
      assert.ok(batch.turns.length < turns.length || turns.length < 30);
      assert.ok(batch.prompt.includes('Marta owes you a favor.'));
      c.memory = {
        id: randomUUID(),
        text: 'Marta owes you a favor. Unresolved: find the silver key.',
        coveredTurnIds: [...(c.memory?.coveredTurnIds ?? []), ...batch.turns.map((t) => t.id)],
        valid: true,
        createdAt: new Date().toISOString(),
      };
      summaries++;
    }
    const context = buildContext(c, turns, 'Find the silver key', [], 16000);
    assert.ok(context.estimatedTokens <= 16000);
    assert.ok(context.prompt.includes('Marta owes you a favor.'));
    assert.ok(context.historyIds.length < 30);
    assert.equal(context.historyIds.length, uncovered(c, turns).length);
    turns.push({
      id: randomUUID(),
      campaignId: c.id,
      requestId: randomUUID(),
      status: 'completed',
      action: `Investigate room ${index}`,
      narrative: `The room contains a locked chest. ${'Dust covers the floor. '.repeat(15)}`,
      changes: [],
      error: null,
      undone: false,
      settings: { provider: index % 2 ? 'claude' : 'codex', model: 'fixture', effort: null },
      context,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
  }
  assert.ok(summaries > 50);
  assert.equal(turns.length, 1000);
});
