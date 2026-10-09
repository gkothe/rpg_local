import type { PoolClient } from 'pg';
import type { RuleRead } from '../domain/rules.js';
export async function turnRuleReads(turnId: string, client: PoolClient): Promise<RuleRead[]> {
  const rows = await client.query(
    'SELECT * FROM turn_rule_reads WHERE turn_id=$1 ORDER BY created_at,id',
    [turnId]
  );
  return rows.rows.map((row) => ({
    id: row.id,
    campaignId: row.campaign_id,
    turnId: row.turn_id,
    context: row.captured_context,
    tool: row.tool_name,
    transportRequestId: row.transport_request_id,
    argumentDigest: row.argument_digest,
    resultHash: row.result_hash,
    payload: row.payload,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}
