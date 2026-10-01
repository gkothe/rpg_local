import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startDiceMcp } from '../src/providers/diceMcp.js';

test('private MCP exposes only dice, serializes calls and closes its listener', async () => {
  let active = 0;
  let peak = 0;
  let calls = 0;
  const server = await startDiceMcp(async () => {
    calls++;
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active--;
    return {
      rollId: '12345678-1234-4234-8234-123456789012',
      slot: 0,
      groups: [{ label: 'check', sides: 6, faces: [4] }],
      reused: false,
    };
  });
  const client = new Client({ name: 'dice-test', version: '1' });
  try {
    const unauthenticated = await fetch(server.url, { method: 'POST', body: '{}' });
    assert.equal(unauthenticated.status, 401);
    assert.equal(
      (
        await fetch(server.url, {
          method: 'POST',
          headers: { ...server.headers, origin: 'http://127.0.0.1:4100' },
          body: '{}',
        })
      ).status,
      403
    );
    assert.equal(
      (await fetch(server.url, { method: 'POST', headers: server.headers, body: 'x'.repeat(5000) }))
        .status,
      413
    );
    await client.connect(
      new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit: { headers: server.headers },
      })
    );
    assert.deepEqual(
      (await client.listTools()).tools.map((tool) => tool.name),
      ['roll_dice']
    );
    await assert.rejects(client.listResources(), /support|method/i);
    await assert.rejects(client.listPrompts(), /support|method/i);
    const bad = await client.callTool({ name: 'shell', arguments: { command: 'whoami' } });
    assert.equal(bad.isError, true);
    // Intentional concurrency proof: the application handler remains sequential.
    const replies = await Promise.all([
      client.callTool({ name: 'roll_dice', arguments: {} }),
      client.callTool({ name: 'roll_dice', arguments: {} }),
    ]);
    assert.equal(replies.length, 2);
    assert.equal(peak, 1);
    const rpc = async (arguments_: unknown) => {
      const response = await fetch(server.url, {
        method: 'POST',
        headers: {
          ...server.headers,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'duplicate',
          method: 'tools/call',
          params: { name: 'roll_dice', arguments: arguments_ },
        }),
      });
      return response.json() as Promise<{ result: { isError?: boolean } }>;
    };
    await rpc({ slot: 0 });
    await rpc({ slot: 0 });
    assert.equal(calls, 3);
    assert.equal((await rpc({ slot: 1 })).result.isError, true);
    assert.equal(calls, 3);
  } finally {
    await client.close();
    await server.close();
  }
  await assert.rejects(fetch(server.url));
});

test('aborting an attempt closes MCP access and request exhaustion prevents another roll', async () => {
  const controller = new AbortController();
  let calls = 0;
  const server = await startDiceMcp(async () => {
    calls++;
    return {
      rollId: '12345678-1234-4234-8234-123456789012',
      slot: 0,
      groups: [{ label: 'check', sides: 6, faces: [4] }],
      reused: false,
    };
  }, controller.signal);
  const client = new Client({ name: 'dice-cap-test', version: '1' });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit: { headers: server.headers },
      })
    );
    for (let i = 0; i < 24; i++)
      await client.callTool({ name: 'roll_dice', arguments: { slot: i } });
    assert.equal(
      (await client.callTool({ name: 'roll_dice', arguments: { slot: 25 } })).isError,
      true
    );
    assert.equal(calls, 24);
    controller.abort();
    await server.close();
    await assert.rejects(fetch(server.url));
  } finally {
    await client.close();
    await server.close();
  }
});
