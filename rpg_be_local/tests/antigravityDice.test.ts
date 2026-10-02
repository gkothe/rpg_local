import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  antigravityDiceEnvironment,
  generateAntigravityDice,
  parseAntigravityDicePhase,
} from '../src/providers/antigravityDice.js';

const settings = { provider: 'agy', model: 'fixture', effort: null };
const request = {
  slot: 0,
  groups: [{ label: 'check', count: 1, sides: 6 }],
  reason: 'Check',
  declaration: 'No modifiers or target',
};
const fixture = `
const args=process.argv.slice(2);
if(args.includes('changelog')) console.log('1.2.14:');
else if(args.includes('/hooks')) {
  if(process.env.RPG_TEST_AGY_MODE==='hooks') setTimeout(()=>{},10000);
  else console.log(JSON.stringify({command:{data:{hooks:[]}}}));
} else {
  let raw=''; process.stdin.on('data',c=>raw+=c); process.stdin.on('end',()=>{
    const text=JSON.parse(raw).message.content;
    const history=JSON.parse(text.split('Application-owned executed tool transcript:').at(-1));
    const tool={kind:'tool_call',tool:'roll_dice',arguments:${JSON.stringify(request)}};
    tool.arguments.slot=history.length;
    const response=history.length<2 ? tool : {kind:'final',response:{version:2,narrative:history.map(r=>r.result.groups[0].faces[0]).join(','),operations:[],rollInterpretations:history.map(r=>({rollId:r.result.rollId,explanation:'Recorded face '+r.result.groups[0].faces[0]}))}};
    console.log(JSON.stringify({event:'init',init:{agent:args[args.indexOf('--agent')+1]}}));
    if(process.env.RPG_TEST_AGY_MODE==='native') console.log(JSON.stringify({event:'step_update',step_update:{step_type:'run_command'}}));
    console.log(JSON.stringify({event:'result',result:{status:'SUCCESS',num_turns:1,usage:{input_tokens:1000},response:JSON.stringify(response)}}));
  });
}`;

test('Antigravity rejects intrinsic native tools, error framing and opaque repeated inference turns', () => {
  const response = {
    kind: 'final',
    response: {
      version: 3,
      narrative: 'Original fixture',
      operations: [],
      rollInterpretations: [],
      ruleCitations: [],
    },
  };
  const events = [
    { event: 'init', init: { agent: 'local-rpg-original' } },
    {
      event: 'result',
      result: {
        status: 'SUCCESS',
        num_turns: 1,
        usage: { input_tokens: 1000 },
        response: JSON.stringify(response),
      },
    },
  ];
  for (const step of [
    { step_type: 'tool', tool_name: 'manage_task' },
    { step_type: 'tool', tool_name: 'list_resources' },
    { step_type: 'error_message' },
  ])
    assert.throws(
      () =>
        parseAntigravityDicePhase(
          [events[0], { event: 'step_update', step_update: step }, events[1]]
            .map((event) => JSON.stringify(event))
            .join('\n'),
          true
        ),
      /unapproved phase activity/
    );
  assert.throws(
    () =>
      parseAntigravityDicePhase(
        [events[0], { event: 'result', result: { ...events[1]!.result, num_turns: 4 } }]
          .map((event) => JSON.stringify(event))
          .join('\n'),
        true
      ),
    /one isolated GM turn/
  );
});

test('Antigravity explicit tool phases preserve canonical faces and stop on a structured final', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rpg-agy-dice-test-'));
  try {
    const filename = path.join(root, 'cli.mjs');
    await writeFile(filename, fixture);
    const ids: string[] = [];
    const response = (await generateAntigravityDice(
      { binary: process.execPath, prefix: [filename] },
      settings,
      'Synthetic context',
      root,
      process.env,
      async (input) => {
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
      }
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
        async () => {
          calls++;
          throw new Error('Unexpected callback');
        }
      ),
      /unapproved phase activity/
    );
    assert.equal(calls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Antigravity cancellation during setup cannot draw dice and oversized phase context fails', async () => {
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
        roll,
        AbortSignal.timeout(200)
      ),
      /cancelled/
    );
    await assert.rejects(
      generateAntigravityDice(
        { binary: process.execPath, prefix: [filename] },
        settings,
        'x'.repeat(12800),
        root,
        process.env,
        roll
      ),
      /reserved context/
    );
    assert.equal(calls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Antigravity rejects foreign tool envelopes and strips inherited configuration overrides', () => {
  const envelope = (tool: string) =>
    [
      { event: 'init', init: { agent: 'local-rpg-fixture' } },
      {
        event: 'result',
        result: {
          status: 'SUCCESS',
          num_turns: 1,
          usage: { input_tokens: 1000 },
          response: JSON.stringify({ kind: 'tool_call', tool, arguments: request }),
        },
      },
    ]
      .map((event) => JSON.stringify(event))
      .join('\n');
  assert.throws(() => parseAntigravityDicePhase(envelope('shell')), /invalid application/);
  const env = antigravityDiceEnvironment({
    PATH: 'local',
    GOOGLE_API_KEY: 'fixture',
    ANTIGRAVITY_APP_DATA_DIR: 'fixture',
    CASCADE_GLOBAL_CONFIG_OVERRIDE: 'fixture',
  });
  assert.deepEqual(env, { PATH: 'local' });
});
