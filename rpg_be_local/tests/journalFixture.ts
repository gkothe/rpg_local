import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { Store } from '../src/store.js';
import { appRoot, databaseUrl } from '../src/config.js';
import { newCampaign } from '../src/domain/campaign.js';
import {
  KnowledgeCertainty as C,
  KnowledgeKind as K,
  KnowledgeOrigin as O,
  KnowledgeStatus as S,
  KnowledgeVisibility as V,
  type CampaignKnowledge,
} from '../src/domain/knowledge.js';
import { TurnStatus } from '../src/domain/options.js';
import type { Campaign, Snapshot, Turn } from '../src/domain/types.js';
import type { Generator } from '../src/providers/service.js';
import type { JournalJobView } from '../src/services/journal.js';
import type { JournalService } from '../src/services/journal.js';

export const dbEnabled = process.env.NODE_ENV === 'test' && !!process.env.RPG_TEST_DATABASE_URL;

/** An isolated schema inside the *_test database with every migration applied. */
export async function openIsolatedStore(prefix: string) {
  const schema = `${prefix}_${randomUUID().replaceAll('-', '')}`;
  const setup = new Store();
  await setup.pool.query(`CREATE SCHEMA ${schema}`);
  await setup.close();
  const url = new URL(databaseUrl());
  url.searchParams.set('options', `-c search_path=${schema}`);
  const store = new Store(url.toString());
  for (const file of (await readdir(path.join(appRoot, 'migrationssql')))
    .filter((f) => f.endsWith('.sql'))
    .sort())
    await store.pool.query(await readFile(path.join(appRoot, 'migrationssql', file), 'utf8'));
  return {
    store,
    async close() {
      await store.pool.query(`DROP SCHEMA ${schema} CASCADE`);
      await store.close();
    },
  };
}

export const knowledgeRecord = (
  title: string,
  text: string,
  over: Partial<CampaignKnowledge> = {}
): CampaignKnowledge => {
  const now = new Date().toISOString();
  const record: CampaignKnowledge = {
    id: randomUUID(),
    kind: K.Npc,
    title,
    text,
    certainty: C.Established,
    status: S.Active,
    characterIds: [],
    characterNames: {},
    origin: O.Gm,
    evidence: [],
    createdTurnId: null,
    updatedTurnId: null,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    attributions: [],
    visibility: V.Player,
    ...over,
  };
  // Creation provenance mirrors ordinary records: the first attribution matches the creation.
  if (!over.attributions)
    record.attributions = [
      {
        origin: record.origin,
        evidence: structuredClone(record.evidence),
        turnId: record.createdTurnId,
        at: record.createdAt,
        visibility: record.visibility ?? V.Player,
      },
    ];
  return record;
};

/** Insert a campaign with completed turns (and ordinary undo snapshots) directly into storage. */
export async function seedCampaign(
  store: Store,
  pairs: { action: string; narrative: string }[],
  knowledge: CampaignKnowledge[] = []
): Promise<{ campaign: Campaign; turns: Turn[] }> {
  const campaign = newCampaign({ name: 'Journal fixture' });
  campaign.knowledge = knowledge;
  await store.insert(campaign);
  const turns: Turn[] = [];
  for (const [i, pair] of pairs.entries()) {
    const createdAt = new Date(2026, 0, 1, 0, i).toISOString();
    const turn = {
      id: randomUUID(),
      campaignId: campaign.id,
      requestId: randomUUID(),
      status: TurnStatus.Completed,
      action: pair.action,
      narrative: pair.narrative,
      changes: [],
      error: null,
      undone: false,
      settings: campaign.settings,
      context: null,
      createdAt,
      completedAt: createdAt,
    } as Turn;
    await store.pool.query(
      'INSERT INTO turns(id,campaign_id,request_id,payload_hash,status,document,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [turn.id, campaign.id, turn.requestId, 'fixture', turn.status, turn, createdAt]
    );
    await saveSnapshot(store, campaign.id, { turnId: turn.id });
    turns.push(turn);
  }
  return { campaign, turns };
}

export async function saveSnapshot(
  store: Store,
  campaignId: string,
  over: Partial<Snapshot> & { turnId: string }
): Promise<void> {
  const snapshot: Snapshot = {
    beforeCharacters: [],
    afterCharacters: [],
    beforeState: {},
    afterState: {},
    beforeMemory: null,
    beforeKnowledge: [],
    afterKnowledge: [],
    ...over,
  };
  await store.pool.query(
    'INSERT INTO snapshots(turn_id,campaign_id,document) VALUES($1,$2,$3) ON CONFLICT (turn_id) DO UPDATE SET document=EXCLUDED.document',
    [snapshot.turnId, campaignId, snapshot]
  );
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitForJob(
  journal: JournalService,
  campaignId: string,
  jobId: string,
  timeoutMs = 10_000
): Promise<JournalJobView> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const view = await journal.status(campaignId, jobId);
    if (!view.active) return view;
    if (Date.now() > deadline) throw new Error('Journal job did not finish in time');
    await sleep(15);
  }
}

/** A tool-free fake CLI; `respond` sees the parsed prompt and returns the schema object. */
export function fakeGenerator(
  respond: (prompt: Record<string, unknown>, signal?: AbortSignal) => unknown | Promise<unknown>,
  capacity = 16_000
): Generator & { calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    capacity: async () => capacity,
    generate: async (_settings, prompt, _schema, signal) => {
      const parsed = JSON.parse(prompt) as Record<string, unknown>;
      calls.push(parsed);
      return respond(parsed, signal);
    },
  } as Generator & { calls: Record<string, unknown>[] };
}

export const excerptText = (prompt: Record<string, unknown>): string =>
  (prompt.excerpts as { text: string }[]).map((e) => e.text).join('\n');
export const excerptTurn = (prompt: Record<string, unknown>, phrase: string) =>
  (prompt.excerpts as { turnId: string; text: string }[]).find((e) => e.text.includes(phrase));

export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
