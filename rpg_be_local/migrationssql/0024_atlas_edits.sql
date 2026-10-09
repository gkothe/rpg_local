CREATE TABLE atlas_edits (
 campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
 request_id uuid NOT NULL,
 digest text NOT NULL,
 changes jsonb NOT NULL,
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(campaign_id,request_id)
);
