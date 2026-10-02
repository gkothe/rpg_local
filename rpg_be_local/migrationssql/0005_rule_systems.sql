CREATE TABLE rule_systems (
  id uuid PRIMARY KEY,
  system_key text NOT NULL UNIQUE CHECK (system_key ~ '^[a-z0-9][a-z0-9_-]{0,79}$'),
  system_name text NOT NULL CHECK (length(system_name) BETWEEN 1 AND 200),
  kind text NOT NULL CHECK (kind IN ('library', 'model_knowledge')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  instructions text NOT NULL CHECK (octet_length(instructions) <= 8192),
  sources jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(sources) = 'array'),
  core_rules jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(core_rules) = 'object'),
  lore jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(lore) = 'object'),
  archetypes jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(archetypes) = 'object'),
  abilities jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(abilities) = 'object'),
  traits jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(traits) = 'object'),
  items jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(items) = 'object'),
  creatures jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(creatures) = 'object'),
  procedures jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(procedures) = 'object'),
  glossary jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(glossary) = 'object'),
  gm_guidance jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(gm_guidance) = 'object'),
  others jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(others) = 'object'),
  mapping jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(mapping) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'model_knowledge' OR (
    system_key = 'model-knowledge' AND sources = '[]' AND mapping = '{}' AND
    core_rules = '{}' AND lore = '{}' AND archetypes = '{}' AND abilities = '{}' AND
    traits = '{}' AND items = '{}' AND creatures = '{}' AND procedures = '{}' AND
    glossary = '{}' AND gm_guidance = '{}' AND others = '{}'
  ))
);
INSERT INTO rule_systems(id, system_key, system_name, kind, content_hash, instructions)
VALUES (
  '00000000-0000-4000-8000-000000000001', 'model-knowledge', 'Model knowledge',
  'model_knowledge', '49c2dff707edf9c650dbb6d3e1c5f0b2dbece715015b4c98438eeeecde54baae',
  'Use campaign memory and model knowledge. Clearly label provisional rules. Request real dice through the owned dice tool.'
);
ALTER TABLE campaigns ADD COLUMN rule_system_id uuid REFERENCES rule_systems(id);
ALTER TABLE campaigns ADD CONSTRAINT campaign_rule_mirror CHECK (
  rule_system_id IS NOT DISTINCT FROM (document->>'ruleSystemId')::uuid
);

CREATE FUNCTION protect_rule_default() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.kind = 'model_knowledge' THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Default rule system cannot be deleted'; END IF;
    IF ROW(NEW.id, NEW.kind, NEW.system_key) IS DISTINCT FROM ROW(OLD.id, OLD.kind, OLD.system_key) THEN
      RAISE EXCEPTION 'Default rule system identity is protected';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.revision < OLD.revision THEN RAISE EXCEPTION 'Rule revision cannot decrease'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER rule_default_protected BEFORE UPDATE OR DELETE ON rule_systems
FOR EACH ROW EXECUTE FUNCTION protect_rule_default();

CREATE TABLE rule_confirmations (
  system_id uuid NOT NULL REFERENCES rule_systems(id),
  request_id uuid NOT NULL,
  input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  identity jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(system_id, request_id)
);
CREATE TABLE campaign_rule_bindings (
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  identity jsonb NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(campaign_id, request_id)
);
CREATE TABLE turn_rule_budgets (
  turn_id uuid PRIMARY KEY,
  campaign_id uuid NOT NULL,
  requests integer NOT NULL DEFAULT 0 CHECK (requests BETWEEN 0 AND 12),
  transcript_bytes integer NOT NULL DEFAULT 0 CHECK (transcript_bytes BETWEEN 0 AND 8192),
  FOREIGN KEY(turn_id, campaign_id) REFERENCES turns(id, campaign_id) ON DELETE CASCADE
);
CREATE FUNCTION immutable_rule_confirmation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Rule confirmation metadata is immutable';
END $$;
CREATE TRIGGER rule_confirmations_immutable BEFORE UPDATE OR DELETE ON rule_confirmations
FOR EACH ROW EXECUTE FUNCTION immutable_rule_confirmation();
CREATE TABLE turn_rule_reads (
  id uuid PRIMARY KEY,
  campaign_id uuid NOT NULL,
  turn_id uuid NOT NULL,
  system_id uuid NOT NULL REFERENCES rule_systems(id),
  captured_context jsonb NOT NULL,
  tool_name text NOT NULL CHECK (tool_name IN ('rules_map', 'rules_search', 'rules_get', 'rules_list')),
  transport_request_id text NOT NULL CHECK (length(transport_request_id) BETWEEN 1 AND 192),
  argument_digest text NOT NULL CHECK (argument_digest ~ '^[a-f0-9]{64}$'),
  result_hash text NOT NULL CHECK (result_hash ~ '^[a-f0-9]{64}$'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  transcript_bytes integer NOT NULL CHECK (transcript_bytes BETWEEN 0 AND 8192),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(turn_id, transport_request_id),
  FOREIGN KEY(turn_id, campaign_id) REFERENCES turns(id, campaign_id) ON DELETE CASCADE
);
CREATE FUNCTION immutable_rule_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM campaigns WHERE id = OLD.campaign_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Rule receipts are retained until campaign deletion';
END $$;
CREATE TRIGGER rule_reads_immutable BEFORE UPDATE OR DELETE ON turn_rule_reads
FOR EACH ROW EXECUTE FUNCTION immutable_rule_receipt();
