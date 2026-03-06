-- 013_shopee_schema_fixes.sql
-- Fix Shopee schema to follow ML patterns: FKs, indexes, unique constraints.
-- Both shopee_sellers and shopee_copy_logs are empty (0 rows) at time of writing.
--
-- Rollback instructions:
--   ALTER TABLE shopee_sellers DROP CONSTRAINT IF EXISTS shopee_sellers_org_id_fkey;
--   ALTER TABLE shopee_sellers ADD CONSTRAINT shopee_sellers_org_id_fkey
--       FOREIGN KEY (org_id) REFERENCES orgs(id);
--   ALTER TABLE shopee_copy_logs ALTER COLUMN org_id SET NOT NULL;
--   ALTER TABLE shopee_copy_logs DROP CONSTRAINT IF EXISTS shopee_copy_logs_org_id_fkey;
--   ALTER TABLE shopee_copy_logs ADD CONSTRAINT shopee_copy_logs_org_id_fkey
--       FOREIGN KEY (org_id) REFERENCES orgs(id);
--   ALTER TABLE shopee_copy_logs DROP CONSTRAINT IF EXISTS shopee_copy_logs_user_id_fkey;
--   ALTER TABLE shopee_copy_logs ADD CONSTRAINT shopee_copy_logs_user_id_fkey
--       FOREIGN KEY (user_id) REFERENCES users(id);
--   DROP INDEX IF EXISTS uq_shopee_sellers_slug_org;
--   CREATE INDEX IF NOT EXISTS idx_shopee_sellers_slug_org ON shopee_sellers(slug, org_id);
--   DROP INDEX IF EXISTS idx_shopee_copy_logs_created_at;
--   DROP INDEX IF EXISTS idx_shopee_copy_logs_source_seller;

-- 1. shopee_sellers.org_id → ON DELETE CASCADE (match copy_sellers pattern)
ALTER TABLE shopee_sellers DROP CONSTRAINT IF EXISTS shopee_sellers_org_id_fkey;
ALTER TABLE shopee_sellers
    ADD CONSTRAINT shopee_sellers_org_id_fkey
    FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE;

-- 2. shopee_copy_logs.org_id → nullable + ON DELETE SET NULL (match copy_logs pattern)
ALTER TABLE shopee_copy_logs ALTER COLUMN org_id DROP NOT NULL;

ALTER TABLE shopee_copy_logs DROP CONSTRAINT IF EXISTS shopee_copy_logs_org_id_fkey;
ALTER TABLE shopee_copy_logs
    ADD CONSTRAINT shopee_copy_logs_org_id_fkey
    FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE SET NULL;

-- 3. shopee_copy_logs.user_id → ON DELETE SET NULL (match copy_logs pattern)
ALTER TABLE shopee_copy_logs DROP CONSTRAINT IF EXISTS shopee_copy_logs_user_id_fkey;
ALTER TABLE shopee_copy_logs
    ADD CONSTRAINT shopee_copy_logs_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

-- 4. Replace non-unique index with UNIQUE index on shopee_sellers(slug, org_id)
DROP INDEX IF EXISTS idx_shopee_sellers_slug_org;
CREATE UNIQUE INDEX IF NOT EXISTS uq_shopee_sellers_slug_org ON shopee_sellers(slug, org_id);

-- 5. Add missing indexes on shopee_copy_logs
CREATE INDEX IF NOT EXISTS idx_shopee_copy_logs_created_at ON shopee_copy_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shopee_copy_logs_source_seller ON shopee_copy_logs(source_seller);
