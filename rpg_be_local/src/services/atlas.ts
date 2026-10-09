import { createHash } from 'node:crypto';
import { Store } from '../store.js';
import { Problem } from '../errors.js';
import { atlasEditSchema } from '../domain/atlas.js';
import { mutateAtlas } from '../domain/atlasMutation.js';
import { projectAtlas } from '../domain/atlasProjection.js';
import { canonicalRuleJson } from '../domain/rules.js';

export class AtlasService {
  constructor(readonly store: Store) {}
  async read(campaignId: string, scope?: string, cursor = 0, routeCursor = 0) {
    return projectAtlas(await this.store.campaign(campaignId), scope, cursor, false, routeCursor);
  }
  async edit(campaignId: string, raw: unknown) {
    const input = atlasEditSchema.parse(raw);
    if (input.changes.preparedReceiptIds?.length)
      throw new Problem(422, 'atlas_receipt', 'Preparation receipts are owned by gameplay turns');
    const digest = createHash('sha256').update(canonicalRuleJson(input.changes)).digest('hex');
    return this.store.transaction(async (client) => {
      const c = await this.store.campaign(campaignId, client, true);
      const prior = await client.query(
        'SELECT digest,result FROM atlas_edits WHERE campaign_id=$1 AND request_id=$2',
        [campaignId, input.requestId]
      );
      if (prior.rows[0]) {
        if (prior.rows[0].digest !== digest)
          throw new Problem(
            409,
            'atlas_request_reused',
            'Atlas request identity was reused with changed input'
          );
        return prior.rows[0].result as { requestId: string; saved: boolean };
      }
      await this.store.assertIdle(campaignId, client);
      const candidate = mutateAtlas(c, input.changes);
      candidate.revision++;
      await this.store.save(candidate, client);
      const result = { requestId: input.requestId, saved: true };
      await client.query(
        'INSERT INTO atlas_edits(campaign_id,request_id,digest,changes,result) VALUES($1,$2,$3,$4,$5)',
        [campaignId, input.requestId, digest, input.changes, result]
      );
      return result;
    });
  }
}
