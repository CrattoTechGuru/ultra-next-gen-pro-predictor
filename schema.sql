CREATE TABLE IF NOT EXISTS cctrl_users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS cctrl_sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES cctrl_users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS cctrl_sessions_user_idx ON cctrl_sessions(user_id);
CREATE TABLE IF NOT EXISTS cctrl_slips (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES cctrl_users(id) ON DELETE CASCADE,
  code TEXT UNIQUE NOT NULL,
  selections JSONB NOT NULL,
  stake NUMERIC NOT NULL DEFAULT 0,
  budget NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS cctrl_slips_user_idx ON cctrl_slips(user_id);
