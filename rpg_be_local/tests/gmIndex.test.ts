import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  applyGmIndexChanges,
  gmIndexDocumentSchema,
  gmIndexEntryValueSchema,
  GmIndexEntryKind,
  GmIndexEntryStatus,
  type GmIndexDocument,
} from '../src/domain/gmIndex.js';
import { GmIndexRefKind } from '../src/domain/gmIndexRefs.js';
import { newCampaign } from '../src/domain/campaign.js';
import { publicCampaign } from '../src/domain/playerProjection.js';
import { diceSessionSchema } from '../src/domain/dice.js';

const entryValue = () => ({
  kind: GmIndexEntryKind.Task,
  status: GmIndexEntryStatus.Active,
  title: 'Armor',
  text: 'Ask an armorer about light armor.',
  ownerCharacterId: null,
  refs: [],
  direction: null,
});
function fixture() {
  const campaign = newCampaign({ name: 'Notes' });
  const currentTurn = { turnId: randomUUID(), contentHash: 'a'.repeat(64) };
  const document: GmIndexDocument = {
    generationId: randomUUID(),
    contractVersion: 1,
    campaignFoundation: [],
    entries: [{ id: randomUUID(), ...entryValue() }],
    lastCheckedTurnId: null,
    dependencyState: {
      canonicalHash: 'b'.repeat(64),
      entries: [],
      foundation: [],
      sourceCoverage: [],
      turnCoverage: [],
    },
  };
  const capture = {
    campaign,
    currentTurn,
    turns: [currentTurn],
    maps: { characters: new Map(), knowledge: new Map(), introductions: new Map() },
  };
  return { document, capture };
}

test('pure index reduction updates exact prior entries and preserves generation identity', () => {
  const { document, capture } = fixture();
  const original = structuredClone(document);
  const next = applyGmIndexChanges(
    document,
    [
      {
        op: 'update',
        id: document.entries[0]!.id,
        expected: document.entries[0]!,
        value: {
          ...entryValue(),
          status: GmIndexEntryStatus.Resolved,
          text: 'Armor obtained.',
          refs: [{ kind: GmIndexRefKind.Turn, current: true }],
        },
      },
    ],
    [],
    capture
  );
  assert.deepEqual(document, original);
  assert.equal(next.generationId, document.generationId);
  assert.equal(next.entries[0]!.status, 'resolved');
  assert.deepEqual(next.entries[0]!.refs, [{ kind: GmIndexRefKind.Turn, ...capture.currentTurn }]);
  assert.equal(next.lastCheckedTurnId, capture.currentTurn.turnId);
});

test('a later invalid delta cannot partially remove live notes', () => {
  const { document, capture } = fixture();
  const original = structuredClone(document);
  assert.throws(
    () =>
      applyGmIndexChanges(
        document,
        [
          { op: 'remove', id: document.entries[0]!.id, expected: document.entries[0]! },
          { op: 'create', entry: { ...entryValue(), ownerCharacterId: randomUUID() } },
        ],
        [],
        capture
      ),
    /owner/
  );
  assert.deepEqual(document, original);
  assert.throws(
    () =>
      applyGmIndexChanges(
        document,
        [
          {
            op: 'update',
            id: document.entries[0]!.id,
            expected: { ...document.entries[0]!, text: 'Changed elsewhere' },
            value: entryValue(),
          },
        ],
        [],
        capture
      ),
    /captured expected/
  );
});

test('empty deltas record an index check without inventing a development', () => {
  const { document, capture } = fixture();
  const next = applyGmIndexChanges(document, [], [], capture);
  assert.deepEqual(next.entries, document.entries);
  assert.deepEqual(next.campaignFoundation, []);
  assert.equal(next.lastCheckedTurnId, capture.currentTurn.turnId);
});

test('direction metadata is required only for pressures and opportunities', () => {
  assert.equal(
    gmIndexEntryValueSchema.safeParse({ ...entryValue(), kind: 'pressure' }).success,
    false
  );
  const direction = {
    basis: 'campaign',
    trigger: null,
    development: 'Inquiry reaches a trader.',
    choices: [],
    rationale: 'Consequence of theft.',
  };
  assert.equal(
    gmIndexEntryValueSchema.safeParse({ ...entryValue(), kind: 'pressure', direction }).success,
    false
  );
  assert.equal(
    gmIndexEntryValueSchema.safeParse({
      ...entryValue(),
      kind: 'opportunity',
      direction: { ...direction, basis: 'creative' },
    }).success,
    true
  );
  const { document } = fixture();
  assert.equal(
    gmIndexDocumentSchema.safeParse({
      ...document,
      entries: [document.entries[0]!, document.entries[0]!],
    }).success,
    false
  );
});

