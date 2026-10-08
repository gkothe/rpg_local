import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Store } from '../src/store.js';
import { appRoot, databaseUrl } from '../src/config.js';
import { newCampaign } from '../src/domain/campaign.js';
import { TurnService } from '../src/services/turns.js';
import { DiceService } from '../src/services/dice.js';
import { textSource } from '../src/services/sources.js';
import { SourcePurpose, TurnStatus } from '../src/domain/options.js';
import { ProviderService, type Provider } from '../src/providers/service.js';
import type { Turn } from '../src/domain/types.js';

/** Wire payloads are inspected structurally; JSON.parse already yields an untyped value. */
type WireJson = ReturnType<typeof JSON.parse>;
const enabled = process.env.NODE_ENV === 'test' && !!process.env.RPG_TEST_DATABASE_URL;
const schema = `api_turns_${randomUUID().replaceAll('-', '')}`;
const SETTINGS = { provider: 'gemini-api', model: 'gemini-test', effort: null };
const NARRATIVE = 'You stand beside the old gate.';
let store: Store;
before(async () => {
  if (!enabled) return;
  const bootstrap = new Store();
  await bootstrap.pool.query(`CREATE SCHEMA ${schema}`);
  await bootstrap.close();
  const url = new URL(databaseUrl());
  url.searchParams.set('options', `-c search_path=${schema}`);
  store = new Store(url.toString());
  for (const file of (await readdir(path.join(appRoot, 'migrationssql')))
    .filter((name) => name.endsWith('.sql'))
    .sort())
    await store.pool.query(await readFile(path.join(appRoot, 'migrationssql', file), 'utf8'));
});
after(async () => {
  if (!enabled) return;
  await store.pool.query(`DROP SCHEMA ${schema} CASCADE`);
  await store.close();
});
async function terminal(campaignId: string, turnId: string): Promise<Turn> {
  for (let attempt = 0; attempt < 250; attempt++) {
    const turn = await store.turn(campaignId, turnId);
    if (![TurnStatus.Pending, TurnStatus.Running].includes(turn.status as TurnStatus)) return turn;
    await delay(20);
  }
  throw new Error('Synthetic turn did not reach a terminal status');
}
class ApiOnlyProviders extends ProviderService {
  protected override async discoverCli(): Promise<Provider[]> {
    return [];
  }
}
/** Mock Gemini HTTP: tool-bearing requests play the GM, no-tools requests play the editor. */
function geminiBoundary(initiallyAvailable: boolean) {
  const counts = { gm: 0, editor: 0 };
  let editorAvailable = initiallyAvailable;
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const fetchImpl: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init!.body));
    if (!body.tools) {
      counts.editor++;
      if (!editorAvailable) return reply({}, 429);
      return reply({
        candidates: [
          {
            content: { role: 'model', parts: [{ text: JSON.stringify({ narrative: NARRATIVE }) }] },
            finishReason: 'STOP',
          },
        ],
      });
    }
    const contents = body.contents as { role: string; parts: WireJson[] }[];
    if (contents.length === 1) {
      counts.gm++;
      const source = JSON.parse(contents[0]!.parts[0].text).mandatory.campaignSources[0];
      return reply({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                {
                  functionCall: {
                    id: 'src',
                    name: 'campaign_sources_get',
                    args: { sourceId: source.id, version: source.version, sectionIndex: 0 },
                  },
                },
                {
                  functionCall: {
                    id: 'roll',
                    name: 'roll_dice',
                    args: {
                      slot: 0,
                      groups: [{ label: 'gate', count: 1, sides: 6 }],
                      reason: 'Check the gate',
                      declaration: 'A single die records the attempt',
                      scope: 'oracle',
                    },
                  },
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      });
    }
    const results = contents.at(-1)!.parts.map((part) => part.functionResponse);
    assert.deepEqual(
      results.map((entry) => entry.id),
      ['src', 'roll']
    );
    const rollId = results[1].response.output.rollId as string;
    return reply({
      candidates: [
        {
          content: {
            role: 'model',
            parts: [
              {
                text: JSON.stringify({
                  combatEffects: [],
                  participantReferences: [],
                  narrative: NARRATIVE,
                  operations: [],
                  rollInterpretations: [{ rollId, explanation: 'The gate remains closed.' }],
                  ruleCitations: [],
                  knowledgeChanges: [],
                  operationExplanations: [],
                }),
              },
            ],
          },
          finishReason: 'STOP',
        },
      ],
    });
  };
  return {
    counts,
    fetchImpl,
    allowEditor: () => {
      editorAvailable = true;
    },
  };
}
async function begin(editorAvailable = false) {
  const campaign = newCampaign({ name: 'API provider fixture' });
  campaign.sources = [
    { ...textSource('Preparation', 'The old gate is locked.'), purpose: SourcePurpose.Campaign },
  ];
  await store.insert(campaign);
  await store.transaction(async (client) => {
    await store.reindex(campaign, client);
  });
  const boundary = geminiBoundary(editorAvailable);
  const providers = new ApiOnlyProviders({
    fetch: boundary.fetchImpl,
    env: { GEMINI_API_KEY: 'test-key', GEMINI_MODELS: 'gemini-test' },
  });
  const service = new TurnService(store, providers);
  const turn = await service.submit(campaign.id, {
    revision: 0,
    requestId: randomUUID(),
    action: 'start',
    settings: SETTINGS,
  });
  return { campaign, service, turn, ...boundary };
}

test(
  'an API-played turn rolls trusted dice, stages a proposal and commits after the API editor',
  { skip: !enabled },
  async () => {
    const f = await begin(true);
    const done = await terminal(f.campaign.id, f.turn.id);
    assert.equal(done.status, TurnStatus.Completed);
    assert.equal(done.narrative, NARRATIVE);
    assert.equal(f.counts.gm, 1);
    assert.equal((await new DiceService(store).records(done.diceSessionId!)).length, 1);
    assert.equal((await store.campaign(f.campaign.id)).revision, 1);
  }
);

test(
  'a failed API editor keeps the saved dice and GM proposal; resuming edits without a second GM call',
  { skip: !enabled },
  async () => {
    const f = await begin();
    const failed = await terminal(f.campaign.id, f.turn.id);
    assert.notEqual(failed.status, TurnStatus.Completed);
    assert.equal((await store.campaign(f.campaign.id)).revision, 0);
    assert.equal((await new DiceService(store).records(failed.diceSessionId!)).length, 1);
    f.allowEditor();
    await f.service.resumeEditing(f.campaign.id, f.turn.id, {
      revision: 0,
      requestId: randomUUID(),
    });
    const done = await terminal(f.campaign.id, f.turn.id);
    assert.equal(done.status, TurnStatus.Completed);
    assert.equal(f.counts.gm, 1);
    assert.equal(f.counts.editor, 2);
    assert.equal((await store.campaign(f.campaign.id)).revision, 1);
  }
);
