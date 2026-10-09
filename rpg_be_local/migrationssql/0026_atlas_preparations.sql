CREATE TABLE atlas_preparations (
 id uuid PRIMARY KEY,
 campaign_id uuid NOT NULL,
 session_id uuid NOT NULL,
 turn_id uuid NOT NULL,
 owner_turn_id uuid NOT NULL,
 local_key text NOT NULL,
 argument_digest text NOT NULL,
 frozen_input jsonb NOT NULL,
 provider_settings jsonb NOT NULL,
 status text NOT NULL CHECK (status IN ('running','ready','failed','interrupted')),
 owner_id uuid,
 result jsonb,
 safe_error text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(session_id,local_key),
 FOREIGN KEY(session_id,campaign_id) REFERENCES dice_sessions(id,campaign_id) ON DELETE CASCADE,
 FOREIGN KEY(turn_id,campaign_id) REFERENCES turns(id,campaign_id) ON DELETE CASCADE,
 FOREIGN KEY(owner_turn_id,campaign_id) REFERENCES turns(id,campaign_id) ON DELETE CASCADE,
 CHECK ((status='running')=(owner_id IS NOT NULL)),
 CHECK ((status='ready')=(result IS NOT NULL))
);
CREATE FUNCTION immutable_ready_atlas_preparation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS (SELECT 1 FROM campaigns WHERE id=OLD.campaign_id) THEN RETURN OLD; END IF;
 IF OLD.status='ready' THEN RAISE EXCEPTION 'Ready atlas preparations are immutable'; END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Atlas preparations are audit records'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER atlas_ready_immutable BEFORE UPDATE OR DELETE ON atlas_preparations FOR EACH ROW EXECUTE FUNCTION immutable_ready_atlas_preparation();
