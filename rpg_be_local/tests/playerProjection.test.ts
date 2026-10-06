import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { newCampaign } from '../src/domain/campaign.js';
import { applyResponse, undoSnapshot } from '../src/domain/state.js';
import {
  KnowledgeVisibility as V,
  KnowledgeKind as K,
  KnowledgeOrigin as O,
  KnowledgeCertainty as C,
  KnowledgeStatus as S,
} from '../src/domain/knowledge.js';
import { publicKnowledge, publicCampaign, publicTurn } from '../src/domain/playerProjection.js';
import { freezeKnowledge, createKnowledgeRecall } from '../src/domain/knowledgeRecall.js';
import type { GameplayResponse } from '../src/domain/gameplayResponse.js';
import { emptyResponse } from './ownedGameplayFixture.js';
import type { Turn } from '../src/domain/types.js';
const hidden = () => ({
  op: 'create' as const,
  kind: K.Objective,
  title: 'Secret plot',
  text: 'SECRET murder plan',
  origin: O.Gm,
  evidence: [],
  certainty: C.Rumor,
  status: S.Active,
  characterIds: [],
  visibility: V.GmOnly,
});
const response = (): GameplayResponse => ({
  ...emptyResponse,
  narrative: 'A stranger arrives.',
  knowledgeChanges: [hidden()],
});
test('hidden continuity is available to GM recall but absent from public changes and projection', () => {
  const c = newCampaign({ name: 'Example' });
  const applied = applyResponse(c, response(), randomUUID());
  assert.deepEqual(applied.changes, []);
  assert.deepEqual(publicCampaign(applied.campaign).knowledge, []);
  const frozen = freezeKnowledge(applied.campaign);
  assert.match(createKnowledgeRecall(frozen).get({ id: frozen.records[0]!.id }).text, /SECRET/);
  assert.deepEqual(undoSnapshot(applied.campaign, applied.snapshot).knowledge, []);
});
test('partial revelation removes old secret attribution, creation evidence and stale linked names', () => {
  const c = newCampaign({ name: 'Example' });
  const applied = applyResponse(c, response(), randomUUID());
  const r = applied.campaign.knowledge![0]!;
  r.characterNames[randomUUID()] = 'SECRET name';
  r.attributions[0]!.revealReason = 'SECRET reason';
  const reveal: GameplayResponse = {
    ...response(),
    knowledgeChanges: [
      {
        op: 'update',
        id: r.id,
        expectedRevision: 1,
        changes: {
          visibility: V.Player,
          title: 'Suspicion',
          text: 'You suspect a plot.',
          characterIds: [],
          holderId: null,
        },
        origin: O.Gm,
        evidence: [],
        revealReason: 'SECRET evidence motivates disclosure',
      },
    ],
  };
  const shown = applyResponse(applied.campaign, reveal, randomUUID());
  const pub = publicKnowledge(shown.campaign.knowledge!)[0]!;
  assert.equal(pub.text, 'You suspect a plot.');
  assert.equal(pub.createdTurnId, null);
  assert.equal(pub.attributions.length, 1);
  assert.ok(!JSON.stringify(pub).includes('SECRET'));
  assert.deepEqual(publicKnowledge(undoSnapshot(shown.campaign, shown.snapshot).knowledge!), []);
  assert.throws(
    () =>
      applyResponse(
        applied.campaign,
        {
          ...reveal,
          knowledgeChanges: [
            {
              ...(reveal.knowledgeChanges[0]! as Extract<
                GameplayResponse['knowledgeChanges'][number],
                { op: 'update' }
              >),
              revealReason: undefined,
            },
          ],
        },
        randomUUID()
      ),
    /Revelation/
  );
});
test('ordinary turn DTO omits nested raw candidates and frozen prompts', () => {
  const raw = {
    id: randomUUID(),
    campaignId: randomUUID(),
    requestId: randomUUID(),
    status: 'failed',
    action: 'start',
    narrative: null,
    changes: [],
    error: 'Editing failed',
    undone: false,
    settings: { provider: 'codex', model: 'test', effort: null },
    context: { prompt: 'SECRET', frozenKnowledge: { records: [hidden()] } },
    createdAt: new Date().toISOString(),
    completedAt: null,
    gmCandidate: { narrative: 'SECRET' },
    sourceReads: [{ payload: 'SECRET' }],
  } as unknown as Turn;
  assert.ok(!JSON.stringify(publicTurn(raw)).includes('SECRET'));
  assert.equal(publicTurn(raw).context, null);
});

test('turn DTO exposes committed combat links but never preparation receipts or drafts', () => {
  const characterId = randomUUID();
  const raw = {
    id: randomUUID(),
    campaignId: randomUUID(),
    requestId: randomUUID(),
    status: 'completed',
    action: 'attack',
    narrative: 'The guard falls back.',
    changes: [],
    error: null,
    undone: false,
    settings: { provider: 'codex', model: 'test', effort: null },
    context: { prompt: 'SECRET' },
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    combatEffects: [
      {
        characterId,
        operationIndex: 0,
        paths: [['health']],
        reason: 'Hit',
        rollIds: [],
        afterParagraph: 1,
      },
    ],
    participantReferences: [{ afterParagraph: 1, characterIds: [characterId] }],
    combatPreparations: [{ payload: 'SECRET' }],
  } as unknown as Turn;
  const projected = publicTurn(raw);
  assert.deepEqual(projected.participantReferences, raw.participantReferences);
  assert.deepEqual(projected.combatEffects, raw.combatEffects);
  assert.ok(!JSON.stringify(projected).includes('SECRET'));
});
