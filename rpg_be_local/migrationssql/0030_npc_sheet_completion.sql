ALTER TABLE dice_sessions ADD COLUMN npc_sheet_version integer NOT NULL DEFAULT 0 CHECK (npc_sheet_version IN (0,1));
CREATE FUNCTION immutable_npc_sheet_session_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.npc_sheet_version IS DISTINCT FROM OLD.npc_sheet_version THEN RAISE EXCEPTION 'NPC sheet session version is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER dice_npc_sheet_version_immutable BEFORE UPDATE ON dice_sessions FOR EACH ROW EXECUTE FUNCTION immutable_npc_sheet_session_version();
ALTER TABLE npc_preparations ADD COLUMN sheet_checkpoint jsonb;
CREATE TABLE npc_sheet_completions (
 id uuid PRIMARY KEY, campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
 character_id uuid NOT NULL, request_id uuid NOT NULL, argument_digest text NOT NULL,
 status text NOT NULL CHECK (status IN ('running','ready','failed','interrupted','cancelled','applied','discarded')),
 owner uuid, lease_until timestamptz, frozen_input jsonb NOT NULL, checkpoint jsonb,
 result jsonb, safe_error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(campaign_id,request_id), UNIQUE(id,campaign_id),
 CHECK ((status='running')=(owner IS NOT NULL)), CHECK(status<>'ready' OR result IS NOT NULL)
);
CREATE UNIQUE INDEX npc_sheet_one_running ON npc_sheet_completions(campaign_id) WHERE status='running';
CREATE TABLE npc_sheet_reads (
 id uuid PRIMARY KEY, job_id uuid NOT NULL, campaign_id uuid NOT NULL, character_id uuid NOT NULL,
 request_id text NOT NULL, argument_digest text NOT NULL, tool text NOT NULL, context jsonb NOT NULL, payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(job_id,request_id),
 FOREIGN KEY(job_id,campaign_id) REFERENCES npc_sheet_completions(id,campaign_id) ON DELETE CASCADE
);
CREATE TABLE npc_sheet_decisions (
 job_id uuid NOT NULL REFERENCES npc_sheet_completions(id) ON DELETE CASCADE,
 request_id uuid NOT NULL, decision text NOT NULL CHECK(decision IN ('apply','discard')),
 result jsonb NOT NULL, PRIMARY KEY(job_id,request_id)
);
