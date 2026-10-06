import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContext,
  compactionBatch,
  estimateTokens,
  recentGameplayHistory,
  olderHistoryBytes,
} from '../src/domain/context.js';
import { newCampaign } from '../src/domain/campaign.js';
import type { Turn } from '../src/domain/types.js';
import { CharacterType, TurnStatus } from '../src/domain/options.js';
import { RuleSystemKind } from '../src/domain/rules.js';
import { randomUUID } from 'node:crypto';
import { campaignPatchSchema } from '../src/domain/schemas.js';

test('campaign description stays out of gameplay, NPC selection and memory summarization', () => {
  const campaign = newCampaign({
    name: 'Shared background',
    description: 'Marta has a silver key.',
  });
  campaign.characters = [
    {
      id: randomUUID(),
      name: 'Marta',
      type: CharacterType.Npc,
      attributes: {},
      inventory: {},
      description: {},
      notes: '',
      revision: 0,
    },
  ];
  const prompt = JSON.parse(buildContext(campaign, [], 'Wait', []).prompt);
  assert.equal(Object.hasOwn(prompt.mandatory, 'description'), false);
  assert.deepEqual(prompt.mandatory.characters, []);
  assert.doesNotMatch(JSON.stringify(prompt), /silver key/);
  const scene = JSON.parse(buildContext(campaign, [], 'Talk to Marta', []).prompt);
  assert.equal(scene.mandatory.characters[0].name, 'Marta');
  assert.equal(Object.hasOwn(prompt.mandatory, 'pinnedFacts'), false);
  assert.equal(Object.hasOwn(campaign, 'pinnedFacts'), false);
  assert.equal(
    campaignPatchSchema.safeParse({ revision: 0, pinnedFacts: ['Retired'] }).success,
    false
  );
  const history = Array.from({ length: 15 }, (_, i) => turn(String(i), 'Wait'));
  const summary = JSON.parse(compactionBatch(campaign, history).prompt);
  assert.match(summary.instruction, /one item per line starting with "- "/);
  assert.equal(Object.hasOwn(summary, 'description'), false);
  assert.doesNotMatch(JSON.stringify(summary), /silver key/);
  assert.equal(campaign.description, 'Marta has a silver key.');
  assert.equal(Object.hasOwn(summary, 'pinnedFacts'), false);
});

test('context freezes off-prompt NPC sheets without adding them to the prompt', () => {
  const c = newCampaign({ name: 'NPC snapshot' });
  c.characters.push({
    id: randomUUID(),
    name: 'Marcus',
    type: CharacterType.Npc,
    attributes: { strength: 3 },
    inventory: {},
    description: {},
    notes: 'NPC_PRIVATE',
    revision: 2,
  });
  const context = buildContext(c, [], 'Travel', []);
  assert.equal(context.frozenKnowledge!.npcCharacters![0]!.attributes.strength, 3);
  assert.deepEqual(JSON.parse(context.prompt).mandatory.characters, []);
  assert.doesNotMatch(JSON.stringify(context), /NPC_PRIVATE/);
  assert.match(context.systemPrompt!, /campaign_npcs_search/);
  c.characters[0]!.attributes.strength = 9;
  assert.equal(context.frozenKnowledge!.npcCharacters![0]!.attributes.strength, 3);
});

test('evidence spans identify only supplied source text with absolute Unicode offsets', () => {
  const c = newCampaign({ name: 'Evidence spans' });
  const id = randomUUID();
  const text = 'before 🌙 and then repeated and repeated';
  c.sources = [
    {
      id,
      name: 'Original source',
      kind: 'text',
      text,
      status: 'confirmed',
      version: 1,
      pages: [],
      warnings: [],
    },
  ];
  const start = text.lastIndexOf('repeated');
  const rules = [
    {
      id,
      version: 1,
      name: 'Original source',
      text: 'repeated',
      start,
      end: start + 'repeated'.length,
    },
  ];
  // The first action also seeds the source catalog with its bootstrap section.
  const played = [turn('played', 'Earlier')];
  const context = buildContext(c, played, 'look', rules);
  assert.deepEqual(context.sourceSpans, rules);
  assert.deepEqual(JSON.parse(context.prompt).rules, rules);
  assert.equal(
    text.slice(context.sourceSpans![0]!.start, context.sourceSpans![0]!.end),
    'repeated'
  );
  const unknownOffsets = buildContext(c, played, 'look', [{ id, version: 1, text: 'repeated' }]);
  assert.deepEqual(unknownOffsets.sourceSpans, []);
});

