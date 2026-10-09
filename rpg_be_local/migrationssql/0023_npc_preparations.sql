CREATE TABLE npc_preparations (
 id uuid PRIMARY KEY,
 campaign_id uuid NOT NULL,
 session_id uuid NOT NULL,
 turn_id uuid NOT NULL,
 owner_turn_id uuid NOT NULL,
 local_key text NOT NULL CHECK (length(local_key) BETWEEN 1 AND 200),
 argument_digest text NOT NULL CHECK (length(argument_digest) = 64),
 frozen_input jsonb NOT NULL CHECK (jsonb_typeof(frozen_input) = 'object'),
 provider_settings jsonb NOT NULL CHECK (jsonb_typeof(provider_settings) = 'object'),
 reserved_character_id uuid NOT NULL,
 status text NOT NULL CHECK (status IN ('running','ready','failed','interrupted')),
 owner_id uuid,
 result jsonb,
 safe_error jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(session_id,local_key), UNIQUE(id,session_id), UNIQUE(session_id,reserved_character_id),
 FOREIGN KEY(session_id,campaign_id) REFERENCES dice_sessions(id,campaign_id) ON DELETE CASCADE,
 FOREIGN KEY(turn_id,campaign_id) REFERENCES turns(id,campaign_id) ON DELETE CASCADE,
 FOREIGN KEY(owner_turn_id,campaign_id) REFERENCES turns(id,campaign_id) ON DELETE CASCADE,
 CHECK ((status = 'running') = (owner_id IS NOT NULL)),
 CHECK ((status = 'ready') = (result IS NOT NULL)),
 CHECK (result IS NULL OR jsonb_typeof(result) = 'object')
);
CREATE INDEX npc_preparations_session ON npc_preparations(session_id,created_at,id);
CREATE FUNCTION immutable_ready_npc_preparation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM campaigns WHERE id = OLD.campaign_id) THEN RETURN OLD; END IF;
 IF OLD.status = 'ready' THEN RAISE EXCEPTION 'Ready NPC preparations are immutable'; END IF;
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'NPC preparations are campaign audit records'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER npc_preparation_ready_immutable BEFORE UPDATE OR DELETE ON npc_preparations FOR EACH ROW EXECUTE FUNCTION immutable_ready_npc_preparation();
