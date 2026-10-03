import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Store } from '../src/store.js';
import { appRoot, databaseUrl } from '../src/config.js';
import { newCampaign } from '../src/domain/campaign.js';
import { TurnStatus } from '../src/domain/options.js';
import type { ProviderSettings, Turn } from '../src/domain/types.js';
import type { DiceResult } from '../src/domain/dice.js';
import { TurnService } from '../src/services/turns.js';
import { RuleStore } from '../src/services/ruleStore.js';
import { DEFAULT_RULE_SYSTEM_ID } from '../src/domain/rules.js';
import { ProviderService } from '../src/providers/service.js';
import type { GameplayToolDispatch } from '../src/providers/gameplayTools.js';

const enabled =
  process.env.NODE_ENV === 'test' &&
  !!process.env.RPG_TEST_DATABASE_URL &&
  process.env.RPG_KNOWLEDGE_NATIVE_RECOVERY === '1';
test(
  'actual Windows v4 Codex persisted-roll cancellation, Antigravity same-root recovery and complete undo',
  { skip: !enabled },
  async () => {
    assert.equal(process.platform, 'win32');
    const schema = `knowledge_native_recovery_${randomUUID().replaceAll('-', '')}`;
    const bootstrap = new Store();
    await bootstrap.pool.query(`CREATE SCHEMA ${schema}`);
    await bootstrap.close();
    const url = new URL(databaseUrl());
    url.searchParams.set('options', `-c search_path=${schema}`);
    const store = new Store(url.toString());
    let service: TurnService;
    let rootId = '';
    let campaignId = '';
    let latestId = '';
    const nativeCalls: { provider: string; prompt: string; systemPrompt: string }[] = [];
    const revealed: { provider: string; result: DiceResult }[] = [];
    const finished: Promise<void>[] = [];
    class ObservedProviders extends ProviderService {
      cancelAfterFirstRoll = true;
      override async generateOwnedGameplay(
        settings: ProviderSettings,
        prompt: string,
        responseSchema: unknown,
        systemPrompt: string,
        tools: GameplayToolDispatch,
        signal?: AbortSignal
      ): Promise<unknown> {
        nativeCalls.push({ provider: settings.provider, prompt, systemPrompt });
        let close!: () => void;
        finished.push(
          new Promise<void>((resolve) => {
            close = resolve;
          })
        );
        const observed: GameplayToolDispatch = async (name, input, id) => {
          // This awaits the real application's committed DiceService transaction.
          const result = await tools(name, input, id);
          if (name === 'roll_dice') {
            assert.ok(
              'rollId' in result && 'groups' in result,
              'Actual persisted dice receipt required'
            );
            revealed.push({
              provider: settings.provider,
              result: structuredClone(result as DiceResult),
            });
            if (this.cancelAfterFirstRoll) {
              this.cancelAfterFirstRoll = false;
              assert.equal(settings.provider, 'codex');
              await new Promise<void>((resolve, reject) => {
                queueMicrotask(() => {
                  void service.cancel(campaignId, rootId).then(() => resolve(), reject);
                });
              });
            }
          }
          return result;
        };
        observed.definitions = tools.definitions;
        try {
          return await super.generateOwnedGameplay(
            settings,
            prompt,
            responseSchema,
            systemPrompt,
            observed,
            signal
          );
        } finally {
          close();
        }
      }
    }
    const providers = new ObservedProviders();
    const finish = async (id: string): Promise<Turn> => {
      for (;;) {
        const turn = await store.turn(campaignId, id);
        if (![TurnStatus.Pending, TurnStatus.Running].includes(turn.status as TurnStatus))
          return turn;
        await delay(100);
      }
    };
    try {
      for (const file of (await readdir(path.join(appRoot, 'migrationssql')))
        .filter((file) => file.endsWith('.sql'))
        .sort())
        await store.pool.query(await readFile(path.join(appRoot, 'migrationssql', file), 'utf8'));
      const catalog = await providers.list();
      const settingsFor = (provider: string, defaultModel: string): ProviderSettings => {
        const configured =
          process.env[`RPG_KNOWLEDGE_NATIVE_RECOVERY_${provider.toUpperCase()}_MODEL`] ??
          defaultModel;
        const model = catalog
          .find((entry) => entry.id === provider)
          ?.models.find((entry) => entry.id === configured);
        assert.ok(
          model?.dice?.supported,
          `Real installed ${provider}/${configured} must advertise trusted dice support`
        );
        const effort =
          process.env.RPG_KNOWLEDGE_NATIVE_RECOVERY_EFFORT ??
          (model.efforts.includes('medium') ? 'medium' : (model.efforts[0] ?? null));
        return { provider, model: model.id, effort };
      };
      const codex = settingsFor('codex', 'gpt-5.6-sol');
      const antigravity = settingsFor('agy', 'gemini-3.8-flash');
      const rules = new RuleStore(store);
      const current = await rules.get(DEFAULT_RULE_SYSTEM_ID);
      await rules.publish(current.systemId, current.revision, (system) => ({
        ...system,
        instructions:
          'For this disposable native acceptance follow the player action workflow exactly. Use only owned tools and return the supplied final schema. Save only the requested important continuity record with GM origin and no source claim.',
      }));
      const campaign = newCampaign({
        name: 'Disposable actual cancellation and provider recovery',
        settings: codex,
      });
      campaignId = campaign.id;
      await store.insert(campaign);
      service = new TurnService(store, providers, 4);
      const input = {
        revision: 0,
        requestId: randomUUID(),
        action:
          'Call roll_dice exactly once with slot 0, groups [{"label":"inn-check","sides":6,"count":1}], reason "Inn discovery", declaration "One d6, no modifier or target". If original roll specifications are supplied, replay them exactly. Then improvise the place Recovery Lantern Inn. Return operations [], ruleCitations [], exactly one rollInterpretations entry for the genuine rollId, and exactly one knowledgeChanges create: kind place, title Recovery Lantern Inn, text "The inn keeper hides a silver key.", origin gm, certainty established, status active, characterIds [], evidence []. No other records or source claims.',
      };
      const submitted = await service.submit(campaign.id, input);
      rootId = submitted.id;
      latestId = rootId;
      const cancelled = await finish(rootId);
      assert.equal(cancelled.status, TurnStatus.Cancelled, cancelled.error ?? '');
      assert.ok(finished[0]);
      await finished[0];
      assert.equal(revealed.length, 1);
      const firstReceipt = revealed[0]!.result;
      const cancelledSaved = await store.turn(campaign.id, rootId);
      assert.equal(cancelledSaved.rolls?.length, 1);
      assert.equal(cancelledSaved.rolls![0]!.id, firstReceipt.rollId);
      assert.deepEqual(cancelledSaved.rolls![0]!.groups, firstReceipt.groups);
      assert.deepEqual((await store.campaign(campaign.id)).knowledge, []);
      assert.equal((await store.campaign(campaign.id)).revision, 0);
      const retryInput = { revision: 0, requestId: randomUUID(), settings: antigravity };
      const retried = await service.retry(campaign.id, rootId, retryInput);
      latestId = retried.id;
      const completed = await finish(retried.id);
      assert.equal(completed.status, TurnStatus.Completed, completed.error ?? '');
      assert.equal(completed.diceSessionId, cancelledSaved.diceSessionId);
      assert.equal(completed.retryOfTurnId, rootId);
      assert.equal(completed.rolls?.length, 1);
      assert.equal(completed.rolls![0]!.id, firstReceipt.rollId);
      assert.deepEqual(completed.rolls![0]!.groups, firstReceipt.groups);
      assert.equal(revealed.length, 2);
      assert.equal(revealed[1]!.provider, 'agy');
      assert.equal(revealed[1]!.result.reused, true);
      assert.deepEqual(revealed[1]!.result.groups, firstReceipt.groups);
      assert.equal(revealed[1]!.result.rollId, firstReceipt.rollId);
      assert.equal(nativeCalls[0]!.systemPrompt, nativeCalls[1]!.systemPrompt);
      const saved = await store.campaign(campaign.id);
      assert.equal(saved.knowledge!.length, 1);
      assert.equal(saved.knowledge![0]!.createdTurnId, completed.id);
      assert.equal(saved.knowledge![0]!.origin, 'gm');
      const replay = await service.retry(campaign.id, rootId, retryInput);
      assert.equal(replay.id, completed.id);
      assert.equal((await store.campaign(campaign.id)).knowledge!.length, 1);
      const restored = await service.undo(campaign.id, saved.revision);
      assert.deepEqual(restored.knowledge, []);
      assert.deepEqual(restored.characters, []);
      assert.deepEqual(restored.state, {});
      assert.equal((await store.turn(campaign.id, completed.id)).undone, true);
      console.log(
        JSON.stringify({
          knowledgeNativeRecovery: {
            cancelledProvider: 'codex',
            recoveredProvider: 'agy',
            cancelledStatus: cancelled.status,
            recoveredStatus: completed.status,
            rollCount: completed.rolls!.length,
            sameRoot: completed.diceSessionId === cancelledSaved.diceSessionId,
            reusedFaces: revealed[1]!.result.reused,
            knowledgeCount: saved.knowledge!.length,
            undoKnowledgeCount: restored.knowledge!.length,
          },
        })
      );
    } finally {
      if (latestId && campaignId) {
        const turn = await store.turn(campaignId, latestId);
        if ([TurnStatus.Pending, TurnStatus.Running].includes(turn.status as TurnStatus))
          await service!.cancel(campaignId, latestId);
      }
      for (const closed of finished) await closed;
      await store.pool.query(`DROP SCHEMA ${schema} CASCADE`);
      await store.close();
    }
  }
);
