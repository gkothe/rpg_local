-- One gameplay contract: retire stored contract numbers and the free-form state.combat shape.
-- In-flight turns would resume under the old contract, so they must finish first.
DO $$
BEGIN
 IF EXISTS (
  SELECT 1 FROM turns
  WHERE status IN ('pending', 'running') OR document->>'editingPending' = 'true'
 ) THEN
  RAISE EXCEPTION 'Finish or cancel pending turns before upgrading';
 END IF;
END $$;

-- Structured encounters carried trackingVersion; any other state.combat (including JSON null)
-- is free-form notes and moves to state.combatNotes unchanged.
CREATE FUNCTION rpg_0015_free_combat(state jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_typeof(state) = 'object' AND state ? 'combat'
  AND NOT (jsonb_typeof(state->'combat') = 'object' AND state->'combat' ? 'trackingVersion')
$$;
CREATE FUNCTION rpg_0015_state(state jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE
  WHEN jsonb_typeof(state) <> 'object' OR NOT state ? 'combat' THEN state
  WHEN rpg_0015_free_combat(state)
   THEN (state - 'combat') || jsonb_build_object('combatNotes', state->'combat')
  ELSE jsonb_set(state, '{combat}', (state->'combat') - 'trackingVersion')
 END
$$;

DO $$
BEGIN
 IF EXISTS (
  SELECT 1 FROM campaigns
  WHERE rpg_0015_free_combat(document->'state') AND document->'state' ? 'combatNotes'
  UNION ALL
  SELECT 1 FROM snapshots
  WHERE (rpg_0015_free_combat(document->'beforeState') AND document->'beforeState' ? 'combatNotes')
   OR (rpg_0015_free_combat(document->'afterState') AND document->'afterState' ? 'combatNotes')
 ) THEN
  RAISE EXCEPTION 'state.combatNotes already exists beside free-form state.combat; merge them manually before upgrading';
 END IF;
END $$;

UPDATE campaigns SET document = jsonb_set(document, '{state}', rpg_0015_state(document->'state'))
WHERE document->'state' ? 'combat';

-- Undo compares the campaign with afterState, so snapshots change identically.
UPDATE snapshots SET document = jsonb_set(document, '{beforeState}', rpg_0015_state(document->'beforeState'))
WHERE document->'beforeState' ? 'combat';
UPDATE snapshots SET document = jsonb_set(document, '{afterState}', rpg_0015_state(document->'afterState'))
WHERE document->'afterState' ? 'combat';

DROP FUNCTION rpg_0015_state(jsonb);
DROP FUNCTION rpg_0015_free_combat(jsonb);

UPDATE turns SET document = jsonb_set(document, '{context}',
  (document->'context') - 'promptContractVersion' - 'digestVersion')
WHERE jsonb_typeof(document->'context') = 'object'
 AND document->'context' ?| ARRAY['promptContractVersion', 'digestVersion'];

-- Sessions stay immutable audit records without the retired contract columns.
CREATE OR REPLACE FUNCTION immutable_dice_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
  IF NOT EXISTS (SELECT 1 FROM campaigns WHERE id = OLD.campaign_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Dice sessions are retained until campaign deletion';
 END IF;
 IF ROW(OLD.id,OLD.campaign_id,OLD.root_turn_id,OLD.context_digest,OLD.frozen_prompt,OLD.frozen_revision,OLD.character_ids,OLD.imported,OLD.created_at,OLD.system_prompt,OLD.frozen_knowledge,OLD.tool_definitions,OLD.frozen_sources)
 IS DISTINCT FROM ROW(NEW.id,NEW.campaign_id,NEW.root_turn_id,NEW.context_digest,NEW.frozen_prompt,NEW.frozen_revision,NEW.character_ids,NEW.imported,NEW.created_at,NEW.system_prompt,NEW.frozen_knowledge,NEW.tool_definitions,NEW.frozen_sources) THEN
  RAISE EXCEPTION 'Dice session context is immutable';
 END IF;
 RETURN NEW;
END $$;

ALTER TABLE dice_sessions DROP COLUMN prompt_contract_version, DROP COLUMN digest_version;
