import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Problem } from '../src/errors.js';
import { ProviderService, type Provider, type Generator } from '../src/providers/service.js';
import type { ApiFetch } from '../src/providers/apiHttp.js';
import { GmIndexUpdateMode, FinalizationResumeIntent } from '../src/domain/gmIndexExecution.js';
import { TurnStatus } from '../src/domain/options.js';
import { DEFAULT_HISTORY_SETTINGS } from '../src/domain/historyRecall.js';
import { gmIndexCanonicalIdentity } from '../src/domain/gmIndexCompatibility.js';
import { TurnService } from '../src/services/turns.js';
import { dbEnabled, openIsolatedStore, seedCampaign, sleep } from './journalFixture.js';
import { gmResponse } from './ownedGameplayFixture.js';
import type { Store } from '../src/store.js';
import type { Turn } from '../src/domain/types.js';

const NARRATIVE = 'You return to the harbor shelter.';

async function indexedCampaign(
  store: Store,
  provider = 'gemini-api',
  model = 'gemini-2.5-flash',
  updateMode = GmIndexUpdateMode.SameConversation
) {
  const { campaign } = await seedCampaign(store, []);
  campaign.settings = { provider, model, effort: null };
  campaign.state = { scene: 'Harbor' };
  campaign.historyRecall = { ...structuredClone(DEFAULT_HISTORY_SETTINGS), enabled: true };
  campaign.gmIndexUpdateMode = updateMode;
  campaign.gmIndex = {
    settings: {
      enabled: true,
      activationHistoryBaseline: { enabled: false, modeDecisionId: null },
    },
    document: {
      generationId: randomUUID(),
      contractVersion: 1,
      campaignFoundation: [],
      entries: [],
      lastCheckedTurnId: null,
      dependencyState: {
        canonicalHash: gmIndexCanonicalIdentity(campaign),
        entries: [],
        foundation: [],
        sourceCoverage: [],
        turnCoverage: [],
      },
    },
  };
  await store.transaction(async (client) => store.save(campaign, client));
  return campaign;
}

async function terminal(store: Store, campaignId: string, turnId: string): Promise<Turn> {
  for (let i = 0; i < 300; i++) {
    const turn = await store.turn(campaignId, turnId);
    if (![TurnStatus.Pending, TurnStatus.Running].includes(turn.status as TurnStatus)) return turn;
    await sleep(25);
  }
  throw new Error('Synthetic indexed turn did not finish');
}

const gameplayPayload = gmResponse(
  NARRATIVE,
  [{ op: 'state', expected: { scene: 'Harbor' }, value: { scene: 'Shelter' } }],
  { gmIndexHandoff: [] }
);

const indexUpdatePayload = {
  checked: { notes: true, foundation: true, direction: true },
  gmIndexChanges: [
    {
      op: 'create',
      entry: {
        kind: 'task',
        status: 'active',
        title: 'Shelter arrival',
        text: 'Arrived safely at the shelter.',
        ownerCharacterId: null,
        refs: [{ kind: 'turn', current: true }],
        direction: null,
      },
    },
  ],
  gmFoundationChanges: [],
};

