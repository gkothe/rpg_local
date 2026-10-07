import type { PoolClient } from 'pg';
import { Problem } from '../errors.js';
import {
  MEMORY_REBUILD_LEASE_SECONDS,
  MemoryRebuildAction,
  MemoryRebuildError,
  MemoryRebuildPurpose,
  MemoryRebuildStatus,
  type MemoryRebuildCandidate,
  type MemoryRebuildReceiptAction,
} from '../domain/memoryRebuild.js';
import type { RebuildCheckpoint } from '../domain/memoryRebuildGeneration.js';
import type { Memory } from '../domain/types.js';
import type { Store } from '../store.js';

export type MemoryRebuildJobRow = {
  id: string;
  campaignId: string;
  requestId: string;
  identityDigest: string;
  status: MemoryRebuildStatus;
  owner: string | null;
  leaseUntil: string | null;
  frozenInput: Record<string, unknown>;
  sourceIdentity: string;
  targetIdentity: string;
  baseline: Memory | null;
  checkpoint: RebuildCheckpoint;
  purpose: MemoryRebuildPurpose;
  candidateText: string | null;
  candidateCoveredTurnIds: string[] | null;
  /** Compact history: unpublished fragments in plan order. */
  staged: unknown[] | null;
  proposalDigest: string | null;
  safeError: string | null;
  errorCode: string | null;
  decision: MemoryRebuildAction.Apply | MemoryRebuildAction.Discard | null;
  decisionRequestId: string | null;
  decisionMemoryId: string | null;
  createdAt: string;
  updatedAt: string;
};
export type MemoryRebuildReceipt = {
  jobId: string;
  action: MemoryRebuildReceiptAction;
  requestId: string;
  identityDigest: string;
  attemptOwner: string | null;
  result: Record<string, unknown> | null;
};

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
type Raw = Record<string, unknown>;
const mapRow = (r: Raw): MemoryRebuildJobRow => {
  const candidate =
    (r.candidate as
      (Omit<MemoryRebuildCandidate, 'proposalDigest'> & { staged?: unknown[] }) | null) ?? null;
  return {
    id: r.id as string,
    campaignId: r.campaign_id as string,
    requestId: r.request_id as string,
    identityDigest: r.identity_digest as string,
    status: r.status as MemoryRebuildStatus,
    owner: (r.owner as string | null) ?? null,
    leaseUntil: iso(r.lease_until),
    frozenInput: r.frozen_input as Record<string, unknown>,
    sourceIdentity: r.source_identity as string,
    targetIdentity: r.target_identity as string,
    baseline: (r.baseline as Memory | null) ?? null,
    checkpoint: r.checkpoint as RebuildCheckpoint,
    purpose: (r.purpose as MemoryRebuildPurpose | undefined) ?? MemoryRebuildPurpose.Memory,
    staged: candidate?.staged ?? null,
    candidateText: candidate?.text ?? null,
    candidateCoveredTurnIds: candidate?.coveredTurnIds ?? null,
    proposalDigest: (r.proposal_digest as string | null) ?? null,
    safeError: (r.safe_error as string | null) ?? null,
    errorCode: (r.error_code as string | null) ?? null,
    decision:
      r.decision === 'applied'
        ? MemoryRebuildAction.Apply
        : r.decision === 'discarded'
          ? MemoryRebuildAction.Discard
          : null,
    decisionRequestId: (r.decision_request_id as string | null) ?? null,
    decisionMemoryId: (r.decision_memory_id as string | null) ?? null,
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
  };
};

const MISSING_TABLE = '42P01';
/** A missing migration is an installation problem, not an unrelated failure. */
export async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if ((e as { code?: string } | null)?.code === MISSING_TABLE)
      throw new Problem(
        503,
        MemoryRebuildError.DatabaseSetup,
        'Memory rebuild tables are missing; run setup-database.cmd and restart the application.'
      );
    throw e;
  }
}

/** Persistence for rebuild jobs. Each attempt is identified by a fresh owner UUID, never a process ID. */
export class MemoryRebuildJobStore {
  constructor(private store: Store) {}

