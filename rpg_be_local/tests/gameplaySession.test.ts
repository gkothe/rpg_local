import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, access, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { GameplaySessionBridge } from '../src/providers/gameplaySession.js';
import { generateAntigravityMcpBook } from '../src/providers/antigravityMcpBook.js';
import type { GameplayToolDispatch } from '../src/providers/gameplayTools.js';
import { GmIndexUpdateMode, gmIndexUpdateModeOf } from '../src/domain/gmIndexExecution.js';
import { publicCampaign } from '../src/domain/playerProjection.js';
import { newCampaign } from '../src/domain/campaign.js';
import { campaignPatchSchema } from '../src/domain/schemas.js';

test('mode defaults to separate, validates closed values and survives public projection', () => {
  assert.equal(gmIndexUpdateModeOf({}), 'separate_agent');
  assert.throws(() => campaignPatchSchema.parse({ revision: 0, gmIndexUpdateMode: 'invented' }));
  const c = newCampaign({ name: 'Synthetic', description: '', instructions: '' });
  c.gmIndexUpdateMode = GmIndexUpdateMode.SameConversation;
  assert.equal(publicCampaign(c).gmIndexUpdateMode, 'same_gm_conversation');
});

const fixture = `
import { createInterface } from 'node:readline';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const args=process.argv.slice(2);
if(args.includes('/hooks')) console.log(JSON.stringify({command:{data:{hooks:[]}}}));
else {
 const agent=args[args.indexOf('--agent')+1];
 const definition=readFileSync(path.join(process.env.USERPROFILE,'.gemini','config','agents',agent,'agent.md'),'utf8');
 const server=JSON.parse(/mcpServers: (.+)/.exec(definition)[1])[0];
 writeFileSync(path.join(process.cwd(),'profile-location.txt'),process.env.USERPROFILE);
 let count=0;
 console.log(JSON.stringify({event:'init',init:{agent}}));
 for await (const line of createInterface({input:process.stdin})) {
  const input=JSON.parse(line);count++;
  if(count===2 && process.env.RPG_PHASE_FORBIDDEN==='yes') {
   const step={step_type:'tool',step_index:2,state:'ACTIVE',tool_name:'call_mcp_tool',tool_info:{parameters:{ServerName:'local_rpg',ToolName:'roll_dice',Arguments:{}}}};
   console.log(JSON.stringify({event:'step_update',step_update:step}));
   await fetch(server.serverUrl,{method:'POST',headers:{...server.headers,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'roll_dice',arguments:{}}})});
  }
  console.log(JSON.stringify({event:'result',result:{status:'SUCCESS',num_turns:process.env.RPG_PHASE_LATE==='yes' && count===2 ? 1 : count,response:JSON.stringify({phase:count,editorReceived:input.message.content.includes('EDITED_TEXT')})}}));
 }
}
`;
for (const mode of ['normal', 'forbidden', 'late'])
  test(`Antigravity native process phases: ${mode}`, async () => {
    const forbidden = mode === 'forbidden';
    const dir = await mkdtemp(path.join(os.tmpdir(), 'rpg-phase-test-'));
    const bridge = new GameplaySessionBridge();
    let dice = 0;
    const tools: GameplayToolDispatch = Object.assign(
      async () => {
        dice++;
        return {};
      },
      {
        definitions: [
          { name: 'roll_dice', description: 'Synthetic', inputSchema: { type: 'object' as const } },
        ],
      }
    );
    const indexTools: GameplayToolDispatch = Object.assign(async () => ({}), { definitions: [] });
    try {
      const file = path.join(dir, 'fixture.mjs');
      await writeFile(file, fixture);
      const first = bridge.runPhase({
        prompt: 'INITIAL',
        schema: {},
        systemPrompt: 'Synthetic',
        tools,
      });
      const initial = await bridge.first;
      let failure: unknown;
      const driver = generateAntigravityMcpBook(
        { binary: process.execPath, prefix: [file] },
        { provider: 'agy', model: 'fixture', effort: null },
        initial.prompt,
        dir,
        {
          ...process.env,
          RPG_PHASE_FORBIDDEN: forbidden ? 'yes' : 'no',
          RPG_PHASE_LATE: mode === 'late' ? 'yes' : 'no',
        },
        { dispatch: tools, definitions: tools.definitions!, schema: {}, systemPrompt: 'Synthetic' },
        undefined,
        undefined,
        bridge
      ).then(
        () => {},
        (error: unknown) => {
          failure = error;
          bridge.fail(error);
        }
      );
      try {
        assert.deepEqual(await first, { phase: 1, editorReceived: false });
        const second = bridge.runPhase({
          prompt: 'EDITED_TEXT',
          schema: {},
          systemPrompt: 'Index only',
          tools: indexTools,
        });
        if (forbidden) await assert.rejects(second, /unavailable in the index phase/);
        else if (mode === 'late') await assert.rejects(second, /reported 1 completed turns/);
        else assert.deepEqual(await second, { phase: 2, editorReceived: true });
        assert.equal(dice, 0);
      } finally {
        bridge.close();
        await driver;
      }
      if (mode === 'normal') assert.equal(failure, undefined);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

test('cancelling an active continuation rejects its phase and closes the owned process', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rpg-phase-cancel-'));
  const bridge = new GameplaySessionBridge();
  const ctl = new AbortController();
  const tools: GameplayToolDispatch = Object.assign(async () => ({}), {
    definitions: [
      {
        name: 'campaign_knowledge_get',
        description: 'Synthetic',
        inputSchema: { type: 'object' as const },
      },
    ],
  });
  try {
    const file = path.join(dir, 'fixture.mjs');
    await writeFile(
      file,
      fixture.replace(
        'const input=JSON.parse(line);count++;',
        'const input=JSON.parse(line);count++; if(count===2) { await new Promise(()=>{}); }'
      )
    );
    const first = bridge.runPhase({
      prompt: 'FIRST',
      schema: {},
      systemPrompt: 'Synthetic',
      tools,
    });
    let failure: unknown;
    const driver = generateAntigravityMcpBook(
      { binary: process.execPath, prefix: [file] },
      { provider: 'agy', model: 'fixture', effort: null },
      'FIRST',
      dir,
      process.env,
      { dispatch: tools, definitions: tools.definitions!, schema: {}, systemPrompt: 'Synthetic' },
      ctl.signal,
      undefined,
      bridge
    ).then(
      () => {},
      (error: unknown) => {
        failure = error;
        bridge.fail(error);
      }
    );
    await first;
    const profile = await readFile(path.join(dir, 'profile-location.txt'), 'utf8');
    const next = bridge.runPhase({ prompt: 'SECOND', schema: {}, systemPrompt: 'Index', tools });
    ctl.abort();
    await assert.rejects(next, /cancelled|no longer active/i);
    bridge.close();
    await driver;
    assert.ok(failure);
    await assert.rejects(access(profile));
    await assert.rejects(
      bridge.runPhase({ prompt: 'THIRD', schema: {}, systemPrompt: 'Index', tools }),
      /closed|cancelled/i
    );
  } finally {
    ctl.abort();
    bridge.close();
    await rm(dir, { recursive: true, force: true });
  }
});
