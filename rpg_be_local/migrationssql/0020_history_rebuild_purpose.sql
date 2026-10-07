-- A rebuild job can stage a compact history index instead of a replacement memory.
-- Existing rows keep the original full-memory purpose.
ALTER TABLE memory_rebuild_jobs
 ADD COLUMN purpose text NOT NULL DEFAULT 'memory' CHECK (purpose IN ('memory','compact_history'));
