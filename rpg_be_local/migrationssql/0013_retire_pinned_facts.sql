-- Description is the single campaign background field; retire the unused pinned facts.
UPDATE campaigns SET document = document - 'pinnedFacts'
WHERE document ? 'pinnedFacts';

UPDATE templates SET document = jsonb_set(document, '{setup}',
  (document->'setup') - 'pinnedFacts')
WHERE document->'setup' ? 'pinnedFacts';
