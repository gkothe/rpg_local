import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Problem } from '../src/errors.js';
import type { Generator } from '../src/providers/service.js';
import type { Campaign, Turn } from '../src/domain/types.js';
import type { DiceResult } from '../src/domain/dice.js';
import { TurnStatus } from '../src/domain/options.js';
import { DEFAULT_HISTORY_SETTINGS } from '../src/domain/historyRecall.js';
import { gmIndexCanonicalIdentity } from '../src/domain/gmIndexCompatibility.js';
import { publicCampaign, publicTurn } from '../src/domain/playerProjection.js';
import { TurnService } from '../src/services/turns.js';
import {
  dbEnabled,
  openIsolatedStore,
  seedCampaign,
  sleep,
  knowledgeRecord,
} from './journalFixture.js';
import { gmResponse, syntheticGenerate } from './ownedGameplayFixture.js';

const NARRATIVE = 'You return to the harbor shelter.';
const PRIVATE_NOTE = 'PRIVATE_INDEX_TURN_MARKER';

async function indexedCampaign(store: Awaited<ReturnType<typeof openIsolatedStore>>['store']) {
  const { campaign } = await seedCampaign(store, []);
  campaign.state = { scene: 'Harbor' };
  campaign.historyRecall = { ...structuredClone(DEFAULT_HISTORY_SETTINGS), enabled: true };
  campaign.gmIndex = {
    settings: {
      enabled: true,
      activationHistoryBaseline: { enabled: false, modeDecisionId: null },
    },
    document: {
      generationId: randomUUID(),
      contractVersion: 1,
      campaignFoundation: [],
      entries: [],
      lastCheckedTurnId: null,
      dependencyState: {
        canonicalHash: gmIndexCanonicalIdentity(campaign),
        entries: [],
        foundation: [],
        sourceCoverage: [],
        turnCoverage: [],
      },
    },
  };
  await store.transaction(async (client) => store.save(campaign, client));
  return campaign;
}

async function terminal(
  store: Awaited<ReturnType<typeof openIsolatedStore>>['store'],
  campaignId: string,
  turnId: string
): Promise<Turn> {
  for (let i = 0; i < 300; i++) {
    const turn = await store.turn(campaignId, turnId);
    if (![TurnStatus.Pending, TurnStatus.Running].includes(turn.status as TurnStatus)) return turn;
    await sleep(15);
  }
  throw new Error('Synthetic indexed turn did not finish');
}

function syntheticIndexedGenerator(
  campaign: Campaign,
  onUpdate: () => Promise<void>,
  failFirstUpdate = false,
  suppliedKnowledgeId?: string
) {
  const stages: string[] = [];
  let gameplayCalls = 0;
  let rollCalls = 0;
  let editorCalls = 0;
  let updaterCalls = 0;
  const editor = syntheticGenerate();
  const generator: Generator = {
    capacity: async () => 16000,
    gameplayCapacity: async () => 16000,
    generate: async (...args) => {
      stages.push('humanizer');
      editorCalls++;
      assert.doesNotMatch(args[1], /PRIVATE_INDEX_TURN_MARKER|gmIndexHandoff/);
      return editor(...args);
    },
    generateOwnedGameplay: async (_settings, _prompt, schema, _system, tools, _signal, trace) => {
      const properties = (schema as { properties: Record<string, unknown> }).properties;
      if ('checked' in properties) {
        stages.push('updater');
        updaterCalls++;
        assert.equal(trace?.purpose, 'gm_index_update');
        assert.equal(tools.definitions?.length, 5);
        assert.ok(!tools.definitions?.some((tool) => tool.name === 'campaign_knowledge_search'));
        assert.ok(!tools.definitions?.some((tool) => tool.name === 'roll_dice'));
        if (suppliedKnowledgeId) {
          assert.ok(
            JSON.parse(_prompt).suppliedKnowledge.some(
              (record: { id: string }) => record.id === suppliedKnowledgeId
            )
          );
        }
        await onUpdate();
        if (failFirstUpdate && updaterCalls === 1)
          throw new Problem(429, 'provider_quota', 'Synthetic updater quota failure');
        return {
          checked: { notes: true, foundation: true, direction: true },
          gmIndexChanges: [
            {
              op: 'create',
              entry: {
                kind: 'task',
                status: 'active',
                title: 'Follow up at the shelter',
                text: PRIVATE_NOTE,
                ownerCharacterId: null,
                refs: [
                  { kind: 'turn', current: true },
                  ...(suppliedKnowledgeId ? [{ kind: 'knowledge', id: suppliedKnowledgeId }] : []),
                ],
                direction: null,
              },
            },
          ],
          gmFoundationChanges: [],
        };
      }
      stages.push('gameplay');
      gameplayCalls++;
      assert.ok('gmIndexHandoff' in properties);
      rollCalls++;
      const roll = (await tools(
        'roll_dice',
        {
          slot: 0,
          scope: 'oracle',
          reason: 'Is the shelter quiet?',
          declaration: 'Oracle d6',
          groups: [{ label: 'Oracle', count: 1, sides: 6 }],
        },
        'shelter-oracle'
      )) as DiceResult;
      return gmResponse(
        NARRATIVE,
        [{ op: 'state', expected: campaign.state, value: { scene: 'Shelter' } }],
        {
          gmIndexHandoff: [],
          rollInterpretations: [
            { rollId: roll.rollId, explanation: 'The shelter is quiet.', afterParagraph: 1 },
          ],
        }
      );
    },
  };
  return {
    generator,
    stages,
    counts: () => ({ gameplayCalls, rollCalls, editorCalls, updaterCalls }),
  };
}

