import type { PoolClient } from 'pg';
import { Problem } from '../errors.js';
import {
  JOURNAL_LEASE_SECONDS,
  JournalDecision,
  JournalJobKind,
  JournalJobStatus,
} from '../domain/journal.js';
import { ownerId, type Store } from '../store.js';

export type JournalJobRow = {
  id: string;
  campaignId: string;
  requestId: string;
  kind: JournalJobKind;
  identityDigest: string;
  status: JournalJobStatus;
  owner: string | null;
  leaseUntil: string | null;
  frozenInput: Record<string, unknown>;
  stagedResult: Record<string, unknown> | null;
  checkpoint: Record<string, unknown> | null;
  safeError: string | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
};
export type JournalDecisionRow = {
  jobId: string;
  requestId: string;
  decision: JournalDecision;
  identityDigest: string;
  result: Record<string, unknown> | null;
};

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const mapRow = (r: Record<string, unknown>): JournalJobRow => ({
  id: r.id as string,
  campaignId: r.campaign_id as string,
  requestId: r.request_id as string,
  kind: r.kind as JournalJobKind,
  identityDigest: r.identity_digest as string,
  status: r.status as JournalJobStatus,
  owner: (r.owner as string | null) ?? null,
  leaseUntil: iso(r.lease_until),
  frozenInput: r.frozen_input as Record<string, unknown>,
  stagedResult: (r.staged_result as Record<string, unknown> | null) ?? null,
  checkpoint: (r.checkpoint as Record<string, unknown> | null) ?? null,
  safeError: (r.safe_error as string | null) ?? null,
  errorCode: (r.error_code as string | null) ?? null,
  createdAt: iso(r.created_at)!,
  updatedAt: iso(r.updated_at)!,
});

const MISSING_TABLE = '42P01';
/** A missing migration is an installation problem, not an unrelated failure. */
async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if ((e as { code?: string } | null)?.code === MISSING_TABLE)
      throw new Problem(
        503,
        'journal_database_setup',
        'Journal tables are missing; run setup-database.cmd and restart the application.'
      );
    throw e;
  }
}

/** Persistence for durable Journal jobs; writes are short transactions, never held across AI calls. */
export class JournalJobStore {
  constructor(private store: Store) {}

  find(campaignId: string, requestId: string, client?: PoolClient): Promise<JournalJobRow | null> {
    return guarded(async () => {
      const r = await (client ?? this.store.pool).query(
        'SELECT * FROM journal_jobs WHERE campaign_id=$1 AND request_id=$2',
        [campaignId, requestId]
      );
      return r.rows[0] ? mapRow(r.rows[0]) : null;
    });
  }

  get(
    campaignId: string,
    jobId: string,
    client?: PoolClient,
    lock = false
  ): Promise<JournalJobRow> {
    return guarded(async () => {
      const r = await (client ?? this.store.pool).query(
        'SELECT * FROM journal_jobs WHERE campaign_id=$1 AND id=$2' + (lock ? ' FOR UPDATE' : ''),
        [campaignId, jobId]
      );
      if (!r.rows[0]) throw new Problem(404, 'journal_not_found', 'Journal task not found');
      return mapRow(r.rows[0]);
    });
  }

  insertRunning(
    client: PoolClient,
    job: {
      id: string;
      campaignId: string;
      requestId: string;
      kind: JournalJobKind;
      identityDigest: string;
      frozenInput: unknown;
      checkpoint: unknown;
    }
  ): Promise<void> {
    return guarded(async () => {
      await client.query(
        "INSERT INTO journal_jobs(id,campaign_id,request_id,kind,identity_digest,status,owner,lease_until,frozen_input,checkpoint) VALUES($1,$2,$3,$4,$5,'running',$6,now()+($7 * interval '1 second'),$8,$9)",
        [
          job.id,
          job.campaignId,
          job.requestId,
          job.kind,
          job.identityDigest,
          ownerId,
          JOURNAL_LEASE_SECONDS,
          JSON.stringify(job.frozenInput),
          JSON.stringify(job.checkpoint),
        ]
      );
    });
  }

  /** Resume an interrupted/failed job with its saved capture. */
  resume(client: PoolClient, jobId: string): Promise<void> {
    return guarded(async () => {
      await client.query(
        "UPDATE journal_jobs SET status='running',owner=$2,lease_until=now()+($3 * interval '1 second'),safe_error=NULL,error_code=NULL,updated_at=now() WHERE id=$1",
        [jobId, ownerId, JOURNAL_LEASE_SECONDS]
      );
    });
  }

