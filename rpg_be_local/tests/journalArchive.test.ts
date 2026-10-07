import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Store } from '../src/store.js';
import { LibraryService, remapArchive } from '../src/services/library.js';
import { JournalService } from '../src/services/journal.js';
import { JournalJobKind, JournalJobStatus } from '../src/domain/journal.js';
import { JournalEventKind } from '../src/domain/journal.js';
import {
  KnowledgeCertainty as C,
  KnowledgeKind as K,
  KnowledgeStatus as S,
} from '../src/domain/knowledge.js';
import { eventDigest, sha256 } from '../src/domain/journalLedger.js';
import { Problem } from '../src/errors.js';
import type { Archive } from '../src/domain/types.js';
import {
  dbEnabled,
  excerptTurn,
  fakeGenerator,
  knowledgeRecord,
  openIsolatedStore,
  seedCampaign,
  waitForJob,
} from './journalFixture.js';

let isolated: Awaited<ReturnType<typeof openIsolatedStore>>;
let store: Store;
before(async () => {
  if (!dbEnabled) return;
  isolated = await openIsolatedStore('journal_archive');
  store = isolated.store;
});
after(async () => {
  if (dbEnabled) await isolated.close();
});

const BORROW = 'borrow the healer book';
const RETURNED = 'handed back the book';
const NEW = 'sister of the temple';
const OLD = 'Mira works for Ada at the inn';
const entry = (turnId: string, phrase: string, over: Record<string, unknown> = {}) => ({
  ref: 'book',
  existingId: null,
  kind: K.Debt,
  title: 'Return the book',
  text: 'Return the healer book.',
  certainty: C.Established,
  status: S.Active,
  characterIds: [],
  related: [],
  quotes: [{ turnId, field: 'narrative', quote: phrase }],
  ...over,
});

/** A campaign with a recovered promise and an accepted correction. */
async function journaledArchive(): Promise<{ archive: Archive; campaignId: string }> {
  const mira = knowledgeRecord('Mira', 'Mira is the innkeeper, employed by Ada.');
  const { campaign } = await seedCampaign(
    store,
    [
      { action: 'I ask', narrative: `You ${BORROW} and promise to return it. ${OLD}.` },
      { action: 'I listen', narrative: `Mira admits she is a ${NEW}.` },
      { action: 'I return it', narrative: `You ${RETURNED} and she thanks you 😀.` },
    ],
    [mira]
  );
  const backfill = new JournalService(
    store,
    fakeGenerator((prompt) => {
      const entries = [];
      const borrow = excerptTurn(prompt, BORROW);
      if (borrow) entries.push(entry(borrow.turnId, BORROW));
      const back = excerptTurn(prompt, RETURNED);
      if (back)
        entries.push(
          entry(back.turnId, RETURNED, { status: S.Resolved, text: 'Returned the book.' })
        );
      return { entries };
    }, 100)
  );
  const job = await backfill.start(campaign.id, JournalJobKind.Backfill, randomUUID());
  assert.equal(
    (await waitForJob(backfill, campaign.id, job.id)).status,
    JournalJobStatus.Completed
  );
  const checker = new JournalService(
    store,
    fakeGenerator((prompt) => {
      if (prompt.excerpts) {
        const newer = excerptTurn(prompt, NEW);
        return {
          excerpts: newer
            ? [{ turnId: newer.turnId, field: 'narrative', quote: NEW, relation: 'contradicts' }]
            : [],
        };
      }
      return {
        outcome: 'proposed',
        reason: 'She says so.',
        changes: { text: 'Mira is a sister of the temple.' },
        evidenceIndexes: [0],
      };
    }, 100)
  );
  const check = await checker.start(campaign.id, JournalJobKind.Check, randomUUID(), {
    entryId: mira.id,
    explanation: 'wrong employer',
  });
  const found = await waitForJob(checker, campaign.id, check.id);
  assert.equal(found.status, JournalJobStatus.Completed, found.error?.message);
  await checker.accept(campaign.id, check.id, randomUUID(), found.finding!.proposalDigest!);
  const archive = JSON.parse(JSON.stringify(await new LibraryService(store).export(campaign.id)));
  return { archive, campaignId: campaign.id };
}

