import { gameplayResponseV5Schema } from '../../rpg_be_local/src/domain/gameplayResponse.ts';
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
  examplePayloadV5,
  proposalV5,
  knowledgeRecord,
  knowledgeSearchResult,
  knowledgeGetResult,
  ruleRead,
  ruleContext,
  citation,
} from '../../rpg_fe_local/src/features/flow/examples.ts';
import { createKnowledgeRecall } from '../../rpg_be_local/src/domain/knowledgeRecall.ts';
import { diceInputSchema } from '../../rpg_be_local/src/domain/dice.ts';
import { ruleToolSchemas } from '../../rpg_be_local/src/services/ruleLookup.ts';
import { ruleReadSchema, ruleCitationSchema } from '../../rpg_be_local/src/domain/rules.ts';
import { validateRuleCitations } from '../../rpg_be_local/src/domain/ruleCitationValidation.ts';
import {
  systemPromptExamples,
  systemPromptV5Examples,
} from '../../rpg_fe_local/src/features/flow/systemPromptExample.ts';
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

test('educational v4 proposal applies its expected-value update without exposing notes', () => {
  const campaign = newCampaign({ name: 'Teaching example' });
  campaign.characters = [{ ...player, notes: 'Private diary', revision: 0 }];
  const parsed = gameplayResponseSchema.parse(proposal);
  validateRollInterpretations(parsed, [ids.roll]);
  const result = applyResponse(campaign, parsed, ids.turn);
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
  assert.throws(() => applyResponse(result.campaign, parsed, ids.turn), /expected prior/);
  assert.throws(() => validateRollInterpretations(parsed, []), /acknowledge exactly/);
  assert.equal(Object.hasOwn(player, 'notes'), false);
});

test('all illustrated payload selections and envelopes match the real context builder', () => {
  for (const version of [4, 5])
    for (const pinned of [false, true])
      for (const mentioned of [false, true])
        for (const book of [false, true]) {
          const expected =
            version === 5
              ? examplePayloadV5(pinned, mentioned, book)
              : examplePayload(pinned, mentioned, book);
          const campaign = newCampaign({
            name: 'Teaching example',
            description: expected.mandatory.description,
            instructions: 'Tell the story in English with a hopeful tone.',
          });
          campaign.characters = [player, npc].map((character) => ({
            ...character,
            notes: 'Secret diary',
            revision: 0,
          }));
          campaign.state = expected.mandatory.state;
          campaign.pinnedFacts = expected.mandatory.pinnedFacts;
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
          const turns = expected.history.map((h) => ({
            id: h.id,
            action: h.player,
            narrative: h.gm,
            status: 'completed',
            undone: false,
          }));
          const manifest = buildContext(
            campaign,
            turns,
            expected.mandatory.action,
            [],
            100000,
            true,
            {
              context: expected.mandatory.ruleContext,
              instructions: book
                ? 'Consult the selected book for covered mechanics.'
                : 'Use model knowledge and label provisional adjudications.',
              overview: expected.mandatory.rulesOverview ?? '',
            },
            version
          );
          assert.deepEqual(JSON.parse(manifest.prompt), expected);
          assert.equal(
            manifest.systemPrompt,
            book
              ? version === 5
                ? systemPromptV5Examples.book
                : systemPromptExamples.book
              : version === 5
                ? systemPromptV5Examples.default
                : systemPromptExamples.default
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
    ruleToolSchemas[tool.id].parse(tool.args);
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

test('v5 educational proposal validates indexed mechanical explanations', () => {
  const campaign = newCampaign({ name: 'Teaching example' });
  campaign.id = ids.campaign;
  campaign.characters = [{ ...player, notes: '', revision: 0 }];
  const parsed = gameplayResponseV5Schema.parse(proposalV5);
  const evidence = {
    campaignId: ids.campaign,
    turnId: ids.turn,
    rolls: [{ id: ids.roll, campaignId: ids.campaign }],
  };
  assert.equal(
    applyResponse(campaign, parsed, ids.turn, evidence).campaign.characters[0].attributes.hp,
    9
  );
  assert.throws(
    () => applyResponse(campaign, { ...parsed, operationExplanations: [] }, ids.turn, evidence),
    /explanation/
  );
});
