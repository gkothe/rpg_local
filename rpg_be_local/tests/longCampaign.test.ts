import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { newCampaign } from '../src/domain/campaign.js';
import {
  buildContext,
  compactionBatch,
  estimateTokens,
  recentGameplayHistory,
  olderHistoryBytes,
} from '../src/domain/context.js';
import type { Turn } from '../src/domain/types.js';
import {
  applyKnowledgeChanges,
  KnowledgeKind,
  KnowledgeOrigin,
  KnowledgeCertainty,
  KnowledgeStatus,
  KnowledgeVisibility,
} from '../src/domain/knowledge.js';
import { createKnowledgeRecall, freezeKnowledge } from '../src/domain/knowledgeRecall.js';
import { gameplayResponseWireJsonSchema } from '../src/domain/gameplayResponse.js';
test('1000-turn synthetic campaign preserves knowledge and excludes player description and full transcripts from gameplay or memory', () => {
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
        visibility: KnowledgeVisibility.Player,
      },
    ],
    [],
    new Map(),
    { campaignId: c.id, turnId: randomUUID() }
  ).records;
  const originalFact = structuredClone(c.knowledge[0]!);
  c.description = 'PLAYER_SUMMARY_CANARY';
  const turns: Turn[] = [];
  let summaries = 0;
  for (let index = 0; index < 1000; index++) {
    if (olderHistoryBytes(c, turns) > 5000) {
      const batch = compactionBatch(c, turns);
      assert.ok(estimateTokens(batch.prompt) <= 8000);
      assert.ok(batch.turns.length < turns.length || turns.length < 30);
      assert.ok(!batch.prompt.includes('PLAYER_SUMMARY_CANARY'));
      c.memory = {
        id: randomUUID(),
        text: 'Marta owes you a favor. Unresolved: find the silver key.',
        coveredTurnIds: [...(c.memory?.coveredTurnIds ?? []), ...batch.turns.map((t) => t.id)],
        valid: true,
        createdAt: new Date().toISOString(),
      };
      summaries++;
    }
    const context = buildContext(c, turns, 'Find the silver key', []);
    // Everything except the fixed response schema stays within the planning target.
    const schemaBytes = Buffer.byteLength(JSON.stringify(gameplayResponseWireJsonSchema));
    assert.ok(context.estimatedTokens - schemaBytes <= 16000);
    assert.ok(!context.prompt.includes('PLAYER_SUMMARY_CANARY'));
    assert.ok(context.historyIds.length < 30);
    assert.equal(context.historyIds.length, recentGameplayHistory(c, turns).history.length);
    assert.deepEqual(
      context.historyIds.slice(-3),
      turns.slice(-3).map((t) => t.id)
    );
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