  find(campaignId: string, requestId: string, client?: PoolClient) {
    return guarded(async () => {
      const r = await (client ?? this.store.pool).query(
        'SELECT * FROM memory_rebuild_jobs WHERE campaign_id=$1 AND request_id=$2',
        [campaignId, requestId]
      );
      return r.rows[0] ? mapRow(r.rows[0]) : null;
    });
  }

  get(campaignId: string, jobId: string, client?: PoolClient, lock = false) {
    return guarded(async () => {
      const r = await (client ?? this.store.pool).query(
        'SELECT * FROM memory_rebuild_jobs WHERE campaign_id=$1 AND id=$2' +
          (lock ? ' FOR UPDATE' : ''),
        [campaignId, jobId]
      );
      if (!r.rows[0]) throw new Problem(404, 'not_found', 'Memory rebuild not found');
      return mapRow(r.rows[0]);
    });
  }

  list(campaignId: string, limit: number, offset: number) {
    return guarded(async () => {
      const r = await this.store.pool.query(
        'SELECT * FROM memory_rebuild_jobs WHERE campaign_id=$1 ORDER BY created_at DESC,id LIMIT $2 OFFSET $3',
        [campaignId, limit, offset]
      );
      return r.rows.map(mapRow);
    });
  }

  /** The newest job that still needs attention; reachable even beyond the first page. */
  attention(campaignId: string) {
    return guarded(async () => {
      const r = await this.store.pool.query(
        "SELECT * FROM memory_rebuild_jobs WHERE campaign_id=$1 AND status IN ('pending','running','ready','failed','interrupted') ORDER BY created_at DESC,id LIMIT 1",
        [campaignId]
      );
      return r.rows[0] ? mapRow(r.rows[0]) : null;
    });
  }

  insertRunning(
    client: PoolClient,
    job: {
      id: string;
      campaignId: string;
      requestId: string;
      identityDigest: string;
      owner: string;
      frozenInput: unknown;
      sourceIdentity: string;
      targetIdentity: string;
      baseline: Memory | null;
      checkpoint: RebuildCheckpoint;
      purpose?: MemoryRebuildPurpose;
    }
  ) {
    return guarded(async () => {
      await client.query(
        "INSERT INTO memory_rebuild_jobs(id,campaign_id,request_id,identity_digest,status,owner,lease_until,frozen_input,source_identity,target_identity,baseline,checkpoint,purpose) VALUES($1,$2,$3,$4,'running',$5,now()+($6 * interval '1 second'),$7,$8,$9,$10,$11,$12)",
        [
          job.id,
          job.campaignId,
          job.requestId,
          job.identityDigest,
          job.owner,
          MEMORY_REBUILD_LEASE_SECONDS,
          JSON.stringify(job.frozenInput),
          job.sourceIdentity,
          job.targetIdentity,
          job.baseline ? JSON.stringify(job.baseline) : null,
          JSON.stringify(job.checkpoint),
          job.purpose ?? MemoryRebuildPurpose.Memory,
        ]
      );
    });
  }

  /** Begin a fresh attempt for a failed/interrupted job; its receipt is written in the same transaction. */
  async resume(client: PoolClient, jobId: string, owner: string): Promise<void> {
    await client.query(
      "UPDATE memory_rebuild_jobs SET status='running',owner=$2,lease_until=now()+($3 * interval '1 second'),safe_error=NULL,error_code=NULL,updated_at=now() WHERE id=$1",
      [jobId, owner, MEMORY_REBUILD_LEASE_SECONDS]
    );
  }

  /** Ownership check for this exact attempt; false means cancelled, recovered or superseded. */
  async owned(jobId: string, owner: string): Promise<boolean> {
    const r = await this.store.pool.query(
      "SELECT 1 FROM memory_rebuild_jobs WHERE id=$1 AND owner=$2 AND status='running' AND lease_until > now()",
      [jobId, owner]
    );
    return (r.rowCount ?? 0) > 0;
  }

  async renew(jobId: string, owner: string): Promise<boolean> {
    const r = await this.store.pool.query(
      "UPDATE memory_rebuild_jobs SET lease_until=now()+($3 * interval '1 second'),updated_at=now() WHERE id=$1 AND owner=$2 AND status='running'",
      [jobId, owner, MEMORY_REBUILD_LEASE_SECONDS]
    );
    return (r.rowCount ?? 0) > 0;
  }

