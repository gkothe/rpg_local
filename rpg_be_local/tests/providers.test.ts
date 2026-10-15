import { test } from 'node:test';
import assert from 'node:assert/strict';
import { providerArgs, parseProviderOutput } from '../src/providers/adapters.js';
import { runProcess } from '../src/providers/processRunner.js';
import { agentDefinition, parseModelCatalog, modelSlug } from '../src/providers/antigravity.js';
import { gameplayResponseJsonSchema as responseJsonSchema } from '../src/domain/gameplayResponse.js';
import { ProviderService, type Provider } from '../src/providers/service.js';
import type { ApiFetch } from '../src/providers/apiHttp.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('editor effort comes from selected model capabilities, with canonical fallback and explicit failures', async () => {
  class EditorProviders extends ProviderService {
    override async list(): Promise<Provider[]> {
      return [
        {
          id: 'codex',
          transport: 'cli',
          name: 'Fixture',
          available: true,
          supported: true,
          reason: null,
          version: 'fixture',
          catalogProvenance: 'fixture',
          models: [
            { id: 'low', label: 'Low', efforts: ['high', 'low', 'medium'], inputTokens: 8000 },
            {
              id: 'fallback',
              label: 'Fallback',
              efforts: ['max', 'high', 'medium'],
              inputTokens: 8000,
            },
            { id: 'default', label: 'Default', efforts: [], inputTokens: 8000 },
          ],
        },
      ];
    }
  }
  const service = new EditorProviders();
  for (const [model, expected] of [
    ['low', 'low'],
    ['fallback', 'medium'],
    ['default', null],
  ] as const) {
    const settings = { provider: 'codex', model, effort: 'high' };
    assert.deepEqual(await service.narrativeEditorSettings(settings), {
      ...settings,
      effort: expected,
    });
    assert.equal(settings.effort, 'high');
  }
  await assert.rejects(
    service.narrativeEditorSettings({ provider: 'codex', model: 'missing', effort: null }),
    /model/
  );
  await assert.rejects(
    service.narrativeEditorSettings({ provider: 'missing', model: 'low', effort: null }),
    /CLI/
  );
});

test('untested Codex version remains usable for dice and books and exposes a compatibility warning', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rpg-cli-version-'));
  const before = { ...process.env };
  try {
    const script = path.join(root, 'cli.mjs');
    await writeFile(
      script,
      `const args=process.argv.slice(2);
      if(args.includes('--help'))console.log('--ignore-user-config --ignore-rules --ephemeral --output-schema');
      else if(args.includes('--version'))console.log('codex-cli 0.159.0-alpha.12.1');
      else if(args.includes('login'))console.log('Logged in using ChatGPT');`
    );
    await writeFile(path.join(root, 'auth.json'), 'synthetic fixture');
    await writeFile(
      path.join(root, 'models_cache.json'),
      JSON.stringify({
        models: [
          {
            slug: 'gpt-5.6-sol',
            display_name: 'Fixture',
            visibility: 'list',
            context_window: 128000,
            supported_reasoning_levels: [{ effort: 'medium' }],
          },
        ],
      })
    );
    process.env.CODEX_HOME = root;
    for (const name of ['CODEX', 'CLAUDE', 'AGY']) process.env[`RPG_${name}_BIN`] = script;
    delete process.env.RPG_MODEL_CATALOG;
    const service = new ProviderService();
    const codex = (await service.list()).find((provider) => provider.id === 'codex')!;
    assert.equal(codex.supported, true);
    assert.equal(codex.reason, null);
    assert.equal(codex.dice?.supported, true);
    assert.match(codex.compatibilityWarning!, /0\.159\.0-alpha\.12\.1.*Gameplay is allowed/);
    assert.equal(codex.models[0]!.rules?.supported, process.platform === 'win32');
    assert.ok(
      await service.gameplayCapacity({ provider: 'codex', model: 'gpt-5.6-sol', effort: 'medium' })
    );
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key];
    Object.assign(process.env, before);
    await rm(root, { recursive: true, force: true });
  }
});

