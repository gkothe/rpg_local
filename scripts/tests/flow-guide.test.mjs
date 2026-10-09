import assert from 'node:assert/strict';
import test from 'node:test';
import { gameplayResponseSchema } from '../../rpg_be_local/src/domain/gameplayResponse.ts';
import { applyResponse, undoSnapshot } from '../../rpg_be_local/src/domain/state.ts';
import { newCampaign } from '../../rpg_be_local/src/domain/campaign.ts';
import { validateRollInterpretations } from '../../rpg_be_local/src/domain/diceResponse.ts';
import {
  player,
  npc,
  proposal,
  ids,
  examplePayload,
  combatIds,
  combatPrepareArgs,
  combatPrepareResult,
  combatRollArgs,
  combatProposal,
  knowledgeRecord,
  knowledgeSearchResult,
  knowledgeGetResult,
  ruleRead,
  ruleContext,
  citation,
} from '../../rpg_fe_local/src/features/flow/examples.ts';
import { createKnowledgeRecall } from '../../rpg_be_local/src/domain/knowledgeRecall.ts';
import {
  historyGetSchema,
  historySearchSchema,
} from '../../rpg_be_local/src/domain/historyRecall.ts';
import { diceInputSchema } from '../../rpg_be_local/src/domain/dice.ts';
import { ruleToolSchemas } from '../../rpg_be_local/src/services/ruleLookup.ts';
import { ruleReadSchema, ruleCitationSchema } from '../../rpg_be_local/src/domain/rules.ts';
import { validateRuleCitations } from '../../rpg_be_local/src/domain/ruleCitationValidation.ts';
import { systemPromptExamples } from '../../rpg_fe_local/src/features/flow/systemPromptExample.ts';
import { combatPrepareSchema } from '../../rpg_be_local/src/domain/combat.ts';
import { buildContext } from '../../rpg_be_local/src/domain/context.ts';
import {
  nodes,
  edges,
  steps,
  tools,
  storageItems,
} from '../../rpg_fe_local/src/features/flow/content.ts';
import { existsSync, readFileSync } from 'node:fs';
import { createCampaignSourceRecall } from '../../rpg_be_local/src/domain/campaignSourceRecall.ts';
import { findRules } from '../../rpg_be_local/src/providers/rulesFind.ts';
import { createNpcRecall } from '../../rpg_be_local/src/domain/npcRecall.ts';
import { journalExample, journalIds } from '../../rpg_fe_local/src/features/flow/examples.ts';
import { applyCorrection, locateQuote } from '../../rpg_be_local/src/domain/journalChanges.ts';
import { correctionGuidance } from '../../rpg_be_local/src/domain/journalCompatibility.ts';
import { listEntries } from '../../rpg_be_local/src/domain/journalProjection.ts';

test('illustrated NPC lookup retrieves an off-prompt saved sheet without private notes', () => {
  const lookup = createNpcRecall(ids.campaign, [{ ...npc, revision: 0 }], []);
  for (const [name, method] of [
    ['campaign_npcs_search', 'search'],
    ['campaign_npcs_get', 'get'],
  ]) {
    const example = tools.find((tool) => tool.id === name);
    assert.ok(example, `Missing ${name} example`);
    assert.deepEqual(lookup[method](example.args), example.result);
    assert.doesNotMatch(JSON.stringify(example.result), /notes/);
  }
});

test('illustrated campaign source navigation matches real search and get payloads', () => {
  const lookup = createCampaignSourceRecall({
    campaignId: ids.campaign,
    sources: [
      {
        id: ids.source,
        version: 1,
        name: 'River town notes',
        purpose: 'reference',
        text: 'The ferryman offers a safe crossing.',
      },
    ],
  });
  const search = tools.find((tool) => tool.id === 'campaign_sources_search');
  const get = tools.find((tool) => tool.id === 'campaign_sources_get');
  assert.deepEqual(lookup.search(search.args), search.result);
  assert.deepEqual(lookup.get(get.args, get.result.receiptId), get.result);
});

test('combined rule lookup example identifies originals already supplied without inventing continuation', async () => {
  const example = tools.find((tool) => tool.id === 'rules_find');
  const output = await findRules(
    async (tool, input) => {
      if (tool === 'rules_search') {
        assert.deepEqual(input, example.args);
        return example.result.search;
      }
      assert.deepEqual(input, { path: example.result.reads[0].path, view: 'text' });
      return example.result.reads[0];
    },
    example.args,
    'illustrated',
    async () => {}
  );
  assert.deepEqual(output, example.result);
});

