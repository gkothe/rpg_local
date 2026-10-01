CREATE TABLE source_artifacts (
 campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
 source_id uuid NOT NULL,
 bytes bytea NOT NULL,
 content_type text NOT NULL,
 PRIMARY KEY(campaign_id,source_id)
);
