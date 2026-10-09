CREATE TABLE atlas_assets (
 id uuid PRIMARY KEY,
 campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
 mime text NOT NULL CHECK(mime IN ('image/png','image/jpeg')),
 bytes bytea,
 content_hash text NOT NULL,
 player_safe boolean NOT NULL DEFAULT false,
 observations jsonb NOT NULL DEFAULT '[]',
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,campaign_id)
);
CREATE TABLE atlas_imports (
 id uuid PRIMARY KEY,
 campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
 request_id uuid NOT NULL,
 digest text NOT NULL,
 asset_id uuid NOT NULL,
 frozen_input jsonb NOT NULL,
 settings jsonb NOT NULL,
 status text NOT NULL CHECK(status IN ('running','ready','applied','failed','cancelled','interrupted')),
 imported boolean NOT NULL DEFAULT false,
 owner_id uuid,
 draft jsonb,
 error text,
 decision jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(campaign_id,request_id),
 FOREIGN KEY(asset_id,campaign_id) REFERENCES atlas_assets(id,campaign_id) ON DELETE CASCADE,
 CHECK((status='running')=(owner_id IS NOT NULL))
);
