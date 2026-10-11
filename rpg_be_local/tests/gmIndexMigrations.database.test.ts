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
