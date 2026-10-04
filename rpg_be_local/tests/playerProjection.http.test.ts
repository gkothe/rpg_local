import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { newCampaign } from '../src/domain/campaign.js';
import { applyResponse } from '../src/domain/state.js';
import {
  KnowledgeVisibility as V,
  KnowledgeKind as K,
  KnowledgeOrigin as O,
  KnowledgeCertainty as C,
  KnowledgeStatus as S,
} from '../src/domain/knowledge.js';
import type { Store } from '../src/store.js';
import type { Turn } from '../src/domain/types.js';
test('ordinary campaign detail/list and turn detail/list/SSE strip frozen secrets; explicit context remains diagnostic', async () => {
  const c = applyResponse(
    newCampaign({ name: 'Example' }),
    {
      version: 5,
      narrative: 'The inn.',
      operations: [],
      rollInterpretations: [],
      ruleCitations: [],
      operationExplanations: [],
      knowledgeChanges: [
        {
          op: 'create',
          kind: K.Objective,
          title: 'SECRET title',
          text: 'SECRET plan',
          characterIds: [],
          origin: O.Gm,
          evidence: [],
          certainty: C.Established,
          status: S.Active,
          visibility: V.GmOnly,
        },
      ],
    },
    randomUUID()
  ).campaign;
  const turn = {
    id: randomUUID(),
    campaignId: c.id,
    requestId: randomUUID(),
    status: 'completed',
    action: 'start',
    narrative: 'The inn.',
    changes: [],
    error: null,
    undone: false,
    settings: c.settings,
    context: {
      prompt: 'SECRET original prompt',
      revision: c.revision,
      estimatedTokens: 1,
      estimator: 'test',
      sourceVersions: [],
      historyIds: [],
      memoryId: null,
    },
    createdAt: c.createdAt,
    completedAt: c.createdAt,
  } as Turn;
  const store = {
    campaign: async () => structuredClone(c),
    list: async () => [structuredClone(c)],
    turn: async () => structuredClone(turn),
    turns: async () => [structuredClone(turn)],
    recentTurns: async () => [structuredClone(turn)],
    turnContext: async () => turn.context,
  } as unknown as Store;
  const { app } = createApp({ store });
  for (const url of [
    '/api/campaigns',
    `/api/campaigns/${c.id}`,
    `/api/campaigns/${c.id}/turns`,
    `/api/campaigns/${c.id}/turns/${turn.id}`,
    `/api/campaigns/${c.id}/turns/${turn.id}/events`,
  ]) {
    const result = await request(app).get(url).set('Host', 'localhost:4100').expect(200);
    assert.ok(!JSON.stringify(result.body).includes('SECRET'), url);
    assert.ok(!result.text.includes('SECRET'), url);
  }
  const diagnostic = await request(app)
    .get(`/api/campaigns/${c.id}/turns/${turn.id}/context`)
    .set('Host', 'localhost:4100')
    .expect(200);
  assert.match(diagnostic.text, /SECRET original prompt/);
});
