import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateClaudeDice } from '../src/providers/claudeDice.js';
import { runCodexDicePhases } from '../src/providers/codexDice.js';
import { generateAntigravityDice } from '../src/providers/antigravityDice.js';
import { gameplayResponseWireJsonSchema } from '../src/domain/gameplayResponse.js';
import { newCampaign } from '../src/domain/campaign.js';
import { freezeKnowledge } from '../src/domain/knowledgeRecall.js';
import { ownedTools } from './ownedGameplayFixture.js';
const claude = `
const args=process.argv.slice(2);
if(args.includes('--version'))console.log('9.9.9 (Claude Code)');
else { process.stdin.resume();process.stdin.on('end',async()=>{
const tools=args[args.indexOf('--allowedTools')+1].split(',');
if(!args[args.indexOf('--system-prompt')+1].includes('ENVELOPE_NATIVE'))throw Error('Missing envelope');
console.log(JSON.stringify({type:'system',subtype:'init',tools,mcp_servers:[{name:'dice',status:'connected'}]}));
if(process.env.RPG_ADAPTER_FIND==='1') {
const server=JSON.parse(args[args.indexOf('--mcp-config')+1]).mcpServers.dice;
if(!tools.some(t=>t.endsWith('rules_find')))throw Error('Missing find');
const response=await fetch(server.url,{method:'POST',headers:{...server.headers,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:10,method:'tools/call',params:{name:'rules_find',arguments:{query:'movement'}}})});
const payload=await response.json();if(payload.result.isError||JSON.parse(payload.result.content[0].text).reads[0].text!=='Original movement')throw Error('Original not received');
}
console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,num_turns:1,result:JSON.stringify({narrative:'Original synthetic response',operations:[],rollInterpretations:[],ruleCitations:[],knowledgeChanges:JSON.parse(process.env.RPG_ADAPTER_KNOWLEDGE||'[]'),operationExplanations:[],combatEffects:[],participantReferences:[]}),modelUsage:{fixture:{contextWindow:128000,outputTokens:100}}}));
});}`;
const codex = `
import readline from 'node:readline';
const lines=readline.createInterface({input:process.stdin});
const send=x=>console.log(JSON.stringify(x));
lines.on('line',raw=>{const m=JSON.parse(raw);
if(m.id===1)send({id:1,result:{}});
else if(m.id===2){if(m.params.dynamicTools.map(t=>t.name).sort().join(',')!==process.env.RPG_ADAPTER_TOOLS)throw Error('Owned tools changed');send({id:2,result:{thread:{id:'thread'}}});}
else if(m.id===3){send({method:'thread/tokenUsage/updated',params:{threadId:process.env.RPG_ADAPTER_FOREIGN_USAGE==='1'?'foreign':'thread',tokenUsage:{last:{outputTokens:10}}}});send({id:3,result:{turn:{id:'turn'}}});if(process.env.RPG_ADAPTER_FIND==='1'){send({id:10,method:'item/tool/call',params:{threadId:'thread',turnId:'turn',callId:'find-call',tool:'rules_find',arguments:{query:'movement'}}});return;}finish();}
else if(m.id===10){if(!m.result.success||JSON.parse(m.result.contentItems[0].text).reads[0].text!=='Original movement')throw Error('Original not received');finish();}
});
function finish(){send({method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed',items:[{type:'agentMessage',text:JSON.stringify({payload_json:JSON.stringify({narrative:'Original synthetic response',operations:[],rollInterpretations:[],ruleCitations:[],knowledgeChanges:JSON.parse(process.env.RPG_ADAPTER_KNOWLEDGE||'[]'),operationExplanations:[],combatEffects:[],participantReferences:[]})})}]}}});}
`;
const antigravity = `
import {readFileSync} from 'node:fs';import {homedir} from 'node:os';import path from 'node:path';
const args=process.argv.slice(2);
if(args.includes('changelog'))console.log('9.9.9:');
else if(args.includes('/hooks'))console.log(JSON.stringify({command:{data:{hooks:[]}}}));
else {let text='';process.stdin.on('data',c=>text+=c);process.stdin.on('end',async()=>{
let server; {const agent=readFileSync(path.join(homedir(),'.gemini','config','agents',args[args.indexOf('--agent')+1],'agent.md'),'utf8');
server=JSON.parse(/^mcpServers: (.+)$/m.exec(agent)[1])[0];
const response=await fetch(server.serverUrl,{method:'POST',headers:{...server.headers,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});
const definitions=(await response.json()).result.tools;
if(!agent.includes('ENVELOPE_NATIVE'))throw Error('Missing envelope');
if(agent.split('Owned MCP argument schemas:').length!==2)throw Error('Exactly one canonical MCP argument schema block is required');
if(server.name!=='local_rpg'||definitions.map(x=>x.name).sort().join(',')!==process.env.RPG_ADAPTER_TOOLS)throw Error('Native MCP schema discovery lost owned capabilities');
const permissions=JSON.parse(readFileSync(path.join(homedir(),'.gemini','antigravity-cli','settings.json'),'utf8')).permissions;
if(permissions.allow.length!==definitions.length||!permissions.deny.includes('read_file(*)'))throw new Error('Permissions must be private and bounded');}
console.log(JSON.stringify({event:'init',init:{agent:args[args.indexOf('--agent')+1]}}));
if(process.env.RPG_ADAPTER_FIND==='1') {
const input={query:'movement'};
console.log(JSON.stringify({event:'step_update',step_update:{step_type:'agent_response',step_index:0,state:'DONE',usage:{input_tokens:100,output_tokens:10}}}));
console.log(JSON.stringify({event:'step_update',step_update:{step_type:'tool',step_index:2,state:'ACTIVE',tool_name:'call_mcp_tool',tool_info:{parameters:{ServerName:'local_rpg',ToolName:'rules_find',Arguments:input}}}}));
const response=await fetch(server.serverUrl,{method:'POST',headers:{...server.headers,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:10,method:'tools/call',params:{name:'rules_find',arguments:input}})});
const payload=await response.json();if(payload.result.isError||JSON.parse(payload.result.content[0].text).reads[0].text!=='Original movement')throw Error('Original not received');
console.log(JSON.stringify({event:'step_update',step_update:{step_type:'tool',step_index:2,state:'DONE',tool_name:'call_mcp_tool'}}));
}
const phase={kind:'final',response:{narrative:'Original synthetic response',operations:[],rollInterpretations:[],ruleCitations:[],knowledgeChanges:JSON.parse(process.env.RPG_ADAPTER_KNOWLEDGE||'[]'),operationExplanations:[],combatEffects:[],participantReferences:[]}};
console.log(JSON.stringify({event:'step_update',step_update:{step_type:'agent_response',step_index:1,state:'DONE',usage:{input_tokens:1000,output_tokens:100,cache_read_tokens:0}}}));
console.log(JSON.stringify({event:'result',result:{status:'SUCCESS',num_turns:1,usage:{input_tokens:1000},response:JSON.stringify(phase.response)}}));
});}`;
const fixtureKnowledge = [
  {
    op: 'create',
    kind: 'event',
    title: 'Gate',
    text: 'The gate is locked.',
    certainty: 'established',
    status: 'active',
    characterIds: [],
    origin: 'source',
    visibility: 'gm_only',
    evidence: [
      {
        type: 'campaign_source',
        sourceId: '11111111-1111-4111-8111-111111111111',
        sourceName: 'Preparation',
        version: 1,
        quote: 'The gate is locked.',
      },
    ],
  },
];
function adapter(book: boolean) {
  const registry = ownedTools({
    book,
    read: async (tool) =>
      tool === 'rules_search'
        ? { entries: [{ path: 'core_rules.book.movement', readableOriginal: true }] }
        : { receipt: 'fixture-receipt', text: 'Original movement' },
    knowledge: freezeKnowledge(newCampaign({ name: 'Frozen' }), true),
    readCampaignSource: async () => ({ entries: [], nextCursor: null, reason: 'no_match' }),
  });
  return {
    dispatch: registry.call,
    definitions: registry.definitions,
    schema: gameplayResponseWireJsonSchema,
    systemPrompt: 'ENVELOPE_NATIVE',
  };
}

