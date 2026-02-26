CREATE TABLE IF NOT EXISTS compat_logs (
    id          BIGSERIAL       PRIMARY KEY,
    source_item_id  TEXT        NOT NULL,
    skus        TEXT[]          NOT NULL,
    targets     JSONB           NOT NULL,
    total_targets   INT         NOT NULL,
    success_count   INT         NOT NULL,
    error_count     INT         NOT NULL,
    created_at  TIMESTAMPTZ     DEFAULT NOW()
);
