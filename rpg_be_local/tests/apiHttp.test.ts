import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postJson } from '../src/providers/apiHttp.js';

const base = { provider: 'Fixture', headers: { 'x-key': 'SECRET' }, body: { a: 1 } };
const reply = (status: number, body: string) => async () => new Response(body, { status });

test('requests go only to the official https hosts and refuse redirects', async () => {
  let init: RequestInit | undefined;
  const result = await postJson({
    ...base,
    url: 'https://openrouter.ai/api/v1/chat/completions',
    fetchImpl: async (_url, options) => {
      init = options;
      return new Response('{"ok":true}');
    },
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(init?.redirect, 'error');
  assert.equal((init?.headers as Record<string, string>)['x-key'], 'SECRET');
  for (const url of ['http://openrouter.ai/x', 'https://evil.example/x'])
    await assert.rejects(
      postJson({ ...base, url, fetchImpl: reply(200, '{}') }),
      /official endpoints/
    );
});

test('status failures are classified without leaking the key or the response body', async () => {
  const cases: [number, RegExp][] = [
    [401, /API key/],
    [429, /quota/],
    [404, /model/],
    [400, /rejected the request/],
    [503, /HTTP 503/],
  ];
  for (const [status, message] of cases) {
    const error = await postJson({
      ...base,
      url: 'https://openrouter.ai/api/v1/chat/completions',
      fetchImpl: reply(status, 'echo SECRET prompt text'),
    }).catch((e: Error) => e);
    assert.match((error as Error).message, message);
    assert.doesNotMatch((error as Error).message, /SECRET|prompt text/);
  }
});

test('invalid JSON, network failure and cancellation are explicit and distinct', async () => {
  const url = 'https://openrouter.ai/api/v1/chat/completions';
  await assert.rejects(
    postJson({ ...base, url, fetchImpl: reply(200, 'not json') }),
    /invalid JSON/
  );
  await assert.rejects(
    postJson({
      ...base,
      url,
      fetchImpl: async () => {
        throw new TypeError('socket SECRET');
      },
    }),
    (error: Error) => /could not be reached/.test(error.message) && !/SECRET/.test(error.message)
  );
  const controller = new AbortController();
  controller.abort();
  let called = false;
  await assert.rejects(
    postJson({
      ...base,
      url,
      signal: controller.signal,
      fetchImpl: async () => {
        called = true;
        return new Response('{}');
      },
    }),
    /cancelled/
  );
  assert.equal(called, false);
  const inFlight = new AbortController();
  await assert.rejects(
    postJson({
      ...base,
      url,
      signal: inFlight.signal,
      fetchImpl: (_url, options) =>
        new Promise((_resolve, reject) => {
          options!.signal!.addEventListener('abort', () =>
            reject(new DOMException('x', 'AbortError'))
          );
          queueMicrotask(() => inFlight.abort());
        }),
    }),
    /cancelled/
  );
});
