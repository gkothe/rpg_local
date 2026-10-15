import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runCodexDicePhases } from '../src/providers/codexDice.js';
import { GameplaySessionBridge } from '../src/providers/gameplaySession.js';
import { Problem } from '../src/errors.js';
import type { GameplayToolDispatch } from '../src/providers/gameplayTools.js';

const fixture = `
import readline from 'node:readline';
import fs from 'node:fs';

const send = o => console.log(JSON.stringify(o));
const mode = process.env.RPG_CODEX_TEST_MODE ?? 'normal';
const logPath = process.env.RPG_CODEX_LOG_PATH;
let turnCount = 0;

readline.createInterface({ input: process.stdin }).on('line', raw => {
  const m = JSON.parse(raw);
  if (m.method === 'turn/start') {
    if (logPath) {
      fs.appendFileSync(logPath, JSON.stringify({ id: m.id, text: m.params?.input?.[0]?.text }) + '\\n');
    }
  }
  if (m.id === 1) {
    send({ id: 1, result: {} });
  } else if (m.id === 2) {
    send({ id: 2, result: { thread: { id: 't-100' } } });
  } else if (m.id === 100) {
    turnCount++;
    send({ id: m.id, result: { turn: { id: 'turn-' + turnCount } } });
    send({
      id: 991,
      method: 'item/tool/call',
      params: {
        tool: 'roll_dice',
        arguments: { slot: 0, groups: [{ label: 'test', count: 1, sides: 6 }], reason: 'test', declaration: 'd6', scope: 'oracle' },
        callId: 'call-1',
        threadId: 't-100',
        turnId: 'turn-' + turnCount,
      },
    });
  } else if (m.id === 200) {
    if (mode === 'stale_completed_before_ack') {
      send({
        method: 'turn/completed',
        params: {
          threadId: 't-100',
          turn: {
            id: 'turn-1',
            status: 'completed',
            items: [
              {
                type: 'agentMessage',
                text: JSON.stringify({
                  payload_json: JSON.stringify({ narrative: 'stale replay' }),
                }),
              },
            ],
          },
        },
      });
      return;
    }
    turnCount++;
    send({ id: 200, result: { turn: { id: 'turn-' + turnCount } } });
    if (mode === 'wrong_turn_after_ack') {
      send({
        method: 'turn/completed',
        params: {
          threadId: 't-100',
          turn: {
            id: 'wrong-turn-id',
            status: 'completed',
            items: [
              {
                type: 'agentMessage',
                text: JSON.stringify({
                  payload_json: JSON.stringify({
                    checked: { notes: true },
                    gmIndexChanges: [],
                    gmFoundationChanges: [],
                  }),
                }),
              },
            ],
          },
        },
      });
      return;
    }
    if (mode === 'correction_flow') {
      send({
        method: 'turn/completed',
        params: {
          threadId: 't-100',
          turn: {
            id: 'turn-' + turnCount,
            status: 'completed',
            items: [
              {
                type: 'agentMessage',
                text: JSON.stringify({
                  payload_json: JSON.stringify({ unexpected: 'invalid' }),
                }),
              },
            ],
          },
        },
      });
    } else if (mode === 'forbidden_tool') {
      send({
        id: 993,
        method: 'item/tool/call',
        params: {
          tool: 'roll_dice',
          arguments: { slot: 0 },
          callId: 'call-forbidden',
          threadId: 't-100',
          turnId: 'turn-' + turnCount,
        },
      });
    } else if (mode === 'foreign_thread') {
      send({
        id: 994,
        method: 'item/tool/call',
        params: {
          tool: 'history_get',
          arguments: { id: 'h1' },
          callId: 'call-ft',
          threadId: 'foreign-thread',
          turnId: 'turn-' + turnCount,
        },
      });
    } else if (mode === 'mismatched_turn') {
      send({
        id: 995,
        method: 'item/tool/call',
        params: {
          tool: 'history_get',
          arguments: { id: 'h1' },
          callId: 'call-mt',
          threadId: 't-100',
          turnId: 'wrong-turn',
        },
      });
    } else {
      send({
        id: 996,
        method: 'item/tool/call',
        params: {
          tool: 'history_get',
          arguments: { id: 'h1' },
          callId: 'call-2',
          threadId: 't-100',
          turnId: 'turn-' + turnCount,
        },
      });
    }
  } else if (m.id === 991) {
    send({
      method: 'turn/completed',
      params: {
        threadId: 't-100',
        turn: {
          id: 'turn-1',
          status: 'completed',
          items: [
            {
              type: 'agentMessage',
              text: JSON.stringify({
                payload_json: JSON.stringify({
                  narrative: 'Turn 1 narrative',
                  operations: [],
                  rollInterpretations: [],
                }),
              }),
            },
          ],
        },
      },
    });
    if (mode === 'idle_call') {
      send({
        id: 992,
        method: 'item/tool/call',
        params: {
          tool: 'roll_dice',
          arguments: {},
          callId: 'call-idle',
          threadId: 't-100',
          turnId: 'turn-1',
        },
      });
    }
  } else if (m.id === 996) {
    send({
      method: 'turn/completed',
      params: {
        threadId: 't-100',
        turn: {
          id: 'turn-2',
          status: 'completed',
          items: [
            {
              type: 'agentMessage',
              text: JSON.stringify({
                payload_json: JSON.stringify({
                  checked: { notes: true },
                  gmIndexChanges: [],
                  gmFoundationChanges: [],
                }),
              }),
            },
          ],
        },
      },
    });
  } else if (m.id === 300) {
    turnCount++;
    send({ id: 300, result: { turn: { id: 'turn-' + turnCount } } });
    send({
      method: 'turn/completed',
      params: {
        threadId: 't-100',
        turn: {
          id: 'turn-' + turnCount,
          status: 'completed',
          items: [
            {
              type: 'agentMessage',
              text: JSON.stringify({
                payload_json: JSON.stringify({
                  checked: { notes: true },
                  gmIndexChanges: [],
                  gmFoundationChanges: [],
                }),
              }),
            },
          ],
        },
      },
    });
  }
});
`;

