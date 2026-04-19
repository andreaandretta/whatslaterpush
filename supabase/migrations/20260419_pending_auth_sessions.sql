CREATE TABLE IF NOT EXISTS pending_auth_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  instance_name TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL,
  CONSTRAINT pending_auth_sessions_status_check CHECK (status IN ('pending', 'authenticated'))
);

CREATE INDEX IF NOT EXISTS idx_pending_auth_sessions_phone_status
  ON pending_auth_sessions (phone, status);

CREATE INDEX IF NOT EXISTS idx_pending_auth_sessions_expires
  ON pending_auth_sessions (expires_at);

ALTER TABLE pending_auth_sessions ENABLE ROW LEVEL SECURITY;
