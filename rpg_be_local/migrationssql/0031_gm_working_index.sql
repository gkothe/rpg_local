-- Nullable fields preserve legacy frozen sessions and humanizer candidates.
ALTER TABLE dice_sessions ADD COLUMN frozen_gm_index jsonb;
ALTER TABLE dice_sessions ADD COLUMN gm_index_contract_version integer;
ALTER TABLE dice_sessions ADD CONSTRAINT dice_frozen_gm_index_object
 CHECK (frozen_gm_index IS NULL OR jsonb_typeof(frozen_gm_index) = 'object');
ALTER TABLE dice_sessions ADD CONSTRAINT dice_gm_index_contract_version
 CHECK ((frozen_gm_index IS NULL AND gm_index_contract_version IS NULL)
 OR (frozen_gm_index IS NOT NULL AND gm_index_contract_version IS NOT NULL AND gm_index_contract_version = 1));
ALTER TABLE narrative_edit_candidates ADD COLUMN gm_index_checkpoint jsonb;
ALTER TABLE narrative_edit_candidates ADD CONSTRAINT narrative_gm_index_checkpoint_object
 CHECK (gm_index_checkpoint IS NULL OR jsonb_typeof(gm_index_checkpoint) = 'object');
ALTER TABLE memory_rebuild_jobs DROP CONSTRAINT memory_rebuild_jobs_purpose_check;
ALTER TABLE memory_rebuild_jobs ADD CONSTRAINT memory_rebuild_jobs_purpose_check
 CHECK (purpose IN ('memory', 'compact_history', 'gm_index'));

CREATE FUNCTION immutable_gm_index_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.frozen_gm_index IS DISTINCT FROM OLD.frozen_gm_index
 OR NEW.gm_index_contract_version IS DISTINCT FROM OLD.gm_index_contract_version THEN
  RAISE EXCEPTION 'Frozen GM index session context is immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER dice_gm_index_immutable BEFORE UPDATE ON dice_sessions
 FOR EACH ROW EXECUTE FUNCTION immutable_gm_index_session();
