-- Password reset tokens table

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id              SERIAL          PRIMARY KEY,
    user_id         UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token           TEXT            UNIQUE NOT NULL,
    expires_at      TIMESTAMPTZ     NOT NULL,
    created_at      TIMESTAMPTZ     DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON password_reset_tokens(token);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id);