test(
  'indexed turn commits state, final narration, index and snapshot only after the separate updater',
  { skip: !dbEnabled },
  async () => {
    const isolated = await openIsolatedStore('gm_index_turn_commit');
    try {
      const { store } = isolated;
      const campaign = await indexedCampaign(store);
      const beforeIndex = structuredClone(campaign.gmIndex!.document);
      const olderFact = knowledgeRecord(
        'Shelter commitment',
        'The shelter keeper promised a room.'
      );
      campaign.knowledge = [olderFact];
      await store.transaction(async (client) => store.save(campaign, client));
      const ai = syntheticIndexedGenerator(
        campaign,
        async () => {
          const live = await store.campaign(campaign.id);
          assert.deepEqual(live.state, campaign.state);
          assert.deepEqual(live.gmIndex!.document, beforeIndex);
          const [pending] = await store.recentTurns(campaign.id);
          assert.ok(pending);
          assert.equal(pending.finalization?.stage, 'index_updating');
          assert.equal(pending.editingPending, true);
          const safe = publicTurn(pending);
          assert.equal(safe.narrative, null);
          assert.deepEqual(safe.changes, []);
          assert.equal(safe.rollInterpretations, undefined);
          assert.equal(safe.operationExplanations, undefined);
          const snapshots = await store.pool.query(
            'SELECT turn_id FROM snapshots WHERE turn_id=$1',
            [pending.id]
          );
          assert.equal(snapshots.rowCount, 0);
        },
        false,
        olderFact.id
      );
      const service = new TurnService(store, ai.generator);
      const submitted = await service.submit(campaign.id, {
        revision: campaign.revision,
        requestId: randomUUID(),
        action: 'Return to the shelter.',
      });
      const completed = await terminal(store, campaign.id, submitted.id);
      assert.equal(completed.status, TurnStatus.Completed, completed.error ?? 'Turn failed');
      assert.deepEqual(ai.stages, ['gameplay', 'humanizer', 'updater']);
      assert.equal(completed.narrative, NARRATIVE);
      assert.equal(completed.rolls?.length, 1);
      assert.equal(completed.rollInterpretations?.length, 1);
      const after = await store.campaign(campaign.id);
      assert.deepEqual(after.state, { scene: 'Shelter' });
      assert.equal(after.gmIndex!.document.entries[0]!.text, PRIVATE_NOTE);
      assert.equal(after.gmIndex!.document.lastCheckedTurnId, completed.id);
      assert.equal(after.gmIndex!.document.generationId, beforeIndex.generationId);
      assert.doesNotMatch(JSON.stringify(publicCampaign(after)), /PRIVATE_INDEX_TURN_MARKER/);
      const snapshot = await store.transaction((client) => store.snapshot(completed.id, client));
      assert.deepEqual(snapshot.beforeGmIndexDocument, beforeIndex);
      assert.deepEqual(snapshot.afterGmIndexDocument, after.gmIndex!.document);
      const restored = await service.undo(campaign.id, after.revision);
      assert.deepEqual(restored.state, campaign.state);
      assert.deepEqual(restored.gmIndex!.document, beforeIndex);
      assert.equal(restored.gmIndex!.settings.enabled, true);
      assert.equal((await store.turn(campaign.id, completed.id)).undone, true);
    } finally {
      await isolated.close();
    }
  }
);

