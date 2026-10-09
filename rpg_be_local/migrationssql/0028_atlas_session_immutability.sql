CREATE OR REPLACE FUNCTION immutable_dice_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
  IF NOT EXISTS (SELECT 1 FROM campaigns WHERE id = OLD.campaign_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Dice sessions are retained until campaign deletion';
 END IF;
 IF ROW(OLD.id,OLD.campaign_id,OLD.root_turn_id,OLD.context_digest,OLD.frozen_prompt,OLD.frozen_revision,OLD.character_ids,OLD.imported,OLD.created_at,OLD.system_prompt,OLD.frozen_knowledge,OLD.tool_definitions,OLD.frozen_sources,OLD.frozen_history,OLD.frozen_continuity,OLD.frozen_atlas)
 IS DISTINCT FROM ROW(NEW.id,NEW.campaign_id,NEW.root_turn_id,NEW.context_digest,NEW.frozen_prompt,NEW.frozen_revision,NEW.character_ids,NEW.imported,NEW.created_at,NEW.system_prompt,NEW.frozen_knowledge,NEW.tool_definitions,NEW.frozen_sources,NEW.frozen_history,NEW.frozen_continuity,NEW.frozen_atlas) THEN
  RAISE EXCEPTION 'Dice session context is immutable';
 END IF;
 RETURN NEW;
END $$;