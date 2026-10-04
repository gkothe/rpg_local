import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { newCampaign } from '../src/domain/campaign.js';
import { TurnStatus } from '../src/domain/options.js';
import {
  freezeCampaignSources,
  CAMPAIGN_SOURCE_GET_TOOL_NAME,
} from '../src/domain/campaignSourceRecall.js';
import { CampaignSourceLookup } from '../src/services/campaignSourceLookup.js';
import { textSource } from '../src/services/sources.js';
import { ownerId, type Store } from '../src/store.js';
import type { Turn } from '../src/domain/types.js';

function fixture() {
  const campaign = newCampaign({ name: 'Lookup transaction' });
  campaign.sources = [textSource('Preparation', 'The old gate 🌙 is locked.')];
  const frozen = freezeCampaignSources(campaign);
  const turn = {
    id: randomUUID(),
    campaignId: campaign.id,
    diceSessionId: randomUUID(),
    context: { revision: campaign.revision, prompt: 'frozen prompt', frozenSources: frozen },
  } as Turn;
  const row = {
    owner: ownerId,
    status: TurnStatus.Running,
    lease_until: new Date(Date.now() + 60000).toISOString(),
    document: structuredClone(turn),
  };
  const reads = new Map<string, { argument_digest: string; payload: Record<string, unknown> }>();
  const client = {
    query: async (sql: string, args: unknown[]) => {
      if (sql.startsWith('SELECT owner')) return { rows: [row] };
      if (sql.startsWith('SELECT frozen_sources')) return { rows: [{ frozen_sources: frozen }] };
      if (sql.startsWith('SELECT argument_digest'))
        return { rows: reads.has(args[1] as string) ? [reads.get(args[1] as string)] : [] };
      if (sql.startsWith('INSERT INTO turn_campaign_source_reads')) {
        reads.set(args[5] as string, {
          argument_digest: args[6] as string,
          payload: args[7] as Record<string, unknown>,
        });
        return { rows: [] };
      }
      throw new Error(`Unexpected query ${sql}`);
    },
  };
  const store = {
    campaign: async () => campaign,
    transaction: async (fn: (client: unknown) => unknown) => fn(client),
  } as unknown as Store;
  return {
    campaign,
    turn,
    row,
    reads,
    lookup: new CampaignSourceLookup(store),
    args: { sourceId: campaign.sources[0]!.id, version: 1, sectionIndex: 0 },
  };
}
test('source receipt is persisted once, transport replay is stable and changed arguments conflict', async () => {
  const f = fixture();
  const first = await f.lookup.read(f.turn, CAMPAIGN_SOURCE_GET_TOOL_NAME, f.args, 'one');
  assert.equal(f.reads.size, 1);
  assert.deepEqual(
    await f.lookup.read(f.turn, CAMPAIGN_SOURCE_GET_TOOL_NAME, f.args, 'one'),
    first
  );
  assert.equal(f.reads.size, 1);
  await assert.rejects(
    () =>
      f.lookup.read(f.turn, CAMPAIGN_SOURCE_GET_TOOL_NAME, { ...f.args, sectionIndex: 1 }, 'one'),
    /identity/
  );
  assert.equal((first.sourceSpan as { text: string }).text, f.campaign.sources[0]!.text);
});
test('cancelled, stale, expired and foreign-owner reads cannot persist or reveal source text', async () => {
  for (const kind of ['cancel', 'revision', 'lease', 'owner', 'prompt'] as const) {
    const f = fixture();
    const signal = new AbortController();
    if (kind === 'cancel') signal.abort();
    if (kind === 'revision') f.campaign.revision++;
    if (kind === 'lease') f.row.lease_until = new Date(0).toISOString();
    if (kind === 'owner') f.row.owner = randomUUID();
    if (kind === 'prompt') f.row.document.context!.prompt = 'different';
    await assert.rejects(() =>
      f.lookup.read(f.turn, CAMPAIGN_SOURCE_GET_TOOL_NAME, f.args, 'request', signal.signal)
    );
    assert.equal(f.reads.size, 0);
  }
});