test(
  'failed updater withholds outcome and resumes saved final text without gameplay, editing or dice repetition',
  { skip: !dbEnabled },
  async () => {
    const isolated = await openIsolatedStore('gm_index_turn_resume');
    try {
      const { store } = isolated;
      const campaign = await indexedCampaign(store);
      const ai = syntheticIndexedGenerator(campaign, async () => {}, true);
      const service = new TurnService(store, ai.generator);
      const submitted = await service.submit(campaign.id, {
        revision: campaign.revision,
        requestId: randomUUID(),
        action: 'Return to the shelter.',
      });
      const failed = await terminal(store, campaign.id, submitted.id);
      assert.equal(failed.status, TurnStatus.Failed);
      assert.match(failed.error!, /Synthetic updater quota failure/);
      assert.equal(failed.editingPending, true);
      assert.equal(failed.finalization?.stage, 'index_updating');
      assert.equal(failed.editingResume?.available, true);
      const safe = publicTurn(failed);
      assert.equal(safe.narrative, null);
      assert.deepEqual(safe.changes, []);
      assert.equal(safe.rollInterpretations, undefined);
      assert.equal(safe.ruleCitations, undefined);
      assert.equal(safe.operationExplanations, undefined);
      assert.equal(safe.combatEffects, undefined);
      assert.equal(safe.participantReferences, undefined);
      assert.equal(safe.rolls?.length, 1);
      const unchanged = await store.campaign(campaign.id);
      assert.deepEqual(unchanged.state, campaign.state);
      assert.deepEqual(unchanged.gmIndex, campaign.gmIndex);
      const candidate = await store.pool.query(
        'SELECT edited_narrative,gm_index_checkpoint FROM narrative_edit_candidates WHERE turn_id=$1',
        [failed.id]
      );
      assert.equal(candidate.rows[0].edited_narrative, NARRATIVE);
      assert.ok(candidate.rows[0].gm_index_checkpoint);
      const legacy = candidate.rows[0].gm_index_checkpoint;
      const savedPrompt = legacy.prompt;
      delete legacy.deliveredOriginals;
      await store.pool.query(
        'UPDATE narrative_edit_candidates SET gm_index_checkpoint=$2 WHERE turn_id=$1',
        [failed.id, JSON.stringify(legacy)]
      );
      await assert.rejects(
        service.submit(campaign.id, {
          revision: unchanged.revision,
          requestId: randomUUID(),
          action: 'A different action before finishing.',
        })
      );
      await service.resumeEditing(campaign.id, failed.id, {
        revision: unchanged.revision,
        requestId: randomUUID(),
      });
      const completed = await terminal(store, campaign.id, failed.id);
      assert.equal(completed.status, TurnStatus.Completed, completed.error ?? 'Resume failed');
      const resumed = await store.pool.query(
        'SELECT gm_index_checkpoint FROM narrative_edit_candidates WHERE turn_id=$1',
        [failed.id]
      );
      assert.equal(resumed.rows[0].gm_index_checkpoint.prompt, savedPrompt);
      assert.equal(resumed.rows[0].gm_index_checkpoint.deliveredOriginals, undefined);
      assert.deepEqual(ai.counts(), {
        gameplayCalls: 1,
        rollCalls: 1,
        editorCalls: 1,
        updaterCalls: 2,
      });
      assert.equal(completed.narrative, NARRATIVE);
      assert.deepEqual(
        completed.rolls?.map((r) => r.id),
        failed.rolls?.map((r) => r.id)
      );
      assert.deepEqual((await store.campaign(campaign.id)).state, { scene: 'Shelter' });
      assert.equal((await store.campaign(campaign.id)).gmIndex!.document.entries.length, 1);
    } finally {
      await isolated.close();
    }
  }
);
