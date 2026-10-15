import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { newCampaign } from '../src/domain/campaign.js';
import { buildContext } from '../src/domain/context.js';
import { CharacterType, TurnStatus } from '../src/domain/options.js';
import { KnowledgeKind } from '../src/domain/knowledge.js';
import { gmIndexCanonicalIdentity } from '../src/domain/gmIndexCompatibility.js';
import {
  DEFAULT_HISTORY_SETTINGS,
  HistoryFragmentKind,
  HistorySelectionStatus,
  fragmentDigest,
  turnVersionOf,
  type HistoryFragment,
} from '../src/domain/historyRecall.js';
import type { Turn } from '../src/domain/types.js';
import { knowledgeRecord } from './journalFixture.js';

test('indexed context removes archival bulk while keeping five final pairs, action, state and retrieval contracts', async (t) => {
  const c = newCampaign({
    name: 'Large indexed campaign',
    instructions: 'Honor the current action.',
  });
  const playerId = randomUUID();
  c.characters = [
    {
      id: playerId,
      name: 'Mira',
      type: CharacterType.Player,
      attributes: { health: 6 },
      inventory: {},
      description: {},
      notes: '',
      revision: 0,
    },
  ];
  c.state = { scene: 'Harbor', time_of_day: 'Night' };
  const turns: Turn[] = Array.from({ length: 100 }, (_, i) => ({
    id: randomUUID(),
    campaignId: c.id,
    requestId: randomUUID(),
    status: TurnStatus.Completed,
    action: `Action ${i}`,
    narrative: `Final scene ${i}.`,
    changes: [],
    error: null,
    undone: false,
    settings: c.settings,
    context: null,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
    completedAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
  }));
  c.knowledge = Array.from({ length: 95 }, (_, i) =>
    knowledgeRecord(
      `Historical event ${i}`,
      `ARCHIVAL_EVENT_${i} ${'Unrelated orchard harvest. '.repeat(100)}`,
      {
        kind: KnowledgeKind.Event,
        characterIds: [playerId],
        characterNames: { [playerId]: 'Mira' },
      }
    )
  );
  c.memory = {
    id: randomUUID(),
    text: 'ARCHIVAL_MEMORY_MARKER '.repeat(6000),
    coveredTurnIds: turns.map((t) => t.id),
    valid: true,
    createdAt: turns[0]!.createdAt,
  };
  const action = 'Return to the harbor shelter and ask for ideas.';
  const baseline = buildContext(c, turns, action, []);
  const versions = turns.map(({ ...turn }) => {
    const { turnId, contentHash } = turnVersionOf(turn);
    return { turnId, contentHash };
  });
  const overviewPayload = {
    kind: HistoryFragmentKind.Overview,
    title: 'Harbor overview',
    text: 'Mira seeks shelter and has unresolved local leads.',
    sources: versions.slice(0, -5),
    parentIds: [],
    links: [],
    derivationDigest: 'a'.repeat(64),
    correctionDigest: 'b'.repeat(64),
  };
  const overview: HistoryFragment = {
    ...overviewPayload,
    id: randomUUID(),
    campaignId: c.id,
    contentDigest: fragmentDigest(overviewPayload),
    createdAt: turns.at(-1)!.createdAt,
    selection: HistorySelectionStatus.Valid,
  };
  c.historyRecall = {
    ...structuredClone(DEFAULT_HISTORY_SETTINGS),
    enabled: true,
    activeOverviewId: overview.id,
  };
  c.gmIndex = {
    settings: {
      enabled: true,
      activationHistoryBaseline: { enabled: false, modeDecisionId: null },
    },
    document: {
      generationId: randomUUID(),
      contractVersion: 1,
      campaignFoundation: [],
      entries: [],
      lastCheckedTurnId: turns.at(-1)!.id,
      dependencyState: {
        canonicalHash: gmIndexCanonicalIdentity(c),
        entries: [],
        foundation: [],
        sourceCoverage: [],
        turnCoverage: versions,
      },
    },
  };
  const indexed = buildContext(c, turns, action, [], undefined, {
    fragments: [
      {
        ...overview,
        id: randomUUID(),
        kind: HistoryFragmentKind.Section,
        contentDigest: fragmentDigest({ ...overviewPayload, kind: HistoryFragmentKind.Section }),
      },
      overview,
    ],
    turnVersions: versions,
    protectedMemories: [],
  });
  assert.equal(indexed.frozenGmIndex?.updateMode, 'separate_agent');
  c.gmIndexUpdateMode = (
    await import('../src/domain/gmIndexExecution.js')
  ).GmIndexUpdateMode.SameConversation;
  const continued = buildContext(c, turns, action, []);
  assert.equal(continued.frozenGmIndex?.updateMode, 'same_gm_conversation');
  assert.match(continued.systemPrompt!, /same conversation will continue/);
  const full = JSON.parse(baseline.prompt),
    small = JSON.parse(indexed.prompt);
  const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
  t.diagnostic(
    JSON.stringify({
      unit: 'serialized_utf8_bytes',
      total: { baseline: bytes(full), indexed: bytes(small) },
      knowledge: {
        baseline: bytes(full.mandatory.knowledge),
        indexed: bytes(small.mandatory.knowledge),
      },
      memory: { baseline: bytes(full.memory), indexed: bytes(small.memory) },
      history: { baseline: bytes(full.history), indexed: bytes(small.history) },
      schema: { baseline: bytes(full.mandatory.schema), indexed: bytes(small.mandatory.schema) },
    })
  );
  assert.ok(
    bytes(small) < bytes(full) / 2,
    `Expected >=50% total prompt reduction: ${bytes(full)} -> ${bytes(small)}`
  );
  assert.ok(bytes(small.mandatory.knowledge) < bytes(full.mandatory.knowledge) / 2);
  assert.ok(bytes(small.memory) < bytes(full.memory) / 2);
  assert.equal(small.mandatory.action, action);
  assert.deepEqual(small.mandatory.state, c.state);
  assert.deepEqual(
    small.history,
    turns.slice(-5).map((t) => ({ player: t.action, gm: t.narrative }))
  );
  assert.deepEqual(
    indexed.historyIds,
    turns.slice(-5).map((t) => t.id)
  );
  assert.ok(small.mandatory.schema.properties.narrative);
  assert.ok(small.mandatory.schema.properties.gmIndexHandoff);
  assert.match(small.historyRecall.note, /campaign_history_search.*campaign_history_get/);
  assert.match(indexed.systemPrompt!, /source\/history\/knowledge tools/);
  assert.equal(indexed.frozenKnowledge?.records.length, 95);
  assert.equal(indexed.frozenHistory?.turnVersions.length, 100);
  assert.equal(c.knowledge.length, 95);
  assert.ok(c.memory.text.includes('ARCHIVAL_MEMORY_MARKER'));
  assert.equal(turns[0]!.narrative, 'Final scene 0.');
  assert.doesNotMatch(indexed.prompt, /ARCHIVAL_MEMORY_MARKER/);
});
