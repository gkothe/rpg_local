import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  API_MODEL_INPUT_TOKENS,
  parseApiModelList,
  readApiConfiguration,
  withoutApiCredentials,
} from '../src/providers/apiConfig.js';
import { API_PROVIDER_ID } from '../src/providers/options.js';

test('model lists are comma-separated, trimmed and independent per provider', () => {
  const env = {
    GEMINI_API_KEY: 'gemini-secret',
    GEMINI_MODELS: ' gemini-2.5-pro , gemini-2.5-flash ,, ',
    OPENROUTER_API_KEY: 'router-secret',
    OPENROUTER_MODELS: 'anthropic/claude-sonnet-4.5,meta-llama/llama-3.3-70b-instruct:free',
  };
  const gemini = readApiConfiguration(API_PROVIDER_ID.Gemini, env);
  const router = readApiConfiguration(API_PROVIDER_ID.OpenRouter, env);
  assert.deepEqual(gemini.models, ['gemini-2.5-pro', 'gemini-2.5-flash']);
  assert.deepEqual(router.models, [
    'anthropic/claude-sonnet-4.5',
    'meta-llama/llama-3.3-70b-instruct:free',
  ]);
  assert.equal(gemini.reason, null);
  assert.equal(router.reason, null);
  assert.ok(API_MODEL_INPUT_TOKENS > 0);
});

test('missing key or models disables only the affected provider with an actionable reason', () => {
  const env = { OPENROUTER_API_KEY: 'router-secret', OPENROUTER_MODELS: 'a/b' };
  const gemini = readApiConfiguration(API_PROVIDER_ID.Gemini, env);
  assert.match(gemini.reason!, /GEMINI_API_KEY/);
  assert.deepEqual(gemini.models, []);
  assert.equal(readApiConfiguration(API_PROVIDER_ID.OpenRouter, env).reason, null);

  const noModels = readApiConfiguration(API_PROVIDER_ID.Gemini, { GEMINI_API_KEY: 'k' });
  assert.match(noModels.reason!, /GEMINI_MODELS/);
  assert.deepEqual(noModels.models, []);
});

test('invalid or duplicate model ids fail the provider and diagnostics never contain the key', () => {
  assert.equal(parseApiModelList('ok,bad id').invalid !== null, true);
  assert.equal(parseApiModelList('same,same').invalid !== null, true);
  assert.deepEqual(parseApiModelList('').models, []);
  for (const models of ['ok,bad id', 'same,same']) {
    const config = readApiConfiguration(API_PROVIDER_ID.Gemini, {
      GEMINI_API_KEY: 'super-secret-value',
      GEMINI_MODELS: models,
    });
    assert.deepEqual(config.models, []);
    assert.match(config.reason!, /GEMINI_MODELS/);
    assert.doesNotMatch(config.reason!, /super-secret-value/);
  }
});

test('child process environments drop API credentials and keep everything else', () => {
  const clean = withoutApiCredentials({
    GEMINI_API_KEY: 'a',
    OPENROUTER_API_KEY: 'b',
    GEMINI_MODELS: 'm',
    PATH: 'p',
  });
  assert.deepEqual(clean, { GEMINI_MODELS: 'm', PATH: 'p' });
});
