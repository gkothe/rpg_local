import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateClaudeDice } from '../src/providers/claudeDice.js';
import { runCodexDicePhases } from '../src/providers/codexDice.js';
import { generateAntigravityDice } from '../src/providers/antigravityDice.js';
const claude = `
const args=process.argv.slice(2);
if(args.includes('--version'))console.log('2.1.232 (Claude Code)');
else { process.stdin.resume();process.stdin.on('end',()=>{
const tools=args[args.indexOf('--allowedTools')+1].split(',');
const book=tools.length===5;
console.log(JSON.stringify({type:'system',subtype:'init',tools,mcp_servers:[{name:'dice',status:'connected'}]}));
console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,num_turns:1,result:JSON.stringify({version:book?3:2,narrative:'Original synthetic response',operations:[],rollInterpretations:[],...(book?{ruleCitations:[]}:{})}),modelUsage:{fixture:{contextWindow:128000,outputTokens:100}}}));
});}`;
const codex = `
import readline from 'node:readline';
const lines=readline.createInterface({input:process.stdin});
const send=x=>console.log(JSON.stringify(x));let book=false;
lines.on('line',raw=>{const m=JSON.parse(raw);
if(m.id===1)send({id:1,result:{}});
else if(m.id===2){book=m.params.dynamicTools.length===5;send({id:2,result:{thread:{id:'thread'}}});}
else if(m.id===3){send({id:3,result:{turn:{id:'turn'}}});send({method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed',items:[{type:'agentMessage',text:JSON.stringify({payload_json:JSON.stringify({version:book?3:2,narrative:'Original synthetic response',operations:[],rollInterpretations:[],...(book?{ruleCitations:[]}:{})})})}]}}});}
});`;
const antigravity = `
import {readFileSync} from 'node:fs';import {homedir} from 'node:os';import path from 'node:path';
const args=process.argv.slice(2);
if(args.includes('changelog'))console.log('1.2.14:');
else if(args.includes('/hooks'))console.log(JSON.stringify({command:{data:{hooks:[]}}}));
else {let text='';process.stdin.on('data',c=>text+=c);process.stdin.on('end',async()=>{
let book=false; {const agent=readFileSync(path.join(homedir(),'.gemini','config','agents',args[args.indexOf('--agent')+1],'agent.md'),'utf8');
const server=JSON.parse(/^mcpServers: (.+)$/m.exec(agent)[1])[0];
const response=await fetch(server.serverUrl,{method:'POST',headers:{...server.headers,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});
const definitions=(await response.json()).result.tools;
book=definitions.length===5;
if(server.name!=='local_rpg'||definitions.map(x=>x.name).sort().join(',')!==(book?'roll_dice,rules_get,rules_list,rules_map,rules_search':'roll_dice'))throw new Error('Mode must use its private actual MCP tool definitions');
const permissions=JSON.parse(readFileSync(path.join(homedir(),'.gemini','antigravity-cli','settings.json'),'utf8')).permissions;
if(permissions.allow.length!==definitions.length||!permissions.deny.includes('read_file(*)'))throw new Error('Permissions must be private and bounded');}
console.log(JSON.stringify({event:'init',init:{agent:args[args.indexOf('--agent')+1]}}));
const phase={kind:'final',response:{version:book?3:2,narrative:'Original synthetic response',operations:[],rollInterpretations:[],...(book?{ruleCitations:[]}:{})}};
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
        const output =
          name === 'claude'
            ? await generateClaudeDice(
                executable,
                settings,
                'Original synthetic context',
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
                  'Original synthetic context',
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
                  'Original synthetic context',
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
