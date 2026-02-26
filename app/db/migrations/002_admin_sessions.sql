ALTER TABLE admin_config
    ADD COLUMN IF NOT EXISTS session_token TEXT,
    ADD COLUMN IF NOT EXISTS session_created_at TIMESTAMPTZ;
