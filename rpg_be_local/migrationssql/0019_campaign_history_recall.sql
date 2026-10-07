-- Selective campaign history: immutable source versions, derived history fragments, durable
-- setting receipts and the frozen history metadata of a gameplay attempt.
CREATE TABLE history_turn_versions (
 campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
 turn_id uuid NOT NULL,
 content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
 document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (campaign_id, turn_id, content_hash)
);
CREATE INDEX history_turn_versions_hash ON history_turn_versions(campaign_id, content_hash);
CREATE TABLE history_fragments (
 id uuid PRIMARY KEY,
 campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK (kind IN ('section','chapter','overview')),
 title text NOT NULL CHECK (length(title) > 0),
 body text NOT NULL CHECK (length(body) > 0),
 sources jsonb NOT NULL CHECK (jsonb_typeof(sources) = 'array'),
 parent_ids jsonb NOT NULL CHECK (jsonb_typeof(parent_ids) = 'array'),
 links jsonb NOT NULL CHECK (jsonb_typeof(links) = 'array'),
 derivation_digest text NOT NULL CHECK (derivation_digest ~ '^[0-9a-f]{64}$'),
 correction_digest text NOT NULL CHECK (correction_digest ~ '^[0-9a-f]{64}$'),
 content_digest text NOT NULL CHECK (content_digest ~ '^[0-9a-f]{64}$'),
 selection_status text NOT NULL DEFAULT 'valid' CHECK (selection_status IN ('valid','stale')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX history_fragments_campaign ON history_fragments(campaign_id, created_at, id);
-- Published payloads never change; only the mutable selection status may.
CREATE FUNCTION immutable_history_fragment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
  IF NOT EXISTS (SELECT 1 FROM campaigns WHERE id = OLD.campaign_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'History fragments are retained until campaign deletion';
 END IF;
 IF ROW(OLD.id,OLD.campaign_id,OLD.kind,OLD.title,OLD.body,OLD.sources,OLD.parent_ids,OLD.links,OLD.derivation_digest,OLD.correction_digest,OLD.content_digest,OLD.created_at)
 IS DISTINCT FROM ROW(NEW.id,NEW.campaign_id,NEW.kind,NEW.title,NEW.body,NEW.sources,NEW.parent_ids,NEW.links,NEW.derivation_digest,NEW.correction_digest,NEW.content_digest,NEW.created_at) THEN
  RAISE EXCEPTION 'History fragment payload is immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER history_fragments_immutable BEFORE UPDATE OR DELETE ON history_fragments
 FOR EACH ROW EXECUTE FUNCTION immutable_history_fragment();
CREATE FUNCTION immutable_history_turn_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
  IF NOT EXISTS (SELECT 1 FROM campaigns WHERE id = OLD.campaign_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'History turn versions are retained until campaign deletion';
 END IF;
 RAISE EXCEPTION 'History turn versions are immutable';
END $$;
CREATE TRIGGER history_turn_versions_immutable BEFORE UPDATE OR DELETE ON history_turn_versions
 FOR EACH ROW EXECUTE FUNCTION immutable_history_turn_version();
-- Receipts make pin and setting changes idempotent across lost responses.
CREATE TABLE history_setting_requests (
 campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
 request_id uuid NOT NULL,
 action text NOT NULL,
 identity_digest text NOT NULL CHECK (identity_digest ~ '^[0-9a-f]{64}$'),
 result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (campaign_id, request_id)
);
-- Frozen history metadata is part of the immutable attempt, like frozen sources.
ALTER TABLE dice_sessions ADD COLUMN frozen_history jsonb;
CREATE OR REPLACE FUNCTION immutable_dice_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
  IF NOT EXISTS (SELECT 1 FROM campaigns WHERE id = OLD.campaign_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Dice sessions are retained until campaign deletion';
 END IF;
 IF ROW(OLD.id,OLD.campaign_id,OLD.root_turn_id,OLD.context_digest,OLD.frozen_prompt,OLD.frozen_revision,OLD.character_ids,OLD.imported,OLD.created_at,OLD.system_prompt,OLD.frozen_knowledge,OLD.tool_definitions,OLD.frozen_sources,OLD.frozen_history)
 IS DISTINCT FROM ROW(NEW.id,NEW.campaign_id,NEW.root_turn_id,NEW.context_digest,NEW.frozen_prompt,NEW.frozen_revision,NEW.character_ids,NEW.imported,NEW.created_at,NEW.system_prompt,NEW.frozen_knowledge,NEW.tool_definitions,NEW.frozen_sources,NEW.frozen_history) THEN
  RAISE EXCEPTION 'Dice session context is immutable';
 END IF;
 RETURN NEW;
END $$;
