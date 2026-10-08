CREATE TABLE advancement_reviews (
  id uuid PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('running','ready','applied','discarded','cancelled','failed','interrupted','reversed')),
  owner uuid,
  lease_until timestamptz,
  capture jsonb NOT NULL,
  proposal jsonb,
  original_proposal jsonb,
  checkpoint jsonb,
  proposal_digest text,
  adjustment_reason text,
  awards jsonb NOT NULL DEFAULT '[]',
  safe_error text,
  imported boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  UNIQUE(campaign_id,request_id),
  UNIQUE(campaign_id,id),
  CHECK ((status='running') = (owner IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE UNIQUE INDEX advancement_one_active ON advancement_reviews(campaign_id)
  WHERE status IN ('running','ready') AND NOT imported;
CREATE TABLE advancement_coverage (
  campaign_id uuid NOT NULL,
  turn_id uuid NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  review_id uuid NOT NULL,
  PRIMARY KEY(campaign_id,turn_id),
  FOREIGN KEY(campaign_id,review_id) REFERENCES advancement_reviews(campaign_id,id) ON DELETE CASCADE
);
CREATE TABLE advancement_decisions (
  campaign_id uuid NOT NULL,
  review_id uuid NOT NULL,
  request_id uuid NOT NULL,
  digest text NOT NULL,
  result jsonb NOT NULL,
  PRIMARY KEY(campaign_id,request_id),
  FOREIGN KEY(campaign_id,review_id) REFERENCES advancement_reviews(campaign_id,id) ON DELETE CASCADE
);
CREATE TABLE advancement_reads (
  id uuid PRIMARY KEY,
  campaign_id uuid NOT NULL,
  review_id uuid NOT NULL,
  request_id text NOT NULL,
  argument_digest text NOT NULL,
  tool text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(review_id,request_id),
  FOREIGN KEY(campaign_id,review_id) REFERENCES advancement_reviews(campaign_id,id) ON DELETE CASCADE
);
