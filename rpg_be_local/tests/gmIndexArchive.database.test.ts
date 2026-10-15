import { GmIndexUpdateMode } from '../src/domain/gmIndexExecution.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Generator } from '../src/providers/service.js';
import {
  CharacterType,
  SourceKind,
  SourcePurpose,
  SourceStatus,
  TurnStatus,
} from '../src/domain/options.js';
import { GmIndexEntryKind, GmIndexEntryStatus } from '../src/domain/gmIndex.js';
import { GmIndexRefKind, validateGmIndexRefs } from '../src/domain/gmIndexRefs.js';
import {
  gmIndexCanonicalIdentity,
  gmIndexSourceCoverage,
  refreshGmIndexDependencies,
} from '../src/domain/gmIndexCompatibility.js';
import { DEFAULT_HISTORY_SETTINGS, turnVersionOf } from '../src/domain/historyRecall.js';
import { LibraryService } from '../src/services/library.js';
import { TurnService } from '../src/services/turns.js';
import {
  dbEnabled,
  openIsolatedStore,
  seedCampaign,
  knowledgeRecord,
  sleep,
} from './journalFixture.js';
import { gmResponse, syntheticGenerate } from './ownedGameplayFixture.js';

async function playedCampaign(store: Awaited<ReturnType<typeof openIsolatedStore>>['store']) {
  const { campaign, turns } = await seedCampaign(store, [
    { action: 'Meet the trader', narrative: 'The trader offers armor.' },
  ]);
  const playerId = randomUUID();
  campaign.characters = [
    {
      id: playerId,
      name: 'Mira',
      type: CharacterType.Player,
      attributes: {},
      inventory: {},
      description: {},
      notes: '',
      revision: 0,
    },
  ];
  const record = knowledgeRecord('Armor offer', 'The trader offers armor.', {
    characterIds: [playerId],
    characterNames: { [playerId]: 'Mira' },
  });
  campaign.knowledge = [record];
  campaign.sources = [
    {
      id: randomUUID(),
      name: 'Harbor source',
      kind: SourceKind.Text,
      purpose: SourcePurpose.Campaign,
      status: SourceStatus.Confirmed,
      version: 1,
      text: 'A merchant faction controls the harbor.',
      pages: [],
      warnings: [],
    },
  ];
  campaign.state = { scene: 'Harbor' };
  campaign.historyRecall = { ...structuredClone(DEFAULT_HISTORY_SETTINGS), enabled: true };
  const first = turnVersionOf(turns[0]!);
  campaign.gmIndex = {
    settings: {
      enabled: true,
      activationHistoryBaseline: { enabled: false, modeDecisionId: randomUUID() },
    },
    document: {
      generationId: randomUUID(),
      contractVersion: 1,
      campaignFoundation: [],
      entries: [
        {
          id: randomUUID(),
          kind: GmIndexEntryKind.Clue,
          status: GmIndexEntryStatus.Active,
          title: 'Armor lead',
          text: 'Private explanation of the armor lead.',
          ownerCharacterId: playerId,
          refs: [
            { kind: GmIndexRefKind.Knowledge, id: record.id },
            { kind: GmIndexRefKind.Character, characterId: playerId },
            {
              kind: GmIndexRefKind.SourceSection,
              sourceId: campaign.sources[0]!.id,
              version: 1,
              sectionIndex: 0,
            },
            { kind: GmIndexRefKind.Turn, turnId: first.turnId, contentHash: first.contentHash },
          ],
          direction: null,
        },
      ],
      lastCheckedTurnId: first.turnId,
      dependencyState: {
        canonicalHash: gmIndexCanonicalIdentity(campaign),
        entries: [],
        foundation: [],
        sourceCoverage: gmIndexSourceCoverage(campaign),
        turnCoverage: [{ turnId: first.turnId, contentHash: first.contentHash }],
      },
    },
  };
  campaign.gmIndex.document = refreshGmIndexDependencies(campaign.gmIndex.document, {
    campaign,
    turns: [first],
  });
  await store.transaction((client) => store.save(campaign, client));
  const generator: Generator = {
    capacity: async () => 16000,
    gameplayCapacity: async () => 16000,
    generate: syntheticGenerate(),
    generateOwnedGameplay: async (_settings, _prompt, schema) => {
      const properties = (schema as { properties: Record<string, unknown> }).properties;
      if ('checked' in properties)
        return {
          checked: { notes: true, foundation: true, direction: true },
          gmIndexChanges: [
            {
              op: 'create',
              entry: {
                kind: 'task',
                status: 'active',
                title: 'Shelter reminder',
                text: 'ARCHIVE_PRIVATE_INDEX_MARKER',
                ownerCharacterId: null,
                refs: [{ kind: 'turn', current: true }],
                direction: null,
              },
            },
          ],
          gmFoundationChanges: [],
        };
      return gmResponse(
        'You reach the shelter.',
        [{ op: 'state', expected: campaign.state, value: { scene: 'Shelter' } }],
        { gmIndexHandoff: [] }
      );
    },
  };
  const service = new TurnService(store, generator);
  const submitted = await service.submit(campaign.id, {
    revision: campaign.revision,
    requestId: randomUUID(),
    action: 'Return to the shelter.',
  });
  for (let i = 0; i < 300; i++) {
    const turn = await store.turn(campaign.id, submitted.id);
    if (![TurnStatus.Pending, TurnStatus.Running].includes(turn.status as TurnStatus)) {
      assert.equal(turn.status, TurnStatus.Completed, turn.error ?? '');
      return { campaign: await store.campaign(campaign.id), completed: turn, generator };
    }
    await sleep(15);
  }
  throw new Error('Archive fixture turn did not finish');
}

