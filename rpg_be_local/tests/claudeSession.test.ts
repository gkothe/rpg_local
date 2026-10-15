import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateClaudeDice } from '../src/providers/claudeDice.js';
import { GameplaySessionBridge } from '../src/providers/gameplaySession.js';
import { Problem } from '../src/errors.js';
import type { GameplayToolDispatch } from '../src/providers/gameplayTools.js';

const fixture = `
import readline from 'node:readline';
import fs from 'node:fs';
import http from 'node:http';

function callMcp(srv, payload) {
  return new Promise((resolve, reject) => {
    const u = new URL(srv.url);
    const bodyStr = JSON.stringify(payload);
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      method: 'POST',
      headers: {
        ...srv.headers,
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Content-Length': Buffer.byteLength(bodyStr),
        'Connection': 'close',
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : null);
        } catch {
          resolve(data);
        }
      });
    });
    req.on('error', reject);
    req.end(bodyStr);
  });
}

const args = process.argv.slice(2);
const mode = process.env.RPG_CLAUDE_TEST_MODE ?? 'normal';
const logPath = process.env.RPG_CLAUDE_LOG_PATH;
const tools = args[args.indexOf('--allowedTools') + 1]?.split(',') ?? [];
const mcpConfigRaw = args[args.indexOf('--mcp-config') + 1];
const mcpConfig = mcpConfigRaw ? JSON.parse(mcpConfigRaw) : null;
const sessionId = args[args.indexOf('--session-id') + 1];
const server = mcpConfig?.mcpServers?.dice;

console.log(JSON.stringify({
  type: 'system',
  subtype: 'init',
  session_id: sessionId,
  tools,
  mcp_servers: [{ name: 'dice', status: 'connected' }],
}));

let turnCount = 0;
const rl = readline.createInterface({ input: process.stdin });

rl.on('close', () => {
  process.exit(0);
});

rl.on('line', async raw => {
  try {
    // F001 regression: parse stdin line ONCE and require an object with type=user/message.content.
    // Double-encoded strings will produce a string primitive and fail here.
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Expected JSON object on stdin, got: ' + typeof parsed);
    }
    if (parsed.type !== 'user' || typeof parsed.message?.content !== 'string') {
      throw new Error('Expected user message object with content string, got: ' + raw);
    }
    turnCount++;
    if (logPath) {
      fs.appendFileSync(logPath, JSON.stringify({ turn: turnCount, content: parsed.message.content }) + '\\n');
    }

  if (turnCount === 1) {
    if (server) {
      if (mode === 'mcp_replay') {
        // F004: Duplicate same-ID/same-arguments call executes underlying gameplay handler once
        const json1 = await callMcp(server, {
          jsonrpc: '2.0',
          id: 101,
          method: 'tools/call',
          params: { name: 'roll_dice', arguments: { slot: 0 } },
        });
        if (logPath) fs.appendFileSync(logPath, JSON.stringify({ mcp_call: 'call1', result: json1 }) + '\\n');

        // Replay with identical RPC ID and identical arguments
        const json2 = await callMcp(server, {
          jsonrpc: '2.0',
          id: 101,
          method: 'tools/call',
          params: { name: 'roll_dice', arguments: { slot: 0 } },
        });
        if (logPath) fs.appendFileSync(logPath, JSON.stringify({ mcp_call: 'call2', result: json2 }) + '\\n');

        // Changed arguments under the same RPC ID must reject
        const json3 = await callMcp(server, {
          jsonrpc: '2.0',
          id: 101,
          method: 'tools/call',
          params: { name: 'roll_dice', arguments: { slot: 99 } },
        });
        if (logPath) fs.appendFileSync(logPath, JSON.stringify({ mcp_call: 'call3', result: json3 }) + '\\n');
      } else {
        await callMcp(server, {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'roll_dice', arguments: { slot: 0 } },
        });
      }
    }
    console.log(JSON.stringify({
      type: 'assistant',
      session_id: mode === 'foreign_assistant' ? 'foreign-session-uuid' : sessionId,
      uuid: 'asst-1',
      message: { content: [{ type: 'tool_use', name: 'mcp__dice__roll_dice', input: { slot: 0 } }] },
    }));
    console.log(JSON.stringify({
      type: 'result',
      subtype: 'success',
      session_id: mode === 'foreign_result' ? 'foreign-session-uuid' : sessionId,
      uuid: 'res-1',
      is_error: false,
      num_turns: turnCount,
      result: JSON.stringify({ narrative: 'Claude turn 1', operations: [], rollInterpretations: [] }),
      modelUsage: { fixture: { contextWindow: 128000, outputTokens: 100 } },
    }));
    if (mode === 'idle_call' && server) {
      await callMcp(server, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'roll_dice', arguments: { slot: 0 } },
      });
    }
  } else if (turnCount === 2) {
    if (mode === 'duplicate_result') {
      console.log(JSON.stringify({
        type: 'result',
        subtype: 'success',
        session_id: sessionId,
        uuid: 'res-1',
        is_error: false,
        num_turns: turnCount,
        result: JSON.stringify({ checked: { notes: true }, gmIndexChanges: [], gmFoundationChanges: [] }),
        modelUsage: { fixture: { contextWindow: 128000, outputTokens: 100 } },
      }));
    } else if (mode === 'forbidden_tool') {
      console.log(JSON.stringify({
        type: 'assistant',
        session_id: sessionId,
        uuid: 'asst-2',
        message: { content: [{ type: 'tool_use', name: 'mcp__dice__roll_dice', input: { slot: 0 } }] },
      }));
    } else if (mode === 'correction_flow') {
      // First attempt returns invalid output to trigger correction
      console.log(JSON.stringify({
        type: 'result',
        subtype: 'success',
        session_id: sessionId,
        uuid: 'res-2-invalid',
        is_error: false,
        num_turns: turnCount,
        result: JSON.stringify({ unexpected: 'invalid' }),
        modelUsage: { fixture: { contextWindow: 128000, outputTokens: 100 } },
      }));
    } else {
      if (server) {
        if (mode === 'mcp_replay') {
          // F004: Same native RPC ID in a later phase is allowed and does NOT conflict with phase 1
          const json4 = await callMcp(server, {
            jsonrpc: '2.0',
            id: 101, // same native RPC ID as phase 1!
            method: 'tools/call',
            params: { name: 'history_get', arguments: { id: 'h1' } },
          });
          if (logPath) fs.appendFileSync(logPath, JSON.stringify({ mcp_call: 'call4', result: json4 }) + '\\n');
        } else {
          await callMcp(server, {
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/call',
            params: { name: 'history_get', arguments: { id: 'h1' } },
          });
        }
      }
      console.log(JSON.stringify({
        type: 'assistant',
        session_id: sessionId,
        uuid: 'asst-2',
        message: { content: [{ type: 'tool_use', name: 'mcp__dice__history_get', input: { id: 'h1' } }] },
      }));
      // F003: Output direct application JSON by default, or envelope when in envelope_mode
      const outputResult = mode === 'envelope_mode'
        ? JSON.stringify({ payload_json: JSON.stringify({ checked: { notes: true }, gmIndexChanges: [], gmFoundationChanges: [] }) })
        : JSON.stringify({ checked: { notes: true }, gmIndexChanges: [], gmFoundationChanges: [] });
      console.log(JSON.stringify({
        type: 'result',
        subtype: 'success',
        session_id: sessionId,
        uuid: 'res-2',
        is_error: false,
        num_turns: turnCount,
        result: outputResult,
        modelUsage: { fixture: { contextWindow: 128000, outputTokens: 100 } },
      }));
    }
  } else if (turnCount === 3) {
    // Correction attempt turn: returns valid application JSON
    console.log(JSON.stringify({
      type: 'result',
      subtype: 'success',
      session_id: sessionId,
      uuid: 'res-3',
      is_error: false,
      num_turns: turnCount,
      result: JSON.stringify({ checked: { notes: true }, gmIndexChanges: [], gmFoundationChanges: [] }),
      modelUsage: { fixture: { contextWindow: 128000, outputTokens: 100 } },
    }));
  }
  } catch (err) {
    if (logPath) {
      fs.appendFileSync(logPath, JSON.stringify({ error: String(err?.stack ?? err) }) + '\\n');
    }
    process.exit(1);
  }
});
`;

