import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { dbEnabled, openIsolatedStore } from './journalFixture.js';
import {
  advancementFixture,
  advancementProvider,
  stagedReview,
  applyReview,
} from './advancementFixture.js';
import { AdvancementService } from '../src/services/advancement.js';
import { LibraryService, remapArchive } from '../src/services/library.js';
import { TurnService } from '../src/services/turns.js';
import { AdvancementStatus as Status } from '../src/domain/advancement.js';
import { SourceKind, SourceStatus } from '../src/domain/options.js';

let isolated: Awaited<ReturnType<typeof openIsolatedStore>>;
before(async () => {
  if (dbEnabled) isolated = await openIsolatedStore('advancement_archive');
});
after(async () => {
  if (dbEnabled) await isolated.close();
});

test(
  'archive round trip remaps awarded evidence and preserves deleted recipient audit',
  { skip: !dbEnabled },
  async () => {
    const store = isolated.store;
    const f = await advancementFixture(store);
    const ai = advancementProvider(f.characterId);
    const service = new AdvancementService(store, ai.generator);
    const review = await applyReview(service, await stagedReview(service, f.campaign.id));
    await store.transaction(async (client) => {
      const c = await store.campaign(f.campaign.id, client, true);
      c.characters = [];
      await store.save(c, client);
    });
    const library = new LibraryService(store);
    const archive = JSON.parse(JSON.stringify(await library.export(f.campaign.id)));
    const imported = await library.import(archive);
    assert.notEqual(imported.id, f.campaign.id);
    const importedReview = (await service.list(imported.id)).reviews[0]!;
    assert.equal(importedReview.status, Status.Applied);
    assert.notEqual(importedReview.id, review.id);
    assert.notEqual(importedReview.awards[0]!.id, review.awards[0]!.id);
    assert.notEqual(importedReview.awards[0]!.characterId, f.characterId);
    assert.equal(importedReview.awards[0]!.recipientName, 'Historical player');
    assert.notEqual(importedReview.awards[0]!.currencyId, review.awards[0]!.currencyId);
    const turns = await store.activeTurns(imported.id);
    assert.deepEqual(importedReview.reviewedTurnIds, [turns[0]!.id]);
    assert.deepEqual(importedReview.awards[0]!.evidenceTurnIds, [turns[0]!.id]);
    assert.equal((await service.list(imported.id)).outstandingTurnCount, 0);
    assert.equal((await service.summary(imported.id)).ledger.length, 1);
    assert.deepEqual((await service.summary(imported.id)).players, []);
    await service.decide(imported.id, importedReview.id, 'reverse', { requestId: randomUUID() });
    assert.equal((await service.list(imported.id)).outstandingTurnCount, 1);
    assert.equal((await service.summary(imported.id)).ledger.length, 0);
    const reversedArchive = await library.export(imported.id);
    const importedReversed = await library.import(reversedArchive);
    assert.equal((await service.list(importedReversed.id)).reviews[0]!.status, Status.Reversed);
    assert.equal((await service.list(importedReversed.id)).outstandingTurnCount, 1);
  }
);

test(
  'imported ready proposals remain audit-only and do not consume eligible history',
  { skip: !dbEnabled },
  async () => {
    const store = isolated.store;
    const f = await advancementFixture(store);
    const ai = advancementProvider(f.characterId);
    const service = new AdvancementService(store, ai.generator);
    await stagedReview(service, f.campaign.id);
    const library = new LibraryService(store);
    const imported = await library.import(await library.export(f.campaign.id));
    const r = (await service.list(imported.id)).reviews[0]!;
    assert.equal(r.imported, true);
    assert.equal(r.status, Status.Ready);
    await assert.rejects(applyReview(service, r), /historical and cannot execute/);
    await assert.rejects(
      service.decide(imported.id, r.id, 'resume', { requestId: randomUUID() }),
      /historical and cannot execute/
    );
    assert.equal((await service.list(imported.id)).outstandingTurnCount, 1);
    assert.equal((await service.summary(imported.id)).ledger.length, 0);
  }
);

