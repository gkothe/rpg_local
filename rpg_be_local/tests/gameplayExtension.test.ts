import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startGameplayMcp } from '../src/providers/gameplayMcp.js';
import { nativeGameplaySchema } from '../src/providers/gameplayContract.js';
import { ownedTools } from './ownedGameplayFixture.js';
import { newCampaign } from '../src/domain/campaign.js';
import { freezeKnowledge } from '../src/domain/knowledgeRecall.js';
import { CharacterType } from '../src/domain/options.js';
import { randomUUID } from 'node:crypto';

test('NPC search and get traverse the private MCP transport with frozen sheets', async () => {
  const c = newCampaign({ name: 'MCP NPC' });
  c.characters.push({
    id: randomUUID(),
    name: 'Marcus',
    type: CharacterType.Npc,
    attributes: { strength: 3 },
    inventory: {},
    description: { role: 'merchant' },
    notes: 'PRIVATE',
    revision: 1,
  });
  const registry = ownedTools({ knowledge: freezeKnowledge(c, true) });
  const endpoint = await startGameplayMcp(registry.definitions, registry.call);
  const client = new Client({ name: 'npc-transport', version: '1' });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(endpoint.url), {
        requestInit: { headers: endpoint.headers },
      })
    );
    assert.ok((await client.listTools()).tools.some((tool) => tool.name === 'campaign_npcs_get'));
    const found = await client.callTool({
      name: 'campaign_npcs_search',
      arguments: { query: 'merchant' },
    });
    assert.equal(found.isError, undefined);
    assert.match(JSON.stringify(found.content), /Marcus/);
    const result = await client.callTool({
      name: 'campaign_npcs_get',
      arguments: { id: c.characters[0]!.id },
    });
    assert.equal(result.isError, undefined);
    assert.match(JSON.stringify(result.content), /strength/);
    assert.doesNotMatch(JSON.stringify(result.content), /PRIVATE|notes/);
    assert.equal(
      (await client.callTool({ name: 'campaign_npcs_get', arguments: { id: randomUUID() } }))
        .isError,
      true
    );
  } finally {
    await client.close();
    await endpoint.close();
  }
});

test('native transports keep readable JSON objects for field validation and repair', () => {
  const readable = nativeGameplaySchema();
  const partial = { narrative: 'Valid', knowledgeChanges: 'not yet repaired' };
  assert.deepEqual(readable.parse(partial), partial);
  assert.throws(() => readable.parse('narration only'));
  assert.throws(() => readable.parse([partial]));
});

test('one registered synthetic tool crosses private MCP without provider name or parameter branches', async () => {
  let calls = 0;
  const registry = ownedTools({
    registrations: [
      {
        name: 'synthetic_echo',
        description: 'Original extension fixture',
        schema: z.object({ value: z.string().min(1) }).strict(),
        purpose: 'default',
        capability: 'rules',
        handler: async (input) => {
          calls++;
          return { echoed: z.object({ value: z.string() }).strict().parse(input).value };
        },
      },
    ],
  });
  const endpoint = await startGameplayMcp(registry.definitions, registry.call);
  const client = new Client({ name: 'synthetic-extension', version: '1' });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(endpoint.url), {
        requestInit: { headers: endpoint.headers },
      })
    );
    assert.deepEqual(
      (await client.listTools()).tools.map((tool) => tool.name),
      ['synthetic_echo']
    );
    const reply = await client.callTool({
      name: 'synthetic_echo',
      arguments: { value: 'original' },
    });
    assert.equal(reply.isError, undefined);
    assert.match(JSON.stringify(reply.content), /original/);
    assert.equal((await client.callTool({ name: 'shell', arguments: {} })).isError, true);
    assert.equal(
      (
        await client.callTool({
          name: 'synthetic_echo',
          arguments: { value: 'original', foreign: true },
        })
      ).isError,
      true
    );
    assert.equal(calls, 1);
  } finally {
    await client.close();
    await endpoint.close();
  }
});