test('educational proposal applies its expected-value update without exposing notes', () => {
  const campaign = newCampaign({ name: 'Teaching example' });
  campaign.id = ids.campaign;
  campaign.characters = [{ ...player, notes: 'Private diary', revision: 0 }];
  const parsed = gameplayResponseSchema.parse(proposal);
  validateRollInterpretations(parsed, [ids.roll]);
  const evidence = {
    campaignId: ids.campaign,
    turnId: ids.turn,
    rolls: [{ id: ids.roll, campaignId: ids.campaign }],
  };
  const result = applyResponse(campaign, parsed, ids.turn, evidence);
  assert.equal(result.campaign.characters[0].attributes.hp, 9);
  assert.equal(result.campaign.characters[0].notes, 'Private diary');
  assert.equal(campaign.characters[0].attributes.hp, 10);
  result.campaign.state = { location: 'Later manual location' };
  result.campaign.characters[0].notes = 'Later private diary';
  const restored = undoSnapshot(result.campaign, result.snapshot);
  assert.equal(restored.characters[0].attributes.hp, 10);
  assert.equal(restored.characters[0].notes, 'Later private diary');
  assert.deepEqual(restored.state, { location: 'Later manual location' });
  const conflicting = structuredClone(result.campaign);
  conflicting.characters[0].attributes.hp = 8;
  assert.throws(() => undoSnapshot(conflicting, result.snapshot), /manually changed/);
  assert.throws(() => applyResponse(result.campaign, parsed, ids.turn, evidence), /expected prior/);
  assert.throws(
    () => applyResponse(campaign, { ...parsed, operationExplanations: [] }, ids.turn, evidence),
    /explanation/
  );
  assert.throws(() => validateRollInterpretations(parsed, []), /acknowledge exactly/);
  assert.equal(Object.hasOwn(player, 'notes'), false);
});

test('all illustrated payload selections and envelopes match the real context builder', () => {
  for (const pinned of [false, true])
    for (const mentioned of [false, true])
      for (const book of [false, true]) {
        const expected = examplePayload(pinned, mentioned, book);
        const campaign = newCampaign({
          name: 'Teaching example',
          description: 'A river town after the flood.',
          instructions: 'Tell the story in English with a hopeful tone.',
        });
        campaign.characters = [player, npc].map((character) => ({
          ...character,
          notes: 'Secret diary',
          revision: 0,
        }));
        campaign.state = expected.mandatory.state;
        campaign.sources = [
          {
            id: ids.source,
            version: 1,
            status: 'confirmed',
            name: 'River town notes',
            text: 'The ferryman offers a safe crossing.',
          },
        ];
        campaign.pinnedSourceIds = pinned ? [ids.source] : [];
        campaign.memory = { valid: true, text: expected.memory, coveredTurnIds: [] };
        const turns = expected.history.map((h, index) => ({
          id: `99999999-9999-4999-8999-${String(index + 1).padStart(12, '0')}`,
          action: h.player,
          narrative: h.gm,
          status: 'completed',
          undone: false,
        }));
        const manifest = buildContext(campaign, turns, expected.mandatory.action, [], {
          context: expected.mandatory.ruleContext,
          instructions: book
            ? 'Consult the selected book for covered mechanics.'
            : 'Use model knowledge and label provisional adjudications.',
          overview: expected.mandatory.rulesOverview ?? '',
        });
        assert.deepEqual(JSON.parse(manifest.prompt), expected);
        assert.equal(
          manifest.systemPrompt,
          book ? systemPromptExamples.book : systemPromptExamples.default
        );
        assert.equal(manifest.prompt.includes('Secret diary'), false);
      }
});

test('educational graph, document sections and source references remain navigable', () => {
  const nodeIds = new Set(nodes.map((node) => node.id));
  for (const edge of edges) {
    assert.ok(nodeIds.has(edge.from));
    assert.ok(nodeIds.has(edge.to));
  }
  for (const step of steps) assert.ok(nodeIds.has(step.node));
  const document = readFileSync(
    new URL('../../docs/documentation/rpg-backend-architecture.md', import.meta.url),
    'utf8'
  );
  for (const item of [...nodes, ...edges, ...tools, ...storageItems]) {
    assert.ok(
      document.includes(`### ${item.section} `) || document.includes(`## ${item.section}.`),
      item.section
    );
    for (const path of item.sources)
      assert.ok(existsSync(new URL(`../../${path}`, import.meta.url)), path);
  }
});

test('tool arguments, frozen recall results and exact book citation match backend contracts', () => {
  diceInputSchema.parse(tools.find((tool) => tool.id === 'roll_dice').args);
  for (const tool of tools.filter((tool) => tool.bookOnly))
    ruleToolSchemas[tool.id === 'rules_find' ? 'rules_search' : tool.id].parse(tool.args);
  const recall = createKnowledgeRecall({
    campaignId: ids.campaign,
    records: [knowledgeRecord],
    characters: [{ id: player.id, name: player.name }],
    sourceIds: [],
  });
  assert.deepEqual(recall.search({ query: 'watchtower' }), knowledgeSearchResult);
  assert.deepEqual(recall.get({ id: knowledgeRecord.id }), knowledgeGetResult);
  const receipt = ruleReadSchema.parse(ruleRead);
  const parsed = ruleCitationSchema.parse(citation);
  validateRuleCitations(
    { ruleCitations: [parsed] },
    [receipt],
    ids.campaign,
    ids.turn,
    ruleContext
  );
  assert.throws(
    () =>
      validateRuleCitations(
        { ruleCitations: [{ ...parsed, quote: 'Invented ruling' }] },
        [receipt],
        ids.campaign,
        ids.turn,
        ruleContext
      ),
    /Citations must/
  );
});

