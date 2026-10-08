import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  advancementAwardSchema,
  advancementProposalSchema,
  advancementDigest,
  AdvancementStatus,
} from '../domain/advancement.js';
import { Problem } from '../errors.js';
import type { Store } from '../store.js';
import type { Campaign, Turn } from '../domain/types.js';

const savedAwardSchema = advancementAwardSchema.safeExtend({
  id: z.uuid(),
  recipientName: z.string().min(1),
  recipientType: z.string(),
  currencyId: z.string().regex(/^[a-f0-9]{64}$/),
});
export const advancementArchiveSchema = z.array(
  z
    .object({
      id: z.uuid(),
      requestId: z.uuid(),
      status: z.enum(AdvancementStatus),
      reviewedTurnIds: z.array(z.uuid()),
      proposal: advancementProposalSchema.nullable(),
      originalProposal: advancementProposalSchema.nullable(),
      adjustmentReason: z.string().nullable(),
      awards: z.array(savedAwardSchema),
      createdAt: z.iso.datetime(),
      appliedAt: z.iso.datetime().nullable(),
      reads: z.array(
        z
          .object({ id: z.uuid(), tool: z.string(), payload: z.record(z.string(), z.unknown()) })
          .strict()
      ),
    })
    .strict()
);
export type AdvancementArchive = z.infer<typeof advancementArchiveSchema>;

export function advancementSourceIds(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload)) return payload.flatMap(advancementSourceIds);
  const p = payload as Record<string, unknown>;
  const own = [p.sourceId, (p.sourceSpan as Record<string, unknown> | undefined)?.id].filter(
    (id): id is string => typeof id === 'string' && z.uuid().safeParse(id).success
  );
  return [...own, ...Object.values(p).flatMap(advancementSourceIds)];
}

function remapReadPayload(payload: unknown, mapped: (id: string) => string): unknown {
  if (Array.isArray(payload)) return payload.map((value) => remapReadPayload(value, mapped));
  if (!payload || typeof payload !== 'object') return payload;
  return Object.fromEntries(
    Object.entries(payload).map(([key, value]) => [
      key,
      ['id', 'sourceId', 'receipt', 'receiptId'].includes(key) && typeof value === 'string'
        ? (mapped(value) ?? value)
        : remapReadPayload(value, mapped),
    ])
  );
}

export async function exportAdvancement(
  client: PoolClient,
  campaignId: string
): Promise<AdvancementArchive> {
  const rows = await client.query(
    'SELECT * FROM advancement_reviews WHERE campaign_id=$1 ORDER BY created_at,id',
    [campaignId]
  );
  const result: AdvancementArchive = [];
  for (const row of rows.rows) {
    const reads = await client.query(
      'SELECT id,tool,payload FROM advancement_reads WHERE review_id=$1 ORDER BY created_at,id',
      [row.id]
    );
    result.push({
      id: row.id,
      requestId: row.request_id,
      status: row.status,
      reviewedTurnIds: Object.keys(row.capture.turnIdentities),
      proposal: row.proposal,
      originalProposal: row.original_proposal,
      adjustmentReason: row.adjustment_reason,
      awards: row.awards,
      createdAt: new Date(row.created_at).toISOString(),
      appliedAt: row.applied_at ? new Date(row.applied_at).toISOString() : null,
      reads: reads.rows,
    });
  }
  return advancementArchiveSchema.parse(result);
}