  /**
   * Persist one accepted batch only if this attempt still owns the job and the stored position is
   * exactly the one the batch started from, so a batch is never appended twice.
   */
  async advance(
    jobId: string,
    owner: string,
    expectedNextIndex: number,
    checkpoint: RebuildCheckpoint,
    candidate: { text: string; coveredTurnIds: string[]; staged?: unknown[] }
  ): Promise<boolean> {
    const r = await this.store.pool.query(
      "UPDATE memory_rebuild_jobs SET checkpoint=$4,candidate=$5,lease_until=now()+($6 * interval '1 second'),updated_at=now() WHERE id=$1 AND owner=$2 AND status='running' AND (checkpoint->>'nextIndex')::int=$3",
      [
        jobId,
        owner,
        expectedNextIndex,
        JSON.stringify(checkpoint),
        JSON.stringify(candidate),
        MEMORY_REBUILD_LEASE_SECONDS,
      ]
    );
    return (r.rowCount ?? 0) > 0;
  }

  async ready(jobId: string, owner: string, digest: string): Promise<boolean> {
    const r = await this.store.pool.query(
      "UPDATE memory_rebuild_jobs SET status='ready',owner=NULL,lease_until=NULL,proposal_digest=$3,candidate=candidate || jsonb_build_object('proposalDigest',$3::text),updated_at=now() WHERE id=$1 AND owner=$2 AND status='running'",
      [jobId, owner, digest]
    );
    return (r.rowCount ?? 0) > 0;
  }

  async fail(jobId: string, owner: string, code: string, message: string): Promise<boolean> {
    const r = await this.store.pool.query(
      "UPDATE memory_rebuild_jobs SET status='failed',owner=NULL,lease_until=NULL,safe_error=$3,error_code=$4,updated_at=now() WHERE id=$1 AND owner=$2 AND status='running'",
      [jobId, owner, message, code]
    );
    return (r.rowCount ?? 0) > 0;
  }

  async cancel(client: PoolClient, jobId: string): Promise<void> {
    await client.query(
      "UPDATE memory_rebuild_jobs SET status='cancelled',owner=NULL,lease_until=NULL,safe_error='Cancelled by player',error_code='cancelled',updated_at=now() WHERE id=$1 AND status IN ('pending','running')",
      [jobId]
    );
  }

  async decide(
    client: PoolClient,
    jobId: string,
    action: MemoryRebuildAction.Apply | MemoryRebuildAction.Discard,
    requestId: string,
    memoryId: string | null
  ): Promise<void> {
    const status =
      action === MemoryRebuildAction.Apply
        ? MemoryRebuildStatus.Applied
        : MemoryRebuildStatus.Discarded;
    await client.query(
      'UPDATE memory_rebuild_jobs SET status=$2,decision=$2,decision_request_id=$3,decision_memory_id=$4,updated_at=now() WHERE id=$1',
      [jobId, status, requestId, memoryId]
    );
  }

  async receipt(
    jobId: string,
    action: MemoryRebuildReceiptAction,
    requestId: string,
    client?: PoolClient
  ): Promise<MemoryRebuildReceipt | null> {
    const r = await (client ?? this.store.pool).query(
      'SELECT * FROM memory_rebuild_requests WHERE job_id=$1 AND action=$2 AND request_id=$3',
      [jobId, action, requestId]
    );
    const row = r.rows[0];
    return row
      ? {
          jobId: row.job_id,
          action: row.action,
          requestId: row.request_id,
          identityDigest: row.identity_digest,
          attemptOwner: row.attempt_owner ?? null,
          result: row.result ?? null,
        }
      : null;
  }

  async insertReceipt(client: PoolClient, receipt: MemoryRebuildReceipt): Promise<void> {
    await client.query(
      'INSERT INTO memory_rebuild_requests(job_id,action,request_id,identity_digest,attempt_owner,result) VALUES($1,$2,$3,$4,$5,$6)',
      [
        receipt.jobId,
        receipt.action,
        receipt.requestId,
        receipt.identityDigest,
        receipt.attemptOwner,
        receipt.result ? JSON.stringify(receipt.result) : null,
      ]
    );
  }
}
