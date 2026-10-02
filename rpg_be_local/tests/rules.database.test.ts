import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import os from 'node:os';
import { rm } from 'node:fs/promises';
import { RuleStore, ruleContent } from '../src/services/ruleStore.js';
import { DiceService } from '../src/services/dice.js';
import { RuleLibrary } from '../src/services/ruleLibrary.js';
import { RulePreview } from '../src/services/rulePreview.js';
import type { RuleUpload } from '../src/domain/ruleImport.js';
import { RuleLookup } from '../src/services/ruleLookup.js';
import { ruleContext } from '../src/services/ruleStore.js';
import { newCampaign } from '../src/domain/campaign.js';
import { ownerId } from '../src/store.js';
import { TurnStatus } from '../src/domain/options.js';
import type { Turn } from '../src/domain/types.js';
import request, { type Response } from 'supertest';
import { createApp } from '../src/app.js';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { Store } from '../src/store.js';
import { appRoot, databaseUrl } from '../src/config.js';
import {
  DEFAULT_RULE_SYSTEM_ID,
  RuleSystemKind,
  ruleContentHash,
  emptyRuleColumns,
  DEFAULT_RULE_INSTRUCTIONS,
} from '../src/domain/rules.js';
const enabled = process.env.NODE_ENV === 'test' && !!process.env.RPG_TEST_DATABASE_URL;
const schema = `rules_fixture_${randomUUID().replaceAll('-', '')}`;
let store: Store;
before(async () => {
  if (!enabled) return;
  const setup = new Store();
  await setup.pool.query(`CREATE SCHEMA ${schema}`);
  await setup.close();
  const url = new URL(databaseUrl());
  url.searchParams.set('options', `-c search_path=${schema}`);
  store = new Store(url.toString());
  for (const name of (await readdir(path.join(appRoot, 'migrationssql')))
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    await store.pool.query(await readFile(path.join(appRoot, 'migrationssql', name), 'utf8'));
  }
});
after(async () => {
  if (!enabled) return;
  await store.pool.query(`DROP SCHEMA ${schema} CASCADE`);
  await store.close();
});
test(
  'fresh/upgraded migrations seed the protected default with a reproducible content hash',
  { skip: !enabled },
  async () => {
    const result = await store.pool.query('SELECT * FROM rule_systems WHERE id=$1', [
      DEFAULT_RULE_SYSTEM_ID,
    ]);
    const row = result.rows[0];
    assert.equal(row.kind, RuleSystemKind.ModelKnowledge);
    assert.equal(row.revision, 1);
    assert.equal(
      row.content_hash,
      ruleContentHash({
        ...emptyRuleColumns(),
        instructions: DEFAULT_RULE_INSTRUCTIONS,
        sources: [],
        mapping: {},
      })
    );
    await assert.rejects(
      store.pool.query('DELETE FROM rule_systems WHERE id=$1', [DEFAULT_RULE_SYSTEM_ID]),
      /cannot be deleted/
    );
    await assert.rejects(
      store.pool.query("UPDATE rule_systems SET sources='[{}]' WHERE id=$1", [
        DEFAULT_RULE_SYSTEM_ID,
      ]),
      /check constraint/
    );
    await assert.rejects(
      store.pool.query("UPDATE rule_systems SET kind='library' WHERE id=$1", [
        DEFAULT_RULE_SYSTEM_ID,
      ]),
      /identity is protected/
    );
  }
);
test(
  'historical receipt pagination includes metadata in its 16 KiB bound and visits every owned receipt once',
  { skip: !enabled },
  async () => {
    const rules = new RuleStore(store);
    const head = await rules.create('original-history-wide', '界'.repeat(200));
    const context = head;
    const campaign = newCampaign({ name: 'Original paginated audit' });
    await store.insert(campaign);
    const turn: Turn = {
      id: randomUUID(),
      campaignId: campaign.id,
      requestId: randomUUID(),
      status: TurnStatus.Failed,
      action: 'Original audit',
      narrative: null,
      changes: [],
      error: 'Original failure',
      undone: false,
      settings: campaign.settings,
      ruleContext: context,
      context: null,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
    await store.pool.query(
      'INSERT INTO turns(id,campaign_id,request_id,payload_hash,status,document) VALUES($1,$2,$3,$4,$5,$6)',
      [turn.id, campaign.id, turn.requestId, 'original', turn.status, turn]
    );
    for (let index = 0; index < 12; index++) {
      const id = randomUUID();
      const payload = {
        receipt: id,
        error: { code: 'original_fixture', message: 'Original '.repeat(55) },
      };
      await store.pool.query(
        'INSERT INTO turn_rule_reads(id,campaign_id,turn_id,system_id,captured_context,tool_name,transport_request_id,argument_digest,result_hash,payload,transcript_bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [
          id,
          campaign.id,
          turn.id,
          head.systemId,
          context,
          'rules_get',
          `${index}-${'r'.repeat(185)}`,
          'a'.repeat(64),
          'b'.repeat(64),
          payload,
          Buffer.byteLength(JSON.stringify(payload)),
        ]
      );
    }
    const { app } = createApp({ store });
    const seen = new Set<string>();
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: Response = await request(app)
        .get(
          `/api/campaigns/${campaign.id}/turns/${turn.id}/rule-reads${cursor ? `?cursor=${cursor}` : ''}`
        )
        .set('Host', '127.0.0.1:4100')
        .expect(200);
      assert.ok(Buffer.byteLength(JSON.stringify(page.body)) <= 16 * 1024);
      assert.ok(page.body.data.length > 0);
      for (const read of page.body.data) {
        assert.equal(seen.has(read.id), false);
        seen.add(read.id);
      }
      cursor = page.body.pagination.nextCursor;
      pages++;
      assert.ok(pages <= 12);
    } while (cursor);
    assert.equal(seen.size, 12);
    assert.ok(pages > 1, 'Wide captured metadata must cause explicit continuation');
  }
);

