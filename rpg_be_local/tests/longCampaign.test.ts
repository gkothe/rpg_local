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
import {
  applyKnowledgeChanges,
  KnowledgeKind,
  KnowledgeOrigin,
  KnowledgeCertainty,
  KnowledgeStatus,
} from '../src/domain/knowledge.js';
import { createKnowledgeRecall, freezeKnowledge } from '../src/domain/knowledgeRecall.js';
test('1000-turn synthetic campaign preserves pinned facts and never sends full transcripts to gameplay or memory', () => {
  const c = newCampaign({ name: 'Long campaign' });
  c.knowledge = applyKnowledgeChanges(
    [],
    [
      {
        op: 'create',
        kind: KnowledgeKind.Place,
        title: 'Old harbor',
        text: 'Dockworkers claim that the harbor has a hidden cave.',
        origin: KnowledgeOrigin.Gm,
        certainty: KnowledgeCertainty.Rumor,
        status: KnowledgeStatus.Active,
        characterIds: [],
        evidence: [],
      },
    ],
    [],
    new Map(),
    { campaignId: c.id, turnId: randomUUID() }
  ).records;
  const originalFact = structuredClone(c.knowledge[0]!);
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
  assert.deepEqual(c.knowledge[0], originalFact);
  const captured = createKnowledgeRecall(freezeKnowledge(c));
  c.settings = { provider: 'antigravity', model: 'fixture', effort: null };
  c.knowledge[0]!.text = 'A later scene replaced this description.';
  const remembered = captured.get({ id: originalFact.id });
  assert.equal(remembered.text, originalFact.text);
  assert.equal(remembered.certainty, KnowledgeCertainty.Rumor);
  assert.equal(remembered.origin, KnowledgeOrigin.Gm);
  assert.equal(captured.search({ query: 'harbor' }).records[0]!.id, originalFact.id);
});
