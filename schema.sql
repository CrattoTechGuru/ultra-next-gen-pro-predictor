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

CREATE TABLE IF NOT EXISTS cctrl_jobs (id TEXT PRIMARY KEY, type TEXT NOT NULL, status TEXT NOT NULL, details JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), finished_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS cctrl_model_registry (version TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE', metrics JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS cctrl_notifications (id TEXT PRIMARY KEY, user_id TEXT REFERENCES cctrl_users(id) ON DELETE CASCADE, type TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, read_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS cctrl_audit (id TEXT PRIMARY KEY, user_id TEXT, action TEXT NOT NULL, metadata JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS cctrl_usage (day DATE NOT NULL, key TEXT NOT NULL, requests INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(day,key));

CREATE TABLE IF NOT EXISTS cctrl_model_runs (
  id TEXT PRIMARY KEY,
  model_version TEXT NOT NULL,
  evaluated INTEGER NOT NULL DEFAULT 0,
  accuracy NUMERIC,
  brier NUMERIC,
  log_loss NUMERIC,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS cctrl_model_runs_idx ON cctrl_model_runs(model_version, created_at DESC);
