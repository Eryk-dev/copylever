-- Multi-tenant: orgs table and org_id columns on all tables

-- 1. Create orgs table
CREATE TABLE IF NOT EXISTS orgs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    stripe_customer_id TEXT UNIQUE,
    stripe_subscription_id TEXT UNIQUE,
    payment_active BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orgs_email ON orgs(email);
CREATE INDEX IF NOT EXISTS idx_orgs_stripe_customer ON orgs(stripe_customer_id);

-- 2. Add org_id (nullable) with FK CASCADE to: users, copy_sellers, user_permissions
ALTER TABLE users ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES orgs(id) ON DELETE CASCADE;
ALTER TABLE copy_sellers ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES orgs(id) ON DELETE CASCADE;
ALTER TABLE user_permissions ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES orgs(id) ON DELETE CASCADE;

-- 3. Add org_id (nullable) with FK SET NULL to: copy_logs, compat_logs, api_debug_logs, auth_logs
ALTER TABLE copy_logs ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES orgs(id) ON DELETE SET NULL;
ALTER TABLE compat_logs ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES orgs(id) ON DELETE SET NULL;
ALTER TABLE api_debug_logs ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES orgs(id) ON DELETE SET NULL;
ALTER TABLE auth_logs ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES orgs(id) ON DELETE SET NULL;

-- 4. Add is_super_admin and email columns to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;

-- 5. Create indexes for org_id on all tables
CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);
CREATE INDEX IF NOT EXISTS idx_copy_sellers_org ON copy_sellers(org_id);
CREATE INDEX IF NOT EXISTS idx_user_permissions_org ON user_permissions(org_id);
CREATE INDEX IF NOT EXISTS idx_copy_logs_org ON copy_logs(org_id);
CREATE INDEX IF NOT EXISTS idx_compat_logs_org ON compat_logs(org_id);
CREATE INDEX IF NOT EXISTS idx_api_debug_logs_org ON api_debug_logs(org_id);
CREATE INDEX IF NOT EXISTS idx_auth_logs_org ON auth_logs(org_id);
