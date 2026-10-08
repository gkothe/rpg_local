import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProviderService, type Provider } from '../src/providers/service.js';
import { createPromptTrace, type PromptTraceContext } from '../src/providers/promptLog.js';
import { API_PROVIDER_ID } from '../src/providers/options.js';
import { ownedTools } from './ownedGameplayFixture.js';

/** Wire payloads are inspected structurally; JSON.parse already yields an untyped value. */
type WireJson = ReturnType<typeof JSON.parse>;
const KEY = 'sk-test-secret-key';
const ENV = {
  GEMINI_API_KEY: KEY,
  GEMINI_MODELS: 'gemini-test',
  OPENROUTER_API_KEY: KEY,
  OPENROUTER_MODELS: 'vendor/router-test',
};
const SCHEMA = { type: 'object' };
const OWNED_SETTINGS = {
  gemini: { provider: API_PROVIDER_ID.Gemini, model: 'gemini-test', effort: null },
  router: { provider: API_PROVIDER_ID.OpenRouter, model: 'vendor/router-test', effort: null },
};
type Call = { url: string; headers: Record<string, string>; body: WireJson };
/** Scripted HTTP boundary: each request consumes the next reply and is recorded. */
function scripted(replies: unknown[]) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({
      url: String(url),
      headers: init!.headers as Record<string, string>,
      body: JSON.parse(String(init!.body)),
    });
    const next = replies.shift();
    if (next === undefined) throw new Error('No scripted reply left');
    if (typeof next === 'object' && next !== null && 'httpStatus' in next)
      return new Response('{}', { status: next.httpStatus as number });
    return new Response(JSON.stringify(next));
  };
  return { calls, fetchImpl };
}
/** CLI discovery launches real executables; API behavior needs none of it. */
class ApiOnlyProviders extends ProviderService {
  protected override async discoverCli(): Promise<Provider[]> {
    return [];
  }
}
const service = (replies: unknown[]) => {
  const http = scripted(replies);
  return { http, providers: new ApiOnlyProviders({ fetch: http.fetchImpl, env: ENV }) };
};
const routerReply = (message: object, finish = 'stop', usage?: object) => ({
  choices: [{ finish_reason: finish, message: { role: 'assistant', ...message } }],
  ...(usage ? { usage } : {}),
});
const routerCall = (id: string, name: string, args: object) => ({
  id,
  type: 'function',
  function: { name, arguments: JSON.stringify(args) },
});
const geminiReply = (parts: object[], finishReason = 'STOP', usageMetadata?: object) => ({
  candidates: [{ content: { role: 'model', parts }, finishReason }],
  ...(usageMetadata ? { usageMetadata } : {}),
});
const FINAL = { narrative: 'The door opens.' };

async function traced() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rpg-api-test-'));
  const trace = await createPromptTrace('test', { executionId: randomUUID() }, dir);
  const context: PromptTraceContext = { executionId: randomUUID(), trace };
  return {
    context,
    events: async () =>
      (await readFile(trace.file, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { kind: string; payload: WireJson }),
    done: () => rm(dir, { recursive: true, force: true }),
  };
}

test('real discovery keeps the three CLI rows beside the API rows', async () => {
  const list = await new ProviderService({ env: ENV }).list(true);
  assert.deepEqual(
    list.map((p) => [p.id, p.transport]),
    [
      ['claude', 'cli'],
      ['codex', 'cli'],
      ['agy', 'cli'],
      ['gemini-api', 'api'],
      ['openrouter', 'api'],
    ]
  );
});

test('discovery reports API providers locally with transport metadata, no request and no key', async () => {
  const { http, providers } = service([]);
  const list = await providers.list(true);
  const gemini = list.find((p) => p.id === API_PROVIDER_ID.Gemini)!;
  const router = list.find((p) => p.id === API_PROVIDER_ID.OpenRouter)!;
  assert.equal(http.calls.length, 0);
  assert.equal(gemini.transport, 'api');
  assert.equal(router.transport, 'api');
  assert.deepEqual(
    gemini.models.map((m) => [m.id, m.efforts]),
    [['gemini-test', []]]
  );
  assert.equal(gemini.supported && router.supported, true);
  assert.doesNotMatch(JSON.stringify(list), new RegExp(KEY));
});

