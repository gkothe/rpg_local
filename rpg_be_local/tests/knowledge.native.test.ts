import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { newCampaign } from '../src/domain/campaign.js';
import { buildContext } from '../src/domain/context.js';
import { freezeKnowledge } from '../src/domain/knowledgeRecall.js';
import {
  gameplayResponseSchema,
  gameplayResponseJsonSchema,
} from '../src/domain/gameplayResponse.js';
import { applyResponse } from '../src/domain/state.js';
import { diceInputSchema, type DiceResult } from '../src/domain/dice.js';
import { GameplayTools, type BookGameplayAdapter } from '../src/providers/gameplayTools.js';
import { locate } from '../src/providers/discovery.js';
import { generateCodexDice } from '../src/providers/codexDice.js';
import { generateAntigravityDice } from '../src/providers/antigravityDice.js';
import { RuleLookup } from '../src/services/ruleLookup.js';
import {
  emptyRuleColumns,
  RuleReview,
  RuleSystemKind,
  ruleContentHash,
  type RuleRead,
  type RuleSystem,
} from '../src/domain/rules.js';
import { validateRuleCitations } from '../src/domain/ruleResponse.js';
import { KnowledgeOrigin } from '../src/domain/knowledge.js';
import { validateRollInterpretations } from '../src/domain/diceResponse.js';

