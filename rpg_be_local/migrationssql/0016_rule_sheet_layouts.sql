-- Display-only character sheet layout hints per rule system. Kept outside rule content so a
-- layout save never changes the content hash, revision or cached gameplay snapshots.
ALTER TABLE rule_systems
 ADD COLUMN sheet_layout jsonb NOT NULL DEFAULT '{"fields":[]}'::jsonb
  CONSTRAINT rule_systems_sheet_layout_shape CHECK (
   jsonb_typeof(sheet_layout) = 'object' AND octet_length(sheet_layout::text) <= 65536
  ),
 ADD COLUMN sheet_layout_updated_at timestamptz NULL;