test('unconfigured API providers are unavailable with a reason', async () => {
  const providers = new ApiOnlyProviders({ env: { GEMINI_API_KEY: KEY } });
  const list = await providers.list(true);
  const gemini = list.find((p) => p.id === API_PROVIDER_ID.Gemini)!;
  assert.equal(gemini.supported, false);
  assert.match(gemini.reason!, /GEMINI_MODELS/);
  const router = list.find((p) => p.id === API_PROVIDER_ID.OpenRouter)!;
  assert.equal(router.available, false);
  assert.match(router.reason!, /OPENROUTER_API_KEY/);
  await assert.rejects(
    providers.generate({ ...OWNED_SETTINGS.router }, 'p', SCHEMA),
    /OPENROUTER_API_KEY/
  );
  await assert.rejects(
    providers.generate({ ...OWNED_SETTINGS.gemini, effort: 'high' }, 'p', SCHEMA),
    /GEMINI_MODELS/
  );
});

test('ordinary OpenRouter generation sends no tools, requires parameters and traces usage', async () => {
  const t = await traced();
  try {
    const { http, providers } = service([
      routerReply({ content: '{"answer":1}' }, 'stop', {
        prompt_tokens: 11,
        completion_tokens: 3,
      }),
    ]);
    const result = await providers.generate(
      OWNED_SETTINGS.router,
      'the prompt',
      SCHEMA,
      undefined,
      t.context
    );
    assert.deepEqual(result, { answer: 1 });
    const [call] = http.calls;
    assert.equal(call!.url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(call!.headers.Authorization, `Bearer ${KEY}`);
    assert.equal(call!.body.model, 'vendor/router-test');
    assert.equal(call!.body.tools, undefined);
    assert.equal(call!.body.provider.require_parameters, true);
    assert.equal(call!.body.messages[1].content, 'the prompt');
    const events = await t.events();
    assert.deepEqual(events.find((e) => e.kind === 'usage')!.payload.inputTokens, 11);
    assert.doesNotMatch(JSON.stringify(events), new RegExp(KEY));
  } finally {
    await t.done();
  }
});

test('ordinary Gemini generation uses generateContent JSON mode and rejects tool calls', async () => {
  const { http, providers } = service([
    geminiReply([{ thought: true, text: 'thinking' }, { text: '{"ok":true}' }]),
    geminiReply([{ functionCall: { name: 'roll_dice', args: {} } }]),
  ]);
  assert.deepEqual(await providers.generate(OWNED_SETTINGS.gemini, 'p', SCHEMA), { ok: true });
  const [call] = http.calls;
  assert.equal(
    call!.url,
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent'
  );
  assert.equal(call!.headers['x-goog-api-key'], KEY);
  assert.equal(call!.body.tools, undefined);
  assert.equal(call!.body.generationConfig.responseMimeType, 'application/json');
  await assert.rejects(providers.generate(OWNED_SETTINGS.gemini, 'p', SCHEMA), /no-tools/);
});

test('OpenRouter owned gameplay runs sequential tools, keeps full history and validates the final', async () => {
  const t = await traced();
  try {
    const first = routerReply(
      {
        content: null,
        reasoning_details: [{ type: 'reasoning.encrypted', data: 'opaque' }],
        tool_calls: [
          routerCall('call_1', 'campaign_knowledge_search', { query: 'inn' }),
          routerCall('call_2', 'campaign_knowledge_search', { query: 'keep' }),
        ],
      },
      'tool_calls',
      { prompt_tokens: 10, completion_tokens: 2 }
    );
    const { http, providers } = service([
      first,
      routerReply({ content: JSON.stringify(FINAL) }, 'stop', {
        prompt_tokens: 30,
        completion_tokens: 5,
      }),
    ]);
    const order: string[] = [];
    const tools = ownedTools();
    const observed: unknown[] = [];
    const dispatch = Object.assign(
      async (name: string, input: unknown, id: string | number) => {
        order.push(JSON.stringify((input as { query: string }).query));
        return tools.call(name, input, id);
      },
      { definitions: tools.call.definitions, assertActive: tools.call.assertActive }
    );
    const result = await providers.generateOwnedGameplay(
      OWNED_SETTINGS.router,
      'play',
      SCHEMA,
      'system',
      dispatch,
      undefined,
      t.context
    );
    assert.deepEqual(result, FINAL);
    assert.deepEqual(order, ['"inn"', '"keep"']);
    const [one, two] = http.calls;
    assert.ok(one!.body.tools.length >= 8);
    assert.ok(
      one!.body.tools.every((tool: WireJson) => tool.function.parameters.$schema === undefined)
    );
    const history = two!.body.messages;
    assert.equal(history[2].reasoning_details[0].data, 'opaque');
    assert.deepEqual(
      history.slice(3).map((m: WireJson) => [m.role, m.tool_call_id]),
      [
        ['tool', 'call_1'],
        ['tool', 'call_2'],
      ]
    );
    assert.equal(two!.body.tools.length, one!.body.tools.length);
    const events = await t.events();
    const usage = events.find((e) => e.kind === 'usage')!.payload;
    assert.deepEqual([usage.inputTokens, usage.outputTokens, usage.modelTurns], [40, 7, 2]);
    void observed;
  } finally {
    await t.done();
  }
});

test('Gemini owned gameplay replays the candidate verbatim and answers with matching function responses', async () => {
  const modelParts = [
    { text: 'checking', thought: true, thoughtSignature: 'sig-1' },
    {
      functionCall: { id: 'g1', name: 'campaign_knowledge_search', args: { query: 'inn' } },
      thoughtSignature: 'sig-2',
    },
    { functionCall: { name: 'campaign_knowledge_search', args: { query: 'bad', unknown: 1 } } },
  ];
  const { http, providers } = service([
    geminiReply(modelParts),
    geminiReply([{ text: JSON.stringify(FINAL) }]),
  ]);
  const tools = ownedTools();
  const result = await providers.generateOwnedGameplay(
    OWNED_SETTINGS.gemini,
    'play',
    SCHEMA,
    'system',
    tools.call
  );
  assert.deepEqual(result, FINAL);
  const [one, two] = http.calls;
  assert.equal(one!.body.tools[0].functionDeclarations.length, tools.definitions.length);
  assert.equal(one!.body.generationConfig, undefined);
  const [user, model, responses] = two!.body.contents;
  assert.equal(user.role, 'user');
  assert.deepEqual(model, { role: 'model', parts: modelParts });
  assert.equal(responses.role, 'user');
  assert.equal(responses.parts.length, 2);
  assert.equal(responses.parts[0].functionResponse.id, 'g1');
  assert.ok('output' in responses.parts[0].functionResponse.response);
  // The id-less second call is answered without an id; its invalid arguments go back as a correctable error.
  assert.equal(responses.parts[1].functionResponse.id, undefined);
  assert.match(responses.parts[1].functionResponse.response.error, /gameplay_arguments_invalid/);
});

test('unknown tools are returned to the model as a rejection and never reach a handler', async () => {
  const { http, providers } = service([
    routerReply({ tool_calls: [routerCall('x', 'shell_exec', { cmd: 'rm -rf /' })] }, 'tool_calls'),
    routerReply({ content: JSON.stringify(FINAL) }),
  ]);
  const tools = ownedTools();
  await providers.generateOwnedGameplay(OWNED_SETTINGS.router, 'p', SCHEMA, 's', tools.call);
  const toolMessage = http.calls[1]!.body.messages.at(-1);
  assert.match(toolMessage.content, /gameplay_tool_invalid/);
});

test('ownership loss stops before the next request and API gameplay requires the ownership hook', async () => {
  let active = true;
  const tools = ownedTools({
    assertActive: async () => {
      if (!active) throw new Error('lost');
    },
  });
  const { http, providers } = service([
    routerReply(
      { tool_calls: [routerCall('c1', 'campaign_knowledge_search', { query: 'a' })] },
      'tool_calls'
    ),
    routerReply({ content: JSON.stringify(FINAL) }),
  ]);
  const dispatch = Object.assign(
    async (name: string, input: unknown, id: string | number) => {
      const result = await tools.call(name, input, id);
      active = false;
      return result;
    },
    { definitions: tools.call.definitions, assertActive: tools.call.assertActive }
  );
  await assert.rejects(
    providers.generateOwnedGameplay(OWNED_SETTINGS.router, 'p', SCHEMA, 's', dispatch),
    /lost/
  );
  assert.equal(http.calls.length, 1);

  const bare = Object.assign(async () => ({}), { definitions: tools.call.definitions });
  const second = service([]);
  await assert.rejects(
    second.providers.generateOwnedGameplay(OWNED_SETTINGS.router, 'p', SCHEMA, 's', bare),
    /ownership check/
  );
  assert.equal(second.http.calls.length, 0);
});

test('cancellation between tool calls prevents further dispatch and requests', async () => {
  const controller = new AbortController();
  const tools = ownedTools({ signal: controller.signal });
  const { http, providers } = service([
    routerReply(
      {
        tool_calls: [
          routerCall('c1', 'campaign_knowledge_search', { query: 'a' }),
          routerCall('c2', 'campaign_knowledge_search', { query: 'b' }),
        ],
      },
      'tool_calls'
    ),
  ]);
  let dispatched = 0;
  const dispatch = Object.assign(
    async (name: string, input: unknown, id: string | number) => {
      dispatched++;
      const result = await tools.call(name, input, id);
      controller.abort();
      return result;
    },
    { definitions: tools.call.definitions, assertActive: tools.call.assertActive }
  );
  await assert.rejects(
    providers.generateOwnedGameplay(
      OWNED_SETTINGS.router,
      'p',
      SCHEMA,
      's',
      dispatch,
      controller.signal
    ),
    /cancel/i
  );
  assert.equal(dispatched, 1);
  assert.equal(http.calls.length, 1);
});

test('refusals, truncation, empty and malformed output are explicit failures', async () => {
  const cases: [string, unknown, RegExp][] = [
    ['router', routerReply({ content: '{"a":1' }, 'length'), /cut off/],
    ['router', routerReply({ content: null, refusal: 'no' }), /refused/],
    ['router', routerReply({ content: '   ' }), /no content/],
    ['router', routerReply({ content: 'prose' }), /required JSON/],
    ['router', { error: { message: 'x' }, choices: [{ message: {} }] }, /error for this request/],
    ['gemini', { promptFeedback: { blockReason: 'SAFETY' } }, /blocked/],
    ['gemini', geminiReply([{ text: '{}' }], 'MAX_TOKENS'), /cut off/],
    ['gemini', geminiReply([{ text: '{}' }], 'SAFETY'), /did not complete/],
    ['gemini', { candidates: [{ finishReason: 'STOP' }] }, /no content/],
  ];
  for (const [which, reply, message] of cases) {
    const { providers } = service([reply]);
    await assert.rejects(
      providers.generate(
        which === 'router' ? OWNED_SETTINGS.router : OWNED_SETTINGS.gemini,
        'p',
        SCHEMA
      ),
      message
    );
  }
});

test('an API failure never switches provider or model', async () => {
  const { http, providers } = service([{ choices: [] }]);
  await assert.rejects(
    providers.generate(OWNED_SETTINGS.router, 'p', SCHEMA),
    /unexpected response/
  );
  assert.equal(http.calls.length, 1);
  assert.equal(http.calls[0]!.body.model, 'vendor/router-test');
});

test('editor effort for API models is the default (null) and non-null effort is rejected', async () => {
  const { providers } = service([]);
  assert.deepEqual(
    await providers.narrativeEditorSettings(OWNED_SETTINGS.gemini),
    OWNED_SETTINGS.gemini
  );
  await assert.rejects(
    providers.capacity({ ...OWNED_SETTINGS.router, effort: 'high' }),
    /Effort is not supported/
  );
  await assert.rejects(
    providers.capacity({ ...OWNED_SETTINGS.router, model: 'unlisted' }),
    /verified model/
  );
});

test('OpenRouter falls down the configured list on availability failures, in order and stickily', async () => {
  const fallbackEnv = { ...ENV, OPENROUTER_MODELS: 'vendor/a,vendor/b,openrouter/free' };
  const http = scripted([
    { httpStatus: 429 },
    { httpStatus: 503 },
    routerReply({ content: '{"ok":1}' }),
    routerReply({ content: '{"ok":2}' }),
  ]);
  const providers = new ApiOnlyProviders({ fetch: http.fetchImpl, env: fallbackEnv });
  const t = await traced();
  try {
    const settings = { ...OWNED_SETTINGS.router, model: 'vendor/a' };
    assert.deepEqual(await providers.generate(settings, 'p', SCHEMA, undefined, t.context), {
      ok: 1,
    });
    assert.deepEqual(
      http.calls.map((call) => call.body.model),
      ['vendor/a', 'vendor/b', 'openrouter/free']
    );
    const fallbacks = (await t.events()).filter((e) => e.kind === 'model_fallback');
    assert.deepEqual(
      fallbacks.map((e) => [e.payload.from, e.payload.to, e.payload.code]),
      [
        ['vendor/a', 'vendor/b', 'provider_quota'],
        ['vendor/b', 'openrouter/free', 'provider_failure'],
      ]
    );
    // The next call starts from the selected model again; fallback is per generation.
    assert.deepEqual(await providers.generate(settings, 'p', SCHEMA), { ok: 2 });
    assert.equal(http.calls[3]!.body.model, 'vendor/a');
  } finally {
    await t.done();
  }
});

test('OpenRouter never falls back on authentication, cancellation or when nothing is left', async () => {
  const fallbackEnv = { ...ENV, OPENROUTER_MODELS: 'vendor/a,vendor/b' };
  const auth = scripted([{ httpStatus: 401 }, routerReply({ content: '{}' })]);
  await assert.rejects(
    new ApiOnlyProviders({ fetch: auth.fetchImpl, env: fallbackEnv }).generate(
      { ...OWNED_SETTINGS.router, model: 'vendor/a' },
      'p',
      SCHEMA
    ),
    /API key/
  );
  assert.equal(auth.calls.length, 1);
  const last = scripted([{ httpStatus: 429 }]);
  await assert.rejects(
    new ApiOnlyProviders({ fetch: last.fetchImpl, env: fallbackEnv }).generate(
      { ...OWNED_SETTINGS.router, model: 'vendor/b' },
      'p',
      SCHEMA
    ),
    /quota/
  );
  assert.equal(last.calls.length, 1);
  const controller = new AbortController();
  controller.abort();
  const none = scripted([]);
  await assert.rejects(
    new ApiOnlyProviders({ fetch: none.fetchImpl, env: fallbackEnv }).generate(
      { ...OWNED_SETTINGS.router, model: 'vendor/a' },
      'p',
      SCHEMA,
      controller.signal
    ),
    /cancel/i
  );
  assert.equal(none.calls.length, 0);
});

test('a fallback model mid-conversation continues the tool history without the previous model reasoning', async () => {
  const fallbackEnv = { ...ENV, OPENROUTER_MODELS: 'vendor/a,vendor/b' };
  const http = scripted([
    routerReply(
      {
        reasoning_details: [{ data: 'opaque' }],
        tool_calls: [routerCall('c1', 'campaign_knowledge_search', { query: 'a' })],
      },
      'tool_calls'
    ),
    { httpStatus: 503 },
    routerReply({ content: JSON.stringify(FINAL) }),
  ]);
  const providers = new ApiOnlyProviders({ fetch: http.fetchImpl, env: fallbackEnv });
  const tools = ownedTools();
  const result = await providers.generateOwnedGameplay(
    { ...OWNED_SETTINGS.router, model: 'vendor/a' },
    'p',
    SCHEMA,
    's',
    tools.call
  );
  assert.deepEqual(result, FINAL);
  assert.deepEqual(
    http.calls.map((call) => call.body.model),
    ['vendor/a', 'vendor/a', 'vendor/b']
  );
  const history = http.calls[2]!.body.messages;
  assert.equal(history[2].reasoning_details, undefined);
  assert.equal(history[3].role, 'tool');
});
