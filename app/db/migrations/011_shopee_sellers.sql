-- Shopee sellers (OAuth connections) and copy logs
CREATE TABLE IF NOT EXISTS shopee_sellers (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    shop_id bigint NOT NULL,
    name text NOT NULL DEFAULT '',
    slug text NOT NULL,
    access_token text,
    refresh_token text,
    token_expires_at timestamptz,
    refresh_token_expires_at timestamptz,
    org_id uuid NOT NULL REFERENCES orgs(id),
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(shop_id, org_id)
);

CREATE INDEX IF NOT EXISTS idx_shopee_sellers_org ON shopee_sellers(org_id);
CREATE INDEX IF NOT EXISTS idx_shopee_sellers_slug_org ON shopee_sellers(slug, org_id);

CREATE TABLE IF NOT EXISTS shopee_copy_logs (
    id bigserial PRIMARY KEY,
    user_id uuid REFERENCES users(id),
    org_id uuid NOT NULL REFERENCES orgs(id),
    source_seller text NOT NULL,
    dest_sellers text[] NOT NULL DEFAULT '{}',
    source_item_id bigint NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    dest_item_ids jsonb DEFAULT '{}',
    error_details jsonb DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shopee_copy_logs_org ON shopee_copy_logs(org_id);
