-- Prevent trial abuse: each ML account and Shopee shop can only be connected to ONE org.
-- Even after disconnect (active=false), the record persists and blocks reconnection to other orgs.
-- Reconnecting to the SAME org works because the callback updates the existing record (no insert).

-- Global uniqueness on ml_user_id (covers both active and inactive records)
CREATE UNIQUE INDEX IF NOT EXISTS idx_copy_sellers_global_ml_user_id
    ON copy_sellers(ml_user_id);

-- Global uniqueness on shop_id (covers both active and inactive records)
CREATE UNIQUE INDEX IF NOT EXISTS idx_shopee_sellers_global_shop_id
    ON shopee_sellers(shop_id);
