-- Historical receipts must survive reference-only imports before a private
-- library is restored. Campaign and turn ownership remain relational; the
-- captured system identity is audit metadata rather than a current-row FK.
ALTER TABLE turn_rule_reads DROP CONSTRAINT turn_rule_reads_system_id_fkey;