for (const failedCatalog of [false, true]) {
  test(`Antigravity discovery skips ambient hooks and preserves catalog ${failedCatalog ? 'failure' : 'readiness'}`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rpg-agy-discovery-'));
    const before = { ...process.env };
    try {
      const script = path.join(root, 'cli.mjs');
      await writeFile(
        script,
        `const args=process.argv.slice(2);
        if(args.includes('--help'))console.log('--agent');
        else if(args.includes('changelog'))console.log('1.2.17:');
        else if(args.includes('/hooks')){console.error('Ambient hooks must not be probed');process.exitCode=1;}
        else if(args.includes('models')){
          if(process.env.RPG_TEST_CATALOG_FAILURE==='1')process.exitCode=1;
          else console.log('fixture-low\\tFixture (Low)');
        }`
      );
      for (const name of ['CODEX', 'CLAUDE', 'AGY']) process.env[`RPG_${name}_BIN`] = script;
      process.env.RPG_TEST_CATALOG_FAILURE = failedCatalog ? '1' : '0';
      delete process.env.RPG_MODEL_CATALOG;
      const service = new ProviderService();
      const agy = (await service.list()).find((provider) => provider.id === 'agy')!;
      assert.equal(agy.available, true);
      assert.equal(agy.version, '1.2.17');
      assert.equal(agy.supported, !failedCatalog);
      assert.equal(agy.dice?.supported, !failedCatalog);
      assert.equal(agy.rules?.supported, !failedCatalog);
      if (failedCatalog) {
        assert.ok(agy.reason);
        assert.doesNotMatch(agy.reason, /isolation is not verified/);
      } else {
        assert.equal(agy.reason, null);
        assert.match(agy.compatibilityWarning!, /Gameplay is allowed/);
        assert.equal(agy.models[0]!.id, 'fixture');
        assert.ok(
          await service.gameplayCapacity({ provider: 'agy', model: 'fixture', effort: 'low' })
        );
      }
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in before)) delete process.env[key];
      Object.assign(process.env, before);
      await rm(root, { recursive: true, force: true });
    }
  });
}

test('gameplay rejects provider and model dice gates without disabling no-tools capacity', async () => {
  class FixtureProviders extends ProviderService {
    provider: Provider = {
      id: 'codex',
      transport: 'cli',
      name: 'Fixture',
      available: true,
      supported: true,
      reason: null,
      version: 'fixture',
      catalogProvenance: 'Fixture',
      dice: { supported: false, reason: 'Unverified dice' },
      models: [
        {
          id: 'fixture',
          label: 'Fixture',
          efforts: ['low'],
          inputTokens: 8000,
          dice: { supported: false, reason: 'Unverified model' },
        },
      ],
    };
    override async list() {
      return [this.provider];
    }
  }
  const service = new FixtureProviders();
  const settings = { provider: 'codex', model: 'fixture', effort: 'low' };
  assert.equal(await service.capacity(settings), 16000);
  await assert.rejects(service.gameplayCapacity(settings), /Unverified dice/);
  service.provider.dice = { supported: true, reason: null };
  await assert.rejects(service.gameplayCapacity(settings), /Unverified model/);
  service.provider.models[0]!.dice = { supported: true, reason: null };
  assert.equal(await service.gameplayCapacity(settings), 16000);
});
test('Claude invocation retains subscription auth, disables tools/customization and session reuse', () => {
  const a = providerArgs(
    'claude',
    { provider: 'claude', model: 'sonnet', effort: 'high' },
    '/tmp/schema.json',
    {}
  );
  assert.ok(a.includes('--safe-mode'));
  assert.ok(a.includes('--no-session-persistence'));
  assert.ok(a.includes('--tools'));
  assert.equal(a[a.indexOf('--tools') + 1], '');
  assert.ok(!a.includes('--bare'));
  assert.ok(!a.includes('--continue'));
  assert.deepEqual(
    parseProviderOutput(
      'claude',
      JSON.stringify({ structured_output: { narrative: 'Hi', operations: [] } })
    ),
    { narrative: 'Hi', operations: [] }
  );
});
test('Claude accepts the application schema without an unsupported meta-schema annotation', () => {
  const args = providerArgs(
    'claude',
    { provider: 'claude', model: 'sonnet', effort: 'low' },
    '/unused/schema.json',
    responseJsonSchema
  );
  const actual = JSON.parse(args[args.indexOf('--json-schema') + 1]!);
  const expected = { ...responseJsonSchema };
  delete expected.$schema;
  assert.deepEqual(actual, expected);
  assert.equal(actual.$schema, undefined);
  assert.ok(responseJsonSchema.$schema);
});
test('Codex/Antigravity machine outputs are parsed, malformed output rejected', () => {
  assert.deepEqual(
    parseProviderOutput(
      'codex',
      JSON.stringify({
        type: 'item.completed',
        item: { type: 'agent_message', text: JSON.stringify({ payload_json: '{"text":"done"}' }) },
      }) + '\n{"type":"turn.completed","usage":{"input_tokens":1000}}\n'
    ),
    { text: 'done' }
  );
  assert.throws(
    () => parseProviderOutput('claude', '{"is_error":true,"result":"login"}'),
    (error: unknown) => (error as { code: string }).code === 'provider_auth'
  );
  assert.throws(() => parseProviderOutput('agy', 'not json'), /JSON/);
});
test('failed generated results stay provider failures without misclassifying story as account diagnostics', () => {
  const generated = JSON.stringify({ text: 'login authorization quota PRIVATE_VALUE' });
  assert.throws(
    () => parseProviderOutput('claude', JSON.stringify({ is_error: true, result: generated })),
    (error: unknown) => (error as { code: string }).code === 'provider_failure'
  );
  for (const [response, expected] of [
    [generated, 'provider_failure'],
    ['Please login with your account', 'provider_auth'],
    ['resource exhausted', 'provider_quota'],
  ]) {
    const output = [
      { event: 'init', init: { agent: 'local-rpg-fixture' } },
      { event: 'result', result: { status: 'ERROR', num_turns: 1, response } },
    ]
      .map((event) => JSON.stringify(event))
      .join('\n');
    assert.throws(
      () => parseProviderOutput('agy', output),
      (error: unknown) => {
        assert.doesNotMatch(String(error), /PRIVATE_VALUE/);
        return (error as { code: string }).code === expected;
      }
    );
    assert.throws(
      () => parseProviderOutput('agy', output.replace('local-rpg-fixture', 'foreign-agent')),
      (error: unknown) => (error as { code: string }).code === 'provider_isolation'
    );
    assert.throws(
      () => parseProviderOutput('agy', output.replace('"num_turns":1', '"num_turns":2')),
      (error: unknown) => (error as { code: string }).code === 'provider_isolation'
    );
  }
});

