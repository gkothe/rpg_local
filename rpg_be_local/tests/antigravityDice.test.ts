import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateAntigravityMcpBook } from '../src/providers/antigravityMcpBook.js';
import type { GameplayAdapter, GameplayToolDispatch } from '../src/providers/gameplayTools.js';
import { ownedTools } from './ownedGameplayFixture.js';
import { withResponseRetries } from '../src/domain/responseRetry.js';
import { diceInputSchema } from '../src/domain/dice.js';
import { PromptTrace } from '../src/providers/promptLog.js';
import {
  antigravityDiceEnvironment,
  generateAntigravityDice,
} from '../src/providers/antigravityDice.js';

const adapter = (dispatch: GameplayToolDispatch, book = false): GameplayAdapter => ({
  definitions: ownedTools({ book, read: async () => ({}) }).definitions,
  dispatch,
  schema: { type: 'object' },
  systemPrompt: 'Synthetic system prompt',
});
const settings = { provider: 'agy', model: 'fixture', effort: null };
const request = {
  slot: 0,
  groups: [{ label: 'check', count: 1, sides: 6 }],
  reason: 'Check',
  declaration: 'No modifiers or target',
};
const fixture = `
import { readFileSync } from 'node:fs'; import { homedir } from 'node:os'; import path from 'node:path';
const args=process.argv.slice(2);
if(args.includes('changelog')) console.log('1.2.14:');
else if(args.includes('/hooks')) {
  if(process.env.RPG_TEST_AGY_MODE==='hooks') setTimeout(()=>{},10000);
  else console.log(JSON.stringify({command:{data:{hooks:[]}}}));
} else {
  let raw=''; process.stdin.on('data',c=>raw+=c); process.stdin.on('end',async()=>{
    const history=[];
    const agent=readFileSync(path.join(homedir(),'.gemini','config','agents',args[args.indexOf('--agent')+1],'agent.md'),'utf8');
    const server=JSON.parse(/^mcpServers: (.+)$/m.exec(agent)[1])[0];
    console.log(JSON.stringify({event:'init',init:{agent:args[args.indexOf('--agent')+1]}}));
    if(process.env.RPG_TEST_AGY_MODE==='native') console.log(JSON.stringify({event:'step_update',step_update:{step_type:'run_command'}}));
    if(process.env.RPG_TEST_AGY_MODE==='foreign-server') console.log(JSON.stringify({event:'step_update',step_update:{step_type:'tool',step_index:1,state:'ACTIVE',tool_name:'call_mcp_tool',tool_info:{parameters:{ServerName:'outside',ToolName:'roll_dice',Arguments:{}}}}}));
    if(process.env.RPG_TEST_AGY_MODE==='foreign-tool') console.log(JSON.stringify({event:'step_update',step_update:{step_type:'tool',step_index:1,state:'ACTIVE',tool_name:'call_mcp_tool',tool_info:{parameters:{ServerName:'local_rpg',ToolName:'shell',Arguments:{}}}}}));
    if(process.env.RPG_TEST_AGY_MODE==='orphan-completion') console.log(JSON.stringify({event:'step_update',step_update:{step_type:'tool',step_index:99,state:'DONE',tool_name:'call_mcp_tool'}}));
    if(process.env.RPG_TEST_AGY_MODE==='direct-owned') console.log(JSON.stringify({event:'step_update',step_update:{step_type:'tool',step_index:2,state:'ACTIVE',tool_name:'rules_search',tool_info:{name:'rules_search',parameters:{query:'original rules'}}}}));
    if(process.env.RPG_TEST_AGY_MODE==='direct-foreign') console.log(JSON.stringify({event:'step_update',step_update:{step_type:'tool',step_index:2,state:'ACTIVE',tool_name:'shell',tool_info:{name:'shell',parameters:{command:'forbidden'}}}}));
    const mode=process.env.RPG_TEST_AGY_MODE;
    if(['zero-turns','missing-turns'].includes(mode)) {
      console.log(JSON.stringify({event:'result',result:{status:'SUCCESS',num_turns:mode==='zero-turns'?0:undefined,response:'PRIVATE_RESPONSE'}}));
      return;
    }
    if(['malformed-arguments','array-arguments','null-arguments','orphan-envelope'].includes(mode)) {
      const argumentsValue=mode==='malformed-arguments' ? '{broken' : mode==='array-arguments' ? [] : mode==='null-arguments' ? null : {};
      console.log(JSON.stringify({event:'step_update',step_update:{step_type:'tool',step_index:99,state:mode==='orphan-envelope'?'DONE':'ACTIVE',tool_name:'call_mcp_tool',tool_info:{parameters:{ServerName:'local_rpg',ToolName:'roll_dice',Arguments:argumentsValue}}}}));
    }
    for(let slot=0;slot<2;slot++) {
      const input={...${JSON.stringify(request)},slot};
      console.log(JSON.stringify({event:'step_update',step_update:{step_type:'agent_response',step_index:slot*2,state:'DONE',usage:mode==='partial-usage'?{input_tokens:10000}:mode==='invalid-usage'?{input_tokens:'unknown',output_tokens:50}:{input_tokens:10000,output_tokens:50,cache_read_tokens:0}}}));
      console.log(JSON.stringify({event:'step_update',step_update:{step_type:'tool',step_index:slot*2+1,state:'ACTIVE',tool_name:'call_mcp_tool',tool_info:{parameters:{ServerName:'local_rpg',ToolName:'roll_dice',Arguments:input}}}}));
      const reply=await fetch(server.serverUrl,{method:'POST',headers:{...server.headers,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'roll_dice',arguments:input}})});
      const payload=await reply.json(); if(payload.result.isError)throw new Error(JSON.stringify(payload));
      history.push({result:JSON.parse(payload.result.content[0].text)});
      const completion={step_type:'tool',step_index:slot*2+1,state:'DONE',tool_name:'call_mcp_tool'};
      if(mode==='matching-envelope'||mode==='changed-envelope') completion.tool_info={parameters:{ServerName:'local_rpg',ToolName:'roll_dice',Arguments:mode==='changed-envelope'?{...input,slot:99}:input}};
      console.log(JSON.stringify({event:'step_update',step_update:completion}));
    }
    console.log(JSON.stringify({event:'step_update',step_update:{step_type:'agent_response',step_index:4,state:'DONE',usage:{input_tokens:10000,output_tokens:12417}}}));
    const response={narrative:history.map(r=>r.result.groups[0].faces[0]).join(','),operations:[],rollInterpretations:history.map(r=>({rollId:r.result.rollId,explanation:'Recorded face '+r.result.groups[0].faces[0]}))};
    if(process.env.RPG_TEST_AGY_MODE==='book-success') response.ruleCitations=[];
    console.log(JSON.stringify({event:'step_update',step_update:{step_type:'unknown',step_index:5,state:'DONE',duration_seconds:0.1}}));
    console.log(JSON.stringify({event:'result',result:{status:'SUCCESS',num_turns:1,usage:mode==='partial-usage'?undefined:mode==='invalid-usage'?{input_tokens:'unknown'}:{input_tokens:30000},response:JSON.stringify(response)}}));
  });
}`;

