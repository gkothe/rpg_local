import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { Store, ownerId } from '../store.js';
import { Problem, conflict } from '../errors.js';
import { TurnStatus } from '../domain/options.js';
import type { Turn } from '../domain/types.js';
import { canonicalRuleJson } from '../domain/rules.js';
import {
  createCampaignSourceRecall,
  CAMPAIGN_SOURCE_GET_TOOL_NAME,
  frozenCampaignSourcesSchema,
  type CampaignSourceTool,
  type CampaignSourceRead,
} from '../domain/campaignSourceRecall.js';
import { RuleStore } from './ruleStore.js';

export class CampaignSourceLookup {
  private readonly lookups = new Map<string, ReturnType<typeof createCampaignSourceRecall>>();
  constructor(readonly store: Store) {}
  async read(
    turn: Turn,
    tool: CampaignSourceTool,
    raw: unknown,
    transportRequestId: string,
    signal?: AbortSignal
  ): Promise<Record<string, unknown>> {
    const payload = await this.store.transaction(async (client) => {
      const campaign = await this.store.campaign(turn.campaignId, client, true);
      const active = await client.query(
        'SELECT owner,status,lease_until,document FROM turns WHERE id=$1 AND campaign_id=$2 FOR UPDATE',
        [turn.id, turn.campaignId]
      );
      const row = active.rows[0];
      if (
        signal?.aborted ||
        !row ||
        row.owner !== ownerId ||
        row.status !== TurnStatus.Running ||
        new Date(row.lease_until).getTime() <= Date.now()
      )
        throw new Problem(409, 'campaign_source_inactive', 'Source attempt is no longer active');
      if (
        campaign.revision !== turn.context?.revision ||
        row.document.context?.prompt !== turn.context?.prompt
      )
        throw conflict('Campaign changed during source lookup');
      if (!turn.diceSessionId)
        throw new Problem(
          422,
          'campaign_source_session',
          'Source lookup requires a frozen session'
        );
      const session = await client.query(
        'SELECT frozen_sources FROM dice_sessions WHERE id=$1 AND campaign_id=$2',
        [turn.diceSessionId, turn.campaignId]
      );
      const frozen = frozenCampaignSourcesSchema.parse(session.rows[0]?.frozen_sources);
      if (
        frozen.campaignId !== turn.campaignId ||
        canonicalRuleJson(frozen) !== canonicalRuleJson(turn.context?.frozenSources)
      )
        throw conflict('Source lookup must use the active frozen context');
      if (turn.ruleContext) await new RuleStore(this.store).guard(turn.ruleContext, client);
      const argumentDigest = createHash('sha256')
        .update(canonicalRuleJson({ tool, arguments: raw }))
        .digest('hex');
      let lookup = this.lookups.get(turn.diceSessionId);
      if (!lookup) {
        lookup = createCampaignSourceRecall(frozen, turn.context?.sourceSpans);
        this.lookups.set(turn.diceSessionId, lookup);
      }
      const prior = await client.query(
        'SELECT argument_digest,payload FROM turn_campaign_source_reads WHERE turn_id=$1 AND transport_request_id=$2',
        [turn.id, transportRequestId]
      );
      if (prior.rows[0]) {
        if (prior.rows[0].argument_digest !== argumentDigest)
          throw conflict('Source transport identity reused with changed arguments');
        return prior.rows[0].payload;
      }
      const id = randomUUID();
      const payload =
        tool === CAMPAIGN_SOURCE_GET_TOOL_NAME ? lookup.get(raw, id) : lookup.search(raw);
      if (signal?.aborted)
        throw new Problem(409, 'campaign_source_inactive', 'Source attempt was cancelled');
      await client.query(
        'INSERT INTO turn_campaign_source_reads(id,campaign_id,turn_id,session_id,tool_name,transport_request_id,argument_digest,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          id,
          turn.campaignId,
          turn.id,
          turn.diceSessionId,
          tool,
          transportRequestId,
          argumentDigest,
          payload,
        ]
      );
      return payload;
    });
    // Store.transaction resolves after COMMIT. A replay delivers its original payload too.
    if (tool === CAMPAIGN_SOURCE_GET_TOOL_NAME && turn.diceSessionId)
      this.lookups.get(turn.diceSessionId)?.markSupplied(payload.sourceSpan);
    return payload;
  }
  async records(
    campaignId: string,
    turnId: string,
    client?: PoolClient
  ): Promise<CampaignSourceRead[]> {
    const result = await (client ?? this.store.pool).query(
      'SELECT * FROM turn_campaign_source_reads WHERE campaign_id=$1 AND turn_id=$2 ORDER BY created_at,id',
      [campaignId, turnId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      campaignId: row.campaign_id,
      turnId: row.turn_id,
      sessionId: row.session_id,
      tool: row.tool_name,
      transportRequestId: row.transport_request_id,
      argumentDigest: row.argument_digest,
      payload: row.payload,
      createdAt: new Date(row.created_at).toISOString(),
    }));
  }
}
