import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { generateCodex } from '../src/providers/codex.js';
import { generateAntigravity } from '../src/providers/antigravity.js';
import { runProcess } from '../src/providers/processRunner.js';
import { providerArgs, parseProviderOutput } from '../src/providers/adapters.js';
import {
  narrativeHumanizerPrompt,
  narrativeHumanizerJsonSchema,
} from '../src/domain/narrativeHumanizer.js';

test('all ordinary editor transports expose no gameplay or external MCP tools', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'rpg-editor-adapters-'));
  const narrative = 'Mira waits.\n\nWhat do you do?';
  const prompt = narrativeHumanizerPrompt(narrative);
  const schemaPath = path.join(directory, 'editor.schema.json');
  try {
    await writeFile(schemaPath, JSON.stringify(narrativeHumanizerJsonSchema));
    await writeFile(path.join(directory, 'auth.json'), 'synthetic fixture');
    await writeFile(
      path.join(directory, 'models_cache.json'),
      JSON.stringify({
        models: [
          {
            slug: 'fixture',
            display_name: 'Fixture',
            visibility: 'list',
            context_window: 128000,
            supported_reasoning_levels: [{ effort: 'high' }],
          },
        ],
      })
    );
    for (const provider of ['codex', 'claude', 'agy']) {
      const file = path.join(directory, `${provider}.mjs`);
      await writeFile(
        file,
        `import {readFileSync} from 'node:fs';import {homedir} from 'node:os';import path from 'node:path';
        const args=process.argv.slice(2), provider=${JSON.stringify(provider)}, response=${JSON.stringify({ narrative })};
        if(args.includes('/hooks')) console.log(JSON.stringify({command:{data:{hooks:[]}}}));
        else if(args.includes('--version')) console.log('codex-cli 0.159.2');
        else if(args.includes('login')) console.log('Logged in using ChatGPT');
        else { let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{
          if(provider==='codex') {
            if(!args.includes('exec')||args.includes('app-server')||!args.includes('--ephemeral'))throw Error('Editor must use ordinary isolated exec');
            const config=args.filter((a,i)=>args[i-1]==='-c');
            if(!args.includes('--ignore-user-config')||!config.includes('features.shell_tool=false'))throw Error('Ambient tools must be disabled');
            console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify({payload_json:JSON.stringify(response)})}}));
            console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:100,output_tokens:10}}));
          } else if(provider==='claude') {
            if(args[args.indexOf('--tools')+1]!==''||args[args.indexOf('--mcp-config')+1]!=='{"mcpServers":{}}')throw Error('Editor tools must be empty');
            console.log(JSON.stringify({structured_output:response}));
          } else {
            const name=args[args.indexOf('--agent')+1], definition=readFileSync(path.join(homedir(),'.gemini','config','agents',name,'agent.md'),'utf8');
            if(!definition.includes('tools: []')||!definition.includes('inheritMcp: false')||definition.includes('mcpServers:'))throw Error('Editor must not expose MCP');
            console.log(JSON.stringify({event:'init',init:{agent:name}}));
            console.log(JSON.stringify({event:'result',result:{status:'SUCCESS',num_turns:1,usage:{input_tokens:100},response:JSON.stringify(response)}}));
          }
        }); }`
      );
      const executable = { binary: process.execPath, prefix: [file] };
      const settings = { provider, model: 'fixture', effort: 'high' };
      const output =
        provider === 'codex'
          ? await generateCodex(executable, settings, prompt, schemaPath, directory, {
              ...process.env,
              CODEX_HOME: directory,
            })
          : provider === 'agy'
            ? await generateAntigravity(
                executable,
                settings,
                prompt,
                narrativeHumanizerJsonSchema,
                directory,
                process.env
              )
            : await runProcess(
                executable.binary,
                [
                  ...executable.prefix,
                  ...providerArgs(provider, settings, schemaPath, narrativeHumanizerJsonSchema),
                ],
                prompt,
                { cwd: directory, timeoutMs: 0 }
              );
      assert.deepEqual(parseProviderOutput(provider, output), { narrative });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