test('runner streams prompt through stdin with bounded output, no shell interpolation and cancellation', async () => {
  const output = await runProcess(
    process.execPath,
    ['-e', 'process.stdin.pipe(process.stdout)'],
    '$(do not execute)',
    { timeoutMs: 1000, maxOutputBytes: 1000 }
  );
  assert.equal(output, '$(do not execute)');
  await assert.rejects(
    runProcess(process.execPath, ['-e', 'process.stdout.write("x".repeat(2000))'], '', {
      timeoutMs: 2000,
      maxOutputBytes: 100,
    }),
    /output limit/
  );
  const ctl = new AbortController();
  const pending = runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], '', {
    timeoutMs: 3000,
    signal: ctl.signal,
  });
  ctl.abort();
  await assert.rejects(pending, /cancelled/);
});

test('Antigravity excludes ambient customizations and accepts one isolated result without token gating', () => {
  const definition = agentDefinition('local-rpg-fixture');
  assert.ok(definition.includes('inheritCustomizations: false'));
  assert.ok(definition.includes('excludeDefaultComponents: true'));
  assert.ok(definition.includes('tools: []'));
  assert.ok(definition.includes('subagent: false'));
  const catalog = parseModelCatalog(
    'Fetching available models...\ngemini-3.8-flash-low\tGemini 3.8 Flash (Low)\n'
  );
  assert.deepEqual(catalog[0]?.efforts, ['low']);
  assert.equal(catalog[0]?.id, 'gemini-3.8-flash');
  assert.equal(
    modelSlug({ provider: 'agy', model: 'gemini-3.8-flash', effort: 'low' }, [
      'high',
      'medium',
      'low',
    ]),
    'gemini-3.8-flash-low'
  );
  const init = { event: 'init', init: { agent: 'local-rpg-fixture' } };
  const result = {
    status: 'SUCCESS',
    num_turns: 1,
    usage: { input_tokens: 1000 },
    response: '```json\n{"text":"done"}\n```',
  };
  const output = (value: unknown) =>
    JSON.stringify(init) + '\n' + JSON.stringify({ event: 'result', result: value });
  assert.deepEqual(parseProviderOutput('agy', output(result)), { text: 'done' });
  assert.throws(() => parseProviderOutput('agy', output({ ...result, num_turns: 2 })), /isolated/);
  for (const usage of [{ input_tokens: 16001 }, { input_tokens: 120000 }, undefined]) {
    assert.deepEqual(parseProviderOutput('agy', output({ ...result, usage })), { text: 'done' });
  }
  assert.throws(
    () => parseProviderOutput('agy', output({ ...result, status: 'ERROR' })),
    (error: unknown) => (error as { code: string }).code === 'provider_failure'
  );
});