for (const mode of ['zero-turns', 'missing-turns']) {
  test(`Antigravity ${mode} completion records diagnostics without accepting or exposing its response`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rpg-agy-completion-'));
    try {
      const filename = path.join(root, 'cli.mjs');
      const traceFile = path.join(root, 'trace.jsonl');
      const executionId = randomUUID();
      const trace = new PromptTrace(traceFile, { executionId });
      await writeFile(filename, fixture);
      await assert.rejects(
        generateAntigravityMcpBook(
          { binary: process.execPath, prefix: [filename] },
          settings,
          'Synthetic',
          root,
          { ...process.env, RPG_TEST_AGY_MODE: mode },
          adapter(async () => {
            throw new Error('No tool is expected');
          }),
          undefined,
          { executionId, trace }
        ),
        (error: unknown) => {
          assert.equal((error as { code: string }).code, 'dice_isolation');
          assert.match((error as Error).message, /reported (0|no) completed turns/);
          return true;
        }
      );
      const raw = await readFile(traceFile, 'utf8');
      const entry = raw
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
        .find((row) => row.kind === 'native_completion');
      assert.equal(entry.payload.reportedTurns, mode === 'zero-turns' ? 0 : null);
      assert.equal(entry.payload.initialized, true);
      assert.equal(entry.payload.unclaimedCalls, 0);
      assert.equal(entry.payload.hasResponse, true);
      assert.doesNotMatch(raw, /PRIVATE_RESPONSE/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test('a registered tool called directly fails before dispatch and automatically retries with MCP guidance', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rpg-agy-direct-repair-'));
  try {
    const filename = path.join(root, 'cli.mjs');
    await writeFile(filename, fixture);
    let attempts = 0;
    let dispatches = 0;
    const result = await withResponseRetries(
      async (attempt, feedback) => {
        attempts++;
        if (attempt > 0) {
          assert.equal(dispatches, 0);
          assert.match(feedback, /rules_search directly/);
          assert.match(feedback, /call_mcp_tool/);
          assert.match(feedback, /ServerName="local_rpg"/);
        }
        return generateAntigravityMcpBook(
          { binary: process.execPath, prefix: [filename] },
          settings,
          `Synthetic ${feedback ?? ''}`,
          root,
          { ...process.env, RPG_TEST_AGY_MODE: attempt === 0 ? 'direct-owned' : 'book-success' },
          adapter(async (name, input) => {
            assert.equal(name, 'roll_dice');
            dispatches++;
            return {
              rollId: randomUUID(),
              slot: diceInputSchema.shape.slot.parse((input as { slot: unknown }).slot),
              groups: [{ label: 'check', sides: 6, faces: [3] }],
              reused: false,
            };
          }, true)
        );
      },
      async () => {}
    );
    assert.equal(attempts, 2);
    assert.equal(dispatches, 2);
    assert.deepEqual((result as { ruleCitations: unknown[] }).ruleCitations, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a genuinely external direct tool remains non-retryable and never dispatches', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rpg-agy-direct-denied-'));
  try {
    const filename = path.join(root, 'cli.mjs');
    await writeFile(filename, fixture);
    let attempts = 0;
    await assert.rejects(
      withResponseRetries(
        async () => {
          attempts++;
          return generateAntigravityMcpBook(
            { binary: process.execPath, prefix: [filename] },
            settings,
            'Synthetic',
            root,
            { ...process.env, RPG_TEST_AGY_MODE: 'direct-foreign' },
            adapter(async () => {
              assert.fail('External tool must never dispatch');
            }, true)
          );
        },
        async () => {
          assert.fail('External tool must never retry');
        }
      ),
      (error: unknown) => (error as { code: string }).code === 'dice_isolation'
    );
    assert.equal(attempts, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const usageMode of ['valid', 'partial-usage', 'invalid-usage'])
  test(`Antigravity accepts successful native MCP despite ${usageMode} telemetry`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rpg-agy-dice-test-'));
    try {
      const filename = path.join(root, 'cli.mjs');
      await writeFile(filename, fixture);
      const ids: string[] = [];
      const response = (await generateAntigravityDice(
        { binary: process.execPath, prefix: [filename] },
        settings,
        'Synthetic context' + 'x'.repeat(70000),
        root,
        { ...process.env, RPG_TEST_AGY_MODE: usageMode },
        adapter(async (_name, input) => {
          const slot = (input as typeof request).slot;
          assert.equal(slot, ids.length);
          const rollId = randomUUID();
          ids.push(rollId);
          return {
            rollId,
            slot,
            groups: [{ label: 'check', sides: 6, faces: [slot + 3] }],
            reused: false,
          };
        })
      )) as { narrative: string; rollInterpretations: { rollId: string }[] };
      assert.equal(response.narrative, '3,4');
      assert.deepEqual(
        response.rollInterpretations.map((entry) => entry.rollId),
        ids
      );
      assert.equal(ids.length, 2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

test('Antigravity rejects native capabilities before executing application dice', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rpg-agy-dice-isolation-'));
  try {
    const filename = path.join(root, 'cli.mjs');
    await writeFile(filename, fixture);
    let calls = 0;
    await assert.rejects(
      generateAntigravityDice(
        { binary: process.execPath, prefix: [filename] },
        settings,
        'Synthetic',
        root,
        { ...process.env, RPG_TEST_AGY_MODE: 'native' },
        adapter(async () => {
          calls++;
          throw new Error('Unexpected callback');
        })
      ),
      /unapproved native activity/
    );
    assert.equal(calls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Antigravity cancellation during setup cannot draw dice', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rpg-agy-dice-cancel-'));
  try {
    const filename = path.join(root, 'cli.mjs');
    await writeFile(filename, fixture);
    let calls = 0;
    const roll = async () => {
      calls++;
      throw new Error('Unexpected callback');
    };
    await assert.rejects(
      generateAntigravityDice(
        { binary: process.execPath, prefix: [filename] },
        settings,
        'Synthetic',
        root,
        { ...process.env, RPG_TEST_AGY_MODE: 'hooks' },
        adapter(roll),
        AbortSignal.timeout(200)
      ),
      /cancelled/
    );
    assert.equal(calls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Antigravity strips inherited configuration overrides', () => {
  const env = antigravityDiceEnvironment({
    PATH: 'local',
    GOOGLE_API_KEY: 'fixture',
    ANTIGRAVITY_APP_DATA_DIR: 'fixture',
    CASCADE_GLOBAL_CONFIG_OVERRIDE: 'fixture',
  });
  assert.deepEqual(env, { PATH: 'local' });
});

test('unavailable MCP server/tools and unmatched completion markers fail before dispatch', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rpg-agy-mcp-envelope-'));
  try {
    const filename = path.join(root, 'cli.mjs');
    await writeFile(filename, fixture);
    for (const mode of ['foreign-server', 'foreign-tool', 'orphan-completion']) {
      let calls = 0;
      await assert.rejects(
        generateAntigravityDice(
          { binary: process.execPath, prefix: [filename] },
          settings,
          'Synthetic',
          root,
          { ...process.env, RPG_TEST_AGY_MODE: mode },
          adapter(async () => {
            calls++;
            throw new Error('Unapproved tool must never dispatch');
          })
        ),
        (error: unknown) => (error as { code: string }).code === 'gameplay_tool_unavailable'
      );
      assert.equal(calls, 0);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const mode of ['malformed-arguments', 'array-arguments', 'null-arguments']) {
  test(`invalid owned MCP arguments are repaired before dice dispatch: ${mode}`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rpg-agy-arguments-'));
    try {
      const filename = path.join(root, 'cli.mjs');
      await writeFile(filename, fixture);
      let attempts = 0;
      let calls = 0;
      await withResponseRetries(
        async (attempt, feedback) => {
          attempts++;
          if (attempt > 0) {
            assert.equal(calls, 0);
            assert.match(feedback, /Arguments/);
            assert.match(feedback, /JSON object/);
          }
          return generateAntigravityDice(
            { binary: process.execPath, prefix: [filename] },
            settings,
            feedback,
            root,
            { ...process.env, RPG_TEST_AGY_MODE: attempt === 0 ? mode : 'matching-envelope' },
            adapter(async () => {
              calls++;
              return {
                rollId: randomUUID(),
                slot: calls - 1,
                groups: [{ label: 'check', sides: 6, faces: [3] }],
                reused: false,
              };
            })
          );
        },
        async () => {}
      );
      assert.equal(attempts, 2);
      assert.equal(calls, 2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

for (const [mode, expectedCalls] of [
  ['orphan-envelope', 0],
  ['changed-envelope', 1],
] as const) {
  test(`MCP completion must match an actually dispatched request: ${mode}`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rpg-agy-completion-'));
    try {
      const filename = path.join(root, 'cli.mjs');
      await writeFile(filename, fixture);
      let calls = 0;
      await assert.rejects(
        generateAntigravityDice(
          { binary: process.execPath, prefix: [filename] },
          settings,
          'Synthetic',
          root,
          { ...process.env, RPG_TEST_AGY_MODE: mode },
          adapter(async () => {
            calls++;
            return {
              rollId: randomUUID(),
              slot: calls - 1,
              groups: [{ label: 'check', sides: 6, faces: [3] }],
              reused: false,
            };
          })
        ),
        (error: unknown) => (error as { code: string }).code === 'dice_isolation'
      );
      assert.equal(calls, expectedCalls);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
