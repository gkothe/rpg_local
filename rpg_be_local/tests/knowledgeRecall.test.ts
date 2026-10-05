import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { newCampaign } from '../src/domain/campaign.js';
import { applyResponse } from '../src/domain/state.js';
import {
  freezeKnowledge,
  createKnowledgeRecall,
  selectRelevantKnowledge,
} from '../src/domain/knowledgeRecall.js';
import {
  KnowledgeKind as K,
  KnowledgeOrigin as O,
  KnowledgeCertainty as C,
  KnowledgeStatus as S,
} from '../src/domain/knowledge.js';
test('recall is frozen across compaction/provider switches; relevance includes unresolved threads; cursors scoped to snapshot/query', () => {
  const c = newCampaign({ name: 'Recall' });
  const r = applyResponse(
    c,
    {
      version: 4,
      narrative: 'Established',
      operations: [],
      ruleCitations: [],
      rollInterpretations: [],
      knowledgeChanges: Array.from({ length: 45 }, (_, i) => ({
        op: 'create' as const,
        kind: i === 0 ? K.Debt : K.Place,
        title: `Inn ${i}`,
        text: 'Old tavern by the river',
        certainty: C.Rumor,
        status: i === 44 ? S.Retracted : S.Active,
        origin: O.Gm,
        characterIds: [],
        evidence: [],
      })),
    },
    randomUUID()
  );
  const frozen = freezeKnowledge(r.campaign);
  const recall = createKnowledgeRecall(frozen);
  r.campaign.knowledge![0]!.text = 'live changed';
  r.campaign.memory = {
    id: randomUUID(),
    text: 'Compacted',
    coveredTurnIds: [],
    valid: true,
    createdAt: new Date().toISOString(),
  };
  r.campaign.settings.provider = 'other';
  const page = recall.search({ query: 'Inn' });
  assert.equal(page.records.length, 20);
  assert.ok(page.nextCursor);
  assert.equal(recall.search({ query: 'Inn', cursor: page.nextCursor! }).records.length, 20);
  assert.equal(recall.get({ id: frozen.records[0]!.id }).text, 'Old tavern by the river');
  assert.throws(
    () =>
      createKnowledgeRecall({ ...frozen, campaignId: randomUUID() }).search({
        query: 'Inn',
        cursor: page.nextCursor!,
      }),
    /Cursor/
  );
  assert.throws(() => recall.search({ query: 'river', cursor: page.nextCursor! }), /Cursor/);
  assert.throws(() => recall.get({ id: randomUUID() }), /not in this frozen/);
  assert.equal(recall.search({ query: '', status: S.Retracted }).records.length, 1);
  assert.equal(recall.get({ id: frozen.records[44]!.id }).status, S.Retracted);
  assert.equal(selectRelevantKnowledge(r.campaign, 'Wait')[0]!.kind, K.Debt);
  for (const record of r.campaign.knowledge!) record.text += 'x'.repeat(1000);
  assert.equal(selectRelevantKnowledge(r.campaign, 'Inn').length, 44);
  assert.equal(selectRelevantKnowledge(r.campaign, 'Unrelated').length, 1);
});