test('rules capability accepts model-supported efforts and Default while preserving existing reserves', async () => {
  class FixtureProviders extends ProviderService {
    provider: Provider = {
      id: 'codex',
      transport: 'cli',
      name: 'Original fixture',
      available: true,
      supported: true,
      version: '0.159.2',
      reason: null,
      catalogProvenance: 'Original fixture',
      dice: { supported: true, reason: null },
      rules: { supported: false, reason: 'Unverified rules' },
      models: [
        {
          id: 'gpt-5.6-sol',
          label: 'Original fixture',
          efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
          inputTokens: 8000,
          dice: { supported: true, reason: null },
          rules: { supported: false, reason: 'Unverified rules model' },
        },
      ],
    };
    override async list() {
      return [this.provider];
    }
  }
  const service = new FixtureProviders();
  const settings = { provider: 'codex', model: 'gpt-5.6-sol', effort: 'medium' };
  assert.equal(await service.capacity(settings), 16000);
  assert.equal(await service.gameplayCapacity(settings), 16000);
  await assert.rejects(service.bookGameplayCapacity(settings), /Unverified rules model/);
  service.provider.rules = { supported: true, reason: null };
  service.provider.models[0]!.rules = {
    supported: true,
    reason: null,
    efforts: ['medium'],
  };
  service.provider.models[0]!.inputTokens = 16000;
  assert.equal(await service.bookGameplayCapacity(settings), 16000);
  assert.equal(await service.bookGameplayCapacity(settings, 7000), 7000);
  for (const effort of ['low', 'medium', 'high', 'xhigh', 'max', null])
    assert.equal(await service.bookGameplayCapacity({ ...settings, effort }), 16000);
  assert.equal(await service.capacity(settings), 16000);
});

test('all five providers advertise gmConversation capability consistent with readiness', async () => {
  const env: NodeJS.ProcessEnv = {
    GEMINI_API_KEY: 'test-gemini-key',
    GEMINI_MODELS: 'gemini-2.5-flash',
    OPENROUTER_API_KEY: 'test-openrouter-key',
    OPENROUTER_MODELS: 'anthropic/claude-3.5-sonnet',
  };
  const service = new ProviderService({ env });
  const providers = await service.list();
  const ids = ['agy', 'codex', 'claude', 'gemini-api', 'openrouter'] as const;
  for (const id of ids) {
    const p = providers.find((row) => row.id === id);
    assert.ok(p, `Provider row ${id} must exist in list`);
    assert.ok(p.gmConversation, `gmConversation capability must be defined for ${id}`);
    assert.equal(typeof p.gmConversation.supported, 'boolean');
    if (p.gmConversation.supported) {
      assert.equal(p.gmConversation.reason, null);
    } else {
      assert.ok(typeof p.gmConversation.reason === 'string');
    }
  }

  // When API key is missing, gmConversation reflects the unconfigured state
  const unconfiguredService = new ProviderService({ env: {} });
  const unconfiguredProviders = await unconfiguredService.list();
  const geminiUnconfigured = unconfiguredProviders.find((p) => p.id === 'gemini-api')!;
  assert.equal(geminiUnconfigured.gmConversation?.supported, false);
  assert.match(geminiUnconfigured.gmConversation?.reason ?? '', /GEMINI_API_KEY/);
  await assert.rejects(
    unconfiguredService.gmConversationCapacity({
      provider: 'gemini-api',
      model: 'gemini-2.5-flash',
      effort: null,
    }),
    /GEMINI_API_KEY/
  );
});

