-- Migration 012: Add source item metadata to copy logs for better UX
-- Shows item name + thumbnail in dimension retry UI

ALTER TABLE copy_logs
  ADD COLUMN IF NOT EXISTS source_item_title TEXT,
  ADD COLUMN IF NOT EXISTS source_item_thumbnail TEXT;

ALTER TABLE shopee_copy_logs
  ADD COLUMN IF NOT EXISTS source_item_title TEXT,
  ADD COLUMN IF NOT EXISTS source_item_thumbnail TEXT;
