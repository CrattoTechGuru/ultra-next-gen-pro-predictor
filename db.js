import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;
const url = process.env.DATABASE_URL;
export const dbEnabled = Boolean(url);
export const pool = dbEnabled ? new Pool({ connectionString: url, ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }, max: 5 }) : null;
export async function initDb(){
  if(!pool) return {enabled:false};
  await pool.query(`CREATE TABLE IF NOT EXISTS cctrl_users (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS cctrl_sessions (
    token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES cctrl_users(id) ON DELETE CASCADE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ NOT NULL
  );
  CREATE INDEX IF NOT EXISTS cctrl_sessions_user_idx ON cctrl_sessions(user_id);
  CREATE TABLE IF NOT EXISTS cctrl_slips (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES cctrl_users(id) ON DELETE CASCADE, code TEXT UNIQUE NOT NULL, selections JSONB NOT NULL, stake NUMERIC NOT NULL DEFAULT 0, budget NUMERIC NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'DRAFT', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS cctrl_slips_user_idx ON cctrl_slips(user_id);
  ALTER TABLE cctrl_slips ADD COLUMN IF NOT EXISTS bookmaker TEXT NOT NULL DEFAULT 'CRATTO';
  ALTER TABLE cctrl_slips ADD COLUMN IF NOT EXISTS shareable BOOLEAN NOT NULL DEFAULT TRUE;
  CREATE TABLE IF NOT EXISTS cctrl_jobs (id TEXT PRIMARY KEY, type TEXT NOT NULL, status TEXT NOT NULL, details JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), finished_at TIMESTAMPTZ);
  CREATE TABLE IF NOT EXISTS cctrl_model_registry (version TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE', metrics JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE IF NOT EXISTS cctrl_notifications (id TEXT PRIMARY KEY, user_id TEXT REFERENCES cctrl_users(id) ON DELETE CASCADE, type TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, read_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE INDEX IF NOT EXISTS cctrl_notifications_user_idx ON cctrl_notifications(user_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS cctrl_audit (id TEXT PRIMARY KEY, user_id TEXT, action TEXT NOT NULL, metadata JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE INDEX IF NOT EXISTS cctrl_audit_created_idx ON cctrl_audit(created_at DESC);
  CREATE TABLE IF NOT EXISTS cctrl_usage (day DATE NOT NULL, key TEXT NOT NULL, requests INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(day,key));
  CREATE TABLE IF NOT EXISTS cctrl_odds (id TEXT PRIMARY KEY, match_id TEXT NOT NULL, bookmaker TEXT NOT NULL, market TEXT NOT NULL, odds NUMERIC NOT NULL, captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE INDEX IF NOT EXISTS cctrl_odds_match_idx ON cctrl_odds(match_id, bookmaker, market);
  CREATE TABLE IF NOT EXISTS cctrl_alerts (id TEXT PRIMARY KEY, user_id TEXT REFERENCES cctrl_users(id) ON DELETE CASCADE, type TEXT NOT NULL, payload JSONB NOT NULL DEFAULT '{}'::jsonb, delivered_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE IF NOT EXISTS cctrl_prediction_evaluations (id TEXT PRIMARY KEY, match_id TEXT NOT NULL, model_version TEXT NOT NULL, predicted_market TEXT NOT NULL, probability NUMERIC NOT NULL, actual TEXT NOT NULL, correct BOOLEAN NOT NULL, brier NUMERIC, log_loss NUMERIC, evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE INDEX IF NOT EXISTS cctrl_eval_model_idx ON cctrl_prediction_evaluations(model_version, evaluated_at DESC);
  `);
  return {enabled:true};
}
export async function getUserByEmail(email){ if(!pool) return null; const r=await pool.query('SELECT * FROM cctrl_users WHERE email=$1 LIMIT 1',[email]); return r.rows[0]||null; }
export async function getUserById(id){ if(!pool) return null; const r=await pool.query('SELECT * FROM cctrl_users WHERE id=$1 LIMIT 1',[id]); return r.rows[0]||null; }
export async function createUser(u){ if(!pool) return null; const r=await pool.query('INSERT INTO cctrl_users(id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5) RETURNING *',[u.id,u.name,u.email,u.passwordHash,u.role||'user']); return r.rows[0]; }
export async function createSession(s){ if(!pool) return null; const r=await pool.query('INSERT INTO cctrl_sessions(token,user_id,expires_at) VALUES($1,$2,$3) RETURNING *',[s.token,s.userId,s.expiresAt]); return r.rows[0]; }
export async function getSession(token){ if(!pool) return null; const r=await pool.query('SELECT * FROM cctrl_sessions WHERE token=$1 AND expires_at>NOW() LIMIT 1',[token]); return r.rows[0]||null; }
export async function deleteSession(token){ if(pool) await pool.query('DELETE FROM cctrl_sessions WHERE token=$1',[token]); }
export async function listUserSlips(userId){ if(!pool) return []; const r=await pool.query('SELECT id,code,selections,stake,budget,status,bookmaker,shareable,created_at AS "createdAt" FROM cctrl_slips WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[userId]); return r.rows; }
export async function createSlip(s){ if(!pool) return null; const r=await pool.query('INSERT INTO cctrl_slips(id,user_id,code,selections,stake,budget,status,bookmaker,shareable) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9) RETURNING id,code,selections,stake,budget,status,bookmaker,shareable,created_at AS "createdAt"',[s.id,s.userId,s.code,JSON.stringify(s.selections),s.stake,s.budget,s.status,s.bookmaker||'CRATTO',s.shareable!==false]); return r.rows[0]; }
export async function getSlipByCode(code){ if(!pool) return null; const r=await pool.query('SELECT id,code,selections,stake,budget,status,bookmaker,shareable,created_at AS "createdAt" FROM cctrl_slips WHERE code=$1 AND shareable=true LIMIT 1',[code]); return r.rows[0]||null; }
export async function adminStats(){ if(!pool) return null; const [u,s]=await Promise.all([pool.query('SELECT COUNT(*)::int AS count FROM cctrl_users'),pool.query('SELECT COUNT(*)::int AS count FROM cctrl_slips')]); return {users:u.rows[0].count,slips:s.rows[0].count}; }

export async function createJob(j){ if(!pool) return j; const r=await pool.query('INSERT INTO cctrl_jobs(id,type,status,details) VALUES($1,$2,$3,$4::jsonb) RETURNING *',[j.id,j.type,j.status||'RUNNING',JSON.stringify(j.details||{})]); return r.rows[0]; }
export async function finishJob(id,status,details={}){ if(pool) await pool.query('UPDATE cctrl_jobs SET status=$2,details=$3::jsonb,finished_at=NOW() WHERE id=$1',[id,status,JSON.stringify(details)]); }
export async function recentJobs(limit=30){ if(!pool) return []; const r=await pool.query('SELECT id,type,status,details,created_at AS "createdAt",finished_at AS "finishedAt" FROM cctrl_jobs ORDER BY created_at DESC LIMIT $1',[limit]); return r.rows; }
export async function upsertModel(m){ if(!pool) return m; const r=await pool.query(`INSERT INTO cctrl_model_registry(version,name,status,metrics) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(version) DO UPDATE SET name=EXCLUDED.name,status=EXCLUDED.status,metrics=EXCLUDED.metrics RETURNING *`,[m.version,m.name,m.status||'ACTIVE',JSON.stringify(m.metrics||{})]); return r.rows[0]; }
export async function listModels(){ if(!pool) return []; const r=await pool.query('SELECT version,name,status,metrics,created_at AS "createdAt" FROM cctrl_model_registry ORDER BY created_at DESC'); return r.rows; }
export async function addNotification(n){ if(!pool) return n; const r=await pool.query('INSERT INTO cctrl_notifications(id,user_id,type,title,body) VALUES($1,$2,$3,$4,$5) RETURNING id,type,title,body,read_at AS "readAt",created_at AS "createdAt"',[n.id,n.userId,n.type,n.title,n.body]); return r.rows[0]; }
export async function listNotifications(userId){ if(!pool) return []; const r=await pool.query('SELECT id,type,title,body,read_at AS "readAt",created_at AS "createdAt" FROM cctrl_notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[userId]); return r.rows; }
export async function markNotificationRead(id,userId){ if(pool) await pool.query('UPDATE cctrl_notifications SET read_at=NOW() WHERE id=$1 AND user_id=$2',[id,userId]); }
export async function audit(action,userId,metadata={}){ if(pool) await pool.query('INSERT INTO cctrl_audit(id,user_id,action,metadata) VALUES($1,$2,$3,$4::jsonb)',[cryptoRandom(),userId,action,JSON.stringify(metadata)]); }
function cryptoRandom(){ return Math.random().toString(36).slice(2)+Date.now().toString(36); }
export async function usage(key){ if(!pool) return {day:new Date().toISOString().slice(0,10),key,requests:0}; const day=new Date().toISOString().slice(0,10); const r=await pool.query(`INSERT INTO cctrl_usage(day,key,requests) VALUES($1,$2,1) ON CONFLICT(day,key) DO UPDATE SET requests=cctrl_usage.requests+1 RETURNING day,key,requests`,[day,key]); return r.rows[0]; }
export async function saveOdds(row){ if(!pool) return row; const r=await pool.query('INSERT INTO cctrl_odds(id,match_id,bookmaker,market,odds) VALUES($1,$2,$3,$4,$5) RETURNING *',[row.id,row.matchId,row.bookmaker,row.market,row.odds]); return r.rows[0]; }
export async function listOdds(matchId){ if(!pool) return []; const r=await pool.query('SELECT id,match_id AS "matchId",bookmaker,market,odds,captured_at AS "capturedAt" FROM cctrl_odds WHERE match_id=$1 ORDER BY captured_at DESC',[matchId]); return r.rows; }
export async function saveEvaluation(e){ if(!pool) return e; const r=await pool.query('INSERT INTO cctrl_prediction_evaluations(id,match_id,model_version,predicted_market,probability,actual,correct,brier,log_loss) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[e.id,e.matchId,e.modelVersion,e.predictedMarket,e.probability,e.actual,e.correct,e.brier,e.logLoss]); return r.rows[0]; }
export async function evaluationSummary(modelVersion){ if(!pool) return null; const r=await pool.query('SELECT COUNT(*)::int AS n, AVG(correct::int)::float AS accuracy, AVG(brier)::float AS brier, AVG(log_loss)::float AS log_loss FROM cctrl_prediction_evaluations WHERE model_version=$1',[modelVersion]); return r.rows[0]; }
export async function createAlert(a){ if(!pool) return a; const r=await pool.query('INSERT INTO cctrl_alerts(id,user_id,type,payload) VALUES($1,$2,$3,$4::jsonb) RETURNING *',[a.id,a.userId,a.type,JSON.stringify(a.payload||{})]); return r.rows[0]; }
export async function listAlerts(userId){ if(!pool) return []; const r=await pool.query('SELECT id,type,payload,delivered_at AS "deliveredAt",created_at AS "createdAt" FROM cctrl_alerts WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[userId]); return r.rows; }