test('Claude session driver: multi-phase continuation with direct stdin objects (F001), schema delivery (F002), and direct index shape (F003)', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rpg-claude-sess-'));
  const file = path.join(root, 'cli.mjs');
  const logFile = path.join(root, 'claude-stdin.log');
  await writeFile(file, fixture);

  const bridge = new GameplaySessionBridge();
  let diceCalled = 0;
  let historyCalled = 0;

  const phase1Schema = {
    type: 'object' as const,
    properties: {
      narrative: { type: 'string' as const },
      operations: { type: 'array' as const },
    },
    required: ['narrative'],
  };

  const phase2Schema = {
    type: 'object' as const,
    properties: {
      checked: { type: 'object' as const },
      gmIndexChanges: { type: 'array' as const },
      gmFoundationChanges: { type: 'array' as const },
    },
    required: ['checked'],
  };

  const phase1Tools: GameplayToolDispatch = Object.assign(
    async (tool: string) => {
      if (tool === 'roll_dice') diceCalled++;
      return { ok: true };
    },
    {
      definitions: [
        {
          name: 'roll_dice',
          description: 'Roll dice',
          inputSchema: { type: 'object' as const, properties: { slot: { type: 'number' } } },
        },
        {
          name: 'history_get',
          description: 'Get history',
          inputSchema: { type: 'object' as const, properties: { id: { type: 'string' } } },
        },
      ],
    }
  );

  const phase2Tools: GameplayToolDispatch = Object.assign(
    async (tool: string) => {
      if (tool === 'history_get') historyCalled++;
      return { id: 'h1', text: 'sample' };
    },
    {
      definitions: [
        {
          name: 'history_get',
          description: 'Get history',
          inputSchema: { type: 'object' as const, properties: { id: { type: 'string' } } },
        },
      ],
    }
  );

  let driverPromise: Promise<unknown> | undefined;
  try {
    driverPromise = generateClaudeDice(
      { binary: process.execPath, prefix: [file] },
      { provider: 'claude', model: 'fixture', effort: null },
      'Turn 1 prompt',
      root,
      { ...process.env, RPG_CLAUDE_TEST_MODE: 'normal', RPG_CLAUDE_LOG_PATH: logFile },
      {
        dispatch: phase1Tools,
        definitions: phase1Tools.definitions!,
        schema: phase1Schema,
        systemPrompt: 'System GM',
      },
      undefined,
      undefined,
      bridge
    );

    const r1 = (await bridge.runPhase({
      prompt: 'Turn 1 prompt',
      schema: phase1Schema,
      systemPrompt: 'System GM',
      tools: phase1Tools,
    })) as { narrative: string };

    assert.equal(r1.narrative, 'Claude turn 1');
    assert.equal(diceCalled, 1);

    const r2 = (await bridge.runPhase({
      prompt: 'Turn 2 index prompt',
      schema: phase2Schema,
      systemPrompt: 'Index system',
      tools: phase2Tools,
    })) as { checked: { notes: boolean }; gmIndexChanges: unknown[] };

    assert.equal(r2.checked.notes, true);
    assert.ok(Array.isArray(r2.gmIndexChanges));
    assert.equal(historyCalled, 1);

    bridge.close();
    await driverPromise;

    // F001 & F002 assertions from recorded stdin lines
    const logLines = (await readFile(logFile, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(logLines.length, 2);

    // Turn 1 content
    assert.equal(logLines[0].turn, 1);
    assert.equal(logLines[0].content, 'Turn 1 prompt');
    assert.equal(logLines[0].content.includes('gmIndexChanges'), false);

    // Turn 2 content: F002 proves Phase 2 schema is present on continuation
    assert.equal(logLines[1].turn, 2);
    assert.match(logLines[1].content, /Application schema: /);
    assert.match(logLines[1].content, /"checked"/);
    assert.match(logLines[1].content, /"gmIndexChanges"/);
    // F003 proves instruction asks for valid JSON matching schema, not payload_json
    assert.match(logLines[1].content, /Return only valid JSON matching the application schema/);
    assert.doesNotMatch(logLines[1].content, /payload_json/);
  } finally {
    bridge.close();
    await driverPromise?.catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test('Claude session driver: later corrections retain the current schema (F002)', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rpg-claude-sess-corr-'));
  const file = path.join(root, 'cli.mjs');
  const logFile = path.join(root, 'claude-stdin-corr.log');
  await writeFile(file, fixture);

  const bridge = new GameplaySessionBridge();

  const phase1Tools: GameplayToolDispatch = Object.assign(async () => ({ ok: true }), {
    definitions: [
      {
        name: 'roll_dice',
        description: 'Roll dice',
        inputSchema: { type: 'object' as const },
      },
    ],
  });

  const phase2Schema = {
    type: 'object' as const,
    properties: {
      checked: { type: 'object' as const },
      gmIndexChanges: { type: 'array' as const },
    },
    required: ['checked'],
  };

  const phase2Tools: GameplayToolDispatch = Object.assign(async () => ({ id: 'h1' }), {
    definitions: [],
  });

  let driverPromise: Promise<unknown> | undefined;
  try {
    driverPromise = generateClaudeDice(
      { binary: process.execPath, prefix: [file] },
      { provider: 'claude', model: 'fixture', effort: null },
      'Turn 1 prompt',
      root,
      { ...process.env, RPG_CLAUDE_TEST_MODE: 'correction_flow', RPG_CLAUDE_LOG_PATH: logFile },
      {
        dispatch: phase1Tools,
        definitions: phase1Tools.definitions!,
        schema: {},
        systemPrompt: 'System GM',
      },
      undefined,
      undefined,
      bridge
    );

    await bridge.runPhase({
      prompt: 'Turn 1 prompt',
      schema: {},
      systemPrompt: 'System GM',
      tools: phase1Tools,
    });

    // Phase 2 first attempt
    const r2Attempt = (await bridge.runPhase({
      prompt: 'Phase 2 initial index attempt',
      schema: phase2Schema,
      systemPrompt: 'Index system',
      tools: phase2Tools,
    })) as { unexpected?: string };
    assert.equal(r2Attempt.unexpected, 'invalid');

    // Phase 2 correction attempt on the same conversation
    const r2Correction = (await bridge.runPhase({
      prompt: 'Feedback: output was invalid, correct it',
      schema: phase2Schema,
      systemPrompt: 'Index system',
      tools: phase2Tools,
    })) as { checked: { notes: boolean } };
    assert.equal(r2Correction.checked.notes, true);

    bridge.close();
    await driverPromise;

    const logLines = (await readFile(logFile, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(logLines.length, 3);

    // Initial continuation prompt (Turn 2) has schema
    assert.match(logLines[1].content, /"checked"/);
    // Correction continuation prompt (Turn 3) retains the schema
    assert.match(logLines[2].content, /"checked"/);
    assert.match(logLines[2].content, /Feedback: output was invalid/);
  } finally {
    bridge.close();
    await driverPromise?.catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test('Claude session driver: envelope unwrap safely handles payload_json (F003)', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rpg-claude-sess-env-'));
  const file = path.join(root, 'cli.mjs');
  await writeFile(file, fixture);

  const bridge = new GameplaySessionBridge();

  const phase1Tools: GameplayToolDispatch = Object.assign(async () => ({ ok: true }), {
    definitions: [
      {
        name: 'roll_dice',
        description: 'Roll dice',
        inputSchema: { type: 'object' as const },
      },
      {
        name: 'history_get',
        description: 'Get history',
        inputSchema: { type: 'object' as const },
      },
    ],
  });

  const phase2Tools: GameplayToolDispatch = Object.assign(async () => ({ id: 'h1' }), {
    definitions: [
      {
        name: 'history_get',
        description: 'Get history',
        inputSchema: { type: 'object' as const },
      },
    ],
  });

  let driverPromise: Promise<unknown> | undefined;
  try {
    driverPromise = generateClaudeDice(
      { binary: process.execPath, prefix: [file] },
      { provider: 'claude', model: 'fixture', effort: null },
      'Turn 1 prompt',
      root,
      { ...process.env, RPG_CLAUDE_TEST_MODE: 'envelope_mode' },
      {
        dispatch: phase1Tools,
        definitions: phase1Tools.definitions!,
        schema: {},
        systemPrompt: 'System GM',
      },
      undefined,
      undefined,
      bridge
    );

    await bridge.runPhase({
      prompt: 'Turn 1 prompt',
      schema: {},
      systemPrompt: 'System GM',
      tools: phase1Tools,
    });

    const r2 = (await bridge.runPhase({
      prompt: 'Turn 2 prompt',
      schema: {},
      systemPrompt: 'Index system',
      tools: phase2Tools,
    })) as { checked: { notes: boolean }; gmIndexChanges: unknown[] };

    assert.equal(r2.checked.notes, true);
    assert.ok(Array.isArray(r2.gmIndexChanges));

    bridge.close();
    await driverPromise;
  } finally {
    bridge.close();
    await driverPromise?.catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test('Claude session driver: MCP request identity replay, conflict rejection, and phase-scoped namespacing (F004)', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rpg-claude-sess-mcp-'));
  const file = path.join(root, 'cli.mjs');
  const logFile = path.join(root, 'claude-mcp-replay.log');
  await writeFile(file, fixture);

  const bridge = new GameplaySessionBridge();
  let rollHandlerCalls = 0;
  let historyHandlerCalls = 0;

  // Dispatcher tracking calls and replay receipts
  const receipts = new Map<string, { identity: string; result: Record<string, unknown> }>();

  const trackDispatch = (
    name: string,
    input: unknown,
    requestId?: string | number
  ): Record<string, unknown> => {
    const key = JSON.stringify(requestId);
    const identity = JSON.stringify({ name, input });
    const existing = receipts.get(key);
    if (existing) {
      if (existing.identity !== identity) {
        throw new Problem(
          409,
          'gameplay_transport_conflict',
          'Transport identity reused with changed tool arguments'
        );
      }
      return existing.result;
    }
    let res: Record<string, unknown> = {};
    if (name === 'roll_dice') {
      rollHandlerCalls++;
      res = { rollId: 'r1', slot: 0 };
    } else if (name === 'history_get') {
      historyHandlerCalls++;
      res = { id: 'h1', text: 'data' };
    }
    receipts.set(key, { identity, result: res });
    return res;
  };

  const phase1Tools: GameplayToolDispatch = Object.assign(
    async (tool: string, input: unknown, reqId: string | number) =>
      trackDispatch(tool, input, reqId),
    {
      definitions: [
        {
          name: 'roll_dice',
          description: 'Roll dice',
          inputSchema: { type: 'object' as const, properties: { slot: { type: 'number' } } },
        },
        {
          name: 'history_get',
          description: 'Get history',
          inputSchema: { type: 'object' as const, properties: { id: { type: 'string' } } },
        },
      ],
    }
  );

  const phase2Tools: GameplayToolDispatch = Object.assign(
    async (tool: string, input: unknown, reqId: string | number) =>
      trackDispatch(tool, input, reqId),
    {
      definitions: [
        {
          name: 'history_get',
          description: 'Get history',
          inputSchema: { type: 'object' as const, properties: { id: { type: 'string' } } },
        },
      ],
    }
  );

  let driverPromise: Promise<unknown> | undefined;
  try {
    driverPromise = generateClaudeDice(
      { binary: process.execPath, prefix: [file] },
      { provider: 'claude', model: 'fixture', effort: null },
      'Turn 1 prompt',
      root,
      { ...process.env, RPG_CLAUDE_TEST_MODE: 'mcp_replay', RPG_CLAUDE_LOG_PATH: logFile },
      {
        dispatch: phase1Tools,
        definitions: phase1Tools.definitions!,
        schema: {},
        systemPrompt: 'System GM',
      },
      undefined,
      undefined,
      bridge
    );

    await bridge.runPhase({
      prompt: 'Turn 1 prompt',
      schema: {},
      systemPrompt: 'System GM',
      tools: phase1Tools,
    });

    await bridge.runPhase({
      prompt: 'Turn 2 prompt',
      schema: {},
      systemPrompt: 'Index system',
      tools: phase2Tools,
    });

    bridge.close();
    await driverPromise;

    // Verify MCP responses recorded by fixture
    const logLines = (await readFile(logFile, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
      .filter((entry) => entry.mcp_call);

    const call1 = logLines.find((e) => e.mcp_call === 'call1')?.result;
    const call2 = logLines.find((e) => e.mcp_call === 'call2')?.result;
    const call3 = logLines.find((e) => e.mcp_call === 'call3')?.result;
    const call4 = logLines.find((e) => e.mcp_call === 'call4')?.result;

    // Call 1 succeeded and called roll handler
    assert.equal(call1?.error, undefined);
    assert.equal(call1?.result?.isError, undefined);

    // Call 2 with SAME ID and SAME args replayed without calling handler again
    assert.equal(call2?.error, undefined);
    assert.equal(rollHandlerCalls, 1);

    // Call 3 with SAME ID and CHANGED args was rejected with conflict
    assert.ok(call3?.error || call3?.result?.isError);
    assert.match(JSON.stringify(call3), /gameplay_transport_conflict/);

    // Call 4 in Phase 2 with the SAME native RPC ID 101 succeeded because it was namespaced by phase!
    assert.equal(call4?.error, undefined);
    assert.equal(historyHandlerCalls, 1);
  } finally {
    bridge.close();
    await driverPromise?.catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test('Claude session driver: tool allowlisting rejects forbidden tool during index phase', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rpg-claude-sess-allow-'));
  const file = path.join(root, 'cli.mjs');
  await writeFile(file, fixture);

  const bridge = new GameplaySessionBridge();

  const phase1Tools: GameplayToolDispatch = Object.assign(async () => ({ ok: true }), {
    definitions: [
      {
        name: 'roll_dice',
        description: 'Roll dice',
        inputSchema: { type: 'object' as const, properties: { slot: { type: 'number' } } },
      },
      {
        name: 'history_get',
        description: 'Get history',
        inputSchema: { type: 'object' as const, properties: { id: { type: 'string' } } },
      },
    ],
  });

  const phase2Tools: GameplayToolDispatch = Object.assign(async () => ({ id: 'h1' }), {
    definitions: [
      {
        name: 'history_get',
        description: 'Get history',
        inputSchema: { type: 'object' as const, properties: { id: { type: 'string' } } },
      },
    ],
  });

  try {
    const driverPromise = generateClaudeDice(
      { binary: process.execPath, prefix: [file] },
      { provider: 'claude', model: 'fixture', effort: null },
      'Turn 1 prompt',
      root,
      { ...process.env, RPG_CLAUDE_TEST_MODE: 'forbidden_tool' },
      {
        dispatch: phase1Tools,
        definitions: phase1Tools.definitions!,
        schema: {},
        systemPrompt: 'System GM',
      },
      undefined,
      undefined,
      bridge
    );

    const r1 = (await bridge.runPhase({
      prompt: 'Turn 1 prompt',
      schema: {},
      systemPrompt: 'System GM',
      tools: phase1Tools,
    })) as { narrative: string };
    assert.equal(r1.narrative, 'Claude turn 1');

    await assert.rejects(
      bridge.runPhase({
        prompt: 'Turn 2 index prompt',
        schema: {},
        systemPrompt: 'Index system',
        tools: phase2Tools,
      }),
      (err: unknown) => err instanceof Problem && err.status === 422 && err.code === 'gm_index_tool'
    );

    await assert.rejects(driverPromise, /unavailable in the index phase/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Claude session driver: abort signal cleanly cancels process and closes MCP endpoint', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rpg-claude-sess-abort-'));
  const file = path.join(root, 'cli.mjs');
  await writeFile(
    file,
    `
import readline from 'node:readline';
const args = process.argv.slice(2);
const tools = args[args.indexOf('--allowedTools') + 1]?.split(',') ?? [];
const sessionId = args[args.indexOf('--session-id') + 1];
console.log(JSON.stringify({
  type: 'system',
  subtype: 'init',
  session_id: sessionId,
  tools,
  mcp_servers: [{ name: 'dice', status: 'connected' }],
}));
// Hangs without completing
readline.createInterface({ input: process.stdin });
`
  );

  const bridge = new GameplaySessionBridge();
  const controller = new AbortController();

  const phase1Tools: GameplayToolDispatch = Object.assign(async () => ({ ok: true }), {
    definitions: [
      {
        name: 'roll_dice',
        description: 'Roll dice',
        inputSchema: { type: 'object' as const },
      },
    ],
  });

  try {
    const driverPromise = generateClaudeDice(
      { binary: process.execPath, prefix: [file] },
      { provider: 'claude', model: 'fixture', effort: null },
      'Turn 1 prompt',
      root,
      process.env,
      {
        dispatch: phase1Tools,
        definitions: phase1Tools.definitions!,
        schema: {},
        systemPrompt: 'System GM',
      },
      controller.signal,
      undefined,
      bridge
    );

    const phasePromise = bridge.runPhase({
      prompt: 'Turn 1 prompt',
      schema: {},
      systemPrompt: 'System GM',
      tools: phase1Tools,
    });

    setTimeout(() => controller.abort(), 50);

    await assert.rejects(phasePromise);
    await assert.rejects(driverPromise);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Claude session driver: foreign session_id on assistant event is rejected with 502 dice_isolation (R202)', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rpg-claude-foreign-asst-'));
  const file = path.join(root, 'cli.mjs');
  await writeFile(file, fixture);

  const bridge = new GameplaySessionBridge();
  const tools: GameplayToolDispatch = Object.assign(async () => ({ ok: true }), {
    definitions: [
      {
        name: 'roll_dice',
        description: 'Roll dice',
        inputSchema: { type: 'object' as const, properties: { slot: { type: 'number' } } },
      },
    ],
  });

  let driverPromise: Promise<unknown> | undefined;
  try {
    driverPromise = generateClaudeDice(
      { binary: process.execPath, prefix: [file] },
      { provider: 'claude', model: 'fixture', effort: null },
      'Turn 1 prompt',
      root,
      { ...process.env, RPG_CLAUDE_TEST_MODE: 'foreign_assistant' },
      {
        dispatch: tools,
        definitions: tools.definitions!,
        schema: {},
        systemPrompt: 'System GM',
      },
      undefined,
      undefined,
      bridge
    );

    await assert.rejects(
      bridge.runPhase({
        prompt: 'Turn 1 prompt',
        schema: {},
        systemPrompt: 'System GM',
        tools,
      }),
      (err: unknown) =>
        err instanceof Problem && err.status === 502 && err.code === 'dice_isolation'
    );
    await assert.rejects(
      driverPromise,
      (err: unknown) =>
        err instanceof Problem && err.status === 502 && err.code === 'dice_isolation'
    );
  } finally {
    bridge.close();
    await driverPromise?.catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test('Claude session driver: foreign session_id on result event is rejected with 502 dice_isolation (R202)', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rpg-claude-foreign-res-'));
  const file = path.join(root, 'cli.mjs');
  await writeFile(file, fixture);

  const bridge = new GameplaySessionBridge();
  const tools: GameplayToolDispatch = Object.assign(async () => ({ ok: true }), {
    definitions: [
      {
        name: 'roll_dice',
        description: 'Roll dice',
        inputSchema: { type: 'object' as const, properties: { slot: { type: 'number' } } },
      },
    ],
  });

  let driverPromise: Promise<unknown> | undefined;
  try {
    driverPromise = generateClaudeDice(
      { binary: process.execPath, prefix: [file] },
      { provider: 'claude', model: 'fixture', effort: null },
      'Turn 1 prompt',
      root,
      { ...process.env, RPG_CLAUDE_TEST_MODE: 'foreign_result' },
      {
        dispatch: tools,
        definitions: tools.definitions!,
        schema: {},
        systemPrompt: 'System GM',
      },
      undefined,
      undefined,
      bridge
    );

    await assert.rejects(
      bridge.runPhase({
        prompt: 'Turn 1 prompt',
        schema: {},
        systemPrompt: 'System GM',
        tools,
      }),
      (err: unknown) =>
        err instanceof Problem && err.status === 502 && err.code === 'dice_isolation'
    );
    await assert.rejects(
      driverPromise,
      (err: unknown) =>
        err instanceof Problem && err.status === 502 && err.code === 'dice_isolation'
    );
  } finally {
    bridge.close();
    await driverPromise?.catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test('Claude session driver: duplicate consumed result uuid after new request is rejected with 502 dice_isolation (R202)', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rpg-claude-dup-res-'));
  const file = path.join(root, 'cli.mjs');
  await writeFile(file, fixture);

  const bridge = new GameplaySessionBridge();
  const phase1Tools: GameplayToolDispatch = Object.assign(async () => ({ ok: true }), {
    definitions: [
      {
        name: 'roll_dice',
        description: 'Roll dice',
        inputSchema: { type: 'object' as const, properties: { slot: { type: 'number' } } },
      },
      {
        name: 'history_get',
        description: 'Get history',
        inputSchema: { type: 'object' as const, properties: { id: { type: 'string' } } },
      },
    ],
  });
  const phase2Tools: GameplayToolDispatch = Object.assign(async () => ({ id: 'h1' }), {
    definitions: [
      {
        name: 'history_get',
        description: 'Get history',
        inputSchema: { type: 'object' as const, properties: { id: { type: 'string' } } },
      },
    ],
  });

  let driverPromise: Promise<unknown> | undefined;
  try {
    driverPromise = generateClaudeDice(
      { binary: process.execPath, prefix: [file] },
      { provider: 'claude', model: 'fixture', effort: null },
      'Turn 1 prompt',
      root,
      { ...process.env, RPG_CLAUDE_TEST_MODE: 'duplicate_result' },
      {
        dispatch: phase1Tools,
        definitions: phase1Tools.definitions!,
        schema: {},
        systemPrompt: 'System GM',
      },
      undefined,
      undefined,
      bridge
    );

    // Phase 1 succeeds normally
    const r1 = (await bridge.runPhase({
      prompt: 'Turn 1 prompt',
      schema: {},
      systemPrompt: 'System GM',
      tools: phase1Tools,
    })) as { narrative: string };
    assert.equal(r1.narrative, 'Claude turn 1');

    // Phase 2 attempts to re-use consumed uuid 'res-1' and must be rejected
    await assert.rejects(
      bridge.runPhase({
        prompt: 'Turn 2 index prompt',
        schema: {},
        systemPrompt: 'Index system',
        tools: phase2Tools,
      }),
      (err: unknown) =>
        err instanceof Problem && err.status === 502 && err.code === 'dice_isolation'
    );
    await assert.rejects(
      driverPromise,
      (err: unknown) =>
        err instanceof Problem && err.status === 502 && err.code === 'dice_isolation'
    );
  } finally {
    bridge.close();
    await driverPromise?.catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});