test('Codex session driver: multi-phase continuation on the same thread with wire schema delivery (F002)', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rpg-codex-sess-'));
  const file = path.join(root, 'cli.mjs');
  const logFile = path.join(root, 'codex-turnstart.log');
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

  try {
    const driverPromise = runCodexDicePhases(
      { binary: process.execPath, prefix: [file] },
      { provider: 'codex', model: 'fixture', effort: null },
      'Turn 1 prompt',
      root,
      { ...process.env, RPG_CODEX_TEST_MODE: 'normal', RPG_CODEX_LOG_PATH: logFile },
      {},
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

    assert.equal(r1.narrative, 'Turn 1 narrative');
    assert.equal(diceCalled, 1);

    const r2 = (await bridge.runPhase({
      prompt: 'Turn 2 index prompt',
      schema: phase2Schema,
      systemPrompt: 'Index system',
      tools: phase2Tools,
    })) as { checked: { notes: boolean } };

    assert.equal(r2.checked.notes, true);
    assert.equal(historyCalled, 1);

    bridge.close();
    await driverPromise;

    // F002: Assert wire schema inclusion
    const logLines = (await readFile(logFile, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(logLines.length, 2);
    // Phase 1 prompt on wire does not contain Phase 2 schema
    assert.ok(!logLines[0].text.includes('"checked"'));
    // Phase 2 continuation prompt on wire explicitly contains serialized phase2Schema
    assert.ok(logLines[1].text.includes('Application schema for payload_json:'));
    assert.ok(logLines[1].text.includes(JSON.stringify(phase2Schema)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Codex session driver: later corrections retain the current schema (F002)', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rpg-codex-sess-corr-'));
  const file = path.join(root, 'cli.mjs');
  const logFile = path.join(root, 'codex-turnstart.log');
  await writeFile(file, fixture);

  const bridge = new GameplaySessionBridge();

  const phase1Schema = {
    type: 'object' as const,
    properties: { narrative: { type: 'string' as const } },
    required: ['narrative'],
  };

  const phase2Schema = {
    type: 'object' as const,
    properties: {
      checked: { type: 'object' as const },
      gmIndexChanges: { type: 'array' as const },
    },
    required: ['checked'],
  };

  const phase1Tools: GameplayToolDispatch = Object.assign(async () => ({ ok: true }), {
    definitions: [
      {
        name: 'roll_dice',
        description: 'Roll dice',
        inputSchema: { type: 'object' as const, properties: { slot: { type: 'number' } } },
      },
    ],
  });

  const phase2Tools: GameplayToolDispatch = Object.assign(async () => ({ id: 'h1' }), {
    definitions: [],
  });

  try {
    const driverPromise = runCodexDicePhases(
      { binary: process.execPath, prefix: [file] },
      { provider: 'codex', model: 'fixture', effort: null },
      'Turn 1 prompt',
      root,
      { ...process.env, RPG_CODEX_TEST_MODE: 'correction_flow', RPG_CODEX_LOG_PATH: logFile },
      {},
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

    await bridge.runPhase({
      prompt: 'Turn 1 prompt',
      schema: phase1Schema,
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

    // Initial continuation prompt (Turn 2) has serialized phase 2 schema
    assert.ok(logLines[1].text.includes('Application schema for payload_json:'));
    assert.ok(logLines[1].text.includes(JSON.stringify(phase2Schema)));

    // Correction continuation prompt (Turn 3) retains the serialized phase 2 schema
    assert.ok(logLines[2].text.includes('Application schema for payload_json:'));
    assert.ok(logLines[2].text.includes(JSON.stringify(phase2Schema)));
    assert.ok(logLines[2].text.includes('Feedback: output was invalid'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Codex session driver: tool allowlisting rejects forbidden tool during index phase', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rpg-codex-sess-allow-'));
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
    const driverPromise = runCodexDicePhases(
      { binary: process.execPath, prefix: [file] },
      { provider: 'codex', model: 'fixture', effort: null },
      'Turn 1 prompt',
      root,
      { ...process.env, RPG_CODEX_TEST_MODE: 'forbidden_tool' },
      {},
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
    assert.equal(r1.narrative, 'Turn 1 narrative');

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

test('Codex session driver: idle tool call rejection between phases', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rpg-codex-sess-idle-'));
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
    ],
  });

  try {
    const driverPromise = runCodexDicePhases(
      { binary: process.execPath, prefix: [file] },
      { provider: 'codex', model: 'fixture', effort: null },
      'Turn 1 prompt',
      root,
      { ...process.env, RPG_CODEX_TEST_MODE: 'idle_call' },
      {},
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

    await assert.rejects(
      driverPromise,
      (err: unknown) =>
        err instanceof Problem && err.status === 409 && err.code === 'gameplay_phase'
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Codex session driver: foreign threadId or mismatched turnId rejected with dice_isolation', async () => {
  for (const mode of ['foreign_thread', 'mismatched_turn'] as const) {
    const root = await mkdtemp(path.join(os.tmpdir(), `rpg-codex-sess-${mode}-`));
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

    try {
      const driverPromise = runCodexDicePhases(
        { binary: process.execPath, prefix: [file] },
        { provider: 'codex', model: 'fixture', effort: null },
        'Turn 1 prompt',
        root,
        { ...process.env, RPG_CODEX_TEST_MODE: mode },
        {},
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

      await assert.rejects(driverPromise, /unapproved or concurrent dice capability/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('Codex session driver: abort signal cleanly cancels process and session', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rpg-codex-sess-abort-'));
  const file = path.join(root, 'cli.mjs');
  await writeFile(
    file,
    `
import readline from 'node:readline';
const send = o => console.log(JSON.stringify(o));
readline.createInterface({ input: process.stdin }).on('line', raw => {
  const m = JSON.parse(raw);
  if (m.id === 1) send({ id: 1, result: {} });
  else if (m.id === 2) send({ id: 2, result: { thread: { id: 't-abort' } } });
  // Never completes turn 1
});
`
  );

  const bridge = new GameplaySessionBridge();
  const controller = new AbortController();

  const phase1Tools: GameplayToolDispatch = Object.assign(async () => ({ ok: true }), {
    definitions: [],
  });

  try {
    const driverPromise = runCodexDicePhases(
      { binary: process.execPath, prefix: [file] },
      { provider: 'codex', model: 'fixture', effort: null },
      'Turn 1 prompt',
      root,
      process.env,
      {},
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

test('Codex session driver: reject stale TurnCompleted before new turn/start is acknowledged (R201)', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rpg-codex-sess-stale-'));
  const file = path.join(root, 'cli.mjs');
  await writeFile(file, fixture);

  const bridge = new GameplaySessionBridge();

  const phase1Schema = {
    type: 'object' as const,
    properties: { narrative: { type: 'string' as const } },
    required: ['narrative'],
  };

  const phase2Schema = {
    type: 'object' as const,
    properties: {
      checked: { type: 'object' as const },
      gmIndexChanges: { type: 'array' as const },
    },
    required: ['checked'],
  };

  const phase1Tools: GameplayToolDispatch = Object.assign(async () => ({ ok: true }), {
    definitions: [
      {
        name: 'roll_dice',
        description: 'Roll dice',
        inputSchema: { type: 'object' as const, properties: { slot: { type: 'number' } } },
      },
    ],
  });

  const phase2Tools: GameplayToolDispatch = Object.assign(async () => ({ id: 'h1' }), {
    definitions: [],
  });

  try {
    const driverPromise = runCodexDicePhases(
      { binary: process.execPath, prefix: [file] },
      { provider: 'codex', model: 'fixture', effort: null },
      'Turn 1 prompt',
      root,
      { ...process.env, RPG_CODEX_TEST_MODE: 'stale_completed_before_ack' },
      {},
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
    assert.equal(r1.narrative, 'Turn 1 narrative');

    // Continuation sends turn/start (m.id = 200).
    // The fixture responds with a stale TurnCompleted (turn-1) before acknowledging turn-2.
    // Must reject and fail closed without resolving Phase 2 with stale gameplay!
    await assert.rejects(
      bridge.runPhase({
        prompt: 'Phase 2 continuation',
        schema: phase2Schema,
        systemPrompt: 'Index system',
        tools: phase2Tools,
      }),
      (err: unknown) =>
        err instanceof Problem && err.status === 502 && err.code === 'codex_protocol'
    );

    await assert.rejects(
      driverPromise,
      (err: unknown) =>
        err instanceof Problem && err.status === 502 && err.code === 'codex_protocol'
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Codex session driver: reject wrong turn ID after acknowledgement (R201)', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rpg-codex-sess-wrong-'));
  const file = path.join(root, 'cli.mjs');
  await writeFile(file, fixture);

  const bridge = new GameplaySessionBridge();

  const phase1Schema = {
    type: 'object' as const,
    properties: { narrative: { type: 'string' as const } },
    required: ['narrative'],
  };

  const phase2Schema = {
    type: 'object' as const,
    properties: {
      checked: { type: 'object' as const },
      gmIndexChanges: { type: 'array' as const },
    },
    required: ['checked'],
  };

  const phase1Tools: GameplayToolDispatch = Object.assign(async () => ({ ok: true }), {
    definitions: [
      {
        name: 'roll_dice',
        description: 'Roll dice',
        inputSchema: { type: 'object' as const, properties: { slot: { type: 'number' } } },
      },
    ],
  });

  const phase2Tools: GameplayToolDispatch = Object.assign(async () => ({ id: 'h1' }), {
    definitions: [],
  });

  try {
    const driverPromise = runCodexDicePhases(
      { binary: process.execPath, prefix: [file] },
      { provider: 'codex', model: 'fixture', effort: null },
      'Turn 1 prompt',
      root,
      { ...process.env, RPG_CODEX_TEST_MODE: 'wrong_turn_after_ack' },
      {},
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
    assert.equal(r1.narrative, 'Turn 1 narrative');

    // Continuation sends turn/start (m.id = 200).
    // The fixture acknowledges turn-2, but emits TurnCompleted with wrong turn ID.
    // Must reject and fail closed.
    await assert.rejects(
      bridge.runPhase({
        prompt: 'Phase 2 continuation',
        schema: phase2Schema,
        systemPrompt: 'Index system',
        tools: phase2Tools,
      }),
      (err: unknown) =>
        err instanceof Problem && err.status === 502 && err.code === 'codex_protocol'
    );

    await assert.rejects(
      driverPromise,
      (err: unknown) =>
        err instanceof Problem && err.status === 502 && err.code === 'codex_protocol'
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
