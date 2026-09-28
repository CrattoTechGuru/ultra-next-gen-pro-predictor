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
  `);
  return {enabled:true};
}
export async function getUserByEmail(email){ if(!pool) return null; const r=await pool.query('SELECT * FROM cctrl_users WHERE email=$1 LIMIT 1',[email]); return r.rows[0]||null; }
export async function getUserById(id){ if(!pool) return null; const r=await pool.query('SELECT * FROM cctrl_users WHERE id=$1 LIMIT 1',[id]); return r.rows[0]||null; }
export async function createUser(u){ if(!pool) return null; const r=await pool.query('INSERT INTO cctrl_users(id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5) RETURNING *',[u.id,u.name,u.email,u.passwordHash,u.role||'user']); return r.rows[0]; }
export async function createSession(s){ if(!pool) return null; const r=await pool.query('INSERT INTO cctrl_sessions(token,user_id,expires_at) VALUES($1,$2,$3) RETURNING *',[s.token,s.userId,s.expiresAt]); return r.rows[0]; }
export async function getSession(token){ if(!pool) return null; const r=await pool.query('SELECT * FROM cctrl_sessions WHERE token=$1 AND expires_at>NOW() LIMIT 1',[token]); return r.rows[0]||null; }
export async function deleteSession(token){ if(pool) await pool.query('DELETE FROM cctrl_sessions WHERE token=$1',[token]); }
export async function listUserSlips(userId){ if(!pool) return []; const r=await pool.query('SELECT id,code,selections,stake,budget,status,created_at AS "createdAt" FROM cctrl_slips WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[userId]); return r.rows; }
export async function createSlip(s){ if(!pool) return null; const r=await pool.query('INSERT INTO cctrl_slips(id,user_id,code,selections,stake,budget,status) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7) RETURNING id,code,selections,stake,budget,status,created_at AS "createdAt"',[s.id,s.userId,s.code,JSON.stringify(s.selections),s.stake,s.budget,s.status]); return r.rows[0]; }
export async function getSlipByCode(code){ if(!pool) return null; const r=await pool.query('SELECT id,code,selections,stake,budget,status,created_at AS "createdAt" FROM cctrl_slips WHERE code=$1 LIMIT 1',[code]); return r.rows[0]||null; }
export async function adminStats(){ if(!pool) return null; const [u,s]=await Promise.all([pool.query('SELECT COUNT(*)::int AS count FROM cctrl_users'),pool.query('SELECT COUNT(*)::int AS count FROM cctrl_slips')]); return {users:u.rows[0].count,slips:s.rows[0].count}; }
