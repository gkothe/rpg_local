import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateClaudeDice } from '../src/providers/claudeDice.js';
import { runCodexDicePhases } from '../src/providers/codexDice.js';
import { generateAntigravityDice } from '../src/providers/antigravityDice.js';
import { gameplayResponseWireJsonSchema } from '../src/domain/gameplayResponse.js';
import { ownedTools } from './ownedGameplayFixture.js';
import { newCampaign } from '../src/domain/campaign.js';
import { freezeKnowledge } from '../src/domain/knowledgeRecall.js';

// Synthetic CLIs only; no real provider is called.
const response = `{narrative:'Two soldiers step forward.',operations:[],rollInterpretations:[],ruleCitations:[],knowledgeChanges:[],operationExplanations:[],combatEffects:[],participantReferences:[]}`;
const batch = `JSON.parse(process.env.RPG_COMBAT_BATCH)`;
const claude = `
const args=process.argv.slice(2);
if(args.includes('--version'))console.log('9.9.9 (Claude Code)');
else { process.stdin.resume();process.stdin.on('end',async()=>{
const tools=args[args.indexOf('--allowedTools')+1].split(',');
if(!tools.some(t=>t.endsWith('combat_prepare')))throw Error('Missing combat_prepare');
console.log(JSON.stringify({type:'system',subtype:'init',tools,mcp_servers:[{name:'dice',status:'connected'}]}));
const server=JSON.parse(args[args.indexOf('--mcp-config')+1]).mcpServers.dice;
const reply=await fetch(server.url,{method:'POST',headers:{...server.headers,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:10,method:'tools/call',params:{name:'combat_prepare',arguments:${batch}}})});
const payload=await reply.json();if(payload.result.isError)throw Error('Prepare rejected '+payload.result.content[0].text);
console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,num_turns:1,result:JSON.stringify(${response}),modelUsage:{fixture:{contextWindow:128000,outputTokens:100}}}));
});}`;
const codex = `
import readline from 'node:readline';
const lines=readline.createInterface({input:process.stdin});
const send=x=>console.log(JSON.stringify(x));
lines.on('line',raw=>{const m=JSON.parse(raw);
if(m.id===1)send({id:1,result:{}});
else if(m.id===2){if(!m.params.dynamicTools.some(t=>t.name==='combat_prepare'))throw Error('Missing combat_prepare');send({id:2,result:{thread:{id:'thread'}}});}
else if(m.id===3){send({id:3,result:{turn:{id:'turn'}}});send({id:10,method:'item/tool/call',params:{threadId:'thread',turnId:'turn',callId:'prepare',tool:'combat_prepare',arguments:${batch}}});}
else if(m.id===10){if(!m.result.success)throw Error('Prepare rejected');send({method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed',items:[{type:'agentMessage',text:JSON.stringify({payload_json:JSON.stringify(${response})})}]}}});}
});`;
const antigravity = `
import {readFileSync} from 'node:fs';import {homedir} from 'node:os';import path from 'node:path';
const args=process.argv.slice(2);
if(args.includes('changelog'))console.log('9.9.9:');
else if(args.includes('/hooks'))console.log(JSON.stringify({command:{data:{hooks:[]}}}));
else {let text='';process.stdin.on('data',c=>text+=c);process.stdin.on('end',async()=>{
const agent=readFileSync(path.join(homedir(),'.gemini','config','agents',args[args.indexOf('--agent')+1],'agent.md'),'utf8');
const server=JSON.parse(/^mcpServers: (.+)$/m.exec(agent)[1])[0];
const permissions=JSON.parse(readFileSync(path.join(homedir(),'.gemini','antigravity-cli','settings.json'),'utf8')).permissions;
if(!permissions.allow.includes('mcp(local_rpg/combat_prepare)'))throw Error('combat_prepare not permitted');
console.log(JSON.stringify({event:'init',init:{agent:args[args.indexOf('--agent')+1]}}));
const input=${batch};
const Arguments=process.env.RPG_COMBAT_STRING==='1'?JSON.stringify(input):input;
console.log(JSON.stringify({event:'step_update',step_update:{step_type:'agent_response',step_index:0,state:'DONE',usage:{input_tokens:100,output_tokens:10}}}));
console.log(JSON.stringify({event:'step_update',step_update:{step_type:'tool',step_index:1,state:'ACTIVE',tool_name:'call_mcp_tool',tool_info:{parameters:{ServerName:'local_rpg',ToolName:'combat_prepare',Arguments}}}}));
if(process.env.RPG_COMBAT_OVERSIZE==='1'){await new Promise(r=>setTimeout(r,200));process.exit(3);}
const reply=await fetch(server.serverUrl,{method:'POST',headers:{...server.headers,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:10,method:'tools/call',params:{name:'combat_prepare',arguments:input}})});
const payload=await reply.json();if(payload.result.isError)throw Error('Prepare rejected');
console.log(JSON.stringify({event:'step_update',step_update:{step_type:'tool',step_index:1,state:'DONE',tool_name:'call_mcp_tool'}}));
console.log(JSON.stringify({event:'step_update',step_update:{step_type:'agent_response',step_index:2,state:'DONE',usage:{input_tokens:1000,output_tokens:100,cache_read_tokens:0}}}));
console.log(JSON.stringify({event:'result',result:{status:'SUCCESS',num_turns:1,usage:{input_tokens:1000},response:JSON.stringify(${response})}}));
});}`;

