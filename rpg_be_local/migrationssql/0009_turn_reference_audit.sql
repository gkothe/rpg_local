ALTER TABLE dice_sessions ADD COLUMN IF NOT EXISTS frozen_sources jsonb;
CREATE TABLE turn_campaign_source_reads (
 id uuid PRIMARY KEY,
 campaign_id uuid NOT NULL,
 turn_id uuid NOT NULL,
 session_id uuid NOT NULL,
 tool_name text NOT NULL CHECK (tool_name IN ('campaign_sources_search','campaign_sources_get')),
 transport_request_id text NOT NULL,
 argument_digest text NOT NULL CHECK(length(argument_digest)=64),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(turn_id,transport_request_id),
 FOREIGN KEY(turn_id,campaign_id) REFERENCES turns(id,campaign_id) ON DELETE CASCADE,
 FOREIGN KEY(session_id,campaign_id) REFERENCES dice_sessions(id,campaign_id) ON DELETE CASCADE
);
CREATE INDEX turn_campaign_source_reads_session ON turn_campaign_source_reads(session_id,created_at,id);
CREATE OR REPLACE FUNCTION immutable_dice_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
  IF NOT EXISTS (SELECT 1 FROM campaigns WHERE id = OLD.campaign_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Dice sessions are retained until campaign deletion';
 END IF;
 IF ROW(OLD.id,OLD.campaign_id,OLD.root_turn_id,OLD.context_digest,OLD.frozen_prompt,OLD.frozen_revision,OLD.character_ids,OLD.imported,OLD.created_at,OLD.prompt_contract_version,OLD.digest_version,OLD.system_prompt,OLD.frozen_knowledge,OLD.tool_definitions,OLD.frozen_sources)
 IS DISTINCT FROM ROW(NEW.id,NEW.campaign_id,NEW.root_turn_id,NEW.context_digest,NEW.frozen_prompt,NEW.frozen_revision,NEW.character_ids,NEW.imported,NEW.created_at,NEW.prompt_contract_version,NEW.digest_version,NEW.system_prompt,NEW.frozen_knowledge,NEW.tool_definitions,NEW.frozen_sources) THEN
  RAISE EXCEPTION 'Dice session context is immutable';
 END IF;
 RETURN NEW;
END $$;
