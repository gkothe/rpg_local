import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DiceProtocol } from '../src/providers/diceProtocol.js';
import { generateCodexDice } from '../src/providers/codexDice.js';
import { claudeDiceEnvironment, generateClaudeDice } from '../src/providers/claudeDice.js';
const input = {
  slot: 0,
  groups: [{ label: 'check', count: 1, sides: 6 }],
  reason: 'Check',
  declaration: 'No modifiers',
};
test('transport receipts reject other tools, changed identities and excessive calls without replacing faces', async () => {
  let calls = 0;
  const protocol = new DiceProtocol(async () => {
    calls++;
    return {
      rollId: randomUUID(),
      slot: 0,
      groups: [{ label: 'check', sides: 6, faces: [4] }],
      reused: false,
    };
  });
  const original = await protocol.call('roll_dice', input, 'first');
  assert.deepEqual(await protocol.call('roll_dice', input, 'first'), original);
  assert.equal(calls, 1);
  await assert.rejects(protocol.call('shell', input, 'other'), /outside/);
  await assert.rejects(
    protocol.call('roll_dice', { ...input, declaration: 'Changed' }, 'first'),
    /changed/
  );
  await assert.rejects(
    protocol.call('roll_dice', { ...input, sneaky: 'field' }, 'invalid'),
    /invalid/
  );
  for (let i = 0; i < 20; i++) await protocol.call('roll_dice', input, 'first');
  await assert.rejects(protocol.call('roll_dice', input, 'first'), /limit/);
  assert.equal(calls, 1);
});

test('Claude final output rejects exhausted turns and unverifiable context without accepting partial JSON', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rpg-claude-dice-bounds-'));
  try {
    const script = path.join(root, 'cli.mjs');
    await writeFile(
      script,
      `if(process.argv.includes('--version'))console.log('2.1.232 (Claude Code)');else{process.stdin.resume();process.stdin.on('end',()=>{console.log(JSON.stringify({type:'system',subtype:'init',tools:['mcp__dice__roll_dice'],mcp_servers:[{name:'dice',status:'connected'}]}));console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,num_turns:process.env.RPG_TEST_DICE_MODE==='turns'?26:1,result:'{"fixture":true}',modelUsage:{fixture:{contextWindow:process.env.RPG_TEST_DICE_MODE==='context'?1000:128000,outputTokens:10}}}));});}`
    );
    for (const mode of ['turns', 'context']) {
      await assert.rejects(
        generateClaudeDice(
          { binary: process.execPath, prefix: [script] },
          { provider: 'claude', model: 'sonnet', effort: 'low' },
          'Synthetic',
          root,
          { ...process.env, RPG_TEST_DICE_MODE: mode },
          async () => {
            throw new Error('Unexpected dice');
          }
        ),
        /bounded dice conversation|continuation budget/
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('Codex adapter rejects foreign tools, ambient capabilities and overflow and cleans its isolated login', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rpg-dice-protocol-'));
  try {
    await writeFile(path.join(root, 'auth.json'), 'Synthetic fixture only');
    await writeFile(
      path.join(root, 'models_cache.json'),
      JSON.stringify({
        models: [
          {
            slug: 'fixture',
            display_name: 'Fixture',
            visibility: 'list',
            supported_reasoning_levels: [{ effort: 'low' }],
            context_window: 272000,
          },
        ],
      })
    );
    const script = path.join(root, 'cli.mjs');
    await writeFile(
      script,
      `import readline from 'node:readline';
      const args=process.argv.slice(2);if(args.includes('--version'))console.log('codex-cli 0.159.2');else if(args.includes('login'))console.log('Logged in using ChatGPT');else{
      const send=o=>console.log(JSON.stringify(o));const lines=readline.createInterface({input:process.stdin});
      lines.on('line',raw=>{const m=JSON.parse(raw);if(m.id===1)send({id:1,result:{}});else if(m.id===2)send({id:2,result:{thread:{id:'thread'}}});else if(m.id===3){send({id:3,result:{turn:{id:'turn'}}});
      if(process.env.RPG_TEST_DICE_MODE==='tool')send({id:9,method:'item/tool/call',params:{tool:'shell',arguments:{},callId:'bad',threadId:'thread',turnId:'turn'}});
      else if(process.env.RPG_TEST_DICE_MODE==='ambient')send({method:'item/started',params:{item:{type:'commandExecution'}}});
      else send({method:'thread/tokenUsage/updated',params:{threadId:'thread',tokenUsage:{last:{inputTokens:128001}}}});}});}
    `
    );
    for (const mode of ['tool', 'ambient', 'overflow']) {
      let calls = 0;
      await assert.rejects(
        generateCodexDice(
          { binary: process.execPath, prefix: [script] },
          { provider: 'codex', model: 'fixture', effort: 'low' },
          'Synthetic context',
          root,
          { ...process.env, CODEX_HOME: root, RPG_TEST_DICE_MODE: mode },
          async () => {
            calls++;
            throw new Error('Unexpected dice');
          }
        ),
        /invalid protocol|outside|context budget/
      );
      assert.equal(calls, 0);
      assert.equal(
        (await readdir(root)).filter((name) => name.startsWith('rpg-isolated-')).length,
        0
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('Claude dice rejects extra ambient tools and strips inherited API/customization overrides', async () => {
  const env = claudeDiceEnvironment({
    PATH: 'local',
    ANTHROPIC_API_KEY: 'fixture',
    CLAUDE_CODE_SAFE_MODE: '1',
    CLAUDE_CODE_USE_BEDROCK: '1',
  });
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.CLAUDE_CODE_SAFE_MODE, undefined);
  assert.equal(env.CLAUDE_CODE_USE_BEDROCK, undefined);
  assert.equal(env.CLAUDE_CODE_DISABLE_CLAUDE_MDS, '1');
  const root = await mkdtemp(path.join(os.tmpdir(), 'rpg-claude-dice-protocol-'));
  try {
    const script = path.join(root, 'cli.mjs');
    await writeFile(
      script,
      `if(process.argv.includes('--version'))console.log('2.1.232 (Claude Code)');else {process.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify({type:'system',subtype:'init',tools:['mcp__dice__roll_dice','Bash'],mcp_servers:[{name:'dice',status:'connected'}]})));}`
    );
    let calls = 0;
    await assert.rejects(
      generateClaudeDice(
        { binary: process.execPath, prefix: [script] },
        { provider: 'claude', model: 'sonnet', effort: 'low' },
        'Synthetic',
        root,
        process.env,
        async () => {
          calls++;
          throw new Error('Unexpected dice');
        }
      ),
      /exclusive dice/
    );
    assert.equal(calls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
