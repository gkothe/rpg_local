ALTER TABLE narrative_edit_requests
  ADD COLUMN resume_intent text NOT NULL DEFAULT 'continue'
  CHECK (resume_intent IN ('continue', 'separate_index_recovery'));