// 1. Gemini API same-conversation indexed turn
test(
  'gemini-api same-conversation indexed turn: gameplay -> editor -> same GM index -> commit and undo',
  { skip: !dbEnabled },
  async () => {
    const isolated = await openIsolatedStore('gm_gemini_session');
    try {
      const { store } = isolated;
      const campaign = await indexedCampaign(store, 'gemini-api', 'gemini-2.5-flash');
      const phasesCalled: string[] = [];

      const mockFetch: ApiFetch = async (_url, init) => {
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
        const isIndex =
          JSON.stringify(body).includes('gmIndexChanges') ||
          JSON.stringify(body).includes('checked');
        const isEditor = JSON.stringify(body).includes('narrative');

        if (isIndex) {
          phasesCalled.push('gemini-index');
          return new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [{ text: JSON.stringify(indexUpdatePayload) }],
                    role: 'model',
                  },
                  finishReason: 'STOP',
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (isEditor && !body.tools) {
          phasesCalled.push('gemini-editor');
          return new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [{ text: JSON.stringify({ narrative: NARRATIVE }) }],
                    role: 'model',
                  },
                  finishReason: 'STOP',
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        phasesCalled.push('gemini-gameplay');
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: JSON.stringify(gameplayPayload) }],
                  role: 'model',
                },
                finishReason: 'STOP',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const generator = new ProviderService({
        env: { GEMINI_API_KEY: 'test-gemini-key', GEMINI_MODELS: 'gemini-2.5-flash' },
        fetch: mockFetch,
      });

      const service = new TurnService(store, generator);
      const submitted = await service.submit(campaign.id, {
        revision: campaign.revision,
        requestId: randomUUID(),
        action: 'Go to the shelter.',
      });

      const completed = await terminal(store, campaign.id, submitted.id);
      assert.equal(completed.status, TurnStatus.Completed, completed.error ?? 'Turn failed');
      assert.ok(phasesCalled.includes('gemini-gameplay'));
      assert.ok(phasesCalled.includes('gemini-index'));

      const after = await store.campaign(campaign.id);
      assert.deepEqual(after.state, { scene: 'Shelter' });
      assert.ok((after.gmIndex?.document.entries.length ?? 0) > 0);

      const undone = await service.undo(campaign.id, after.revision);
      assert.deepEqual(undone.state, { scene: 'Harbor' });
    } finally {
      await isolated.close();
    }
  }
);

// 2. OpenRouter same-conversation indexed turn
test(
  'openrouter same-conversation indexed turn: gameplay -> editor -> same GM index -> commit and undo',
  { skip: !dbEnabled },
  async () => {
    const isolated = await openIsolatedStore('gm_openrouter_session');
    try {
      const { store } = isolated;
      const campaign = await indexedCampaign(store, 'openrouter', 'anthropic/claude-3.5-sonnet');
      const phasesCalled: string[] = [];

      const mockFetch: ApiFetch = async (_url, init) => {
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
        const isIndex =
          JSON.stringify(body).includes('gmIndexChanges') ||
          JSON.stringify(body).includes('checked');
        const isEditor = JSON.stringify(body).includes('narrative');

        if (isIndex) {
          phasesCalled.push('openrouter-index');
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify(indexUpdatePayload),
                    role: 'assistant',
                  },
                  finish_reason: 'stop',
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (isEditor && !body.tools) {
          phasesCalled.push('openrouter-editor');
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({ narrative: NARRATIVE }),
                    role: 'assistant',
                  },
                  finish_reason: 'stop',
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        phasesCalled.push('openrouter-gameplay');
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify(gameplayPayload),
                  role: 'assistant',
                },
                finish_reason: 'stop',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const generator = new ProviderService({
        env: {
          OPENROUTER_API_KEY: 'test-openrouter-key',
          OPENROUTER_MODELS: 'anthropic/claude-3.5-sonnet',
        },
        fetch: mockFetch,
      });

      const service = new TurnService(store, generator);
      const submitted = await service.submit(campaign.id, {
        revision: campaign.revision,
        requestId: randomUUID(),
        action: 'Go to the shelter.',
      });

      const completed = await terminal(store, campaign.id, submitted.id);
      assert.equal(completed.status, TurnStatus.Completed, completed.error ?? 'Turn failed');
      assert.ok(phasesCalled.includes('openrouter-gameplay'));
      assert.ok(phasesCalled.includes('openrouter-index'));

      const after = await store.campaign(campaign.id);
      assert.deepEqual(after.state, { scene: 'Shelter' });
      assert.ok((after.gmIndex?.document.entries.length ?? 0) > 0);

      const undone = await service.undo(campaign.id, after.revision);
      assert.deepEqual(undone.state, { scene: 'Harbor' });
    } finally {
      await isolated.close();
    }
  }
);

