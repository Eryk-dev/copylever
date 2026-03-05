-- Backfill existing data into Lever Money org and finalize multi-tenant constraints

-- 1. Create the Lever Money org with deterministic UUID
INSERT INTO orgs (id, name, email, active, payment_active)
VALUES ('00000000-0000-0000-0000-000000000001'::uuid, 'Lever Money', 'eryk@levermoney.com.br', true, true)
ON CONFLICT (id) DO NOTHING;

-- 2. Backfill org_id on all tables
UPDATE users SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE copy_sellers SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE user_permissions SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE copy_logs SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE compat_logs SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE api_debug_logs SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE auth_logs SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;

-- 3. Set eryk as super admin
UPDATE users SET is_super_admin = true WHERE username = 'eryk';

-- 4. Set NOT NULL on org_id for core tables (log tables stay nullable)
ALTER TABLE users ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE copy_sellers ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE user_permissions ALTER COLUMN org_id SET NOT NULL;

-- 5. Drop old unique constraints and create org-scoped ones
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_username_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_org_username ON users(org_id, username);

ALTER TABLE copy_sellers DROP CONSTRAINT IF EXISTS copy_sellers_slug_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_copy_sellers_org_slug ON copy_sellers(org_id, slug);

-- 6. Create unique index on users email (partial — only where email is set)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;
