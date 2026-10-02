import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContext, compactionBatch, estimateTokens } from '../src/domain/context.js';
import { newCampaign } from '../src/domain/campaign.js';
import type { Turn } from '../src/domain/types.js';
import { TurnStatus } from '../src/domain/options.js';
import { RuleSystemKind } from '../src/domain/rules.js';

test('book context fits ordinary instructions and a character without the old byte cap', () => {
  const c = newCampaign({ name: 'Book context' });
  c.budgets.gameplay = 16000;
  c.characters = [
    {
      id: 'player',
      name: 'Sigurd',
      type: 'player',
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
  const context = buildContext(c, [], 'start', [], 16000, true, rules);
  assert.ok(Buffer.byteLength(context.prompt) > 8000);
  assert.ok(context.estimatedTokens <= 16000);
  assert.equal(JSON.parse(context.prompt).mandatory.systemInstructions, rules.instructions);
  c.state = { oversized: 'x'.repeat(40000) };
  const large = buildContext(c, [], 'start', [], 16000, true, rules);
  assert.equal(JSON.parse(large.prompt).mandatory.state.oversized, c.state.oversized);
  assert.ok(large.estimatedTokens > 16000);
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

test('trusted context includes completed roll evidence but excludes failed and undone dice history', () => {
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
  const context = buildContext(c, [completed, failed, undone], 'Next', [], 16000, true);
  assert.match(context.prompt, /rollInterpretations/);
  assert.match(context.prompt, /faces/);
  assert.doesNotMatch(context.prompt, /FAILED_CANARY|UNDONE_CANARY/);
  assert.deepEqual(context.historyIds, ['completed']);
  assert.ok(context.estimatedTokens <= 16000);
  assert.doesNotMatch(compactionBatch(c, [completed], 16000).prompt, /roll_dice/);
});
test('preserves uncovered turns and pinned facts even above the optional retrieval target', () => {
  const c = newCampaign({ name: 'A' });
  c.pinnedFacts = ['Marta has a silver key'];
  const history = [turn('1', 'Door open')];
  const context = buildContext(c, history, 'walk', [], 16000);
  assert.ok(context.prompt.includes('silver key'));
  assert.deepEqual(context.historyIds, ['1']);
  assert.ok(context.estimatedTokens <= 16000);
  const large = buildContext(c, [turn('2', 'x'.repeat(70000))], 'go', [], 16000);
  assert.deepEqual(large.historyIds, ['2']);
  assert.ok(large.prompt.includes('x'.repeat(70000)));
  assert.ok(large.estimatedTokens > 16000);
});
test('memory coverage and undone events are excluded and compaction stays bounded without partial turns', () => {
  const c = newCampaign({ name: 'A' });
  c.memory = { id: 'm', text: 'Past events', coveredTurnIds: ['1'], valid: true, createdAt: '' };
  const h = [turn('1', 'secret old'), turn('2', 'new')];
  const b = buildContext(c, h, 'go', [], 16000);
  assert.deepEqual(b.historyIds, ['2']);
  assert.ok(!b.prompt.includes('secret old'));
  const batch = compactionBatch(c, h, 8000);
  assert.deepEqual(
    batch.turns.map((x) => x.id),
    ['2']
  );
  assert.ok(estimateTokens(batch.prompt) <= 8000);
  const largeBatch = compactionBatch(c, [turn('3', 'x'.repeat(40000))], 8000);
  assert.deepEqual(
    largeBatch.turns.map((x) => x.id),
    ['3']
  );
  assert.ok(largeBatch.prompt.includes('x'.repeat(40000)));
  c.memory.valid = false;
  assert.deepEqual(buildContext(c, h, 'go', [], 16000).historyIds, ['1', '2']);
});