// 3. Codex CLI same-conversation indexed turn
test(
  'codex CLI same-conversation indexed turn: gameplay -> editor -> same GM index -> commit and undo',
  { skip: !dbEnabled },
  async () => {
    const isolated = await openIsolatedStore('gm_codex_session');
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'rpg-codex-wire-'));
    const beforeEnv = { ...process.env };
    try {
      const { store } = isolated;
      const campaign = await indexedCampaign(store, 'codex', 'gpt-5.6-sol');

      const codexScript = path.join(tempDir, 'fake-codex.mjs');
      const scriptContent = `
import readline from 'node:readline';
const args = process.argv.slice(2);

if (args.includes('--version')) {
  console.log('codex-cli 0.159.2');
  process.exit(0);
}

if (args.includes('login')) {
  console.log('Logged in using ChatGPT');
  process.exit(0);
}

if (args.includes('exec')) {
  console.log(JSON.stringify({
    type: 'item.completed',
    item: {
      type: 'agent_message',
      text: JSON.stringify({ payload_json: JSON.stringify({ narrative: "You return to the harbor shelter." }) })
    }
  }));
  console.log(JSON.stringify({ type: 'turn.completed' }));
  process.exit(0);
}

const send = o => console.log(JSON.stringify(o));
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', raw => {
  const m = JSON.parse(raw);
  if (m.id === 1) {
    send({ id: 1, result: {} });
  } else if (m.id === 2) {
    send({ id: 2, result: { thread: { id: 't-codex' } } });
  } else if (m.id === 100) {
    send({ id: 100, result: { turn: { id: 'turn-1' } } });
    send({
      method: 'turn/completed',
      params: {
        threadId: 't-codex',
        turn: {
          id: 'turn-1',
          status: 'completed',
          items: [{
            type: 'agentMessage',
            text: JSON.stringify({ payload_json: JSON.stringify(${JSON.stringify(gameplayPayload)}) })
          }]
        }
      }
    });
  } else if (m.id === 200) {
    send({ id: 200, result: { turn: { id: 'turn-2' } } });
    send({
      method: 'turn/completed',
      params: {
        threadId: 't-codex',
        turn: {
          id: 'turn-2',
          status: 'completed',
          items: [{
            type: 'agentMessage',
            text: JSON.stringify({ payload_json: JSON.stringify(${JSON.stringify(indexUpdatePayload)}) })
          }]
        }
      }
    });
  }
});
`;
      await writeFile(codexScript, scriptContent, 'utf8');
      await writeFile(path.join(tempDir, 'auth.json'), 'synthetic fixture', 'utf8');
      await writeFile(
        path.join(tempDir, 'models_cache.json'),
        JSON.stringify({
          models: [
            {
              slug: 'gpt-5.6-sol',
              display_name: 'GPT',
              visibility: 'list',
              supported_reasoning_levels: [],
            },
          ],
        }),
        'utf8'
      );
      process.env.CODEX_HOME = tempDir;

      class FakeCodexProviderService extends ProviderService {
        constructor() {
          super({ env: { ...process.env, CODEX_HOME: tempDir } });
          this.locations.set('codex', { binary: process.execPath, prefix: [codexScript] });
        }
        override async list(): Promise<Provider[]> {
          return [
            {
              id: 'codex',
              transport: 'cli',
              name: 'Codex',
              available: true,
              supported: true,
              reason: null,
              version: '0.159.2',
              catalogProvenance: 'test',
              gmConversation: { supported: true, reason: null },
              dice: { supported: true, reason: null },
              rules: { supported: true, reason: null },
              models: [
                {
                  id: 'gpt-5.6-sol',
                  label: 'GPT',
                  efforts: [],
                  inputTokens: 8000,
                  dice: { supported: true, reason: null },
                  rules: { supported: true, reason: null },
                },
              ],
            },
          ];
        }
      }

      const generator = new FakeCodexProviderService();
      const service = new TurnService(store, generator);
      const submitted = await service.submit(campaign.id, {
        revision: campaign.revision,
        requestId: randomUUID(),
        action: 'Go to the shelter.',
      });

      const completed = await terminal(store, campaign.id, submitted.id);
      assert.equal(completed.status, TurnStatus.Completed, completed.error ?? 'Turn failed');

      const after = await store.campaign(campaign.id);
      assert.deepEqual(after.state, { scene: 'Shelter' });
      assert.ok((after.gmIndex?.document.entries.length ?? 0) > 0);

      const undone = await service.undo(campaign.id, after.revision);
      assert.deepEqual(undone.state, { scene: 'Harbor' });
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in beforeEnv)) delete process.env[key];
      Object.assign(process.env, beforeEnv);
      await rm(tempDir, { recursive: true, force: true });
      await isolated.close();
    }
  }
);

