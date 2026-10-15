import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { dbEnabled, openIsolatedStore, seedCampaign } from './journalFixture.js';

test(
  'GM index storage preserves legacy rows, pairs frozen fields and prevents context rewrites',
  { skip: !dbEnabled },
  async () => {
    const isolated = await openIsolatedStore('gm_index_migration');
    try {
      const { campaign, turns } = await seedCampaign(isolated.store, [
        { action: 'Wait', narrative: 'The harbor is quiet.' },
      ]);
      const insert = (frozen: unknown, version: number | null) =>
        isolated.store.pool.query(
          `INSERT INTO dice_sessions
       (id,campaign_id,root_turn_id,context_digest,frozen_prompt,frozen_revision,character_ids,frozen_gm_index,gm_index_contract_version)
       VALUES ($1,$2,$3,$4,$5,0,'[]',$6,$7) RETURNING id`,
          [
            randomUUID(),
            campaign.id,
            turns[0]!.id,
            'a'.repeat(64),
            '{}',
            frozen === null ? null : JSON.stringify(frozen),
            version,
          ]
        );
      const legacy = await insert(null, null);
      await assert.rejects(insert({}, null), /dice_gm_index_contract_version/);
      await assert.rejects(insert(null, 1), /dice_gm_index_contract_version/);
      await assert.rejects(insert({}, 2), /dice_gm_index_contract_version/);
      await assert.rejects(insert([], 1), /dice_frozen_gm_index_object/);
      const indexed = await insert({}, 1);
      await assert.rejects(
        isolated.store.pool.query(
          `UPDATE dice_sessions SET frozen_gm_index='{"changed":true}' WHERE id=$1`,
          [indexed.rows[0].id]
        ),
        /immutable/
      );
      await assert.rejects(
        isolated.store.pool.query(
          `UPDATE dice_sessions SET frozen_gm_index='{}',gm_index_contract_version=1 WHERE id=$1`,
          [legacy.rows[0].id]
        ),
        /immutable/
      );
      // Accounting remains mutable even when the execution context is frozen.
      await isolated.store.pool.query('UPDATE dice_sessions SET new_faces=1 WHERE id=$1', [
        indexed.rows[0].id,
      ]);
      const columns = await isolated.store.pool.query(
        `SELECT gm_index_checkpoint FROM narrative_edit_candidates LIMIT 0`
      );
      assert.equal(columns.fields[0]!.name, 'gm_index_checkpoint');
    } finally {
      await isolated.close();
    }
  }
);

test(
  'recovery intent migration preserves existing requests and validates its closed values',
  { skip: !dbEnabled },
  async () => {
    const isolated = await openIsolatedStore('gm_resume_intent_migration');
    try {
      const { store } = isolated;
      // Recreate the pre-0032 column shape inside this disposable test schema only.
      await store.pool.query('ALTER TABLE narrative_edit_requests DROP COLUMN resume_intent');
      const { campaign, turns } = await seedCampaign(store, [
        { action: 'Wait', narrative: 'A quiet room.' },
      ]);
      const turnId = turns[0]!.id;
      await store.pool.query(
        "INSERT INTO narrative_edit_candidates(turn_id,campaign_id,candidate_digest,campaign_revision,rule_context,settings,raw_response,raw_narrative,owner) VALUES($1,$2,'synthetic',0,'{}','{}','{}','Synthetic',$3)",
        [turnId, campaign.id, randomUUID()]
      );
      const requestId = randomUUID();
      await store.pool.query(
        "INSERT INTO narrative_edit_requests(turn_id,request_id,candidate_digest) VALUES($1,$2,'synthetic')",
        [turnId, requestId]
      );
      const { readFile } = await import('node:fs/promises');
      await store.pool.query(
        await readFile(
          new URL('../migrationssql/0032_finalization_resume_intent.sql', import.meta.url),
          'utf8'
        )
      );
      const legacy = await store.pool.query(
        'SELECT resume_intent FROM narrative_edit_requests WHERE request_id=$1',
        [requestId]
      );
      assert.equal(legacy.rows[0].resume_intent, 'continue');
      await assert.rejects(
        store.pool.query(
          "UPDATE narrative_edit_requests SET resume_intent='invented' WHERE request_id=$1",
          [requestId]
        ),
        /narrative_edit_requests_resume_intent_check/
      );
      await store.pool.query(
        "UPDATE narrative_edit_requests SET resume_intent='separate_index_recovery' WHERE request_id=$1",
        [requestId]
      );
    } finally {
      await isolated.close();
    }
  }
);
