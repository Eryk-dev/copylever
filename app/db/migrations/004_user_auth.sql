-- User authentication & RBAC tables

CREATE TABLE IF NOT EXISTS users (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    username        TEXT            UNIQUE NOT NULL,
    password_hash   TEXT            NOT NULL,
    role            TEXT            NOT NULL DEFAULT 'operator'
                                   CHECK (role IN ('admin', 'operator')),
    can_run_compat  BOOLEAN         NOT NULL DEFAULT false,
    active          BOOLEAN         NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ     DEFAULT now(),
    last_login_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS user_sessions (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token           TEXT            UNIQUE NOT NULL,
    created_at      TIMESTAMPTZ     DEFAULT now(),
    expires_at      TIMESTAMPTZ     NOT NULL
);

CREATE TABLE IF NOT EXISTS user_permissions (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seller_slug     TEXT            NOT NULL,
    can_copy_from   BOOLEAN         NOT NULL DEFAULT false,
    can_copy_to     BOOLEAN         NOT NULL DEFAULT false,
    UNIQUE (user_id, seller_slug)
);

CREATE TABLE IF NOT EXISTS auth_logs (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID            REFERENCES users(id) ON DELETE SET NULL,
    username        TEXT,
    action          TEXT            NOT NULL,
    created_at      TIMESTAMPTZ     DEFAULT now()
);

-- Add user_id to existing log tables
ALTER TABLE copy_logs  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE compat_logs ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;
