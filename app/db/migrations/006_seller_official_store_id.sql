-- Cache official_store_id for brand/official-store sellers
ALTER TABLE copy_sellers ADD COLUMN IF NOT EXISTS official_store_id integer;
