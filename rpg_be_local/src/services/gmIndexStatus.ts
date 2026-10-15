import type { Store } from '../store.js';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { Problem } from '../errors.js';
import { canonicalJson, sha256 } from '../domain/journalLedger.js';
import { gmIndexPreview, GM_INDEX_MODE_OPTIONS } from '../domain/gmIndexGeneration.js';
import { projectFreshGmIndex } from '../domain/gmIndexCompatibility.js';
import { HistorySettingsAction, historySettingsOf } from '../domain/historyRecall.js';
import { MemoryRebuildPurpose } from '../domain/memoryRebuild.js';
import { TURN_FINALIZATION_STAGE_OPTIONS } from '../domain/turnFinalization.js';

import { GM_INDEX_UPDATE_MODE_OPTIONS } from '../domain/gmIndexExecution.js';
export const GM_INDEX_OPTIONS = {
  updateModes: GM_INDEX_UPDATE_MODE_OPTIONS,
  purposeId: MemoryRebuildPurpose.GmIndex,
  modes: GM_INDEX_MODE_OPTIONS,
  finalizationStages: TURN_FINALIZATION_STAGE_OPTIONS,
} as const;
export const gmIndexDisableSchema = z
  .object({ requestId: z.uuid(), expectedEnabled: z.literal(true) })
  .strict();
export class GmIndexStatusService {
  constructor(private store: Store) {}
  async status(campaignId: string, client?: PoolClient) {
    const campaign = await this.store.campaign(campaignId, client);
    const turns = await this.store.activeTurns(campaignId, client);
    const busy = await (client ?? this.store.pool).query(
      `SELECT id FROM turns WHERE campaign_id=$1 AND (status IN ('pending','running') OR document->>'editingPending'='true')
      UNION ALL SELECT id FROM memory_rebuild_jobs WHERE campaign_id=$1 AND status IN ('pending','running')`,
      [campaignId]
    );
    return {
      prepared: !!campaign.gmIndex,
      enabled: campaign.gmIndex?.settings.enabled ?? false,
      refreshRequired: campaign.gmIndex
        ? projectFreshGmIndex(campaign.gmIndex.document, campaign).refreshRequired
        : false,
      canPrepare:
        busy.rows.length === 0 && !!campaign.settings.provider && !!campaign.settings.model,
      blockedReason: busy.rows.length
        ? 'Finish the active turn or preparation first.'
        : !campaign.settings.provider || !campaign.settings.model
          ? 'Select an available provider and model first.'
          : null,
      playerKnown: gmIndexPreview(campaign, turns),
    };
  }
  async disable(campaignId: string, input: z.infer<typeof gmIndexDisableSchema>) {
    const identity = sha256(
      canonicalJson({
        action: HistorySettingsAction.DisableGmIndex,
        expectedEnabled: input.expectedEnabled,
      })
    );
    return this.store.transaction(async (client) => {
      const campaign = await this.store.campaign(campaignId, client, true);
      const prior = await client.query(
        'SELECT identity_digest,result FROM history_setting_requests WHERE campaign_id=$1 AND request_id=$2',
        [campaignId, input.requestId]
      );
      if (prior.rows[0]) {
        if (prior.rows[0].identity_digest !== identity)
          throw new Problem(
            409,
            'history_request_reused',
            'Request identity was already used with different input.'
          );
        return prior.rows[0].result;
      }
      if (!campaign.gmIndex?.settings.enabled)
        throw new Problem(
          409,
          'gm_index_changed',
          'GM index activation changed; reload its status.'
        );
      campaign.gmIndex.settings.enabled = false;
      campaign.historyRecall = {
        ...historySettingsOf(campaign),
        enabled: campaign.gmIndex.settings.activationHistoryBaseline.enabled,
      };
      campaign.revision++;
      await this.store.save(campaign, client);
      const result = { status: await this.status(campaignId, client) };
      await client.query(
        'INSERT INTO history_setting_requests(campaign_id,request_id,action,identity_digest,result) VALUES($1,$2,$3,$4,$5)',
        [
          campaignId,
          input.requestId,
          HistorySettingsAction.DisableGmIndex,
          identity,
          JSON.stringify(result),
        ]
      );
      return result;
    });
  }
}