  /** Owner/lease check under the job row lock; false means cancelled, recovered or taken over. */
  async owned(jobId: string, client?: PoolClient): Promise<boolean> {
    const r = await (client ?? this.store.pool).query(
      "SELECT 1 FROM journal_jobs WHERE id=$1 AND owner=$2 AND status='running' AND lease_until > now()",
      [jobId, ownerId]
    );
    return (r.rowCount ?? 0) > 0;
  }

  /** Renew ownership and optionally persist progress; false when ownership was lost. */
  async renew(
    jobId: string,
    progress?: { checkpoint?: unknown; staged?: unknown }
  ): Promise<boolean> {
    const r = await this.store.pool.query(
      "UPDATE journal_jobs SET lease_until=now()+($2 * interval '1 second'),checkpoint=COALESCE($4::jsonb,checkpoint),staged_result=COALESCE($5::jsonb,staged_result),updated_at=now() WHERE id=$1 AND owner=$3 AND status='running'",
      [
        jobId,
        JOURNAL_LEASE_SECONDS,
        ownerId,
        progress?.checkpoint === undefined ? null : JSON.stringify(progress.checkpoint),
        progress?.staged === undefined ? null : JSON.stringify(progress.staged),
      ]
    );
    return (r.rowCount ?? 0) > 0;
  }

  /** Finish only while still owned; returns whether the terminal state was written. */
  async finish(
    jobId: string,
    status: JournalJobStatus,
    fields: {
      staged?: unknown;
      checkpoint?: unknown;
      safeError?: string | null;
      errorCode?: string | null;
    } = {},
    client?: PoolClient
  ): Promise<boolean> {
    const r = await (client ?? this.store.pool).query(
      "UPDATE journal_jobs SET status=$2,owner=NULL,lease_until=NULL,staged_result=COALESCE($4::jsonb,staged_result),checkpoint=COALESCE($5::jsonb,checkpoint),safe_error=$6,error_code=$7,updated_at=now() WHERE id=$1 AND owner=$3 AND status='running'",
      [
        jobId,
        status,
        ownerId,
        fields.staged === undefined ? null : JSON.stringify(fields.staged),
        fields.checkpoint === undefined ? null : JSON.stringify(fields.checkpoint),
        fields.safeError ?? null,
        fields.errorCode ?? null,
      ]
    );
    return (r.rowCount ?? 0) > 0;
  }

  async cancel(client: PoolClient, jobId: string): Promise<void> {
    await client.query(
      "UPDATE journal_jobs SET status='cancelled',owner=NULL,lease_until=NULL,safe_error='Cancelled by player',error_code='journal_cancelled',updated_at=now() WHERE id=$1 AND status IN ('pending','running')",
      [jobId]
    );
  }

  decision(
    jobId: string,
    requestId: string,
    client?: PoolClient
  ): Promise<JournalDecisionRow | null> {
    return guarded(async () => {
      const r = await (client ?? this.store.pool).query(
        'SELECT * FROM journal_job_decisions WHERE job_id=$1 AND (request_id=$2 OR $2::uuid IS NULL) ORDER BY created_at LIMIT 1',
        [jobId, requestId]
      );
      const row = r.rows[0];
      return row
        ? {
            jobId: row.job_id,
            requestId: row.request_id,
            decision: row.decision,
            identityDigest: row.identity_digest,
            result: row.result,
          }
        : null;
    });
  }
  /** The job's single terminal decision, whichever request recorded it. */
  async anyDecision(jobId: string, client?: PoolClient): Promise<JournalDecisionRow | null> {
    const r = await (client ?? this.store.pool).query(
      'SELECT * FROM journal_job_decisions WHERE job_id=$1 LIMIT 1',
      [jobId]
    );
    const row = r.rows[0];
    return row
      ? {
          jobId: row.job_id,
          requestId: row.request_id,
          decision: row.decision,
          identityDigest: row.identity_digest,
          result: row.result,
        }
      : null;
  }
  async recordDecision(client: PoolClient, d: JournalDecisionRow): Promise<void> {
    await client.query(
      'INSERT INTO journal_job_decisions(job_id,request_id,decision,identity_digest,result) VALUES($1,$2,$3,$4,$5)',
      [
        d.jobId,
        d.requestId,
        d.decision,
        d.identityDigest,
        d.result ? JSON.stringify(d.result) : null,
      ]
    );
  }
  active(status: JournalJobStatus): boolean {
    return status === JournalJobStatus.Pending || status === JournalJobStatus.Running;
  }
}
