-- Durable Journal jobs (history backfill and fact checks) and their terminal decisions.
-- Candidate and checkpoint contents are private to the app; the HTTP layer projects safe progress only.
CREATE TABLE journal_jobs (
 id uuid PRIMARY KEY,
 campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
 request_id uuid NOT NULL,
 kind text NOT NULL CHECK (kind IN ('backfill','check')),
 identity_digest text NOT NULL CHECK (length(identity_digest) = 64),
 status text NOT NULL CHECK (status IN ('pending','running','completed','failed','cancelled','interrupted')),
 owner uuid,
 lease_until timestamptz,
 frozen_input jsonb NOT NULL CHECK (jsonb_typeof(frozen_input) = 'object'),
 staged_result jsonb CHECK (staged_result IS NULL OR jsonb_typeof(staged_result) = 'object'),
 checkpoint jsonb CHECK (checkpoint IS NULL OR jsonb_typeof(checkpoint) = 'object'),
 safe_error text,
 error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (campaign_id, request_id),
 CHECK ((status = 'running') = (owner IS NOT NULL))
);
-- At most one unfinished Journal job per campaign.
CREATE UNIQUE INDEX journal_jobs_one_active ON journal_jobs(campaign_id) WHERE status IN ('pending','running');
CREATE INDEX journal_jobs_campaign ON journal_jobs(campaign_id, created_at, id);
CREATE TABLE journal_job_decisions (
 job_id uuid NOT NULL REFERENCES journal_jobs(id) ON DELETE CASCADE,
 request_id uuid NOT NULL,
 decision text NOT NULL CHECK (decision IN ('accepted','dismissed')),
 identity_digest text NOT NULL CHECK (length(identity_digest) = 64),
 result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (job_id, request_id)
);
-- A job accepts exactly one terminal decision.
CREATE UNIQUE INDEX journal_job_decisions_one ON journal_job_decisions(job_id);
