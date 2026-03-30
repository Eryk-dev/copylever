-- Photo operation logs (bulk photo manager)
CREATE TABLE IF NOT EXISTS photo_logs (
    id              BIGSERIAL       PRIMARY KEY,
    user_id         UUID            REFERENCES users(id) ON DELETE SET NULL,
    org_id          UUID            REFERENCES orgs(id) ON DELETE SET NULL,
    source_item_id  TEXT,
    sku             TEXT,
    targets         JSONB           NOT NULL DEFAULT '[]',
    total_targets   INT             NOT NULL DEFAULT 0,
    success_count   INT             NOT NULL DEFAULT 0,
    error_count     INT             NOT NULL DEFAULT 0,
    status          TEXT            NOT NULL DEFAULT 'pending',
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_photo_logs_org ON photo_logs(org_id);
CREATE INDEX IF NOT EXISTS idx_photo_logs_org_created ON photo_logs(org_id, created_at);