test('private index is excluded from player campaign projection', () => {
  const { document, capture } = fixture();
  document.entries[0]!.text = 'GM_INDEX_SECRET_MARKER';
  capture.campaign.gmIndex = {
    settings: {
      enabled: false,
      activationHistoryBaseline: { enabled: false, modeDecisionId: null },
    },
    document,
  };
  assert.doesNotMatch(
    JSON.stringify(publicCampaign(capture.campaign)),
    /gmIndex|GM_INDEX_SECRET_MARKER/
  );
  assert.match(JSON.stringify(capture.campaign), /GM_INDEX_SECRET_MARKER/);
});

test('frozen index and contract version are paired while legacy sessions remain valid', () => {
  const { document } = fixture();
  const session = {
    id: randomUUID(),
    campaignId: randomUUID(),
    rootTurnId: randomUUID(),
    contextDigest: 'c'.repeat(64),
    frozenPrompt: '{}',
    frozenRevision: 0,
    characterIds: [],
    newFaces: 0,
    createdAt: new Date().toISOString(),
    imported: false,
  };
  const frozenGmIndex = { enabled: true, contractVersion: 1, document };
  assert.equal(diceSessionSchema.safeParse(session).success, true);
  assert.equal(diceSessionSchema.safeParse({ ...session, frozenGmIndex }).success, false);
  assert.equal(
    diceSessionSchema.safeParse({ ...session, gmIndexContractVersion: 1 }).success,
    false
  );
  assert.equal(
    diceSessionSchema.safeParse({ ...session, frozenGmIndex, gmIndexContractVersion: 1 }).success,
    true
  );
});

import { applyResponse, undoSnapshot } from '../src/domain/state.js';
import { refreshGmIndexDependencies } from '../src/domain/gmIndexCompatibility.js';

const noGameplayChanges = {
  narrative: 'A quiet moment.',
  operations: [],
  rollInterpretations: [],
  ruleCitations: [],
  knowledgeChanges: [],
  operationExplanations: [],
  combatEffects: [],
  participantReferences: [],
};
test('same-generation undo restores notes while preserving disabled activation', () => {
  const { document, capture } = fixture();
  const campaign = capture.campaign;
  campaign.gmIndex = {
    settings: {
      enabled: true,
      activationHistoryBaseline: { enabled: false, modeDecisionId: null },
    },
    document,
  };
  const applied = applyResponse(campaign, noGameplayChanges, capture.currentTurn.turnId);
  const after = applyGmIndexChanges(document, [], [], capture);
  applied.snapshot.beforeGmIndexDocument = structuredClone(document);
  applied.snapshot.afterGmIndexDocument = structuredClone(after);
  applied.campaign.gmIndex!.document = after;
  applied.campaign.gmIndex!.settings.enabled = false;
  const undone = undoSnapshot(applied.campaign, applied.snapshot);
  assert.deepEqual(undone.gmIndex!.document, document);
  assert.equal(undone.gmIndex!.settings.enabled, false);
});

test('undo after a fresh generation or legacy activation keeps new notes and invalidates undone pointers', () => {
  for (const indexedSnapshot of [true, false]) {
    const { document, capture } = fixture();
    const campaign = capture.campaign;
    const applied = applyResponse(campaign, noGameplayChanges, capture.currentTurn.turnId);
    if (indexedSnapshot) {
      applied.snapshot.beforeGmIndexDocument = structuredClone(document);
      applied.snapshot.afterGmIndexDocument = structuredClone(document);
    }
    const rebuilt = structuredClone(document);
    rebuilt.generationId = randomUUID();
    rebuilt.lastCheckedTurnId = capture.currentTurn.turnId;
    rebuilt.entries[0]!.refs = [{ kind: GmIndexRefKind.Turn, ...capture.currentTurn }];
    rebuilt.dependencyState.turnCoverage = [capture.currentTurn];
    const fresh = refreshGmIndexDependencies(rebuilt, capture);
    applied.campaign.gmIndex = {
      settings: {
        enabled: true,
        activationHistoryBaseline: { enabled: false, modeDecisionId: null },
      },
      document: fresh,
    };
    const undone = undoSnapshot(applied.campaign, applied.snapshot);
    assert.equal(undone.gmIndex!.document.generationId, rebuilt.generationId);
    assert.equal(undone.gmIndex!.settings.enabled, true);
    assert.equal(undone.gmIndex!.document.dependencyState.entries[0]!.stale, true);
    assert.equal(undone.gmIndex!.document.lastCheckedTurnId, null);
    assert.deepEqual(undone.gmIndex!.document.dependencyState.turnCoverage, []);
  }
});