test(
  'export and import preserve the ledger with consistent remapped identities and recomputed digests',
  { skip: !dbEnabled },
  async () => {
    const { archive, campaignId } = await journaledArchive();
    assert.ok(
      !JSON.stringify(archive).includes('journal_jobs'),
      'operational jobs are not exported'
    );
    assert.equal(archive.campaign.journal!.events.length, 2);
    const library = new LibraryService(store);
    const imported = await library.import(archive);
    assert.notEqual(imported.id, campaignId);
    const turns = await store.turns(imported.id);
    const turnById = new Map(turns.map((t) => [t.id, t]));
    const ledger = imported.journal!;
    assert.equal(ledger.events.length, 2);
    const oldIds = new Set(archive.campaign.journal!.events.map((e) => e.id));
    for (const event of ledger.events) {
      assert.ok(!oldIds.has(event.id), 'event identity is remapped');
      assert.equal(event.digest, eventDigest(event as unknown as Record<string, unknown>));
      const quotes =
        event.kind === JournalEventKind.Correction
          ? event.evidence
          : event.contributions.flatMap((c) => c.evidence);
      assert.ok(quotes.length > 0);
      for (const q of quotes) {
        const turn = turnById.get(q.turnId)!;
        assert.ok(turn, 'evidence turn belongs to the imported campaign');
        const text = q.field === 'action' ? turn.action : turn.narrative!;
        assert.equal(text.slice(q.start, q.end), q.quote);
        assert.equal(sha256(text), q.digest);
      }
      if (event.kind === JournalEventKind.Backfill)
        for (const id of event.knowledgeIds)
          assert.ok(
            imported.knowledge!.some((k) => k.id === id),
            'recovered record id remapped'
          );
      else assert.ok(imported.knowledge!.some((k) => k.id === event.knowledgeId));
    }
    // The imported campaign works: it can be exported again unchanged in shape.
    const again = await library.export(imported.id);
    assert.equal(again.campaign.journal!.events.length, 2);
    assert.deepEqual(
      again.campaign.journal!.coverageTurnIds.sort(),
      [...ledger.coverageTurnIds].sort()
    );
    const jobs = await store.pool.query('SELECT 1 FROM journal_jobs WHERE campaign_id=$1', [
      imported.id,
    ]);
    assert.equal(jobs.rowCount, 0, 'imports cannot execute old jobs');
  }
);

test(
  'pre-feature archives import with an empty ledger and numbered archives stay rejected',
  { skip: !dbEnabled },
  async () => {
    const { archive } = await journaledArchive();
    const legacy = structuredClone(archive);
    delete (legacy.campaign as { journal?: unknown }).journal;
    const imported = await new LibraryService(store).import(legacy);
    assert.equal(imported.journal, undefined);
    assert.throws(
      () => remapArchive({ ...archive, version: 5 }),
      (e: unknown) => e instanceof Problem && e.code === 'archive_unsupported'
    );
  }
);

test(
  'tampered Journal evidence, digests and links are rejected before anything is stored',
  { skip: !dbEnabled },
  async () => {
    const { archive } = await journaledArchive();
    const invalid = (mutate: (a: Archive) => void) => {
      const copy = structuredClone(archive);
      mutate(copy);
      assert.throws(
        () => remapArchive(copy),
        (e: unknown) =>
          (e instanceof Problem && ['archive_invalid', 'validation'].includes(e.code)) ||
          (e as Error).name === 'ZodError'
      );
    };
    invalid((a) => {
      const event = a.campaign.journal!.events.find((e) => e.kind === JournalEventKind.Correction)!;
      if (event.kind === JournalEventKind.Correction) event.evidence[0]!.quote = 'tampered text!';
    });
    invalid((a) => {
      a.campaign.journal!.events[0]!.digest = '0'.repeat(64);
    });
    invalid((a) => {
      const event = a.campaign.journal!.events.find((e) => e.kind === JournalEventKind.Backfill)!;
      if (event.kind === JournalEventKind.Backfill) event.contributions[0]!.turnId = randomUUID();
    });
    invalid((a) => {
      a.campaign.journal!.coverageTurnIds.push(randomUUID());
    });
    invalid((a) => {
      const evidence = a.campaign.journal!.events.flatMap((e) =>
        e.kind === JournalEventKind.Correction ? e.evidence : []
      )[0]!;
      const turn = a.turns.find((t) => t.id === evidence.turnId)!;
      turn.narrative = `${turn.narrative} (edited)`;
    });
  }
);

test('campaign templates never carry Journal history', { skip: !dbEnabled }, async () => {
  const { campaignId } = await journaledArchive();
  const library = new LibraryService(store);
  const template = await library.template('Template', campaignId, 0);
  assert.ok(!('journal' in template.setup));
  const fresh = await library.instantiate(template.id, 'From template');
  assert.equal(fresh.journal, undefined);
  assert.deepEqual(fresh.knowledge, []);
});
