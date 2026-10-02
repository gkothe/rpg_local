import { test } from 'node:test';
import assert from 'node:assert/strict';
import { providerArgs, parseProviderOutput } from '../src/providers/adapters.js';
import { runProcess } from '../src/providers/processRunner.js';
import { agentDefinition, parseModelCatalog, modelSlug } from '../src/providers/antigravity.js';
import { responseJsonSchema } from '../src/domain/schemas.js';
import { ProviderService, type Provider } from '../src/providers/service.js';

test('gameplay rejects provider and model dice gates without disabling no-tools capacity', async () => {
  class FixtureProviders extends ProviderService {
    provider: Provider = {
      id: 'codex',
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
  assert.equal(await service.capacity(settings), 4800);
  await assert.rejects(service.gameplayCapacity(settings), /Unverified dice/);
  service.provider.dice = { supported: true, reason: null };
  await assert.rejects(service.gameplayCapacity(settings), /Unverified model/);
  service.provider.models[0]!.dice = { supported: true, reason: null };
  assert.equal(await service.gameplayCapacity(settings), 4800);
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
      JSON.stringify({ structured_output: { version: 1, narrative: 'Hi', operations: [] } })
    ),
    { version: 1, narrative: 'Hi', operations: [] }
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
    /CLI reported/
  );
  assert.throws(() => parseProviderOutput('agy', 'not json'), /JSON/);
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

test('Antigravity excludes ambient customizations and parses only one bounded isolated result', () => {
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
  assert.throws(
    () => parseProviderOutput('agy', output({ ...result, usage: { input_tokens: 16001 } })),
    /envelope/
  );
  assert.throws(
    () => parseProviderOutput('agy', output({ ...result, status: 'ERROR' })),
    /isolated/
  );
});

test('rules capability is independent, requires its verified effort and preserves existing default/no-tools reserves', async () => {
  class FixtureProviders extends ProviderService {
    provider: Provider = {
      id: 'codex',
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
          efforts: ['low', 'medium'],
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
  assert.equal(await service.capacity(settings), 4800);
  assert.equal(await service.gameplayCapacity(settings), 4800);
  await assert.rejects(service.bookGameplayCapacity(settings), /Unverified rules model/);
  service.provider.rules = { supported: true, reason: null };
  service.provider.models[0]!.rules = {
    supported: true,
    reason: null,
    efforts: ['medium'],
    limits: { ruleCalls: 12, diceCalls: 12, combinedCalls: 24, promptBytes: 8000 },
  };
  assert.equal(await service.bookGameplayCapacity(settings), 8000);
  assert.equal(await service.bookGameplayCapacity(settings, 7000), 7000);
  await assert.rejects(
    service.bookGameplayCapacity({ ...settings, effort: 'low' }),
    /only with medium effort/
  );
  assert.equal(await service.capacity(settings), 4800);
  assert.deepEqual(await service.bookGameplayLimits(settings), {
    ruleCalls: 12,
    diceCalls: 12,
    combinedCalls: 24,
    promptBytes: 8000,
  });
});
