-- These counters audit usage; they must not cap a CLI's rule lookups.
ALTER TABLE turn_rule_budgets
  DROP CONSTRAINT turn_rule_budgets_requests_check,
  DROP CONSTRAINT turn_rule_budgets_transcript_bytes_check,
  ADD CONSTRAINT turn_rule_budgets_requests_nonnegative CHECK (requests >= 0),
  ADD CONSTRAINT turn_rule_budgets_transcript_bytes_nonnegative CHECK (transcript_bytes >= 0);

ALTER TABLE turn_rule_reads
  DROP CONSTRAINT turn_rule_reads_transcript_bytes_check,
  ADD CONSTRAINT turn_rule_reads_transcript_bytes_nonnegative CHECK (transcript_bytes >= 0);