// 4. Claude CLI same-conversation indexed turn
test(
  'claude CLI same-conversation indexed turn: gameplay -> editor -> same GM index -> commit and undo',
  { skip: !dbEnabled },
  async () => {
    const isolated = await openIsolatedStore('gm_claude_session');
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'rpg-claude-wire-'));
    try {
      const { store } = isolated;
      const campaign = await indexedCampaign(store, 'claude', 'claude-3-7-sonnet');

      const claudeScript = path.join(tempDir, 'fake-claude.mjs');
      const scriptContent = `
import readline from 'node:readline';
const args = process.argv.slice(2);

if (args.includes('--json-schema')) {
  console.log(JSON.stringify({
    result: JSON.stringify({ narrative: "You return to the harbor shelter." })
  }));
  process.exit(0);
}

const sessionId = args[args.indexOf('--session-id') + 1];
const allowedToolsIdx = args.indexOf('--allowedTools');
const allowedTools = allowedToolsIdx !== -1 && args[allowedToolsIdx + 1] ? args[allowedToolsIdx + 1].split(',') : [];

console.log(JSON.stringify({
  type: 'system',
  subtype: 'init',
  session_id: sessionId,
  tools: allowedTools,
  mcp_servers: [{ name: 'dice', status: 'connected' }],
}));

let turnCount = 0;
const rl = readline.createInterface({ input: process.stdin });
rl.on('close', () => process.exit(0));
rl.on('line', () => {
  turnCount++;
  if (turnCount === 1) {
    console.log(JSON.stringify({
      type: 'result',
      subtype: 'success',
      session_id: sessionId,
      uuid: 'res-1',
      is_error: false,
      num_turns: turnCount,
      result: JSON.stringify(${JSON.stringify(gameplayPayload)}),
    }));
  } else if (turnCount === 2) {
    console.log(JSON.stringify({
      type: 'result',
      subtype: 'success',
      session_id: sessionId,
      uuid: 'res-2',
      is_error: false,
      num_turns: turnCount,
      result: JSON.stringify(${JSON.stringify(indexUpdatePayload)}),
    }));
  }
});
`;
      await writeFile(claudeScript, scriptContent, 'utf8');

      class FakeClaudeProviderService extends ProviderService {
        constructor() {
          super();
          this.locations.set('claude', { binary: process.execPath, prefix: [claudeScript] });
        }
        override async list(): Promise<Provider[]> {
          return [
            {
              id: 'claude',
              transport: 'cli',
              name: 'Claude',
              available: true,
              supported: true,
              reason: null,
              version: '1.0.0',
              catalogProvenance: 'test',
              gmConversation: { supported: true, reason: null },
              dice: { supported: true, reason: null },
              rules: { supported: true, reason: null },
              models: [
                {
                  id: 'claude-3-7-sonnet',
                  label: 'Claude 3.7 Sonnet',
                  efforts: [],
                  inputTokens: 8000,
                  dice: { supported: true, reason: null },
                  rules: { supported: true, reason: null },
                },
              ],
            },
          ];
        }
      }

      const generator = new FakeClaudeProviderService();
      const service = new TurnService(store, generator);
      const submitted = await service.submit(campaign.id, {
        revision: campaign.revision,
        requestId: randomUUID(),
        action: 'Go to the shelter.',
      });

      const completed = await terminal(store, campaign.id, submitted.id);
      assert.equal(completed.status, TurnStatus.Completed, completed.error ?? 'Turn failed');

      const after = await store.campaign(campaign.id);
      assert.deepEqual(after.state, { scene: 'Shelter' });
      assert.ok((after.gmIndex?.document.entries.length ?? 0) > 0);

      const undone = await service.undo(campaign.id, after.revision);
      assert.deepEqual(undone.state, { scene: 'Harbor' });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
      await isolated.close();
    }
  }
);