const enabled = process.env.NODE_ENV === 'test' && process.env.RPG_KNOWLEDGE_NATIVE === '1';
const providers = (process.env.RPG_KNOWLEDGE_NATIVE_PROVIDERS ?? 'codex,agy').split(',');
for (const provider of providers) {
  if (provider !== 'codex' && provider !== 'agy')
    throw Error('Knowledge native probe supports Codex and Antigravity only');
  test(
    `actual Windows ${provider} v4 creation and frozen old-fact search/get/dice`,
    { skip: !enabled },
    async () => {
      assert.equal(process.platform, 'win32');
      const installed = await locate(provider);
      assert.ok(installed, 'Installed CLI required');
      const directory = await mkdtemp(path.join(os.tmpdir(), 'rpg-knowledge-native-'));
      const settings = {
        provider,
        model:
          process.env.RPG_KNOWLEDGE_NATIVE_MODEL ??
          (provider === 'codex' ? 'gpt-5.6-sol' : 'gemini-3.8-flash'),
        effort: process.env.RPG_KNOWLEDGE_NATIVE_EFFORT ?? 'medium',
      };
      const unavailable = async (): Promise<never> => {
        throw Error('Registry bypass');
      };
      const native = async (prompt: string, adapter: BookGameplayAdapter) =>
        gameplayResponseSchema.parse(
          await (provider === 'codex'
            ? generateCodexDice(
                installed,
                settings,
                prompt,
                directory,
                process.env,
                unavailable,
                undefined,
                adapter
              )
            : generateAntigravityDice(
                installed,
                settings,
                prompt,
                directory,
                process.env,
                unavailable,
                undefined,
                adapter
              ))
        );
      try {
        let campaign = newCampaign({ name: 'Disposable native knowledge transport' });
        campaign.instructions =
          'For this synthetic transport test follow the explicit player action workflow exactly. Keep narration concise and use only the supplied owned tools.';
        const secret = `violet-${randomUUID()}`;
        const createContext = buildContext(
          campaign,
          [],
          `Improvise a place named "Old Lantern Inn" whose cellar password is "${secret}". Return no character/state operations or rolls. Save exactly one established active place knowledge record with origin gm, evidence [], characterIds [], and its password in the text.`,
          [],
          16000,
          true,
          undefined,
          4
        );
        const creationTools = new GameplayTools({
          book: false,
          knowledge: freezeKnowledge(campaign),
          assertActive: async () => {},
          roll: unavailable,
        });
        const first = await native(createContext.prompt, {
          dispatch: creationTools.call,
          definitions: creationTools.definitions,
          schema: gameplayResponseJsonSchema,
          systemPrompt: createContext.systemPrompt!,
        });
        assert.equal(first.knowledgeChanges.length, 1);
        campaign = applyResponse(campaign, first, randomUUID()).campaign;
        assert.ok(campaign.knowledge?.some((record) => record.text.includes(secret)));
        const trace: string[] = [];
        const rolls: DiceResult[] = [];
        const recallTools = new GameplayTools({
          book: false,
          knowledge: freezeKnowledge(campaign),
          assertActive: async () => {},
          roll: async (raw) => {
            const input = diceInputSchema.parse(raw);
            assert.equal(input.slot, 0);
            assert.equal(rolls.length, 0);
            const result = {
              rollId: randomUUID(),
              slot: input.slot,
              groups: input.groups.map((group) => ({
                label: group.label,
                sides: group.sides,
                faces: Array.from({ length: group.count }, () => randomInt(1, group.sides + 1)),
              })),
              reused: false,
            };
            rolls.push(result);
            return result;
          },
        });
        // A fresh provider action receives no history, memory, or inline registry.
        // The password can only come from the frozen owned read tools.
        const secondPrompt = JSON.stringify({
          action:
            'Recall the Old Lantern Inn cellar password: call campaign_knowledge_search with query "Old Lantern Inn", then campaign_knowledge_get using the returned record id, then roll_dice exactly once slot 0 one d6, then report the password and genuine returned faces. Return operations [], knowledgeChanges [], ruleCitations [], and exactly one rollInterpretations entry acknowledging the returned rollId.',
          schema: gameplayResponseJsonSchema,
        });
        const second = await native(secondPrompt, {
          definitions: recallTools.definitions,
          schema: gameplayResponseJsonSchema,
          systemPrompt: createContext.systemPrompt!,
          dispatch: async (name, input, id) => {
            trace.push(name);
            return recallTools.call(name, input, id);
          },
        });
        assert.deepEqual(trace, [
          'campaign_knowledge_search',
          'campaign_knowledge_get',
          'roll_dice',
        ]);
        assert.ok(second.narrative.includes(secret));
        assert.equal(second.rollInterpretations.length, 1);
        assert.equal(second.rollInterpretations[0]!.rollId, rolls[0]!.rollId);
        assert.deepEqual(second.knowledgeChanges, []);
        console.log(
          JSON.stringify({
            knowledgeNative: {
              provider,
              version: second.version,
              trace,
              recordCount: campaign.knowledge!.length,
              rollCount: rolls.length,
            },
          })
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  );
  test(
    `actual Windows ${provider} v4 book source provenance and trusted dice`,
    { skip: !enabled || process.env.RPG_KNOWLEDGE_NATIVE_BOOK !== '1' },
    async () => {
      assert.equal(process.platform, 'win32');
      const installed = await locate(provider);
      assert.ok(installed, 'Installed CLI required');
      const directory = await mkdtemp(path.join(os.tmpdir(), 'rpg-knowledge-book-native-'));
      const settings = {
        provider,
        model:
          process.env.RPG_KNOWLEDGE_NATIVE_MODEL ??
          (provider === 'codex' ? 'gpt-5.6-sol' : 'gemini-3.8-flash'),
        effort: process.env.RPG_KNOWLEDGE_NATIVE_EFFORT ?? 'medium',
      };
      const now = new Date().toISOString();
      const system: RuleSystem = {
        ...emptyRuleColumns(),
        instructions:
          'Follow the explicit synthetic player action workflow. Keep narration concise.',
        sources: [
          { slug: 'original', title: 'Original synthetic book', pageCount: 1, pdfHash: null },
        ],
        mapping: {},
        systemId: randomUUID(),
        systemKey: 'native-source',
        systemName: 'Native original source',
        kind: RuleSystemKind.Library,
        revision: 1,
        contentHash: 'a'.repeat(64),
        createdAt: now,
        updatedAt: now,
      };
      const quote = `The Old Lantern Inn was founded by Mira Oak, whose seal is ${randomUUID()}.`;
      system.lore.original = {
        name: 'Original book',
        aliases: [],
        source: 'original',
        text: '',
        structural: true,
        pdfPages: [],
        printedPages: [],
        review: RuleReview.Verified,
        children: {
          location: {
            name: 'Old Lantern Inn',
            aliases: [],
            source: 'original',
            text: quote,
            review: RuleReview.Verified,
            children: {},
            pdfPages: [1],
            printedPages: ['1'],
            pageSpans: [{ start: 0, end: quote.length, pdfPage: 1, printedPage: '1' }],
          },
        },
      };
      system.contentHash = ruleContentHash(system);
      const campaign = newCampaign({ name: 'Disposable native book knowledge' });
      const turnId = randomUUID();
      const { systemId, systemKey, systemName, kind, revision, contentHash } = system;
      const ruleContext = { systemId, systemKey, systemName, kind, revision, contentHash };
      const context = buildContext(
        campaign,
        [],
        'First call rules_get with path lore.original.location and view text. Next roll_dice exactly once slot 0 one d6. Return operations [], exactly one rollInterpretations entry with its genuine rollId, and exactly one ruleCitations entry quoting the entire original text returned by rules_get. Copy receipt identity, source, system identity, hash and exact page provenance; quote start/end are the supplied text window start/end. Save exactly one established active place knowledge record named Old Lantern Inn with the original founded-by fact and seal in its text, origin source, characterIds [], and evidence [{type:"book",citation:<the same complete rule citation>}].',
        [],
        16000,
        true,
        {
          context: ruleContext,
          instructions: system.instructions,
          overview: 'One original book node at lore.original.location.',
        },
        4
      );
      const reads: RuleRead[] = [];
      const faces: DiceResult[] = [];
      const trace: string[] = [];
      const lookup = new RuleLookup();
      const registry = new GameplayTools({
        book: true,
        knowledge: freezeKnowledge(campaign),
        assertActive: async () => {},
        roll: async (raw) => {
          const input = diceInputSchema.parse(raw);
          assert.equal(input.slot, 0);
          assert.equal(faces.length, 0);
          assert.equal(input.groups.length, 1);
          assert.equal(input.groups[0]!.sides, 6);
          assert.equal(input.groups[0]!.count, 1);
          const result = {
            rollId: randomUUID(),
            slot: input.slot,
            groups: input.groups.map((group) => ({
              label: group.label,
              sides: group.sides,
              faces: Array.from({ length: group.count }, () => randomInt(1, group.sides + 1)),
            })),
            reused: false,
          };
          faces.push(result);
          return result;
        },
        read: async (tool, input, requestId) => {
          const id = randomUUID();
          const payload = lookup.execute(system, tool, input, id);
          const digest = (value: unknown) =>
            createHash('sha256').update(JSON.stringify(value)).digest('hex');
          reads.push({
            id,
            campaignId: campaign.id,
            turnId,
            context: ruleContext,
            tool,
            transportRequestId: requestId,
            argumentDigest: digest(input),
            resultHash: digest(payload),
            payload,
            createdAt: new Date().toISOString(),
          });
          return payload;
        },
      });
      const unavailable = async (): Promise<never> => {
        throw Error('Registry bypass');
      };
      const adapter: BookGameplayAdapter = {
        schema: gameplayResponseJsonSchema,
        systemPrompt: context.systemPrompt!,
        definitions: registry.definitions,
        dispatch: async (name, input, id) => {
          trace.push(name);
          return registry.call(name, input, id);
        },
      };
      try {
        const response = gameplayResponseSchema.parse(
          await (provider === 'codex'
            ? generateCodexDice(
                installed,
                settings,
                context.prompt,
                directory,
                process.env,
                unavailable,
                undefined,
                adapter
              )
            : generateAntigravityDice(
                installed,
                settings,
                context.prompt,
                directory,
                process.env,
                unavailable,
                undefined,
                adapter
              ))
        );
        assert.deepEqual(trace, ['rules_get', 'roll_dice']);
        assert.equal(response.ruleCitations.length, 1);
        assert.deepEqual(response.operations, []);
        assert.equal(response.ruleCitations[0]!.quote, quote);
        validateRuleCitations(response, reads, campaign.id, turnId, ruleContext);
        assert.equal(response.rollInterpretations.length, 1);
        assert.equal(response.rollInterpretations[0]!.rollId, faces[0]!.rollId);
        validateRollInterpretations(
          response,
          faces.map((roll) => roll.rollId)
        );
        assert.equal(response.knowledgeChanges.length, 1);
        const saved = applyResponse(campaign, response, turnId, {
          campaignId: campaign.id,
          turnId,
          ruleContext,
          ruleReads: reads,
        }).campaign;
        assert.equal(saved.knowledge![0]!.origin, KnowledgeOrigin.Source);
        assert.deepEqual(saved.knowledge![0]!.evidence, [
          { type: 'book', citation: response.ruleCitations[0] },
        ]);
        assert.ok(saved.knowledge![0]!.text.includes('Mira Oak'));
        console.log(
          JSON.stringify({
            knowledgeBookNative: {
              provider,
              version: response.version,
              trace,
              recordCount: saved.knowledge!.length,
              citationCount: response.ruleCitations.length,
              rollCount: faces.length,
            },
          })
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  );
}
