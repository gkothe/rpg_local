CREATE FUNCTION rule_tree_has_text(node jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE child jsonb;
BEGIN
  IF COALESCE(node->>'structural', 'false') <> 'true' AND COALESCE(node->>'text', '') <> '' THEN RETURN true; END IF;
  FOR child IN SELECT value FROM jsonb_each(COALESCE(node->'children', '{}'::jsonb)) LOOP
    IF rule_tree_has_text(child) THEN RETURN true; END IF;
  END LOOP;
  RETURN false;
END $$;
CREATE FUNCTION rule_column_has_text(book_column jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT EXISTS (SELECT 1 FROM jsonb_each(book_column) WHERE rule_tree_has_text(value))
$$;
ALTER TABLE rule_systems ADD COLUMN has_original_text boolean GENERATED ALWAYS AS (
  rule_column_has_text(core_rules) OR rule_column_has_text(lore) OR
  rule_column_has_text(archetypes) OR rule_column_has_text(abilities) OR
  rule_column_has_text(traits) OR rule_column_has_text(items) OR
  rule_column_has_text(creatures) OR rule_column_has_text(procedures) OR
  rule_column_has_text(glossary) OR rule_column_has_text(gm_guidance) OR
  rule_column_has_text(others)
) STORED;