// 5. Antigravity CLI same-conversation indexed turn
test(
  'agy CLI same-conversation indexed turn: gameplay -> editor -> same GM index -> commit and undo',
  { skip: !dbEnabled },
  async () => {
    const isolated = await openIsolatedStore('gm_agy_session');
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'rpg-agy-wire-'));
    try {
      const { store } = isolated;
      const campaign = await indexedCampaign(store, 'agy', 'gemini-3.8-flash');

      const agyScript = path.join(tempDir, 'fake-agy.mjs');
      const scriptContent = `
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const args = process.argv.slice(2);

if (args.includes('changelog')) {
  console.log('1.2.14:');
  process.exit(0);
}

if (args.includes('/hooks')) {
  console.log(JSON.stringify({ command: { data: { hooks: [] } } }));
  process.exit(0);
}

const agentIdx = args.indexOf('--agent');
const agentName = agentIdx !== -1 ? args[agentIdx + 1] : 'agent';
console.log(JSON.stringify({ event: 'init', init: { agent: agentName } }));

const profile = process.env.USERPROFILE || os.homedir();
const agentFile = path.join(profile, '.gemini', 'config', 'agents', agentName, 'agent.md');
let isSession = false;
try {
  if (fs.existsSync(agentFile)) {
    const text = fs.readFileSync(agentFile, 'utf8');
    if (text.includes('mcpServers')) isSession = true;
  }
} catch {}

if (!isSession) {
  let raw = '';
  process.stdin.on('data', c => raw += c);
  process.stdin.on('end', () => {
    console.log(JSON.stringify({
      event: 'result',
      result: {
        status: 'SUCCESS',
        num_turns: 1,
        response: '\`\`\`json\\n' + JSON.stringify({ narrative: "You return to the harbor shelter." }) + '\\n\`\`\`'
      }
    }));
    process.exit(0);
  });
} else {
  let turnCount = 0;
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('close', () => process.exit(0));
  rl.on('line', line => {
    turnCount++;
    const isIndex = line.includes('gmIndexChanges') || line.includes('checked') || turnCount > 1;
    const responseData = isIndex ? ${JSON.stringify(indexUpdatePayload)} : ${JSON.stringify(gameplayPayload)};
    console.log(JSON.stringify({
      event: 'result',
      result: {
        status: 'SUCCESS',
        num_turns: turnCount,
        response: '\`\`\`json\\n' + JSON.stringify(responseData) + '\\n\`\`\`'
      }
    }));
  });
}
`;
      await writeFile(agyScript, scriptContent, 'utf8');

      class FakeAgyProviderService extends ProviderService {
        constructor() {
          super();
          this.locations.set('agy', { binary: process.execPath, prefix: [agyScript] });
        }
        override async list(): Promise<Provider[]> {
          return [
            {
              id: 'agy',
              transport: 'cli',
              name: 'Antigravity',
              available: true,
              supported: true,
              reason: null,
              version: '1.2.14',
              catalogProvenance: 'test',
              gmConversation: { supported: true, reason: null },
              dice: { supported: true, reason: null },
              rules: { supported: true, reason: null },
              models: [
                {
                  id: 'gemini-3.8-flash',
                  label: 'Gemini 3.8 Flash',
                  efforts: [],
                  inputTokens: 16000,
                  dice: { supported: true, reason: null },
                  rules: { supported: true, reason: null },
                },
              ],
            },
          ];
        }
      }

      const generator = new FakeAgyProviderService();
      const service = new TurnService(store, generator);
      const submitted = await service.submit(campaign.id, {
        revision: campaign.revision,
        requestId: randomUUID(),
        action: 'Go to the shelter.',
      });

      const completed = await terminal(store, campaign.id, submitted.id);
      assert.equal(completed.status, TurnStatus.Completed, completed.error ?? 'Turn failed');

      const after = await store.campaign(campaign.id);
      assert.deepEqual(after.state, { scene: 'Shelter' });
      assert.ok((after.gmIndex?.document.entries.length ?? 0) > 0);

      const undone = await service.undo(campaign.id, after.revision);
      assert.deepEqual(undone.state, { scene: 'Harbor' });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
      await isolated.close();
    }
  }
);