test('context separates exact instructions from reference data and supplies the response schema', () => {
  const c = newCampaign({ name: 'Envelope' });
  c.instructions = '  CAMPAIGN_EXACT\n\t';
  const rules = {
    context: {
      systemId: '00000000-0000-4000-8000-000000000005',
      systemKey: 'vampire',
      systemName: 'Vampire',
      kind: RuleSystemKind.ModelKnowledge,
      revision: 2,
      contentHash: 'a'.repeat(64),
    },
    instructions: ' \nSELECTED_EXACT\t ',
    overview: '',
  };
  const context = buildContext(c, [], 'look', [], rules);
  assert.ok(context.systemPrompt?.includes(rules.instructions));
  assert.ok(context.systemPrompt?.includes(c.instructions));
  assert.match(context.systemPrompt!, /Narrative writing guidance:/);
  assert.doesNotMatch(
    context.prompt,
    /SELECTED_EXACT|CAMPAIGN_EXACT|Application integration contract|Narrative writing guidance/
  );
  const data = JSON.parse(context.prompt).mandatory;
  assert.ok(data.schema.properties.combatEffects);
  assert.equal(data.schema.properties.version, undefined);
  assert.equal(data.instructions, undefined);
  assert.equal(data.systemInstructions, undefined);
  assert.equal(data.campaignInstructions, undefined);
  assert.deepEqual(data.knowledge, []);
});

test('book context fits ordinary instructions and a character without the old byte cap', () => {
  const c = newCampaign({ name: 'Book context' });
  c.characters = [
    {
      id: 'player',
      name: 'Sigurd',
      type: CharacterType.Player,
      attributes: { dossier: 'x'.repeat(2800) },
      inventory: {},
      description: {},
      notes: '',
      revision: 1,
    },
  ];
  const rules = {
    context: {
      systemId: '00000000-0000-4000-8000-000000000005',
      systemKey: 'vampire',
      systemName: 'Vampire',
      kind: RuleSystemKind.Library,
      revision: 2,
      contentHash: 'a'.repeat(64),
    },
    instructions: 'x'.repeat(5961),
    overview: 'Available rule categories.',
  };
  const context = buildContext(c, [], 'start', [], rules);
  assert.ok(Buffer.byteLength(context.prompt) > 8000);
  // Book prompts use the UTF-8 bytes / 2 planning heuristic.
  assert.equal(context.estimatedTokens, Math.ceil(Buffer.byteLength(context.prompt) / 2));
  assert.ok(context.systemPrompt!.includes(rules.instructions));
  assert.equal(JSON.parse(context.prompt).mandatory.rulesOverview, rules.overview);
  c.state = { oversized: 'x'.repeat(40000) };
  const large = buildContext(c, [], 'start', [], rules);
  assert.equal(JSON.parse(large.prompt).mandatory.state.oversized, c.state.oversized);
  assert.ok(large.estimatedTokens > context.estimatedTokens + 16000);
});
const turn = (id: string, narrative: string): Turn => ({
  id,
  campaignId: 'c',
  requestId: id,
  status: 'completed',
  action: 'look',
  narrative,
  changes: [],
  error: null,
  undone: false,
  settings: { provider: '', model: '', effort: null },
  context: null,
  createdAt: '',
  completedAt: '',
});