export function validateAdvancementArchive(reviews: AdvancementArchive, turns: Turn[]) {
  const ids = new Set(turns.map((t) => t.id));
  const covered = new Set<string>();
  for (const r of reviews) {
    if (
      new Set(r.reviewedTurnIds).size !== r.reviewedTurnIds.length ||
      r.reviewedTurnIds.some((id) => !ids.has(id))
    )
      throw new Problem(
        422,
        'archive_invalid',
        'Advancement coverage references absent or duplicate turns'
      );
    if (
      [AdvancementStatus.Applied, AdvancementStatus.Reversed].includes(r.status) &&
      (!r.proposal || !r.appliedAt)
    )
      throw new Problem(
        422,
        'archive_invalid',
        'Applied advancement requires proposal and timestamp'
      );
    const receipts = new Set(r.reads.map((x) => x.id));
    for (const p of [r.proposal, r.originalProposal]) {
      if (!p) continue;
      if (
        p.awards.some((a) => a.evidenceTurnIds.some((id) => !r.reviewedTurnIds.includes(id))) ||
        p.ruleEvidence.some((e) => !receipts.has(e.receiptId))
      )
        throw new Problem(422, 'archive_invalid', 'Advancement evidence is outside this review');
    }
    if (
      r.awards.length &&
      ![AdvancementStatus.Applied, AdvancementStatus.Reversed].includes(r.status)
    )
      throw new Problem(
        422,
        'archive_invalid',
        'Unapplied reviews cannot contain awarded progression'
      );
    if (r.proposal && [AdvancementStatus.Applied, AdvancementStatus.Reversed].includes(r.status)) {
      const awards = r.awards.map(
        ({ id: _id, recipientName: _name, recipientType: _type, currencyId: _currency, ...a }) => a
      );
      if (advancementDigest(awards) !== advancementDigest(r.proposal.awards))
        throw new Problem(
          422,
          'archive_invalid',
          'Advancement awards differ from the final proposal'
        );
    }
    if (r.status === AdvancementStatus.Applied)
      for (const id of r.reviewedTurnIds) {
        const t = turns.find((t) => t.id === id)!;
        if (covered.has(id) || t.undone || t.status !== 'completed')
          throw new Problem(422, 'archive_invalid', 'Invalid active advancement coverage');
        covered.add(id);
      }
  }
}

export async function importAdvancement(
  store: Store,
  client: PoolClient,
  c: Campaign,
  reviews: AdvancementArchive
) {
  for (const r of reviews) {
    const capture = {
      turnIdentities: Object.fromEntries(r.reviewedTurnIds.map((id) => [id, 'imported'])),
    };
    await client.query(
      'INSERT INTO advancement_reviews(id,campaign_id,request_id,status,capture,proposal,original_proposal,proposal_digest,adjustment_reason,awards,imported,created_at,applied_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11,$12)',
      [
        r.id,
        c.id,
        r.requestId,
        r.status === AdvancementStatus.Running ? AdvancementStatus.Interrupted : r.status,
        capture,
        r.proposal,
        r.originalProposal,
        r.proposal ? advancementDigest(r.proposal) : null,
        r.adjustmentReason,
        JSON.stringify(r.awards),
        r.createdAt,
        r.appliedAt,
      ]
    );
    for (const read of r.reads)
      await client.query(
        'INSERT INTO advancement_reads(id,campaign_id,review_id,request_id,argument_digest,tool,payload) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [read.id, c.id, r.id, read.id, 'imported', read.tool, read.payload]
      );
    if (r.status === AdvancementStatus.Applied)
      for (const turnId of r.reviewedTurnIds)
        await client.query(
          'INSERT INTO advancement_coverage(campaign_id,turn_id,review_id) VALUES($1,$2,$3)',
          [c.id, turnId, r.id]
        );
  }
  // A review's captured provider input is deliberately never imported as runnable state.
  void store;
}

export function remapAdvancement(
  reviews: AdvancementArchive,
  mapped: (id: string) => string,
  campaignId: string
) {
  for (const r of reviews) {
    r.id = mapped(r.id);
    r.requestId = randomUUID();
    r.reviewedTurnIds = r.reviewedTurnIds.map(mapped);
    for (const p of [r.proposal, r.originalProposal])
      if (p) {
        for (const a of p.awards) {
          a.characterId = mapped(a.characterId);
          a.evidenceTurnIds = a.evidenceTurnIds.map(mapped);
        }
        for (const e of p.ruleEvidence) e.receiptId = mapped(e.receiptId);
      }
    for (const a of r.awards) {
      a.id = mapped(a.id);
      a.characterId = mapped(a.characterId);
      a.evidenceTurnIds = a.evidenceTurnIds.map(mapped);
      a.currencyId = advancementDigest({
        campaignId,
        system: r.proposal!.rewardSystem.key,
        unit: a.unitKey,
        kind: a.kind,
      });
    }
    for (const read of r.reads) {
      const old = read.id;
      read.id = mapped(old);
      if (read.payload.receipt === old) read.payload.receipt = read.id;
      if (read.payload.receiptId === old) read.payload.receiptId = read.id;
      read.payload = remapReadPayload(read.payload, mapped) as Record<string, unknown>;
    }
  }
}