// 6. Correction evidence in same session
test(
  'same-session correction evidence: retry feedback is delivered in same conversation session',
  { skip: !dbEnabled },
  async () => {
    const isolated = await openIsolatedStore('gm_correction_session');
    try {
      const { store } = isolated;
      const campaign = await indexedCampaign(store, 'gemini-api', 'gemini-2.5-flash');
      let attempts = 0;
      let sawFeedback = false;

      const mockFetch: ApiFetch = async (_url, init) => {
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
        const isIndex =
          JSON.stringify(body).includes('gmIndexChanges') ||
          JSON.stringify(body).includes('checked');
        const isEditor = JSON.stringify(body).includes('narrative');

        if (isIndex) {
          return new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [{ text: JSON.stringify(indexUpdatePayload) }],
                    role: 'model',
                  },
                  finishReason: 'STOP',
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (isEditor && !body.tools) {
          return new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [{ text: JSON.stringify({ narrative: NARRATIVE }) }],
                    role: 'model',
                  },
                  finishReason: 'STOP',
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        attempts++;
        if (attempts === 1) {
          // Deliver invalid candidate to trigger retry feedback
          return new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [{ text: 'NOT_VALID_JSON' }],
                    role: 'model',
                  },
                  finishReason: 'STOP',
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        // Second attempt in same session receives correction feedback
        if (JSON.stringify(body).includes('Response correction')) {
          sawFeedback = true;
        }

        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: JSON.stringify(gameplayPayload) }],
                  role: 'model',
                },
                finishReason: 'STOP',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const generator = new ProviderService({
        env: { GEMINI_API_KEY: 'test-gemini-key', GEMINI_MODELS: 'gemini-2.5-flash' },
        fetch: mockFetch,
      });

      const service = new TurnService(store, generator);
      const submitted = await service.submit(campaign.id, {
        revision: campaign.revision,
        requestId: randomUUID(),
        action: 'Go to the shelter.',
      });

      const completed = await terminal(store, campaign.id, submitted.id);
      assert.equal(completed.status, TurnStatus.Completed, completed.error ?? 'Turn failed');
      assert.equal(sawFeedback, true);
      assert.equal(attempts, 2);
    } finally {
      await isolated.close();
    }
  }
);

