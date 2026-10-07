-- Durable campaign-memory rebuild drafts. A draft is staged here and replaces memory only on explicit Apply.
-- Operational state, not campaign archive content (matches Journal jobs).
CREATE TABLE memory_rebuild_jobs (
 id uuid PRIMARY KEY,
 campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
 request_id uuid NOT NULL,
 identity_digest text NOT NULL CHECK (identity_digest ~ '^[0-9a-f]{64}$'),
 status text NOT NULL CHECK (status IN ('pending','running','ready','failed','cancelled','interrupted','applied','discarded')),
 owner uuid,
 lease_until timestamptz,
 frozen_input jsonb NOT NULL CHECK (jsonb_typeof(frozen_input) = 'object'),
 source_identity text NOT NULL CHECK (source_identity ~ '^[0-9a-f]{64}$'),
 target_identity text NOT NULL CHECK (target_identity ~ '^[0-9a-f]{64}$'),
 baseline jsonb CHECK (baseline IS NULL OR jsonb_typeof(baseline) = 'object'),
 checkpoint jsonb NOT NULL CHECK (jsonb_typeof(checkpoint) = 'object'),
 candidate jsonb CHECK (candidate IS NULL OR jsonb_typeof(candidate) = 'object'),
 proposal_digest text CHECK (proposal_digest IS NULL OR proposal_digest ~ '^[0-9a-f]{64}$'),
 safe_error text,
 error_code text,
 decision text CHECK (decision IS NULL OR decision IN ('applied','discarded')),
 decision_request_id uuid,
 decision_memory_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (campaign_id, request_id),
 CHECK ((status = 'running') = (owner IS NOT NULL))
);
-- At most one unfinished rebuild per campaign.
CREATE UNIQUE INDEX memory_rebuild_jobs_one_active ON memory_rebuild_jobs(campaign_id) WHERE status IN ('pending','running');
CREATE INDEX memory_rebuild_jobs_campaign ON memory_rebuild_jobs(campaign_id, created_at DESC, id);
-- Receipts make resume/apply/discard idempotent across lost responses.
CREATE TABLE memory_rebuild_requests (
 job_id uuid NOT NULL REFERENCES memory_rebuild_jobs(id) ON DELETE CASCADE,
 action text NOT NULL CHECK (action IN ('resume','apply','discard')),
 request_id uuid NOT NULL,
 identity_digest text NOT NULL CHECK (identity_digest ~ '^[0-9a-f]{64}$'),
 attempt_owner uuid,
 result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (job_id, action, request_id)
);
