CREATE TABLE narrative_edit_candidates (
  turn_id uuid PRIMARY KEY REFERENCES turns(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  candidate_digest text NOT NULL,
  campaign_revision integer NOT NULL,
  rule_context jsonb NOT NULL,
  settings jsonb NOT NULL,
  raw_response jsonb NOT NULL,
  raw_narrative text NOT NULL,
  edited_narrative text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','abandoned')),
  owner uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (turn_id, campaign_id) REFERENCES turns(id, campaign_id) ON DELETE CASCADE
);
CREATE TABLE narrative_edit_requests (
  turn_id uuid NOT NULL REFERENCES narrative_edit_candidates(turn_id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  candidate_digest text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (turn_id, request_id)
);

CREATE FUNCTION immutable_narrative_candidate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.turn_id,OLD.campaign_id,OLD.candidate_digest,OLD.campaign_revision,OLD.rule_context,OLD.settings,OLD.raw_response,OLD.raw_narrative)
     IS DISTINCT FROM
     (NEW.turn_id,NEW.campaign_id,NEW.candidate_digest,NEW.campaign_revision,NEW.rule_context,NEW.settings,NEW.raw_response,NEW.raw_narrative)
     OR (OLD.status='abandoned' AND NEW.status<>'abandoned')
     OR (OLD.edited_narrative IS NOT NULL AND OLD.edited_narrative IS DISTINCT FROM NEW.edited_narrative) THEN
    RAISE EXCEPTION 'Narrative candidate identity and saved edited text are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_narrative_candidate BEFORE UPDATE ON narrative_edit_candidates
FOR EACH ROW EXECUTE FUNCTION immutable_narrative_candidate();
