import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateClaudeDice } from '../src/providers/claudeDice.js';
import { runCodexDicePhases } from '../src/providers/codexDice.js';
import { generateAntigravityDice } from '../src/providers/antigravityDice.js';
import { GameplayTools } from '../src/providers/gameplayTools.js';
import { gameplayResponseJsonSchema } from '../src/domain/gameplayResponse.js';
import { newCampaign } from '../src/domain/campaign.js';
import { freezeKnowledge } from '../src/domain/knowledgeRecall.js';
const claude = `
const args=process.argv.slice(2);
if(args.includes('--version'))console.log('9.9.9 (Claude Code)');
else { process.stdin.resume();process.stdin.on('end',()=>{
const tools=args[args.indexOf('--allowedTools')+1].split(',');
const book=tools.some(t=>t.endsWith('rules_get'));const knowledge=tools.some(t=>t.endsWith('campaign_knowledge_get'));if(knowledge&&!args[args.indexOf('--system-prompt')+1].includes('ENVELOPE_NATIVE'))throw Error('Missing envelope');
console.log(JSON.stringify({type:'system',subtype:'init',tools,mcp_servers:[{name:'dice',status:'connected'}]}));
console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,num_turns:1,result:JSON.stringify({version:knowledge?4:book?3:2,narrative:'Original synthetic response',operations:[],rollInterpretations:[],...((book||knowledge)?{ruleCitations:[]}:{ }),...(knowledge?{knowledgeChanges:[]}:{})}),modelUsage:{fixture:{contextWindow:128000,outputTokens:100}}}));
});}`;
const codex = `
import readline from 'node:readline';
const lines=readline.createInterface({input:process.stdin});
const send=x=>console.log(JSON.stringify(x));let book=false,knowledge=false;
lines.on('line',raw=>{const m=JSON.parse(raw);
if(m.id===1)send({id:1,result:{}});
else if(m.id===2){book=m.params.dynamicTools.some(t=>t.name==='rules_get');knowledge=m.params.dynamicTools.some(t=>t.name==='campaign_knowledge_get');send({id:2,result:{thread:{id:'thread'}}});}
else if(m.id===3){send({id:3,result:{turn:{id:'turn'}}});send({method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed',items:[{type:'agentMessage',text:JSON.stringify({payload_json:JSON.stringify({version:knowledge?4:book?3:2,narrative:'Original synthetic response',operations:[],rollInterpretations:[],...((book||knowledge)?{ruleCitations:[]}:{ }),...(knowledge?{knowledgeChanges:[]}:{})})})}]}}});}
});`;
const antigravity = `
import {readFileSync} from 'node:fs';import {homedir} from 'node:os';import path from 'node:path';
const args=process.argv.slice(2);
if(args.includes('changelog'))console.log('9.9.9:');
else if(args.includes('/hooks'))console.log(JSON.stringify({command:{data:{hooks:[]}}}));
else {let text='';process.stdin.on('data',c=>text+=c);process.stdin.on('end',async()=>{
let book=false,knowledge=false; {const agent=readFileSync(path.join(homedir(),'.gemini','config','agents',args[args.indexOf('--agent')+1],'agent.md'),'utf8');
const server=JSON.parse(/^mcpServers: (.+)$/m.exec(agent)[1])[0];
const response=await fetch(server.serverUrl,{method:'POST',headers:{...server.headers,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});
const definitions=(await response.json()).result.tools;
book=definitions.some(t=>t.name==='rules_get');knowledge=definitions.some(t=>t.name==='campaign_knowledge_get');if(knowledge&&!agent.includes('ENVELOPE_NATIVE'))throw Error('Missing envelope');
if(knowledge&&agent.split('Owned MCP argument schemas:').length!==2)throw Error('V4 requires exactly one canonical MCP argument schema block');
if(!knowledge&&!agent.includes('Owned MCP argument schemas:'))throw Error('Legacy textual schema guidance changed');
if(knowledge&&definitions.map(x=>x.name).sort().join(',')!==(book?'campaign_knowledge_get,campaign_knowledge_search,roll_dice,rules_get,rules_list,rules_map,rules_search':'campaign_knowledge_get,campaign_knowledge_search,roll_dice'))throw Error('Native MCP schema discovery lost owned capabilities');
if(server.name!=='local_rpg'||!knowledge&&definitions.map(x=>x.name).sort().join(',')!==(book?'roll_dice,rules_get,rules_list,rules_map,rules_search':'roll_dice'))throw new Error('Mode must use its private actual MCP tool definitions');
const permissions=JSON.parse(readFileSync(path.join(homedir(),'.gemini','antigravity-cli','settings.json'),'utf8')).permissions;
if(permissions.allow.length!==definitions.length||!permissions.deny.includes('read_file(*)'))throw new Error('Permissions must be private and bounded');}
console.log(JSON.stringify({event:'init',init:{agent:args[args.indexOf('--agent')+1]}}));
const phase={kind:'final',response:{version:knowledge?4:book?3:2,narrative:'Original synthetic response',operations:[],rollInterpretations:[],...((book||knowledge)?{ruleCitations:[]}:{ }),...(knowledge?{knowledgeChanges:[]}:{})}};
console.log(JSON.stringify({event:'step_update',step_update:{step_type:'agent_response',step_index:1,state:'DONE',usage:{input_tokens:1000,output_tokens:100,cache_read_tokens:0}}}));
console.log(JSON.stringify({event:'result',result:{status:'SUCCESS',num_turns:1,usage:{input_tokens:1000},response:JSON.stringify(phase.response)}}));
});}`;
test('all three candidate adapters positively accept selected book-v3 and preserve default-v2 final contracts', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rpg-rule-adapter-test-'));
  const unexpected = async (): Promise<never> => {
    throw new Error('Unexpected tool');
  };
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
      for (const book of [undefined, { dispatch: unexpected }]) {
        const prompt = book
          ? 'Original synthetic context ' + 'x'.repeat(18000)
          : 'Original synthetic context';
        const output =
          name === 'claude'
            ? await generateClaudeDice(
                executable,
                settings,
                prompt,
                directory,
                process.env,
                unexpected,
                undefined,
                book
              )
            : name === 'codex'
              ? await runCodexDicePhases(
                  executable,
                  settings,
                  prompt,
                  directory,
                  process.env,
                  {},
                  unexpected,
                  undefined,
                  book
                )
              : await generateAntigravityDice(
                  executable,
                  settings,
                  prompt,
                  directory,
                  process.env,
                  unexpected,
                  undefined,
                  book
                );
        assert.equal((output as { version: number }).version, book ? 3 : 2);
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('all native transports dispatch explicit v4 with the owned no-library knowledge registry', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rpg-v4-adapter-test-'));
  const unexpected = async (): Promise<never> => {
    throw Error('Unexpected dice');
  };
  const registry = new GameplayTools({
    book: false,
    roll: unexpected,
    assertActive: async () => {},
    knowledge: freezeKnowledge(newCampaign({ name: 'Frozen' })),
  });
  const adapter = {
    dispatch: registry.call,
    definitions: registry.definitions,
    schema: gameplayResponseJsonSchema,
    systemPrompt: 'ENVELOPE_NATIVE',
  };
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
      const result =
        name === 'claude'
          ? await generateClaudeDice(
              executable,
              settings,
              'DATA_ONLY',
              directory,
              process.env,
              unexpected,
              undefined,
              adapter
            )
          : name === 'codex'
            ? await runCodexDicePhases(
                executable,
                settings,
                'DATA_ONLY',
                directory,
                process.env,
                {},
                unexpected,
                undefined,
                adapter
              )
            : await generateAntigravityDice(
                executable,
                settings,
                'DATA_ONLY',
                directory,
                process.env,
                unexpected,
                undefined,
                adapter
              );
      assert.equal((result as { version: number }).version, 4);
      assert.deepEqual((result as { knowledgeChanges: unknown[] }).knowledgeChanges, []);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
