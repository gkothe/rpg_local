import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runCodexDicePhases } from '../src/providers/codexDice.js';
import { Problem } from '../src/errors.js';
import { randomUUID } from 'node:crypto';
import { newCampaign } from '../src/domain/campaign.js';
import { freezeKnowledge } from '../src/domain/knowledgeRecall.js';
import { CharacterType } from '../src/domain/options.js';
import { diceInputSchema } from '../src/domain/dice.js';
import { gameplayResponseWireJsonSchema } from '../src/domain/gameplayResponse.js';
import { ownedTools } from './ownedGameplayFixture.js';

for (const code of ['npc_not_found', 'npc_cursor']) {
  test(`Codex corrects ${code} with a fresh call ID and receives actual frozen NPC results`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rpg-codex-npc-'));
    try {
      const c = newCampaign({ name: 'Native NPC' });
      const id = randomUUID();
      c.characters.push({
        id,
        name: 'Marcus',
        type: CharacterType.Npc,
        attributes: { strength: 3 },
        inventory: {},
        description: {},
        notes: 'PRIVATE',
        revision: 1,
      });
      const registry = ownedTools({ knowledge: freezeKnowledge(c, true) });
      const tool = code === 'npc_not_found' ? 'campaign_npcs_get' : 'campaign_npcs_search';
      const badArgs =
        code === 'npc_not_found' ? { id: randomUUID() } : { query: '', cursor: 'bad' };
      const goodArgs = code === 'npc_not_found' ? { id } : { query: 'Marcus' };
      const file = path.join(root, 'cli.mjs');
      await writeFile(
        file,
        `import readline from 'node:readline';
const send=o=>console.log(JSON.stringify(o));
readline.createInterface({input:process.stdin}).on('line',raw=>{
 const m=JSON.parse(raw);
 if(m.id===1)send({id:1,result:{}});
 else if(m.id===2){if(!m.params.dynamicTools.some(t=>t.name==='${tool}'))throw Error('Missing NPC tool');send({id:2,result:{thread:{id:'t'}}});}
 else if(m.id===3){send({id:3,result:{turn:{id:'u'}}});send({id:9,method:'item/tool/call',params:{tool:'${tool}',arguments:${JSON.stringify(badArgs)},callId:'bad',threadId:'t',turnId:'u'}});}
 else if(m.id===9){if(m.result.success!==false)throw Error('Expected recoverable failure');send({id:10,method:'item/tool/call',params:{tool:'${tool}',arguments:${JSON.stringify(goodArgs)},callId:'corrected',threadId:'t',turnId:'u'}});}
 else if(m.id===10){if(!m.result.success||!JSON.stringify(m.result).includes('Marcus')||JSON.stringify(m.result).includes('PRIVATE'))throw Error('Expected private-safe NPC result');send({method:'turn/completed',params:{threadId:'t',turn:{id:'u',status:'completed',items:[{type:'agentMessage',text:JSON.stringify({payload_json:JSON.stringify({narrative:'NPC recalled',operations:[],rollInterpretations:[],ruleCitations:[],knowledgeChanges:[]})})}]}}});}
});`
      );
      const result = await runCodexDicePhases(
        { binary: process.execPath, prefix: [file] },
        { provider: 'codex', model: 'fixture', effort: null },
        'Synthetic NPC action',
        root,
        process.env,
        {},
        {
          dispatch: registry.call,
          definitions: registry.definitions,
          schema: gameplayResponseWireJsonSchema,
          systemPrompt: '',
        }
      );
      assert.equal((result as { narrative: string }).narrative, 'NPC recalled');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

const fixture = `import readline from 'node:readline';
const send=o=>console.log(JSON.stringify(o));
readline.createInterface({input:process.stdin}).on('line',raw=>{
 const m=JSON.parse(raw);
 if(m.id===1)send({id:1,result:{}});
 else if(m.id===2)send({id:2,result:{thread:{id:'t'}}});
 else if(m.id===3){send({id:3,result:{turn:{id:'u'}}});send({id:9,method:'item/tool/call',params:{tool:'roll_dice',arguments:{},callId:'bad',threadId:'t',turnId:'u'}});}
 else if(m.id===9){if(m.result.success!==false)throw Error('Invalid call must fail');send({id:10,method:'item/tool/call',params:{tool:'roll_dice',arguments:{slot:0,groups:[{label:'check',count:1,sides:6}],reason:'Check',declaration:'No modifiers',scope:'oracle'},callId:'corrected',threadId:'t',turnId:'u'}});}
 else if(m.id===10){if(!m.result.success)throw Error('Corrected call must succeed');send({method:'turn/completed',params:{threadId:'t',turn:{id:'u',status:'completed',items:[{type:'agentMessage',text:JSON.stringify({payload_json:JSON.stringify({narrative:'Valid corrected roll',operations:[],rollInterpretations:[]})})}]}}});}
});`;
for (const code of [
  'dice_input',
  'cancelled',
  'gameplay_transport_conflict',
  'rules_context_changed',
  'dice_replay',
  'local_service',
] as const) {
  test(`Codex returns repairable input errors in the same turn and stops ownership errors: ${code}`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rpg-codex-repair-'));
    try {
      const file = path.join(root, 'cli.mjs');
      await writeFile(file, fixture);
      let calls = 0;
      const generate = () =>
        runCodexDicePhases(
          { binary: process.execPath, prefix: [file] },
          { provider: 'codex', model: 'fixture', effort: null },
          'Synthetic',
          root,
          process.env,
          {},
          {
            definitions: ownedTools().definitions,
            schema: gameplayResponseWireJsonSchema,
            systemPrompt: '',
            dispatch: async (_name, input) => {
              // Mirrors DiceService: malformed requests are rejected before any face is drawn.
              if (!diceInputSchema.safeParse(input).success)
                throw new Problem(422, 'dice_input', 'Invalid dice input');
              calls++;
              if (code !== 'dice_input') throw new Problem(422, code, 'Synthetic rejected request');
              return {
                rollId: '00000000-0000-4000-8000-000000000001',
                slot: 0,
                groups: [{ label: 'check', sides: 6, faces: [3] }],
                reused: false,
              };
            },
          }
        );
      if (code === 'dice_input') {
        const result = await generate();
        assert.equal((result as { narrative: string }).narrative, 'Valid corrected roll');
        assert.equal(calls, 1);
      } else {
        await assert.rejects(generate(), (e: unknown) => (e as { code: string }).code === code);
        assert.equal(calls, 1);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