test('history tool examples match the real history tool schemas', () => {
  historySearchSchema.parse(tools.find((tool) => tool.id === 'campaign_history_search').args);
  historyGetSchema.parse(tools.find((tool) => tool.id === 'campaign_history_get').args);
});

test('combat teaching example matches the real preparation, dice and turn validation', () => {
  combatPrepareSchema.parse(tools.find((tool) => tool.id === 'combat_prepare').args);
  combatPrepareSchema.parse(combatPrepareArgs);
  diceInputSchema.parse(combatRollArgs);
  const campaign = newCampaign({ name: 'Teaching example' });
  campaign.id = ids.campaign;
  campaign.characters = [{ ...player, notes: '', revision: 0 }];
  campaign.state = { location: 'North bridge' };
  const drafts = combatPrepareResult.createOperations.map((op, index) => ({
    characterId: op.characterId,
    receiptId: op.preparationReceiptId,
    localKey: `soldier-${index + 1}`,
    label: `Soldier ${index + 1}`,
    character: op.character,
    introduction: op.introduction,
    trackedFields: combatPrepareArgs.participants[index + 1].trackedFields,
  }));
  const evidence = {
    campaignId: ids.campaign,
    turnId: ids.turn,
    rolls: [{ ...combatRollArgs, id: combatIds.roll, campaignId: ids.campaign }],
    combat: {
      authorization: {
        encounterId: combatIds.encounter,
        drafts,
        participants: combatPrepareResult.participants.map(
          ({ characterId, label, trackedFields }) => ({ characterId, label, trackedFields })
        ),
      },
    },
  };
  const parsed = gameplayResponseSchema.parse(combatProposal);
  const result = applyResponse(campaign, parsed, ids.turn, evidence).campaign;
  const sheet = (id) => result.characters.find((character) => character.id === id);
  assert.equal(sheet(combatIds.soldierA).attributes.hp, 3);
  assert.equal(sheet(combatIds.soldierB).attributes.hp, 6);
  assert.equal(sheet(ids.player).attributes.hp, 10);
  assert.throws(
    () => applyResponse(campaign, { ...parsed, combatEffects: [] }, ids.turn, evidence),
    /combat effect/
  );
});

test('illustrated Journal correction matches real evidence, apply, projection and context rules', () => {
  const now = '2026-01-01T00:00:00.000Z';
  const campaign = newCampaign({ name: 'Journal example' });
  campaign.knowledge = [
    {
      id: journalIds.record,
      kind: 'npc',
      title: journalExample.record.title,
      text: journalExample.record.text,
      certainty: 'established',
      status: 'active',
      characterIds: [],
      characterNames: {},
      origin: 'gm',
      evidence: [],
      createdTurnId: journalIds.olderTurn,
      updatedTurnId: journalIds.olderTurn,
      createdAt: now,
      updatedAt: now,
      revision: 1,
      attributions: [
        { origin: 'gm', evidence: [], turnId: journalIds.olderTurn, at: now, visibility: 'player' },
      ],
      visibility: 'player',
      introductionVisibility: 'player',
    },
  ];
  const turns = new Map(
    journalExample.turns.map((turn) => [turn.id, { ...turn, status: 'completed', undone: false }])
  );
  const evidence = locateQuote(turns.get(journalIds.newerTurn), 'narrative', journalExample.quote);
  assert.ok(evidence, 'the illustrated quote is an exact substring of the illustrated turn');
  const { campaign: corrected } = applyCorrection(
    campaign,
    {
      knowledgeId: journalIds.record,
      changes: { text: journalExample.correctedText },
      reason: journalExample.flagged,
      evidence: [evidence],
    },
    turns,
    journalIds.job
  );
  assert.equal(corrected.knowledge[0].text, journalExample.correctedText);
  assert.equal(corrected.journal.events[0].kind, 'correction');
  assert.equal(correctionGuidance(corrected)[0].correctedFields.text, journalExample.correctedText);
  const listed = listEntries(corrected.knowledge, corrected.characters, {
    query: 'sister',
    includePast: false,
    limit: 20,
  });
  assert.equal(listed.entries[0].overview, journalExample.correctedText);
  const section = journalExample.turns.map((turn) => turn.narrative).join(' ');
  assert.match(section, /sister of the temple/);
});

test('compact NPC creator teaching tool matches backend receipt contracts', async () => {
  const { npcPrepareSchema, npcPreparationPayloadSchema, preparationOperations } =
    await import('../../rpg_be_local/src/domain/npcPreparation.ts');
  const tool = tools.find((t) => t.id === 'npc_prepare');
  npcPrepareSchema.parse(tool.args);
  const { createOperation, profileChange, guidance, ...payload } = tool.result;
  const parsed = npcPreparationPayloadSchema.parse(payload);
  assert.deepEqual(preparationOperations(parsed), tool.result);
  assert.ok(createOperation.npcPreparationReceiptId);
  assert.equal(profileChange.expected, null);
  assert.ok(guidance.includes('private'));
});