test('gameplay history contains only delivered text and excludes failed and undone turns', () => {
  const c = newCampaign({ name: 'Dice context' });
  const completed = turn('completed', 'Saved outcome');
  completed.rolls = [
    {
      id: 'record',
      reason: 'Check',
      declaration: 'Target 4',
      groups: [{ label: 'Check', sides: 6, faces: [5] }],
    },
  ] as Turn['rolls'];
  const failed = { ...turn('failed', 'FAILED_CANARY'), status: TurnStatus.Failed };
  const undone = { ...turn('undone', 'UNDONE_CANARY'), undone: true };
  const context = buildContext(c, [completed, failed, undone], 'Next', []);
  assert.match(context.prompt, /rollInterpretations/);
  assert.deepEqual(JSON.parse(context.prompt).history, [{ player: 'look', gm: 'Saved outcome' }]);
  assert.doesNotMatch(context.prompt, /FAILED_CANARY|UNDONE_CANARY/);
  assert.deepEqual(context.historyIds, ['completed']);
  assert.doesNotMatch(compactionBatch(c, [completed], 16000).prompt, /roll_dice/);
});
test('preserves uncovered turns and campaign state even above the optional retrieval target', () => {
  const c = newCampaign({ name: 'A' });
  c.state = { establishedFact: 'Marta has a silver key' };
  const history = [turn('1', 'Door open')];
  const context = buildContext(c, history, 'walk', []);
  assert.ok(context.prompt.includes('silver key'));
  assert.deepEqual(context.historyIds, ['1']);
  const large = buildContext(c, [turn('2', 'x'.repeat(70000))], 'go', []);
  assert.deepEqual(large.historyIds, ['2']);
  assert.ok(large.prompt.includes('x'.repeat(70000)));
  assert.ok(large.estimatedTokens > context.estimatedTokens + 60000);
});
test('memory coverage and undone events are excluded and compaction stays bounded without partial turns', () => {
  const c = newCampaign({ name: 'A' });
  c.memory = { id: 'm', text: 'Past events', coveredTurnIds: ['1'], valid: true, createdAt: '' };
  const h = [
    turn('1', 'secret old'),
    turn('2', 'new'),
    turn('4', 'recent'),
    turn('5', 'recent'),
    turn('6', 'recent'),
  ];
  const b = buildContext(c, h, 'go', []);
  assert.deepEqual(b.historyIds, ['2', '4', '5', '6']);
  assert.ok(!b.prompt.includes('secret old'));
  const batch = compactionBatch(c, h, 8000);
  assert.deepEqual(
    batch.turns.map((x) => x.id),
    ['2']
  );
  assert.ok(estimateTokens(batch.prompt) <= 8000);
  const largeBatch = compactionBatch(c, [turn('3', 'x'.repeat(40000)), ...h.slice(-3)], 8000);
  assert.deepEqual(
    largeBatch.turns.map((x) => x.id),
    ['3']
  );
  assert.ok(largeBatch.prompt.includes('x'.repeat(40000)));
  c.memory.valid = false;
  assert.deepEqual(buildContext(c, h, 'go', []).historyIds, ['1', '2', '4', '5', '6']);
});

test('retrieved relevant sections are included even when the old capacity estimate is tiny', () => {
  const campaign = newCampaign({ name: 'No gameplay ceiling' });
  const sections = [
    { id: randomUUID(), version: 1, text: 'Relevant rule. '.repeat(3000) },
    { id: randomUUID(), version: 1, text: 'Other relevant rule. '.repeat(3000) },
  ];
  const prompt = JSON.parse(buildContext(campaign, [], 'act', sections).prompt);
  assert.deepEqual(prompt.rules, sections);
});

test('default compaction packs a 32-KiB consecutive batch without splitting turns', () => {
  const c = newCampaign({ name: '32 KiB compaction' });
  assert.equal(c.budgets.compaction, 32768);
  const history = Array.from({ length: 9 }, (_, i) => turn(String(i), 'x'.repeat(6000)));
  const batch = compactionBatch(c, history);
  assert.equal(batch.turns.length, 5);
  assert.ok(Buffer.byteLength(batch.prompt, 'utf8') <= 32768);
  assert.deepEqual(
    batch.turns.map((t) => t.id),
    ['0', '1', '2', '3', '4']
  );
});

test('three recent pairs survive legacy memory coverage without adding technical audit', () => {
  const c = newCampaign({ name: 'Recent pairs' });
  const history = Array.from({ length: 10 }, (_, i) => ({
    ...turn(String(i), `Delivered ${i}`),
    action: `Player ${i}`,
    rawNarrative: 'RAW_CANARY',
  }));
  c.memory = {
    id: 'memory',
    text: 'Legacy summary',
    coveredTurnIds: history.map((t) => t.id),
    valid: true,
    createdAt: '',
  };
  const manifest = buildContext(c, history, 'Current action', []);
  const payload = JSON.parse(manifest.prompt);
  assert.deepEqual(
    payload.history,
    history.slice(-3).map((t) => ({ player: t.action, gm: t.narrative }))
  );
  assert.deepEqual(manifest.historyIds, ['7', '8', '9']);
  assert.equal(payload.memory, 'Legacy summary');
  assert.equal(payload.mandatory.action, 'Current action');
  assert.doesNotMatch(manifest.prompt, /RAW_CANARY/);
  c.memory.valid = false;
  assert.equal(JSON.parse(buildContext(c, history, 'Now', []).prompt).history.length, 10);
});