function combatBatch(historyChars: number) {
  return {
    localKey: 'ambush',
    participants: ['a', 'b'].map((key) => ({
      localKey: `soldier-${key}`,
      label: 'Soldier',
      character: {
        name: 'Soldier',
        type: 'npc',
        attributes: { health: { damage: 0 } },
        inventory: {},
        description: { history: 'é'.repeat(historyChars) },
      },
      introduction: { origin: 'gm', evidence: [], visibility: 'player' },
      trackedFields: [{ path: ['health', 'damage'], kind: 'damage', label: 'Damage' }],
    })),
  };
}
function registry(prepared: unknown[]) {
  const unexpected = async (): Promise<never> => {
    throw Error('Unexpected dice');
  };
  const tools = ownedTools({
    roll: unexpected,
    knowledge: freezeKnowledge(newCampaign({ name: 'Frozen' }), true),
    prepareCombat: async (input) => {
      prepared.push(input);
      return { receiptId: 'fixture', encounterId: 'fixture' };
    },
  });
  return {
    adapter: {
      dispatch: tools.call,
      definitions: tools.definitions,
      schema: gameplayResponseWireJsonSchema,
      systemPrompt: 'ENVELOPE_NATIVE',
    },
  };
}

test('all native transports carry a multi-kilobyte combat_prepare batch through the owned registry', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rpg-v6-adapter-test-'));
  try {
    for (const [name, script, string] of [
      ['claude', claude, false],
      ['codex', codex, false],
      ['agy', antigravity, false],
      ['agy', antigravity, true],
    ] as const) {
      const prepared: unknown[] = [];
      const { adapter } = registry(prepared);
      const filename = path.join(directory, `${name}.mjs`);
      await writeFile(filename, script);
      const executable = { binary: process.execPath, prefix: [filename] };
      const settings = { provider: name, model: 'fixture', effort: null };
      const input = combatBatch(2000);
      assert.ok(Buffer.byteLength(JSON.stringify(input)) > 4608);
      const env = {
        ...process.env,
        RPG_COMBAT_BATCH: JSON.stringify(input),
        RPG_COMBAT_STRING: string ? '1' : '0',
      };
      const result =
        name === 'claude'
          ? await generateClaudeDice(executable, settings, 'DATA', directory, env, adapter)
          : name === 'codex'
            ? await runCodexDicePhases(executable, settings, 'DATA', directory, env, {}, adapter)
            : await generateAntigravityDice(executable, settings, 'DATA', directory, env, adapter);
      assert.equal((result as { narrative: string }).narrative, 'Two soldiers step forward.', name);
      assert.deepEqual(prepared, [input], name);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Antigravity rejects an oversize combat_prepare envelope before dispatch', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rpg-v6-agy-oversize-'));
  try {
    const prepared: unknown[] = [];
    const { adapter } = registry(prepared);
    const filename = path.join(directory, 'agy.mjs');
    await writeFile(filename, antigravity);
    // ~1.2 MB of UTF-8 although well under one million JavaScript characters.
    const input = combatBatch(300_000);
    await assert.rejects(
      generateAntigravityDice(
        { binary: process.execPath, prefix: [filename] },
        { provider: 'agy', model: 'fixture', effort: null },
        'DATA',
        directory,
        { ...process.env, RPG_COMBAT_BATCH: JSON.stringify(input), RPG_COMBAT_OVERSIZE: '1' },
        adapter
      )
    );
    assert.deepEqual(prepared, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
