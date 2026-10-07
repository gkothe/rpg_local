import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import { startGameplayMcp } from '../src/providers/gameplayMcp.js';
import { ownedTools } from './ownedGameplayFixture.js';

const definitions = ownedTools().definitions;
test('private MCP exposes only owned tools, serializes calls and closes its listener', async () => {
  let active = 0;
  let peak = 0;
  let calls = 0;
  const server = await startGameplayMcp(definitions, async () => {
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
      (
        await fetch(server.url, {
          method: 'POST',
          headers: server.headers,
          body: 'x'.repeat(1_200_000),
        }).catch((error: unknown) => {
          if ((error as { cause?: { code?: string } }).cause?.code === 'ECONNRESET')
            return { status: 413 };
          throw error;
        })
      ).status,
      413
    );
    await client.connect(
      new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit: { headers: server.headers },
      })
    );
    assert.deepEqual(
      (await client.listTools()).tools.map((tool) => tool.name),
      definitions.map((definition) => definition.name)
    );
    assert.deepEqual((await client.listResources()).resources, []);
    assert.deepEqual((await client.listResourceTemplates()).resourceTemplates, []);
    assert.equal(calls, 0);
    await assert.rejects(client.readResource({ uri: 'file:///private' }), /support|method/i);
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
    assert.equal(calls, 2);
  } finally {
    await client.close();
    await server.close();
  }
  await assert.rejects(fetch(server.url));
});

test('MCP permits continued tool calls and aborting an attempt closes access', async () => {
  const controller = new AbortController();
  let calls = 0;
  const server = await startGameplayMcp(
    definitions,
    async () => {
      calls++;
      return {
        rollId: '12345678-1234-4234-8234-123456789012',
        slot: 0,
        groups: [{ label: 'check', sides: 6, faces: [4] }],
        reused: false,
      };
    },
    controller.signal
  );
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
      undefined
    );
    assert.equal(calls, 25);
    controller.abort();
    await server.close();
    await assert.rejects(fetch(server.url));
  } finally {
    await client.close();
    await server.close();
  }
});

test('MCP accepts large combat batches only for combat_prepare and keeps other tool ceilings', async () => {
  const calls: string[] = [];
  const roll = async () => ({ rollId: randomUUID(), slot: 0, groups: [], reused: false });
  const tools = ownedTools({
    roll,
    prepareCombat: async () => {
      calls.push('combat_prepare');
      return { receiptId: randomUUID() };
    },
  });
  const draft = (bytes: number) => ({
    localKey: `guard-${bytes}`,
    label: 'Guard',
    character: {
      name: 'Guard',
      type: 'npc',
      attributes: { health: 0 },
      inventory: {},
      description: { history: 'x'.repeat(bytes) },
    },
    introduction: { origin: 'gm', evidence: [], visibility: 'player' },
    trackedFields: [{ path: ['health'], kind: 'damage', label: 'Health' }],
  });
  const batch = (bytes: number) => ({
    localKey: 'fight',
    participants: [draft(bytes), draft(bytes + 1)],
  });
  let rpcId = 0;
  const rpc = async (url: string, headers: Record<string, string>, name: string, args: unknown) => {
    // A body over the ceiling is refused before parsing; the server may reset the upload.
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...headers,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: ++rpcId,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    }).catch((error: unknown) => {
      if ((error as { cause?: { code?: string } }).cause?.code === 'ECONNRESET')
        return { status: 413 };
      throw error;
    });
    return response.status === 200
      ? ((await (response as Response).json()) as {
          result: { isError?: boolean; content: { text: string }[] };
        })
      : response.status;
  };
  const endpoint = await startGameplayMcp(tools.definitions, tools.call);
  try {
    // Two multi-kilobyte drafts exceed the 1 024-byte argument ceiling of the other tools.
    const accepted = await rpc(endpoint.url, endpoint.headers, 'combat_prepare', batch(3000));
    assert.notEqual(typeof accepted, 'number');
    assert.equal((accepted as { result: { isError?: boolean } }).result.isError, undefined);
    assert.deepEqual(calls, ['combat_prepare']);
    // Multibyte text counts in UTF-8 bytes, not JavaScript string length: each wide draft has
    // ~270K characters (540 KB); two of them stay under 1 MiB characters but exceed 1 MiB bytes.
    const text = 'é'.repeat(90_000);
    const wide = (localKey: string) => ({
      ...draft(0),
      localKey,
      character: {
        ...draft(0).character,
        description: { history: text },
        inventory: { notes: text },
        attributes: { health: 0, background: text },
      },
    });
    const one = await rpc(endpoint.url, endpoint.headers, 'combat_prepare', {
      localKey: 'wide',
      participants: [wide('a')],
    });
    assert.equal((one as { result: { isError?: boolean } }).result.isError, undefined);
    assert.equal(calls.length, 2);
    const two = await rpc(endpoint.url, endpoint.headers, 'combat_prepare', {
      localKey: 'wider',
      participants: [wide('a'), wide('b')],
    });
    assert.equal((two as { result: { isError?: boolean } }).result.isError, true);
    assert.equal(calls.length, 2);
    assert.equal(
      await rpc(endpoint.url, endpoint.headers, 'combat_prepare', batch(1_100_000)),
      413
    );
    // Other owned tools keep their 1 024-byte argument ceiling.
    const bigDice = await rpc(endpoint.url, endpoint.headers, 'roll_dice', {
      slot: 0,
      groups: [{ label: 'x', count: 1, sides: 6 }],
      reason: 'x'.repeat(2000),
      declaration: 'x',
    });
    assert.equal(
      (bigDice as { result: { isError?: boolean; content: { text: string }[] } }).result.isError,
      true
    );
    assert.match(
      (bigDice as { result: { content: { text: string }[] } }).result.content[0]!.text,
      /byte limit/
    );
    const foreign = await rpc(endpoint.url, endpoint.headers, 'shell', {
      command: 'x'.repeat(3000),
    });
    assert.notEqual(
      typeof foreign,
      'number',
      `foreign tools are refused, not size-limited: ${String(foreign)}`
    );
    const refused = foreign as { result?: { isError?: boolean }; error?: unknown };
    assert.ok(refused.result?.isError === true || refused.error, JSON.stringify(foreign));
    assert.equal(calls.length, 2);
  } finally {
    await endpoint.close();
  }
});