function bookFiles(slug: string, body: string): RuleUpload[] {
  const bytes = Buffer.from(
    `<!-- column: core_rules | source: ${slug} -->\n<!-- node: check | pages: 1 | printed: 1 -->\n${body}`
  );
  return [
    {
      name: 'manifest.json',
      bytes: Buffer.from(
        JSON.stringify({
          format: 'rules-book',
          version: 1,
          source: { slug, title: slug, pageCount: 2, pdfHash: null },
          columns: [
            {
              column: 'core_rules',
              file: 'core_rules.md',
              hash: createHash('sha256').update(bytes).digest('hex'),
            },
          ],
          converter: { id: 'synthetic', version: '1' },
          markerFormatVersion: 1,
          coverage: { description: 'Original synthetic text', omissions: [] },
        })
      ),
    },
    { name: 'core_rules.md', bytes },
  ];
}

test(
  'publication racing session creation or a dice draw rejects under the shared rule lock before any new session/face',
  { skip: !enabled },
  async () => {
    const rules = new RuleStore(store);
    const dice = new DiceService(store);
    for (const mode of ['session', 'roll'] as const) {
      const created = await rules.create(`original-race-${mode}`, `Original concurrent ${mode}`);
      const head = await rules.get(created.systemId);
      const captured = ruleContext(head);
      const campaign = newCampaign({
        name: `Original concurrent ${mode}`,
        systemId: head.systemId,
      });
      await store.insert(campaign);
      const turn: Turn = {
        id: randomUUID(),
        campaignId: campaign.id,
        requestId: randomUUID(),
        status: TurnStatus.Running,
        action: 'Original concurrent action',
        narrative: null,
        changes: [],
        error: null,
        undone: false,
        settings: campaign.settings,
        ruleContext: captured,
        context: {
          revision: 0,
          prompt: '{}',
          estimatedTokens: 2,
          estimator: 'original fixture',
          sourceVersions: [],
          historyIds: [],
          memoryId: null,
          ruleContext: captured,
        },
        createdAt: new Date().toISOString(),
        completedAt: null,
      };
      await store.pool.query(
        "INSERT INTO turns(id,campaign_id,request_id,payload_hash,status,document,owner,lease_until) VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '1 minute')",
        [turn.id, campaign.id, turn.requestId, 'original', turn.status, turn, ownerId]
      );
      const sessionId =
        mode === 'roll' ? await dice.createSession(turn, 'a'.repeat(64), []) : undefined;
      const publisher = await store.pool.connect();
      try {
        await publisher.query('BEGIN');
        await publisher.query('SELECT id FROM rule_systems WHERE id=$1 FOR UPDATE', [
          head.systemId,
        ]);
        const publisherPid = (await publisher.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        const pending =
          mode === 'session'
            ? dice.createSession(turn, 'a'.repeat(64), [])
            : dice.roll(sessionId!, turn, {
                slot: 0,
                reason: 'Original check',
                declaration: 'No modifiers',
                groups: [{ label: 'Original', sides: 6, count: 1 }],
              });
        const rejected = assert.rejects(pending, /Rule system changed/);
        let waiting = false;
        for (let index = 0; index < 100 && !waiting; index++) {
          waiting = (
            await store.pool.query(
              'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS waiting',
              [publisherPid]
            )
          ).rows[0].waiting;
          if (!waiting) await new Promise((resolve) => setTimeout(resolve, 5));
        }
        assert.equal(
          waiting,
          true,
          'The actual dice transaction must wait for the publishing rule lock'
        );
        const changed = {
          ...ruleContent(head),
          instructions: `Original concurrent ${mode} publication`,
        };
        await publisher.query(
          'UPDATE rule_systems SET instructions=$2,revision=revision+1,content_hash=$3 WHERE id=$1',
          [head.systemId, changed.instructions, ruleContentHash(changed)]
        );
        await publisher.query('COMMIT');
        await rejected;
        assert.equal(
          (
            await store.pool.query(
              'SELECT count(*)::int AS count FROM dice_records WHERE campaign_id=$1',
              [campaign.id]
            )
          ).rows[0].count,
          0
        );
        assert.equal(
          (
            await store.pool.query(
              'SELECT count(*)::int AS count FROM dice_sessions WHERE campaign_id=$1',
              [campaign.id]
            )
          ).rows[0].count,
          mode === 'roll' ? 1 : 0
        );
        if (mode === 'roll')
          assert.equal(
            (
              await store.pool.query('SELECT requests FROM dice_attempts WHERE turn_id=$1', [
                turn.id,
              ])
            ).rows[0].requests,
            0
          );
      } finally {
        await publisher.query('ROLLBACK');
        publisher.release();
      }
    }
  }
);
test(
  'rule reads commit before reveal, replay once, retain invalid-request audit and guard changed/cancelled heads',
  { skip: !enabled },
  async () => {
    const rules = new RuleStore(store);
    const lookup = new RuleLookup();
    const campaign = newCampaign({ name: 'Original read-audit fixture' });
    await store.insert(campaign);
    const expected = ruleContext(await rules.get());
    const turn: Turn = {
      id: randomUUID(),
      campaignId: campaign.id,
      requestId: randomUUID(),
      status: TurnStatus.Running,
      action: 'Read',
      narrative: null,
      changes: [],
      error: null,
      undone: false,
      settings: campaign.settings,
      ruleContext: expected,
      context: {
        revision: campaign.revision,
        prompt: '{}',
        estimatedTokens: 2,
        estimator: 'fixture',
        sourceVersions: [],
        historyIds: [],
        memoryId: null,
        ruleContext: expected,
      },
      createdAt: new Date().toISOString(),
      completedAt: null,
    };
    await store.pool.query(
      "INSERT INTO turns(id,campaign_id,request_id,payload_hash,status,document,owner,lease_until) VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '1 minute')",
      [turn.id, campaign.id, turn.requestId, 'a'.repeat(64), turn.status, turn, ownerId]
    );
    const first = await rules.read(turn, 'rules_map', {}, 'map-first', lookup);
    const visible = await store.pool.query('SELECT payload FROM turn_rule_reads WHERE id=$1', [
      first.id,
    ]);
    assert.deepEqual(visible.rows[0].payload, first.payload);
    assert.deepEqual(await rules.read(turn, 'rules_map', {}, 'map-first', lookup), first);
    const invalid = await rules.read(
      turn,
      'rules_search',
      { query: 'test', system: 'foreign' },
      'invalid',
      lookup
    );
    assert.equal((invalid.payload.error as { code: string }).code, 'rules_request_invalid');
    const counters = await store.pool.query(
      'SELECT requests FROM turn_rule_budgets WHERE turn_id=$1',
      [turn.id]
    );
    assert.equal(counters.rows[0].requests, 2);
    await assert.rejects(
      rules.read(turn, 'rules_map', { column: 'lore' }, 'map-first', lookup),
      /changed arguments/
    );
    await assert.rejects(
      store.pool.query("UPDATE turn_rule_reads SET payload='{}' WHERE id=$1", [first.id]),
      /retained/
    );
    await rules.publish(expected.systemId, expected.revision, (system) => ({
      ...system,
      instructions: 'Changed default instructions',
    }));
    await assert.rejects(rules.read(turn, 'rules_map', {}, 'map-first', lookup), /changed/);
    await store.pool.query('UPDATE turns SET status=$2 WHERE id=$1', [
      turn.id,
      TurnStatus.Cancelled,
    ]);
    await assert.rejects(
      rules.read(turn, 'rules_map', {}, 'cancelled', lookup),
      /no longer active/
    );
    await store.pool.query('DELETE FROM campaigns WHERE id=$1', [campaign.id]);
  }
);
test(
  'library HTTP routes validate metadata/instructions/multipart and retain access protections',
  { skip: !enabled },
  async () => {
    const directory = path.join(os.tmpdir(), `rpg-rules-http-preview-${randomUUID()}`);
    const previews = new RulePreview(directory);
    const { app } = createApp({ store, rulePreviews: previews });
    try {
      await request(app)
        .post('/api/rule-systems')
        .set('Host', 'localhost:4100')
        .send({ systemKey: 'forbidden', name: 'Forbidden' })
        .expect(403);
      const created = await request(app)
        .post('/api/rule-systems')
        .set('Host', 'localhost:4100')
        .set('X-RPG-Client', 'local-rpg')
        .send({ systemKey: `synthetic-${randomUUID()}`, name: 'HTTP synthetic fixture' })
        .expect(201);
      const head = created.body.data;
      const input = {
        revision: head.revision,
        requestId: randomUUID(),
        instructions: 'Keep handwritten',
      };
      const saved = await request(app)
        .patch(`/api/rule-systems/${head.systemId}/instructions`)
        .set('Host', 'localhost:4100')
        .set('X-RPG-Client', 'local-rpg')
        .send(input)
        .expect(200);
      const replay = await request(app)
        .patch(`/api/rule-systems/${head.systemId}/instructions`)
        .set('Host', 'localhost:4100')
        .set('X-RPG-Client', 'local-rpg')
        .send(input)
        .expect(200);
      assert.deepEqual(replay.body.data, saved.body.data);
      await request(app)
        .patch(`/api/rule-systems/${head.systemId}/instructions`)
        .set('Host', 'localhost:4100')
        .set('X-RPG-Client', 'local-rpg')
        .send({ ...input, core_rules: {} })
        .expect(422);
      const files = bookFiles('original', '<script>synthetic</script>');
      const previewRequest = request(app)
        .post(`/api/rule-systems/${head.systemId}/imports`)
        .set('Host', 'localhost:4100')
        .set('X-RPG-Client', 'local-rpg')
        .field('revision', String(saved.body.data.revision));
      for (const file of files) previewRequest.attach('files', file.bytes, file.name);
      const preview = await previewRequest.expect(201);
      const confirm = await request(app)
        .post(`/api/rule-systems/${head.systemId}/imports/${preview.body.data.previewId}/confirm`)
        .set('Host', 'localhost:4100')
        .set('X-RPG-Client', 'local-rpg')
        .send({ revision: saved.body.data.revision, requestId: randomUUID() })
        .expect(200);
      const metadata = await request(app)
        .get(`/api/rule-systems/${head.systemId}`)
        .set('Host', 'localhost:4100')
        .expect(200);
      assert.equal(metadata.body.data.instructions, 'Keep handwritten');
      assert.equal(metadata.body.data.revision, confirm.body.data.revision);
      assert.equal(metadata.body.data.core_rules, undefined);
      const found = await request(app)
        .get(`/api/rule-systems/${head.systemId}/search`)
        .query({ query: 'synthetic' })
        .set('Host', 'localhost:4100')
        .expect(200);
      const hit = found.body.data.entries[0];
      const text = await request(app)
        .get(`/api/rule-systems/${head.systemId}/nodes`)
        .query({ path: hit.path, locator: hit.locator })
        .set('Host', 'localhost:4100')
        .expect(200);
      assert.equal(text.body.data.text, '<script>synthetic</script>');
      await request(app)
        .get(`/api/rule-systems/${head.systemId}/mapping`)
        .set('Host', 'localhost:4100')
        .expect(200);
      await request(app)
        .post(`/api/rule-systems/${DEFAULT_RULE_SYSTEM_ID}/imports`)
        .set('Host', 'localhost:4100')
        .set('X-RPG-Client', 'local-rpg')
        .field('revision', '1')
        .attach('files', files[0]!.bytes, files[0]!.name)
        .expect(422);
    } finally {
      await previews.close();
      await rm(directory, { recursive: true, force: true });
    }
  }
);
test(
  'publication replaces complete book partitions, preserves instructions/other books and replays committed confirmation metadata',
  { skip: !enabled },
  async () => {
    const rules = new RuleStore(store);
    const created = await rules.create(`synthetic-${randomUUID()}`, 'Synthetic publication');
    const directory = path.join(os.tmpdir(), `rpg-rules-db-preview-${randomUUID()}`);
    const previews = new RulePreview(directory);
    const library = new RuleLibrary(rules, previews);
    try {
      let head = await library.instructions(
        created.systemId,
        created.revision,
        'Hand-written instructions'
      );
      const previewA = await library.preview(
        head.systemId,
        head.revision,
        bookFiles('book-a', 'Original A')
      );
      const identity = {
        revision: head.revision,
        requestId: randomUUID(),
        previewId: previewA.previewId,
      };
      const committed = await library.confirm(head.systemId, identity);
      const previewB = await library.preview(
        head.systemId,
        committed.revision,
        bookFiles('book-b', 'Original B')
      );
      head = await library.confirm(head.systemId, {
        revision: committed.revision,
        requestId: randomUUID(),
        previewId: previewB.previewId,
      });
      assert.deepEqual(await library.confirm(head.systemId, identity), committed);
      await assert.rejects(
        library.confirm(head.systemId, { ...identity, revision: head.revision }),
        /changed input/
      );
      const same = await library.preview(
        head.systemId,
        head.revision,
        bookFiles('book-a', 'Original A')
      );
      const noop = await library.confirm(head.systemId, {
        revision: head.revision,
        requestId: randomUUID(),
        previewId: same.previewId,
      });
      assert.equal(noop.revision, head.revision);
      const replacement = await library.preview(
        head.systemId,
        head.revision,
        bookFiles('book-a', 'Replacement A')
      );
      head = await library.confirm(head.systemId, {
        revision: head.revision,
        requestId: randomUUID(),
        previewId: replacement.previewId,
      });
      const system = await rules.get(head.systemId);
      assert.equal(system.instructions, 'Hand-written instructions');
      assert.equal(system.core_rules['book-a']!.children.check!.text, 'Replacement A');
      assert.equal(system.core_rules['book-b']!.children.check!.text, 'Original B');
      const stale = await library.preview(
        head.systemId,
        head.revision,
        bookFiles('book-a', 'Stale')
      );
      await library.instructions(head.systemId, head.revision, 'Updated instructions');
      await assert.rejects(
        library.confirm(head.systemId, {
          revision: head.revision,
          requestId: randomUUID(),
          previewId: stale.previewId,
        }),
        /changed/
      );
    } finally {
      await previews.close();
      await rm(directory, { recursive: true, force: true });
    }
  }
);
test(
  'campaign mirror references only an existing system and default edits cannot decrease revision',
  { skip: !enabled },
  async () => {
    const id = randomUUID();
    await store.pool.query('INSERT INTO campaigns(id,document) VALUES($1,$2)', [id, { id }]);
    await assert.rejects(
      store.pool.query(
        "UPDATE campaigns SET rule_system_id=$2::uuid,document=jsonb_set(document,'{ruleSystemId}',to_jsonb($2::uuid::text)) WHERE id=$1",
        [id, randomUUID()]
      ),
      /foreign key/
    );
    await assert.rejects(
      store.pool.query('UPDATE campaigns SET rule_system_id=$2 WHERE id=$1', [
        id,
        DEFAULT_RULE_SYSTEM_ID,
      ]),
      /campaign_rule_mirror/
    );
    await store.pool.query(
      "UPDATE campaigns SET rule_system_id=$2::uuid,document=jsonb_set(document,'{ruleSystemId}',to_jsonb($2::uuid::text)) WHERE id=$1",
      [id, DEFAULT_RULE_SYSTEM_ID]
    );
    await store.pool.query('UPDATE rule_systems SET revision=2 WHERE id=$1', [
      DEFAULT_RULE_SYSTEM_ID,
    ]);
    await assert.rejects(
      store.pool.query('UPDATE rule_systems SET revision=1 WHERE id=$1', [DEFAULT_RULE_SYSTEM_ID]),
      /cannot decrease/
    );
  }
);

test(
  'private backup preview restores atomically, preserves local identity/revisions and v3 references resolve by exact key/hash',
  { skip: !enabled },
  async () => {
    const { RuleBackup } = await import('../src/services/ruleBackup.js');
    const { LibraryService } = await import('../src/services/library.js');
    const rules = new RuleStore(store);
    const original = await rules.create(
      `backup-${randomUUID().slice(0, 8)}`,
      'Original private fixture'
    );
    const staging = new RulePreview(path.join(os.tmpdir(), `rules-backup-${randomUUID()}`));
    const library = new RuleLibrary(rules, staging);
    const preview = await library.preview(
      original.systemId,
      original.revision,
      bookFiles('original', 'Original synthetic authority.')
    );
    const published = await library.confirm(original.systemId, {
      previewId: preview.previewId,
      revision: original.revision,
      requestId: randomUUID(),
    });
    const backups = new RuleBackup(rules, staging);
    const backup = await backups.export(published.systemId);
    assert.equal(backup.system.content.sources.length, 1);
    const copied = {
      ...backup,
      system: { ...backup.system, systemKey: `restored-${randomUUID().slice(0, 8)}` },
    };
    const fresh = await backups.preview(Buffer.from(JSON.stringify(copied)));
    const identity = { ...fresh, requestId: randomUUID(), replace: false };
    const restored = await backups.confirm(identity);
    assert.notEqual(restored.systemId, published.systemId);
    assert.equal(restored.contentHash, published.contentHash);
    assert.deepEqual(await backups.confirm(identity), restored);
    const old = await backups.preview(Buffer.from(JSON.stringify(copied)));
    await assert.rejects(
      backups.confirm({ ...old, requestId: randomUUID(), replace: false }),
      /Explicitly confirm/
    );
    const edited = await library.instructions(
      restored.systemId,
      restored.revision,
      'Changed local instructions'
    );
    await assert.rejects(
      backups.confirm({ ...old, requestId: randomUUID(), replace: true }),
      /changed after/
    );
    const current = await backups.preview(Buffer.from(JSON.stringify(copied)));
    const replaced = await backups.confirm({ ...current, requestId: randomUUID(), replace: true });
    assert.equal(replaced.revision, edited.revision + 1);
    assert.equal(replaced.contentHash, restored.contentHash);
    const identical = await backups.preview(Buffer.from(JSON.stringify(copied)));
    const sameHashRestore = await backups.confirm({
      ...identical,
      requestId: randomUUID(),
      replace: true,
    });
    assert.equal(sameHashRestore.revision, replaced.revision + 1);
    assert.equal(sameHashRestore.contentHash, replaced.contentHash);
    const before = await rules.get(restored.systemId);
    await assert.rejects(
      backups.preview(
        Buffer.from(
          JSON.stringify({ ...copied, system: { ...copied.system, contentHash: 'a'.repeat(64) } })
        )
      ),
      /hash does not match/
    );
    assert.deepEqual(await rules.get(restored.systemId), before);
    const campaign = newCampaign({
      name: 'Reference only original fixture',
      systemId: restored.systemId,
    });
    await store.insert(campaign);
    const saves = new LibraryService(store);
    const archive = await saves.export(campaign.id);
    assert.equal(archive.version, 3);
    assert.equal(archive.campaign.ruleSystemId, null);
    assert.equal(archive.campaign.ruleReference?.systemKey, restored.systemKey);
    assert.equal(JSON.stringify(archive).includes('Original synthetic authority.'), false);
    const resolved = await saves.import(archive);
    assert.equal(resolved.ruleSystemId, restored.systemId);
    const missing = structuredClone(archive);
    missing.campaign.ruleReference!.systemKey = `absent-${randomUUID().slice(0, 8)}`;
    const unresolved = await saves.import(missing);
    assert.equal(unresolved.ruleSystemId, null);
    assert.equal(unresolved.ruleResolution?.status, 'unresolved');
    await assert.rejects(rules.resolve(unresolved), /Resolve this campaign/);
    await staging.close();
  }
);

test(
  'terminal receipt HTTP pages stay below 16 KiB and v3 remaps historical evidence even with a missing library',
  { skip: !enabled },
  async () => {
    const { LibraryService } = await import('../src/services/library.js');
    const { canonicalRuleJson, serializedBytes } = await import('../src/domain/rules.js');
    const rules = new RuleStore(store);
    const selected = ruleContext(await rules.get());
    const campaign = newCampaign({ name: 'Original historical evidence fixture' });
    await store.insert(campaign);
    const turn: Turn = {
      id: randomUUID(),
      campaignId: campaign.id,
      requestId: randomUUID(),
      status: TurnStatus.Failed,
      action: 'Original action',
      narrative: null,
      changes: [],
      error: 'Original failed attempt',
      undone: false,
      settings: campaign.settings,
      ruleContext: selected,
      context: null,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
    await store.pool.query(
      'INSERT INTO turns(id,campaign_id,request_id,payload_hash,status,document) VALUES($1,$2,$3,$4,$5,$6)',
      [turn.id, campaign.id, turn.requestId, 'test', turn.status, turn]
    );
    for (let index = 0; index < 4; index++) {
      const id = randomUUID();
      const payload = {
        receipt: id,
        text: 'Original 🐉 '.repeat(80),
        source: 'original',
        path: 'core_rules.original.check',
        view: 'text',
        start: 0,
        end: 960,
        pages: { precision: 'unknown', pdfPages: [], printedPages: [] },
      };
      await store.pool.query(
        'INSERT INTO turn_rule_reads(id,campaign_id,turn_id,system_id,captured_context,tool_name,transport_request_id,argument_digest,result_hash,payload,transcript_bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
        [
          id,
          campaign.id,
          turn.id,
          selected.systemId,
          selected,
          'rules_get',
          String(index),
          'a'.repeat(64),
          createHash('sha256').update(canonicalRuleJson(payload)).digest('hex'),
          payload,
          serializedBytes(payload),
        ]
      );
    }
    const { app } = createApp({ store });
    const headers = { Host: '127.0.0.1:4100' };
    const first = await request(app)
      .get(`/api/campaigns/${campaign.id}/turns/${turn.id}/rule-reads`)
      .set(headers)
      .expect(200);
    assert.ok(Buffer.byteLength(JSON.stringify(first.body)) <= 16 * 1024);
    assert.equal(first.body.data.length, 4);
    await request(app)
      .get(`/api/campaigns/${randomUUID()}/turns/${turn.id}/rule-reads`)
      .set(headers)
      .expect(404);
    await store.pool.query('UPDATE turns SET status=$2 WHERE id=$1', [turn.id, TurnStatus.Running]);
    await request(app)
      .get(`/api/campaigns/${campaign.id}/turns/${turn.id}/rule-reads`)
      .set(headers)
      .expect(409);
    await store.pool.query('UPDATE turns SET status=$2 WHERE id=$1', [turn.id, TurnStatus.Failed]);
    // Keep the fixture transcript within the aggregate application rule budget.
    const saves = new LibraryService(store);
    const archive = await saves.export(campaign.id);
    assert.equal(archive.turns[0]!.ruleReads?.length, 4);
    const imported = await saves.import(archive);
    const importedTurns = await store.turns(imported.id);
    assert.equal(importedTurns[0]!.ruleReads?.length, 4);
    assert.notEqual(importedTurns[0]!.ruleReads![0]!.id, archive.turns[0]!.ruleReads![0]!.id);
    assert.equal(importedTurns[0]!.ruleReads![0]!.campaignId, imported.id);
  }
);

test(
  'private backup static HTTP routing, explicit protected-default restore and unresolved hash-change resolution preserve write protections',
  { skip: !enabled },
  async () => {
    const staging = new RulePreview(path.join(os.tmpdir(), `rules-http-backup-${randomUUID()}`));
    const { app } = createApp({ store, rulePreviews: staging });
    const headers = {
      Host: '127.0.0.1:4100',
      Origin: 'http://127.0.0.1:4100',
      'X-RPG-Client': 'local-rpg',
    };
    const downloaded = await request(app)
      .get(`/api/rule-systems/${DEFAULT_RULE_SYSTEM_ID}/backups`)
      .set(headers)
      .expect(200);
    const original = downloaded.body.data;
    original.system.revision = 999999;
    original.system.content.instructions = 'Original explicitly restored default instructions';
    original.system.contentHash = ruleContentHash(original.system.content);
    const previewResponse = await request(app)
      .post('/api/rule-systems/backups/imports')
      .set(headers)
      .attach('file', Buffer.from(JSON.stringify(original)), 'private.json')
      .expect(201);
    const preview = previewResponse.body.data;
    assert.equal(preview.protectedDefault, true);
    const body = {
      systemId: preview.systemId,
      systemKey: preview.systemKey,
      revision: preview.revision,
      requestId: randomUUID(),
      replace: false,
    };
    await request(app)
      .post(`/api/rule-systems/backups/imports/${preview.previewId}/confirm`)
      .set(headers)
      .send(body)
      .expect(409);
    const confirmBody = { ...body, replace: true };
    const saved = await request(app)
      .post(`/api/rule-systems/backups/imports/${preview.previewId}/confirm`)
      .set(headers)
      .send(confirmBody)
      .expect(200);
    assert.equal(saved.body.data.systemId, DEFAULT_RULE_SYSTEM_ID);
    assert.equal(saved.body.data.revision, preview.revision + 1);
    const replayed = await request(app)
      .post(`/api/rule-systems/backups/imports/${preview.previewId}/confirm`)
      .set(headers)
      .send(confirmBody)
      .expect(200);
    assert.deepEqual(replayed.body.data, saved.body.data);
    await request(app)
      .post('/api/rule-systems/backups/imports')
      .set(headers)
      .attach('file', Buffer.from('{}'), 'bad.json')
      .expect(422);
    await request(app)
      .post('/api/rule-systems/backups/imports')
      .set({ Host: 'foreign.example' })
      .attach('file', Buffer.from('{}'), 'bad.json')
      .expect(403);
    const rules = new RuleStore(store);
    const selected = await rules.create(
      `resolution-${randomUUID().slice(0, 8)}`,
      'Original resolution fixture'
    );
    const library = new RuleLibrary(rules, staging);
    const prepared = await library.preview(
      selected.systemId,
      selected.revision,
      bookFiles('original', 'Original resolution text.')
    );
    const published = await library.confirm(selected.systemId, {
      revision: selected.revision,
      previewId: prepared.previewId,
      requestId: randomUUID(),
    });
    const campaign = newCampaign({ name: 'Original unresolved recovery' });
    campaign.ruleResolution = {
      status: 'unresolved',
      reference: {
        systemKey: published.systemKey,
        systemName: published.systemName,
        kind: published.kind,
        contentHash: 'f'.repeat(64),
      },
    };
    await store.insert(campaign);
    const resolution = await request(app)
      .get(`/api/campaigns/${campaign.id}/rule-system/resolution`)
      .set(headers)
      .expect(200);
    assert.equal(resolution.body.data.hashChanged, true);
    assert.equal(resolution.body.data.candidate.systemId, published.systemId);
    const choice = { revision: 0, requestId: randomUUID(), systemId: published.systemId };
    await request(app)
      .post(`/api/campaigns/${campaign.id}/rule-system/resolution`)
      .set(headers)
      .send(choice)
      .expect(200);
    const current = await store.campaign(campaign.id);
    assert.equal(current.ruleResolution, undefined);
    assert.equal(current.ruleSystemId, published.systemId);
    await staging.close();
  }
);

test(
  'campaign selection requires published original text, retains memory/state and binds idle revision/request identities',
  { skip: !enabled },
  async () => {
    const { CampaignService } = await import('../src/services/campaigns.js');
    const campaigns = new CampaignService(store, {
      capacity: async () => 16000,
      generate: async () => ({}),
    });
    const rules = new RuleStore(store);
    const empty = await rules.create(`empty-${randomUUID().slice(0, 8)}`, 'Original empty fixture');
    await assert.rejects(
      campaigns.create({
        name: 'Empty rejected',
        description: '',
        instructions: '',
        systemId: empty.systemId,
      }),
      /Publish a book/
    );
    await assert.rejects(
      campaigns.create({
        name: 'Missing rejected',
        description: '',
        instructions: '',
        systemId: randomUUID(),
      }),
      /not found/
    );
    const campaign = await campaigns.create({
      name: 'Original selection fixture',
      description: '',
      instructions: '',
      systemId: null,
    });
    campaign.state = { original: true };
    campaign.memory = {
      id: randomUUID(),
      text: 'Original retained event memory',
      coveredTurnIds: [],
      valid: true,
      createdAt: new Date().toISOString(),
    };
    await store.transaction(async (client) => store.save(campaign, client));
    const staging = new RulePreview(path.join(os.tmpdir(), `rules-binding-${randomUUID()}`));
    const library = new RuleLibrary(rules, staging);
    const preview = await library.preview(
      empty.systemId,
      empty.revision,
      bookFiles('original', 'Original selected authority.')
    );
    const published = await library.confirm(empty.systemId, {
      previewId: preview.previewId,
      revision: empty.revision,
      requestId: randomUUID(),
    });
    const identity = { revision: 0, requestId: randomUUID(), systemId: published.systemId };
    const binding = await campaigns.bindRules(campaign.id, identity);
    assert.deepEqual(await campaigns.bindRules(campaign.id, identity), binding);
    await assert.rejects(
      campaigns.bindRules(campaign.id, { ...identity, systemId: null }),
      /identity reused/
    );
    await assert.rejects(
      campaigns.bindRules(campaign.id, { ...identity, requestId: randomUUID() }),
      /Campaign changed/
    );
    const selected = await store.campaign(campaign.id);
    assert.deepEqual(selected.state, campaign.state);
    assert.deepEqual(selected.memory, campaign.memory);
    const activeId = randomUUID();
    await store.pool.query(
      'INSERT INTO turns(id,campaign_id,request_id,payload_hash,status,document) VALUES($1,$2,$3,$4,$5,$6)',
      [
        activeId,
        campaign.id,
        randomUUID(),
        'fixture',
        TurnStatus.Running,
        { id: activeId, campaignId: campaign.id, status: TurnStatus.Running },
      ]
    );
    await assert.rejects(
      campaigns.bindRules(campaign.id, {
        revision: selected.revision,
        requestId: randomUUID(),
        systemId: null,
      }),
      /cancel the active turn/
    );
    await staging.close();
  }
);

test(
  'multipart combined book bytes are rejected during upload before parsing/publication',
  { skip: !enabled },
  async () => {
    const { app } = createApp({ store });
    const headers = {
      Host: '127.0.0.1:4100',
      Origin: 'http://127.0.0.1:4100',
      'X-RPG-Client': 'local-rpg',
    };
    const response = await request(app)
      .post(`/api/rule-systems/${randomUUID()}/imports`)
      .set(headers)
      .field('revision', '1')
      .attach('files', Buffer.alloc(10 * 1024 * 1024, 120), 'core_rules.md')
      .attach('files', Buffer.alloc(10 * 1024 * 1024, 120), 'lore.md')
      .attach('files', Buffer.from('{}'), 'manifest.json')
      .expect(413);
    assert.equal(response.body.code, 'rules_upload_size');
  }
);
