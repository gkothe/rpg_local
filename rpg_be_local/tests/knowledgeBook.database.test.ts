import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { appRoot, databaseUrl } from '../src/config.js';
import { newCampaign } from '../src/domain/campaign.js';
import { TurnService } from '../src/services/turns.js';
import { LibraryService } from '../src/services/library.js';
import { RuleStore } from '../src/services/ruleStore.js';
import { RuleLibrary } from '../src/services/ruleLibrary.js';
import { RulePreview } from '../src/services/rulePreview.js';
import { RuleSystemKind, type RuleCitation } from '../src/domain/rules.js';
import type { RuleUpload } from '../src/domain/ruleImport.js';
import type { Generator } from '../src/providers/service.js';
import type { Turn } from '../src/domain/types.js';

const enabled = process.env.NODE_ENV === 'test' && !!process.env.RPG_TEST_DATABASE_URL;
const schema = `knowledge_book_fixture_${randomUUID().replaceAll('-', '')}`;
const directory = path.join(os.tmpdir(), `rpg-knowledge-book-${randomUUID()}`);
let store: Store;
before(async () => {
  if (!enabled) return;
  const setup = new Store();
  await setup.pool.query(`CREATE SCHEMA ${schema}`);
  await setup.close();
  const url = new URL(databaseUrl());
  url.searchParams.set('options', `-c search_path=${schema}`);
  store = new Store(url.toString());
  for (const file of (await readdir(path.join(appRoot, 'migrationssql')))
    .filter((file) => file.endsWith('.sql'))
    .sort())
    await store.pool.query(await readFile(path.join(appRoot, 'migrationssql', file), 'utf8'));
});
after(async () => {
  if (!enabled) return;
  await store.pool.query(`DROP SCHEMA ${schema} CASCADE`);
  await store.close();
  await rm(directory, { recursive: true, force: true });
});

function originalBook(): RuleUpload[] {
  const bytes = Buffer.from(
    '<!-- column: core_rules | source: original -->\n<!-- node: archive | pages: 1 | printed: 1 -->\nThe original keeper safeguards a silver key.'
  );
  return [
    {
      name: 'manifest.json',
      bytes: Buffer.from(
        JSON.stringify({
          format: 'rules-book',
          version: 1,
          source: {
            slug: 'original',
            title: 'Original synthetic keeper',
            pageCount: 1,
            pdfHash: null,
          },
          columns: [
            {
              column: 'core_rules',
              file: 'core_rules.md',
              hash: createHash('sha256').update(bytes).digest('hex'),
            },
          ],
          converter: { id: 'original-synthetic-fixture', version: '1' },
          markerFormatVersion: 1,
          coverage: { description: 'Original test text only', omissions: [] },
        })
      ),
    },
    { name: 'core_rules.md', bytes },
  ];
}

