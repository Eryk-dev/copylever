-- Debug logging table for ML API calls
-- Stores full request/response data for every failed API attempt
-- Enables fast diagnosis of copy errors without searching stdout logs

CREATE TABLE IF NOT EXISTS api_debug_logs (
    id              BIGSERIAL       PRIMARY KEY,
    created_at      TIMESTAMPTZ     DEFAULT NOW(),

    -- Operation context
    action          TEXT            NOT NULL,
    source_seller   TEXT,
    dest_seller     TEXT,
    source_item_id  TEXT,
    dest_item_id    TEXT,
    user_id         UUID            REFERENCES users(id) ON DELETE SET NULL,
    copy_log_id     BIGINT,

    -- Request data
    api_method      TEXT,
    api_url         TEXT,
    request_payload JSONB,

    -- Response data
    response_status INT,
    response_body   JSONB,
    error_message   TEXT,

    -- Retry context
    attempt_number  INT             DEFAULT 1,
    adjustments     TEXT[],
    resolved        BOOLEAN         DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_debug_logs_created ON api_debug_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_debug_logs_source_item ON api_debug_logs(source_item_id);