test(
  'archive rejects duplicated active coverage and falsified final awarded amounts',
  { skip: !dbEnabled },
  async () => {
    const store = isolated.store;
    const f = await advancementFixture(store);
    const service = new AdvancementService(store, advancementProvider(f.characterId).generator);
    await applyReview(service, await stagedReview(service, f.campaign.id));
    const archive = await new LibraryService(store).export(f.campaign.id);
    const duplicate = structuredClone(archive);
    duplicate.advancementReviews!.push({
      ...structuredClone(duplicate.advancementReviews![0]!),
      id: randomUUID(),
      requestId: randomUUID(),
    });
    assert.throws(() => remapArchive(duplicate), /active advancement coverage/);
    const falsified = structuredClone(archive);
    falsified.advancementReviews![0]!.awards[0]!.amount = 900;
    assert.throws(() => remapArchive(falsified), /differ from the final proposal/);
  }
);

test(
  'gameplay undo requires reversing covering advancement and then leaves ledger inactive',
  { skip: !dbEnabled },
  async () => {
    const store = isolated.store;
    const f = await advancementFixture(store);
    const ai = advancementProvider(f.characterId);
    const service = new AdvancementService(store, ai.generator);
    const turnService = new TurnService(store, ai.generator);
    const review = await applyReview(service, await stagedReview(service, f.campaign.id));
    await assert.rejects(turnService.undo(f.campaign.id, 0), /Reverse the advancement review/);
    assert.equal((await store.turn(f.campaign.id, f.turns[0]!.id)).undone, false);
    await service.decide(f.campaign.id, review.id, 'reverse', { requestId: randomUUID() });
    await turnService.undo(f.campaign.id, 0);
    assert.equal((await store.turn(f.campaign.id, f.turns[0]!.id)).undone, true);
    assert.equal((await service.summary(f.campaign.id)).ledger.length, 0);
    assert.equal((await service.list(f.campaign.id)).outstandingTurnCount, 0);
  }
);

test(
  'campaign original read receipts remap their source and receipt identities',
  { skip: !dbEnabled },
  async () => {
    const store = isolated.store;
    const f = await advancementFixture(store);
    const sourceId = randomUUID();
    f.campaign.sources.push({
      id: sourceId,
      name: 'Campaign house rule',
      kind: SourceKind.Text,
      text: 'Awards depend on completed objectives.',
      status: SourceStatus.Confirmed,
      version: 1,
      pages: [],
      warnings: [],
    });
    await store.transaction(async (client) => store.save(f.campaign, client));
    const ai = advancementProvider(f.characterId);
    const originalGenerate = ai.generator.generateOwnedGameplay!;
    ai.generator.generateOwnedGameplay = async (
      settings,
      prompt,
      schema,
      system,
      tools,
      signal,
      trace
    ) => {
      await tools('campaign_sources_get', { sourceId, version: 1, sectionIndex: 0 }, randomUUID());
      return originalGenerate(settings, prompt, schema, system, tools, signal, trace);
    };
    const service = new AdvancementService(store, ai.generator);
    await applyReview(service, await stagedReview(service, f.campaign.id));
    const library = new LibraryService(store);
    const archive = await library.export(f.campaign.id);
    const imported = await library.import(archive);
    const nextArchive = await library.export(imported.id);
    const read = nextArchive.advancementReviews![0]!.reads[0]!;
    assert.equal(read.payload.receiptId, read.id);
    assert.notEqual(read.id, archive.advancementReviews![0]!.reads[0]!.id);
    assert.equal((read.payload.sourceSpan as { id: string }).id, imported.sources[0]!.id);
  }
);

test(
  'campaign templates exclude advancement ledger, coverage and manual review opt-in',
  { skip: !dbEnabled },
  async () => {
    const store = isolated.store;
    const f = await advancementFixture(store);
    const service = new AdvancementService(store, advancementProvider(f.characterId).generator);
    await applyReview(service, await stagedReview(service, f.campaign.id));
    const library = new LibraryService(store);
    const template = await library.template('New campaign setup', f.campaign.id, 0);
    const campaign = await library.instantiate(template.id);
    assert.equal(campaign.advancementPolicy, undefined);
    assert.equal((await service.list(campaign.id)).reviews.length, 0);
    assert.equal((await service.list(campaign.id)).outstandingTurnCount, 0);
    assert.equal((await service.summary(campaign.id)).ledger.length, 0);
  }
);