async function finish(campaignId: string, turnId: string): Promise<Turn> {
  for (let index = 0; index < 300; index++) {
    const turn = await store.turn(campaignId, turnId);
    if (!['pending', 'running'].includes(turn.status)) return turn;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Book knowledge fixture did not complete');
}

test(
  'original-book receipt knowledge commits with dice, survives archive remapping and restores on undo',
  { skip: !enabled },
  async () => {
    const rules = new RuleStore(store);
    const created = await rules.create(
      `keeper-${randomUUID().slice(0, 8)}`,
      'Original keeper fixture'
    );
    const library = new RuleLibrary(rules, new RulePreview(directory));
    const preview = await library.preview(created.systemId, created.revision, originalBook());
    const published = await library.confirm(created.systemId, {
      previewId: preview.previewId,
      revision: created.revision,
      requestId: randomUUID(),
    });
    assert.equal(published.kind, RuleSystemKind.Library);
    const campaign = newCampaign({ name: 'Book knowledge DB' });
    campaign.ruleSystemId = published.systemId;
    await store.insert(campaign);
    let malformed = false;
    const generator: Generator = {
      capacity: async () => 16000,
      gameplayCapacity: async () => 16000,
      bookGameplayCapacity: async () => 16000,
      generate: async () => {
        throw new Error('Unexpected extraction');
      },
      generateBookGameplay: async () => {
        throw new Error('Unexpected legacy book gameplay');
      },
      generateOwnedGameplay: async (_settings, _prompt, _schema, systemPrompt, tools) => {
        assert.ok(systemPrompt);
        const read = await tools(
          'rules_get',
          { path: 'core_rules.original.archive', view: 'text' },
          'original-book'
        );
        if (!('text' in read)) throw new Error('Owned book lookup must return text');
        const roll = await tools(
          'roll_dice',
          {
            slot: 0,
            groups: [{ label: 'search', sides: 6, count: 1 }],
            reason: 'Find keeper',
            declaration: 'Four succeeds',
          },
          'original-roll'
        );
        assert.equal(read.text, 'The original keeper safeguards a silver key.');
        const pages = read.pages as {
          precision: RuleCitation['precision'];
          pdfPages: number[];
          printedPages: string[];
        };
        const quote = malformed ? 'Forged keeper text.' : String(read.text);
        const citation: RuleCitation = {
          receiptId: String(read.receipt),
          path: String(read.path),
          source: String(read.source),
          systemId: published.systemId,
          revision: published.revision,
          contentHash: published.contentHash,
          quote,
          start: 0,
          end: quote.length,
          ...pages,
        };
        return {
          version: 4,
          narrative: 'The keeper safeguards the key.',
          operations: [],
          rollInterpretations: [{ rollId: roll.rollId, explanation: 'Search check' }],
          ruleCitations: [citation],
          knowledgeChanges: [
            {
              op: 'create',
              kind: 'objective',
              title: 'Keeper key',
              text: 'The keeper safeguards a silver key.',
              origin: 'source',
              certainty: 'established',
              status: 'active',
              characterIds: [],
              evidence: [{ type: 'book', citation }],
            },
          ],
        };
      },
    };
    const service = new TurnService(store, generator, 4);
    malformed = true;
    const invalid = await service.submit(campaign.id, {
      revision: 0,
      requestId: randomUUID(),
      action: 'Locate key',
    });
    assert.equal((await finish(campaign.id, invalid.id)).status, 'failed');
    assert.deepEqual((await store.campaign(campaign.id)).knowledge, []);
    malformed = false;
    const retried = await service.retry(campaign.id, invalid.id, {
      revision: 0,
      requestId: randomUUID(),
    });
    const completed = await finish(campaign.id, retried.id);
    assert.equal(completed.status, 'completed', completed.error ?? '');
    assert.deepEqual(completed.rolls, (await store.turn(campaign.id, invalid.id)).rolls);
    const current = await store.campaign(campaign.id);
    assert.equal(current.knowledge?.length, 1);
    assert.equal(current.knowledge![0]!.origin, 'source');
    assert.equal(current.knowledge![0]!.certainty, 'established');
    const evidence = current.knowledge![0]!.evidence[0]!;
    assert.equal(evidence.type, 'book');
    if (evidence.type !== 'book') throw new Error('Book evidence expected');
    assert.ok(completed.ruleReads!.some((read) => read.id === evidence.citation.receiptId));
    const archives = new LibraryService(store);
    const imported = await archives.import(await archives.export(campaign.id));
    const importedEvidence = imported.knowledge![0]!.evidence[0]!;
    assert.equal(importedEvidence.type, 'book');
    if (importedEvidence.type !== 'book') throw new Error('Imported book evidence expected');
    assert.notEqual(importedEvidence.citation.receiptId, evidence.citation.receiptId);
    const importedTurns = await store.turns(imported.id);
    assert.ok(
      importedTurns.some((turn) =>
        turn.ruleReads?.some((read) => read.id === importedEvidence.citation.receiptId)
      )
    );
    assert.equal(importedEvidence.citation.quote, evidence.citation.quote);
    assert.deepEqual((await service.undo(imported.id, imported.revision)).knowledge, []);
    assert.deepEqual((await service.undo(campaign.id, current.revision)).knowledge, []);
  }
);
