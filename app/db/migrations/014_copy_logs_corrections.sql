-- 014_copy_logs_corrections.sql
-- Generic correction workflow for ML/Shopee copy logs.

ALTER TABLE copy_logs
    ADD COLUMN IF NOT EXISTS source_item_sku TEXT,
    ADD COLUMN IF NOT EXISTS correction_details JSONB;

ALTER TABLE shopee_copy_logs
    ADD COLUMN IF NOT EXISTS source_item_sku TEXT,
    ADD COLUMN IF NOT EXISTS correction_details JSONB;

UPDATE copy_logs
SET status = 'needs_correction'
WHERE status = 'needs_dimensions';

UPDATE shopee_copy_logs
SET status = 'needs_correction'
WHERE status = 'needs_dimensions';