test(
  'indexed archive remaps all private references and generation identities and remains undoable',
  { skip: !dbEnabled },
  async () => {
    const isolated = await openIsolatedStore('gm_index_archive');
    try {
      const { store } = isolated;
      const { campaign, completed, generator } = await playedCampaign(store);
      const library = new LibraryService(store);
      campaign.gmIndexUpdateMode = GmIndexUpdateMode.SameConversation;
      await store.transaction(async (client) => store.save(campaign, client));
      const original = await library.export(campaign.id);
      assert.equal(original.historyTurnVersions?.length, 2);
      assert.match(JSON.stringify(original), /ARCHIVE_PRIVATE_INDEX_MARKER/);
      const imported = await library.import(original);
      const archive = await library.export(imported.id);
      assert.equal(archive.campaign.gmIndexUpdateMode, 'same_gm_conversation');
      assert.notEqual(archive.campaign.id, campaign.id);
      const document = archive.campaign.gmIndex!.document;
      assert.notEqual(document.generationId, campaign.gmIndex!.document.generationId);
      const importedTurn = archive.turns.find((turn) => turn.action === completed.action)!;
      assert.notEqual(importedTurn.id, completed.id);
      assert.equal(document.lastCheckedTurnId, importedTurn.id);
      const snapshot = archive.snapshots.find((s) => s.turnId === importedTurn.id)!;
      assert.deepEqual(snapshot.afterGmIndexDocument, document);
      assert.equal(snapshot.beforeGmIndexDocument!.generationId, document.generationId);
      const session = archive.diceSessions.find((s) => s.rootTurnId === importedTurn.id)!;
      assert.equal(session.imported, true);
      assert.equal(session.gmIndexContractVersion, 1);
      assert.equal(session.frozenGmIndex!.document.generationId, document.generationId);
      assert.deepEqual(session.frozenGmIndex!.document, snapshot.beforeGmIndexDocument);
      assert.equal(
        importedTurn.context?.frozenGmIndex?.document.generationId,
        document.generationId
      );
      const originals = archive.historyTurnVersions!.map(({ turnId, contentHash }) => ({
        turnId,
        contentHash,
      }));
      for (const entry of document.entries)
        validateGmIndexRefs(entry.refs, { campaign: archive.campaign, turns: originals });
      for (const locator of document.dependencyState.turnCoverage)
        assert.ok(
          originals.some(
            (v) => v.turnId === locator.turnId && v.contentHash === locator.contentHash
          )
        );
      assert.notEqual(document.entries[0]!.id, campaign.gmIndex!.document.entries[0]!.id);
      assert.equal(document.entries[0]!.ownerCharacterId, archive.campaign.characters[0]!.id);
      const restored = await new TurnService(store, generator).undo(imported.id, imported.revision);
      assert.deepEqual(restored.state, { scene: 'Harbor' });
      assert.deepEqual(restored.gmIndex!.document, snapshot.beforeGmIndexDocument);
      assert.equal(restored.gmIndex!.settings.enabled, true);
    } finally {
      await isolated.close();
    }
  }
);

test(
  'campaign templates omit GM index even when a stored setup injects private timeline data',
  { skip: !dbEnabled },
  async () => {
    const isolated = await openIsolatedStore('gm_index_template');
    try {
      const { store } = isolated;
      const { campaign } = await playedCampaign(store);
      const library = new LibraryService(store);
      const template = await library.template('Harbor setup', campaign.id, campaign.revision);
      assert.doesNotMatch(JSON.stringify(template), /gmIndex|ARCHIVE_PRIVATE_INDEX_MARKER/);
      const injected = { ...template, setup: { ...template.setup, gmIndex: campaign.gmIndex } };
      await store.pool.query('UPDATE templates SET document=$2 WHERE id=$1', [
        template.id,
        JSON.stringify(injected),
      ]);
      const instance = await library.instantiate(template.id);
      assert.equal(instance.gmIndex, undefined);
      assert.deepEqual(instance.knowledge, []);
      assert.doesNotMatch(JSON.stringify(instance), /ARCHIVE_PRIVATE_INDEX_MARKER/);
    } finally {
      await isolated.close();
    }
  }
);
