-- Combat preparation receipts reserve individual identities before dice resolve.
-- They are session audit records, never canonical campaign state.
CREATE TABLE combat_preparations (
 id uuid PRIMARY KEY,
 campaign_id uuid NOT NULL,
 session_id uuid NOT NULL,
 turn_id uuid NOT NULL,
 encounter_id uuid NOT NULL,
 preparation_key text NOT NULL CHECK (length(preparation_key) BETWEEN 1 AND 200),
 argument_digest text NOT NULL CHECK (length(argument_digest) = 64),
 payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (session_id, preparation_key),
 UNIQUE (id, session_id),
 FOREIGN KEY (session_id, campaign_id) REFERENCES dice_sessions(id, campaign_id) ON DELETE CASCADE,
 FOREIGN KEY (turn_id, campaign_id) REFERENCES turns(id, campaign_id) ON DELETE CASCADE
);
CREATE INDEX combat_preparations_session ON combat_preparations(session_id, created_at, id);
CREATE TABLE combat_prepared_characters (
 id uuid PRIMARY KEY,
 campaign_id uuid NOT NULL,
 session_id uuid NOT NULL,
 preparation_id uuid NOT NULL,
 local_key text NOT NULL CHECK (length(local_key) BETWEEN 1 AND 200),
 specification_digest text NOT NULL CHECK (length(specification_digest) = 64),
 draft jsonb NOT NULL CHECK (jsonb_typeof(draft) = 'object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (session_id, local_key),
 FOREIGN KEY (preparation_id, session_id) REFERENCES combat_preparations(id, session_id) ON DELETE CASCADE,
 FOREIGN KEY (session_id, campaign_id) REFERENCES dice_sessions(id, campaign_id) ON DELETE CASCADE
);
CREATE FUNCTION immutable_combat_preparation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM campaigns WHERE id = OLD.campaign_id) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Combat preparations are append-only; only campaign deletion may erase them';
END $$;
CREATE TRIGGER combat_preparations_immutable BEFORE UPDATE OR DELETE ON combat_preparations FOR EACH ROW EXECUTE FUNCTION immutable_combat_preparation();
CREATE TRIGGER combat_prepared_characters_immutable BEFORE UPDATE OR DELETE ON combat_prepared_characters FOR EACH ROW EXECUTE FUNCTION immutable_combat_preparation();