// 7. Cancellation
test(
  'same-session cancellation aborts the turn and marks it cancelled',
  { skip: !dbEnabled },
  async () => {
    const isolated = await openIsolatedStore('gm_cancellation_session');
    try {
      const { store } = isolated;
      const campaign = await indexedCampaign(store, 'gemini-api', 'gemini-2.5-flash');

      let turnId = '';
      const generator: Generator = {
        capacity: async () => 16000,
        gameplayCapacity: async () => 16000,
        gmConversationCapacity: async () => {},
        generate: async () => ({ narrative: NARRATIVE }),
        generateOwnedGameplay: async () => ({}),
        withOwnedGameplaySession: async (_settings, use, signal) => {
          return use({
            runPhase: async () => {
              // Wait until cancelled
              for (let i = 0; i < 100; i++) {
                if (signal?.aborted) throw new Problem(409, 'cancelled', 'Turn cancelled');
                await sleep(20);
              }
              throw new Error('Did not receive abort');
            },
          });
        },
      };
      const service = new TurnService(store, generator);

      const submitted = await service.submit(campaign.id, {
        revision: campaign.revision,
        requestId: randomUUID(),
        action: 'Go to the shelter.',
      });
      turnId = submitted.id;

      // Cancel turn while running
      await sleep(40);
      await service.cancel(campaign.id, turnId);

      const completed = await terminal(store, campaign.id, turnId);
      assert.equal(completed.status, TurnStatus.Cancelled);
    } finally {
      await isolated.close();
    }
  }
);

// 8. Explicit separate-agent recovery after lost session
test(
  'explicit separate-agent recovery resumes and completes turn after lost same-GM session',
  { skip: !dbEnabled },
  async () => {
    const isolated = await openIsolatedStore('gm_recovery_session');
    try {
      const { store } = isolated;
      const campaign = await indexedCampaign(store, 'gemini-api', 'gemini-2.5-flash');

      let sessionLost = false;
      const mockFetch: ApiFetch = async (_url, init) => {
        const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
        const isIndex =
          JSON.stringify(body).includes('gmIndexChanges') ||
          JSON.stringify(body).includes('checked');
        const isEditor = JSON.stringify(body).includes('narrative');

        if (isIndex) {
          if (!sessionLost) {
            sessionLost = true;
            throw new Problem(409, 'gm_session_lost', 'Synthetic session disconnect');
          }
          return new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [{ text: JSON.stringify(indexUpdatePayload) }],
                    role: 'model',
                  },
                  finishReason: 'STOP',
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        if (isEditor && !body.tools) {
          return new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [{ text: JSON.stringify({ narrative: NARRATIVE }) }],
                    role: 'model',
                  },
                  finishReason: 'STOP',
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: JSON.stringify(gameplayPayload) }],
                  role: 'model',
                },
                finishReason: 'STOP',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const generator = new ProviderService({
        env: { GEMINI_API_KEY: 'test-gemini-key', GEMINI_MODELS: 'gemini-2.5-flash' },
        fetch: mockFetch,
      });

      const service = new TurnService(store, generator);
      const submitted = await service.submit(campaign.id, {
        revision: campaign.revision,
        requestId: randomUUID(),
        action: 'Go to the shelter.',
      });

      const pausedTurn = await terminal(store, campaign.id, submitted.id);
      assert.equal(pausedTurn.status, TurnStatus.Failed);
      assert.equal(pausedTurn.editingPending, true);
      assert.equal(pausedTurn.finalization?.stage, 'index_updating');
      assert.equal(pausedTurn.finalization?.recovery?.available, true);

      // Now explicitly recover using separate index agent
      const resumed = await service.resumeEditing(campaign.id, submitted.id, {
        revision: 0,
        requestId: randomUUID(),
        resumeIntent: FinalizationResumeIntent.SeparateIndexRecovery,
      });
      assert.ok(resumed);

      const completed = await terminal(store, campaign.id, submitted.id);
      assert.equal(completed.status, TurnStatus.Completed, completed.error ?? 'Turn failed');

      const after = await store.campaign(campaign.id);
      assert.deepEqual(after.state, { scene: 'Shelter' });
      assert.ok((after.gmIndex?.document.entries.length ?? 0) > 0);
    } finally {
      await isolated.close();
    }
  }
);