test('selection preserves older uncovered backlog and deduplicates completed turn IDs', () => {
  const c = newCampaign({ name: 'Backlog' });
  for (const count of [0, 1, 3, 4, 10]) {
    const h = Array.from({ length: count }, (_, i) => turn(String(i), `Final ${i}`));
    const result = recentGameplayHistory(c, [...h, ...h]);
    assert.deepEqual(
      result.history.map((t) => t.id),
      h.map((t) => t.id)
    );
    assert.deepEqual(
      result.recent.map((t) => t.id),
      h.slice(-3).map((t) => t.id)
    );
    assert.deepEqual(
      result.older.map((t) => t.id),
      h.slice(0, Math.max(0, h.length - 3)).map((t) => t.id)
    );
  }
});

test('compaction excludes protected pairs even when they are huge; one older turn is eligible', () => {
  const c = newCampaign({ name: 'Protected' });
  const recent = [turn('r1', 'x'.repeat(70000)), turn('r2', 'recent'), turn('r3', 'recent')];
  assert.equal(olderHistoryBytes(c, recent), 0);
  assert.deepEqual(compactionBatch(c, recent).turns, []);
  const old = turn('old', 'Before the recent window');
  old.rolls = [
    {
      id: 'roll',
      reason: 'Check',
      declaration: 'Target 4',
      groups: [{ label: 'Check', sides: 6, faces: [5] }],
    },
  ] as Turn['rolls'];
  const batch = compactionBatch(c, [old, ...recent]);
  assert.deepEqual(
    batch.turns.map((t) => t.id),
    ['old']
  );
  const input = JSON.parse(batch.prompt);
  assert.equal(input.turns[0].dice[0].id, 'roll');
  assert.doesNotMatch(batch.prompt, /r1|r2|r3/);
  c.memory = { id: 'm', text: 'Prior memory', coveredTurnIds: ['old'], valid: true, createdAt: '' };
  assert.equal(olderHistoryBytes(c, [old, ...recent]), 0);
  assert.equal(JSON.parse(compactionBatch(c, [old, ...recent]).prompt).priorMemory, 'Prior memory');
});

test('context includes every active encounter participant by ID without a lexical mention', () => {
  const c = newCampaign({ name: 'Ambush' });
  const guard = (name: string) => ({
    id: randomUUID(),
    name,
    type: 'npc' as const,
    attributes: { health: { damage: 0 } },
    inventory: {},
    description: {},
    notes: 'PRIVATE',
    revision: 1,
  });
  const a = guard('Soldier');
  const b = guard('Soldier');
  const absent = guard('Merchant');
  c.characters.push(a, b, absent);
  const fields = [{ path: ['health', 'damage'], kind: 'damage', label: 'Damage' }];
  c.state = {
    combat: {
      id: randomUUID(),
      active: true,
      round: 2,
      participants: [a, b].map((x) => ({
        characterId: x.id,
        label: x.name,
        trackedFields: fields,
      })),
    },
  };
  const ids = () =>
    (
      JSON.parse(buildContext(c, [], 'I dodge', []).prompt).mandatory.characters as { id: string }[]
    ).map((x) => x.id);
  assert.deepEqual(ids(), [a.id, b.id]);
  const context = buildContext(c, [], 'I dodge', []);
  assert.doesNotMatch(context.prompt, /PRIVATE/);
  assert.match(context.systemPrompt!, /combat_prepare/);
  // Free-form combat notes are never interpreted as identities; an ID mention still selects.
  c.state = { combatNotes: { enemies: [a.id] } };
  assert.deepEqual(ids(), [a.id]);
  c.state = { combatNotes: { enemies: ['two raiders'] } };
  assert.deepEqual(ids(), []);
  c.state = { combat: { enemies: ['two raiders'] } };
  assert.throws(ids, /combatNotes/);
});
