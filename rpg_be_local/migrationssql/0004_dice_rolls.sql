ALTER TABLE turns ADD CONSTRAINT turns_id_campaign_unique UNIQUE (id, campaign_id);

CREATE TABLE dice_sessions (
  id uuid PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  root_turn_id uuid NOT NULL,
  context_digest text NOT NULL CHECK (length(context_digest) = 64),
  frozen_prompt text NOT NULL,
  frozen_revision integer NOT NULL CHECK (frozen_revision >= 0),
  character_ids jsonb NOT NULL CHECK (jsonb_typeof(character_ids) = 'array'),
  imported boolean NOT NULL DEFAULT false,
  new_faces integer NOT NULL DEFAULT 0 CHECK (new_faces BETWEEN 0 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, campaign_id),
  FOREIGN KEY (root_turn_id, campaign_id) REFERENCES turns(id, campaign_id) ON DELETE CASCADE
);
CREATE TABLE dice_attempts (
  turn_id uuid PRIMARY KEY,
  campaign_id uuid NOT NULL,
  session_id uuid NOT NULL,
  requests integer NOT NULL DEFAULT 0 CHECK (requests BETWEEN 0 AND 25),
  next_slot integer NOT NULL DEFAULT 0 CHECK (next_slot BETWEEN 0 AND 12),
  transcript_bytes integer NOT NULL DEFAULT 0 CHECK (transcript_bytes BETWEEN 0 AND 8192),
  FOREIGN KEY (turn_id, campaign_id) REFERENCES turns(id, campaign_id) ON DELETE CASCADE,
  FOREIGN KEY (session_id, campaign_id) REFERENCES dice_sessions(id, campaign_id) ON DELETE CASCADE
);

CREATE FUNCTION immutable_dice_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF NOT EXISTS (SELECT 1 FROM campaigns WHERE id = OLD.campaign_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Dice sessions are retained until campaign deletion';
  END IF;
  IF ROW(OLD.id,OLD.campaign_id,OLD.root_turn_id,OLD.context_digest,OLD.frozen_prompt,OLD.frozen_revision,OLD.character_ids,OLD.imported,OLD.created_at)
    IS DISTINCT FROM ROW(NEW.id,NEW.campaign_id,NEW.root_turn_id,NEW.context_digest,NEW.frozen_prompt,NEW.frozen_revision,NEW.character_ids,NEW.imported,NEW.created_at) THEN
    RAISE EXCEPTION 'Dice session context is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER dice_sessions_immutable BEFORE UPDATE OR DELETE ON dice_sessions FOR EACH ROW EXECUTE FUNCTION immutable_dice_session();

CREATE FUNCTION valid_dice_groups(groups jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE g jsonb; face jsonb; total integer := 0; labels text[] := '{}';
BEGIN
  IF jsonb_typeof(groups) IS DISTINCT FROM 'array' OR jsonb_array_length(groups) NOT BETWEEN 1 AND 8 THEN RETURN false; END IF;
  FOR g IN SELECT value FROM jsonb_array_elements(groups) LOOP
    IF jsonb_typeof(g) IS DISTINCT FROM 'object' OR jsonb_typeof(g->'label') IS DISTINCT FROM 'string' OR length(g->>'label') NOT BETWEEN 1 AND 80 OR (g->>'label') = ANY(labels) THEN RETURN false; END IF;
    labels := array_append(labels, g->>'label');
    IF jsonb_typeof(g->'sides') IS DISTINCT FROM 'number' OR (g->>'sides')::numeric NOT BETWEEN 2 AND 1000000 OR trunc((g->>'sides')::numeric) <> (g->>'sides')::numeric THEN RETURN false; END IF;
    IF jsonb_typeof(g->'faces') IS DISTINCT FROM 'array' OR jsonb_array_length(g->'faces') NOT BETWEEN 1 AND 50 THEN RETURN false; END IF;
    total := total + jsonb_array_length(g->'faces');
    FOR face IN SELECT value FROM jsonb_array_elements(g->'faces') LOOP
      IF jsonb_typeof(face) IS DISTINCT FROM 'number' OR face::text::numeric < 1 OR face::text::numeric > (g->>'sides')::numeric OR trunc(face::text::numeric) <> face::text::numeric THEN RETURN false; END IF;
    END LOOP;
  END LOOP;
  RETURN total <= 100;
EXCEPTION WHEN others THEN RETURN false;
END $$;

CREATE TABLE dice_records (
  id uuid PRIMARY KEY,
  campaign_id uuid NOT NULL,
  session_id uuid NOT NULL,
  slot integer NOT NULL CHECK (slot BETWEEN 0 AND 11),
  spec_digest text NOT NULL CHECK (length(spec_digest) = 64),
  input jsonb NOT NULL CHECK (jsonb_typeof(input) = 'object'),
  groups jsonb NOT NULL CHECK (valid_dice_groups(groups)),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, slot),
  FOREIGN KEY (session_id, campaign_id) REFERENCES dice_sessions(id, campaign_id) ON DELETE CASCADE
);
CREATE FUNCTION immutable_dice_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM campaigns WHERE id = OLD.campaign_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Dice records are append-only; only campaign deletion may erase them';
END $$;
CREATE TRIGGER dice_records_immutable BEFORE UPDATE OR DELETE ON dice_records FOR EACH ROW EXECUTE FUNCTION immutable_dice_record();