test('all native transports carry the owned registry with and without a rule library', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rpg-owned-adapter-test-'));
  try {
    for (const [name, script] of [
      ['claude', claude],
      ['codex', codex],
      ['agy', antigravity],
    ] as const) {
      const filename = path.join(directory, `${name}.mjs`);
      await writeFile(filename, script);
      const executable = { binary: process.execPath, prefix: [filename] };
      const settings = { provider: name, model: 'fixture', effort: null };
      for (const book of [false, true]) {
        const owned = adapter(book);
        const env = {
          ...process.env,
          RPG_ADAPTER_FIND: book ? '1' : '0',
          RPG_ADAPTER_KNOWLEDGE: JSON.stringify(fixtureKnowledge),
          RPG_ADAPTER_TOOLS: owned.definitions
            .map((definition) => definition.name)
            .sort()
            .join(','),
        };
        const result =
          name === 'claude'
            ? await generateClaudeDice(executable, settings, 'DATA_ONLY', directory, env, owned)
            : name === 'codex'
              ? await runCodexDicePhases(
                  executable,
                  settings,
                  'DATA_ONLY',
                  directory,
                  env,
                  {},
                  owned
                )
              : await generateAntigravityDice(
                  executable,
                  settings,
                  'DATA_ONLY',
                  directory,
                  env,
                  owned
                );
        assert.equal((result as { narrative: string }).narrative, 'Original synthetic response');
        assert.deepEqual(
          (result as { knowledgeChanges: unknown[] }).knowledgeChanges,
          fixtureKnowledge
        );
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Codex usage diagnostics cannot cross the owned thread boundary', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rpg-usage-owner-'));
  try {
    const script = path.join(directory, 'codex.mjs');
    await writeFile(script, codex);
    await assert.rejects(
      runCodexDicePhases(
        { binary: process.execPath, prefix: [script] },
        { provider: 'codex', model: 'fixture', effort: null },
        'Synthetic context',
        directory,
        {
          ...process.env,
          RPG_ADAPTER_FOREIGN_USAGE: '1',
          RPG_ADAPTER_TOOLS: adapter(false)
            .definitions.map((definition) => definition.name)
            .sort()
            .join(','),
        },
        {},
        adapter(false)
      ),
      (error: unknown) => (error as { code: string }).code === 'dice_isolation'
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