test('cold cache API isolation: Gemini and OpenRouter resolve validation and session without discovering CLIs', async () => {
  class ThrowingCliService extends ProviderService {
    override async discoverCli(): Promise<Provider[]> {
      throw new Error('CLI discovery must not be invoked for API operations');
    }
  }
  const env: NodeJS.ProcessEnv = {
    GEMINI_API_KEY: 'test-gemini-key',
    GEMINI_MODELS: 'gemini-2.5-flash',
    OPENROUTER_API_KEY: 'test-openrouter-key',
    OPENROUTER_MODELS: 'anthropic/claude-3.5-sonnet',
  };
  const service = new ThrowingCliService({ env });

  // Capacity, gameplay capacity, narrativeEditorSettings, and gmConversationCapacity must all work on cold cache
  const geminiSettings = { provider: 'gemini-api', model: 'gemini-2.5-flash', effort: null };
  assert.equal(await service.capacity(geminiSettings), 16000);
  assert.equal(await service.gameplayCapacity(geminiSettings), 16000);
  assert.deepEqual(await service.narrativeEditorSettings(geminiSettings), {
    ...geminiSettings,
    effort: null,
  });
  await service.gmConversationCapacity(geminiSettings);

  const openrouterSettings = {
    provider: 'openrouter',
    model: 'anthropic/claude-3.5-sonnet',
    effort: null,
  };
  assert.equal(await service.capacity(openrouterSettings), 16000);
  assert.equal(await service.gameplayCapacity(openrouterSettings), 16000);
  assert.deepEqual(await service.narrativeEditorSettings(openrouterSettings), {
    ...openrouterSettings,
    effort: null,
  });
  await service.gmConversationCapacity(openrouterSettings);

  // withOwnedGameplaySession creates session without discovering CLIs
  let geminiSessionRan = false;
  await service.withOwnedGameplaySession(geminiSettings, async (session) => {
    assert.ok(session);
    assert.equal(typeof session.runPhase, 'function');
    geminiSessionRan = true;
  });
  assert.equal(geminiSessionRan, true);

  let openrouterSessionRan = false;
  await service.withOwnedGameplaySession(openrouterSettings, async (session) => {
    assert.ok(session);
    assert.equal(typeof session.runPhase, 'function');
    openrouterSessionRan = true;
  });
  assert.equal(openrouterSessionRan, true);
});

test('withOwnedGameplaySession callback failure before the first request cleans up and propagates error across providers', async () => {
  const env: NodeJS.ProcessEnv = {
    GEMINI_API_KEY: 'test-gemini-key',
    GEMINI_MODELS: 'gemini-2.5-flash',
    OPENROUTER_API_KEY: 'test-openrouter-key',
    OPENROUTER_MODELS: 'anthropic/claude-3.5-sonnet',
  };
  const service = new ProviderService({ env });

  // API callback failure before first request propagates
  await assert.rejects(
    service.withOwnedGameplaySession(
      { provider: 'gemini-api', model: 'gemini-2.5-flash', effort: null },
      async () => {
        throw new Error('gemini early callback error');
      }
    ),
    /gemini early callback error/
  );

  await assert.rejects(
    service.withOwnedGameplaySession(
      { provider: 'openrouter', model: 'anthropic/claude-3.5-sonnet', effort: null },
      async () => {
        throw new Error('openrouter early callback error');
      }
    ),
    /openrouter early callback error/
  );

  // CLI callback failure before first request fails the bridge and does not hang
  class MockCliService extends ProviderService {
    constructor() {
      super();
      this.locations.set('codex', { binary: 'dummy-codex', prefix: [] });
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
  const cliService = new MockCliService();
  await assert.rejects(
    cliService.withOwnedGameplaySession(
      { provider: 'codex', model: 'gpt-5.6-sol', effort: null },
      async () => {
        throw new Error('cli early callback error');
      }
    ),
    /cli early callback error/
  );
});

test('withOwnedGameplaySession routes API providers to their respective engines and executes phases', async () => {
  const geminiBody = {
    candidates: [
      {
        content: {
          parts: [{ text: '{"text":"gemini phase response"}' }],
          role: 'model',
        },
        finishReason: 'STOP',
      },
    ],
  };
  const mockFetch: ApiFetch = async (_url, init) => {
    const reqBody = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
    assert.ok(reqBody.contents || reqBody.messages);
    return new Response(JSON.stringify(geminiBody), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const service = new ProviderService({
    env: { GEMINI_API_KEY: 'test-key', GEMINI_MODELS: 'gemini-2.5-flash' },
    fetch: mockFetch,
  });
  const dispatch = Object.assign(async () => ({}), {
    definitions: [],
    assertActive: async () => {},
  });
  const result = await service.withOwnedGameplaySession(
    { provider: 'gemini-api', model: 'gemini-2.5-flash', effort: null },
    async (session) => {
      return await session.runPhase({
        prompt: 'test prompt',
        schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
        systemPrompt: 'test system prompt',
        tools: dispatch,
      });
    }
  );
  assert.deepEqual(result, { text: 'gemini phase response' });
});
