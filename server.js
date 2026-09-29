import express from 'express';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { dbEnabled, initDb, loadAppState, saveAppState, getUserByEmail, getUserById, createUser, createSession, getSession, deleteSession, listUserSlips, createSlip, getSlipByCode, adminStats, createJob, finishJob, recentJobs, upsertModel, listModels, addNotification, listNotifications, markNotificationRead, audit, usage, saveOdds, listOdds, saveEvaluation, evaluationSummary, createAlert, listAlerts } from './db.js';
import { startScheduler, makeJobId } from './operations.js';
import { impliedProbability, valueMetrics, marketProbability, rankValue } from './intelligence.js';
import { makeRunId } from './automation.js';
import { rateLimit, safeCompare } from './security.js';
import { ensembleModels, walkForward, calibration as advancedCalibration, leaguePerformance } from './advanced_models.js';
import { summarizeStore, coverage } from './data_engine.js';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use('/api/', rateLimit({ windowMs: 60_000, max: 180 }));

const PORT = Number(process.env.PORT) || 10000;
const HOST = '0.0.0.0';
const API = 'https://api.football-data.org/v4';
const storePath = path.join(__dirname, 'data', 'store.json');
let runtimeStore = null;
let stateWriteTimer = null;

function readStore() {
  if (runtimeStore) return runtimeStore;
  try {
    const s = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    s.matches ??= []; s.predictions ??= []; s.evaluations ??= []; s.meta ??= {};
    s.users ??= []; s.sessions ??= []; s.slips ??= [];
    return s;
  } catch { return { matches: [], predictions: [], evaluations: [], meta: {}, users: [], sessions: [], slips: [] }; }
}
function writeStore(store) {
  runtimeStore = store;
  store.users ??= []; store.sessions ??= []; store.slips ??= [];
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2));
  if (dbEnabled) {
    clearTimeout(stateWriteTimer);
    stateWriteTimer = setTimeout(() => saveAppState('runtime_store', store).catch(err => console.error('State persistence failed:', err.message)), 250);
  }
}

function clamp(x, min = 0, max = 1) { return Math.max(min, Math.min(max, x)); }
function factorial(n) { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; }
function poisson(k, lambda) { return Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k); }

async function apiFetch(endpoint) {
  const token = process.env.FOOTBALL_DATA_API_KEY;
  if (!token) throw new Error('FOOTBALL_DATA_API_KEY is not configured on Render.');
  const response = await fetch(API + endpoint, {
    headers: { 'X-Auth-Token': token, 'Accept': 'application/json' }
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`football-data.org returned HTTP ${response.status}: ${body.slice(0, 300)}`);
  }
  return response.json();
}

// football-data.org rejects date ranges longer than 10 days (HTTP 400), so long windows
// are fetched in consecutive chunks. Chunks are paced for the provider's per-minute rate
// limit (free plan: about 10 requests/min); set FOOTBALL_DATA_CHUNK_PAUSE_MS=0 on a plan
// with a higher limit.
const MAX_RANGE_DAYS = 10;
const MAX_RANGE_CHUNKS = 12;
const CHUNK_PAUSE_MS = Number(process.env.FOOTBALL_DATA_CHUNK_PAUSE_MS || 6500);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function apiFetchMatchesRange(dateFrom, dateTo, extra = {}) {
  const DAY = 86400000;
  const start = new Date(String(dateFrom).slice(0, 10) + 'T00:00:00Z');
  const end = new Date(String(dateTo).slice(0, 10) + 'T00:00:00Z');
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    throw new Error('Invalid date range: use YYYY-MM-DD dates, with the start on or before the end.');
  }
  const chunks = Math.ceil(((end - start) / DAY + 1) / MAX_RANGE_DAYS);
  if (chunks > MAX_RANGE_CHUNKS) {
    throw new Error(`Date range too long: ${MAX_RANGE_CHUNKS * MAX_RANGE_DAYS} days maximum.`);
  }
  const matches = [];
  for (let i = 0, cursor = start.getTime(); cursor <= end.getTime(); i++, cursor += MAX_RANGE_DAYS * DAY) {
    const chunkEnd = Math.min(cursor + (MAX_RANGE_DAYS - 1) * DAY, end.getTime());
    const q = new URLSearchParams({
      dateFrom: new Date(cursor).toISOString().slice(0, 10),
      dateTo: new Date(chunkEnd).toISOString().slice(0, 10),
      ...extra
    });
    if (i > 0 && CHUNK_PAUSE_MS > 0) await sleep(CHUNK_PAUSE_MS);
    const data = await apiFetch('/matches?' + q.toString());
    matches.push(...(data.matches || []));
  }
  return { matches };
}

function upsertMatches(store, matches = []) {
  for (const match of matches) {
    const i = store.matches.findIndex(x => x.id === match.id);
    if (i >= 0) store.matches[i] = match;
    else store.matches.push(match);
  }
  store.matches.sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));
  if (store.matches.length > 10000) store.matches = store.matches.slice(-10000);
}

function teamForm(teamId, matches, venue, limit = 10) {
  const relevant = matches
    .filter(m => m.status === 'FINISHED')
    .filter(m => {
      const home = m.homeTeam?.id === teamId;
      const away = m.awayTeam?.id === teamId;
      if (!home && !away) return false;
      if (venue === 'home') return home;
      if (venue === 'away') return away;
      return true;
    })
    .sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate))
    .slice(-limit);

  if (!relevant.length) return { gf: 1.35, ga: 1.35, ppg: 1.2, n: 0, form: '' };
  let gf = 0, ga = 0, pts = 0;
  const form = [];
  for (const m of relevant) {
    const home = m.homeTeam.id === teamId;
    const hg = Number(m.score?.fullTime?.home ?? 0);
    const ag = Number(m.score?.fullTime?.away ?? 0);
    const f = home ? hg : ag;
    const c = home ? ag : hg;
    gf += f; ga += c;
    if (f > c) { pts += 3; form.push('W'); }
    else if (f === c) { pts += 1; form.push('D'); }
    else form.push('L');
  }
  return { gf: gf / relevant.length, ga: ga / relevant.length, ppg: pts / relevant.length, n: relevant.length, form: form.join('') };
}

function leagueGoalRate(matches) {
  const finished = matches.filter(m => m.status === 'FINISHED');
  if (!finished.length) return 1.35;
  const goals = finished.reduce((sum, m) => sum + Number(m.score?.fullTime?.home ?? 0) + Number(m.score?.fullTime?.away ?? 0), 0);
  return clamp(goals / finished.length / 2, 0.9, 2.2);
}

function predict(match, history) {
  const home = teamForm(match.homeTeam.id, history, 'home');
  const away = teamForm(match.awayTeam.id, history, 'away');
  const league = leagueGoalRate(history);

  // Transparent Poisson feature blend. It is a statistical estimate, not a guarantee.
  let lambdaHome = (home.gf * 0.58 + (2 - home.ga) * 0.42) * 1.08;
  let lambdaAway = (away.gf * 0.58 + (2 - away.ga) * 0.42) * 0.94;
  lambdaHome = clamp(lambdaHome * 0.72 + league * 0.28, 0.25, 3.8);
  lambdaAway = clamp(lambdaAway * 0.72 + league * 0.28, 0.20, 3.5);

  let h = 0, d = 0, a = 0, over25 = 0, btts = 0;
  for (let hg = 0; hg <= 8; hg++) {
    for (let ag = 0; ag <= 8; ag++) {
      const p = poisson(hg, lambdaHome) * poisson(ag, lambdaAway);
      if (hg > ag) h += p;
      else if (hg === ag) d += p;
      else a += p;
      if (hg + ag > 2) over25 += p;
      if (hg > 0 && ag > 0) btts += p;
    }
  }
  const total = h + d + a;
  const probs = [h / total, d / total, a / total];
  const markets = {
    HOME_WIN: probs[0], DRAW: probs[1], AWAY_WIN: probs[2],
    OVER_2_5: over25, BTTS: btts
  };
  const ranked = Object.entries(markets).sort((x, y) => y[1] - x[1]);
  const [recommendedMarket, rawTopProbability] = ranked[0];
  const entropy = -probs.reduce((s, p) => s + (p > 0 ? p * Math.log(p) : 0), 0) / Math.log(3);
  const sampleFactor = Math.min(1, (home.n + away.n) / 16);
  const confidence = clamp(rawTopProbability * (1 - 0.20 * entropy) * (0.82 + 0.18 * sampleFactor));

  return {
    matchId: match.id,
    home: match.homeTeam.name,
    away: match.awayTeam.name,
    kickoff: match.utcDate,
    competition: match.competition?.name || 'Unknown',
    probabilities: {
      homeWin: probs[0], draw: probs[1], awayWin: probs[2], over25, btts
    },
    expectedGoals: Number((lambdaHome + lambdaAway).toFixed(2)),
    recommendedMarket,
    rawTopProbability,
    confidence,
    risk: confidence >= 0.70 ? 'LOW' : confidence >= 0.58 ? 'MEDIUM' : 'HIGH',
    features: { home, away, leagueGoalRate: league },
    modelVersion: 'CRATTO-CTRL-12.0-Poisson'
    ,dataSufficiency: { homeMatches: home.n, awayMatches: away.n, sufficient: home.n >= 5 && away.n >= 5 }
  };
}


function eloRatings(matches) {
  const ratings = new Map();
  const K = 24;
  const homeAdv = 55;
  const get = id => ratings.has(id) ? ratings.get(id) : 1500;
  const finished = [...matches].filter(m => m.status === 'FINISHED').sort((a,b)=>new Date(a.utcDate)-new Date(b.utcDate));
  for (const m of finished) {
    const h = m.homeTeam?.id, a = m.awayTeam?.id;
    if (!h || !a) continue;
    const hg = Number(m.score?.fullTime?.home ?? 0), ag = Number(m.score?.fullTime?.away ?? 0);
    const rh = get(h), ra = get(a);
    const eh = 1 / (1 + Math.pow(10, ((ra - (rh + homeAdv)) / 400)));
    const outcome = hg > ag ? 1 : hg === ag ? .5 : 0;
    const margin = Math.min(1.5, 1 + Math.log1p(Math.abs(hg-ag)) * .18);
    ratings.set(h, rh + K * margin * (outcome - eh));
    ratings.set(a, ra + K * margin * ((1-outcome) - (1-eh)));
  }
  return ratings;
}
function eloProbabilities(match, ratings) {
  const rh = ratings.get(match.homeTeam.id) ?? 1500;
  const ra = ratings.get(match.awayTeam.id) ?? 1500;
  const x = (rh + 55 - ra) / 400;
  const homeNonDraw = 1 / (1 + Math.pow(10, -x));
  const draw = clamp(0.27 - Math.min(.08, Math.abs(x) * .06), .16, .29);
  return { homeWin: homeNonDraw * (1-draw), draw, awayWin: (1-homeNonDraw) * (1-draw) };
}
function trend(teamId, matches, limit=8) {
  const games = matches.filter(m=>m.status==='FINISHED' && (m.homeTeam?.id===teamId || m.awayTeam?.id===teamId))
    .sort((a,b)=>new Date(a.utcDate)-new Date(b.utcDate)).slice(-limit);
  if (games.length < 4) return { slope: 0, direction: 'STABLE' };
  const vals = games.map(m=>{
    const home=m.homeTeam.id===teamId, gf=Number(m.score?.fullTime?.home??0), ga=Number(m.score?.fullTime?.away??0);
    return home ? gf-ga : ga-gf;
  });
  const n=vals.length, xbar=(n-1)/2, ybar=vals.reduce((a,b)=>a+b,0)/n;
  const den=vals.reduce((a,_,i)=>a+(i-xbar)**2,0)||1;
  const slope=vals.reduce((a,y,i)=>a+(i-xbar)*(y-ybar),0)/den;
  return { slope:Number(slope.toFixed(3)), direction:slope>.08?'UP':slope<-.08?'DOWN':'STABLE' };
}
function ensemblePrediction(match, history) {
  const base = predict(match, history);
  const ratings = eloRatings(history);
  const elo = eloProbabilities(match, ratings);
  const formHome = base.features.home.ppg, formAway = base.features.away.ppg;
  const formEdge = clamp(.5 + (formHome-formAway)/6, .18, .82);
  const form = { homeWin: formEdge*.72, draw:.28, awayWin:(1-formEdge)*.72 };
  const weights = history.length >= 100 ? { poisson:.55, elo:.30, form:.15 } : { poisson:.70, elo:.20, form:.10 };
  const probs3 = {
    homeWin: clamp(weights.poisson*base.probabilities.homeWin + weights.elo*elo.homeWin + weights.form*form.homeWin),
    draw: clamp(weights.poisson*base.probabilities.draw + weights.elo*elo.draw + weights.form*form.draw),
    awayWin: clamp(weights.poisson*base.probabilities.awayWin + weights.elo*elo.awayWin + weights.form*form.awayWin)
  };
  const sum=probs3.homeWin+probs3.draw+probs3.awayWin;
  probs3.homeWin/=sum; probs3.draw/=sum; probs3.awayWin/=sum;
  const markets={HOME_WIN:probs3.homeWin,DRAW:probs3.draw,AWAY_WIN:probs3.awayWin,OVER_2_5:base.probabilities.over25,BTTS:base.probabilities.btts};
  const ranked=Object.entries(markets).sort((a,b)=>b[1]-a[1]);
  const entropy=-[probs3.homeWin,probs3.draw,probs3.awayWin].reduce((s,p)=>s+(p>0?p*Math.log(p):0),0)/Math.log(3);
  const calibrationFactor=history.length>=150 ? .98 : history.length>=50 ? .94 : .88;
  const confidence=clamp(ranked[0][1]*(1-.16*entropy)*calibrationFactor);
  const ht=trend(match.homeTeam.id,history), at=trend(match.awayTeam.id,history);
  return {...base, probabilities:{...base.probabilities,...probs3}, recommendedMarket:ranked[0][0], rawTopProbability:ranked[0][1], confidence,
    risk:confidence>=.70?'LOW':confidence>=.58?'MEDIUM':'HIGH', modelVersion:'CRATTO-CTRL-24.0-AUTH-PORTFOLIO',
    modelBlend:weights, elo:{home:ratings.get(match.homeTeam.id)??1500,away:ratings.get(match.awayTeam.id)??1500,probabilities:elo}, trend:{home:ht,away:at}, calibrationFactor};
}
function evaluateEnsemble(pred, match) {
  const e=evaluatePrediction(pred,match);
  const arr=[pred.probabilities.homeWin,pred.probabilities.draw,pred.probabilities.awayWin];
  const actual=match.score.fullTime.home>match.score.fullTime.away?0:match.score.fullTime.home===match.score.fullTime.away?1:2;
  e.logLoss=-Math.log(Math.max(1e-9,arr[actual]));
  return e;
}
function correlationScore(a,b) {
  if (a.recommendedMarket===b.recommendedMarket) return .8;
  const homeAway = new Set([a.home,a.away,a.matchId,b.home,b.away,b.matchId]);
  if (homeAway.size < 6) return .55;
  if ((a.probabilities?.over25 && b.probabilities?.btts) || (a.probabilities?.btts && b.probabilities?.over25)) return .35;
  return 0;
}
function buildPortfolio(predictions, opts={}) {
  const maxSelections=Math.max(1,Math.min(20,Number(opts.maxSelections||5)));
  const minConfidence=clamp(Number(opts.minConfidence??.65));
  const risk=opts.risk||'ALL';
  const pool=predictions.filter(p=>p.confidence>=minConfidence&&(risk==='ALL'||p.risk===risk)).sort((a,b)=>b.confidence-a.confidence);
  const selected=[];
  for(const p of pool){
    if(selected.length>=maxSelections) break;
    const tooCorrelated=selected.some(x=>correlationScore(x,p)>=.75);
    if(!tooCorrelated) selected.push(p);
  }
  return selected;
}


function evaluatePrediction(prediction, match) {
  const hg = Number(match.score?.fullTime?.home ?? 0);
  const ag = Number(match.score?.fullTime?.away ?? 0);
  const actual = hg > ag ? 'HOME_WIN' : hg === ag ? 'DRAW' : 'AWAY_WIN';
  const p = prediction.probabilities;
  const actualIndex = actual === 'HOME_WIN' ? 0 : actual === 'DRAW' ? 1 : 2;
  const arr = [p.homeWin, p.draw, p.awayWin];
  const brier = arr.reduce((s, x, i) => s + Math.pow(x - (i === actualIndex ? 1 : 0), 2), 0);
  return {
    matchId: match.id,
    actual,
    predicted: ['HOME_WIN', 'DRAW', 'AWAY_WIN'][arr.indexOf(Math.max(...arr))],
    correct: arr.indexOf(Math.max(...arr)) === actualIndex,
    brier
  };
}


function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const derived = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(derived, 'hex'));
}
function token() { return crypto.randomBytes(32).toString('hex'); }
function shareCode() { return `CCTRL-${crypto.randomBytes(4).toString('hex').toUpperCase()}`; }
function normalizeEmail(value) { return String(value || '').trim().toLowerCase(); }
function safeUser(u) { return u ? { id:u.id, name:u.name, email:u.email, role:u.role, createdAt:u.created_at || u.createdAt } : null; }
function tokenFromReq(req) { const raw=req.headers.authorization||''; return raw.startsWith('Bearer ')?raw.slice(7):null; }
function adminAuthorized(req) {
  const key = process.env.ADMIN_KEY;
  const supplied = req.headers['x-admin-key'] || req.query.adminKey;
  return Boolean(key && supplied && safeCompare(key, supplied));
}
function bookmakerSlip(selections, bookmaker='CRATTO') {
  const normalized=String(bookmaker||'CRATTO').toUpperCase();
  const supported=['CRATTO','BETWAY','HOLLYWOODBETS'];
  if(!supported.includes(normalized)) throw new Error('Unsupported bookmaker target.');
  const rows=(Array.isArray(selections)?selections:[]).map((s,i)=>({
    leg:i+1,
    fixture:`${s.home} vs ${s.away}`,
    market:s.recommendedMarket||s.market||'UNSPECIFIED',
    probability:s.confidence ?? s.rawTopProbability ?? null,
    kickoff:s.kickoff||null,
    competition:s.competition||null
  }));
  return {
    bookmaker:normalized,
    mode: normalized==='CRATTO'?'CRATTO_SHARE_CODE':'BOOKMAKER_READY',
    title: normalized==='BETWAY'?'Betway-ready slip':normalized==='HOLLYWOODBETS'?'Hollywoodbets-ready slip':'CRATTO CTRL slip',
    instructions: normalized==='BETWAY'
      ? 'Transfer these selections into Betway, then use Betway Book-a-Bet to generate the official Betway booking code.'
      : normalized==='HOLLYWOODBETS'
      ? 'Transfer these selections into Hollywoodbets and use its own sharing/booking workflow to obtain the official bookmaker reference.'
      : 'Share this CRATTO CTRL code with another CRATTO user.',
    selections:rows
  };
}

async function authUser(req) {
  const token=tokenFromReq(req); if(!token) return null;
  if(dbEnabled) { const s=await getSession(token); return s ? await getUserById(s.user_id) : null; }
  const store=readStore(); const s=store.sessions.find(x=>x.token===token && new Date(x.expiresAt)>new Date()); return s ? store.users.find(u=>u.id===s.userId) || null : null;
}

async function requireAuth(req,res,next) {
  try { const user = await authUser(req); if (!user) return res.status(401).json({error:'Login required'}); req.user = user; next(); }
  catch(e) { res.status(500).json({error:e.message}); }
}
function validateEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email||'')); }

app.post('/api/auth/register', async (req,res)=>{
  try {
    const name=String(req.body.name||'').trim(), email=String(req.body.email||'').trim().toLowerCase(), password=String(req.body.password||'');
    if(name.length<2 || !validateEmail(email) || password.length<8) return res.status(400).json({error:'Name, valid email and password of at least 8 characters are required.'});
    const user={id:crypto.randomUUID(),name,email,passwordHash:hashPassword(password),createdAt:new Date().toISOString(),role:'user'};
    if(dbEnabled) {
      if(await getUserByEmail(email)) return res.status(409).json({error:'An account with that email already exists.'});
      await createUser(user);
      const session={token:token(),userId:user.id,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+1000*60*60*24*30).toISOString()};
      await createSession(session);
      return res.json({user:safeUser(user),token:session.token});
    }
    const store=readStore();
    if(store.users.some(u=>u.email===email)) return res.status(409).json({error:'An account with that email already exists.'});
    const session={token:token(),userId:user.id,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+1000*60*60*24*30).toISOString()};
    store.users.push(user); store.sessions.push(session); writeStore(store);
    res.json({user:safeUser(user),token:session.token});
  } catch(e){res.status(500).json({error:e.message});}
});
app.post('/api/auth/login',async(req,res)=>{
  const email=String(req.body.email||'').trim().toLowerCase(), password=String(req.body.password||'');
  try {
    if(dbEnabled){
      const user=await getUserByEmail(email);
      if(!user || !verifyPassword(password,user.password_hash)) return res.status(401).json({error:'Invalid email or password.'});
      const session={token:token(),userId:user.id,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+1000*60*60*24*30).toISOString()};
      await createSession(session); return res.json({user:{id:user.id,name:user.name,email:user.email,createdAt:user.created_at,role:user.role},token:session.token});
    }
    const store=readStore(), user=store.users.find(u=>u.email===email);
    if(!user || !verifyPassword(password,user.passwordHash)) return res.status(401).json({error:'Invalid email or password.'});
    const session={token:token(),userId:user.id,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+1000*60*60*24*30).toISOString()};
    store.sessions=store.sessions.filter(s=>new Date(s.expiresAt)>new Date()).slice(-5000); store.sessions.push(session); writeStore(store);
    res.json({user:safeUser(user),token:session.token});
  } catch(e){res.status(500).json({error:e.message});}
});
app.post('/api/auth/logout',async(req,res)=>{
  try { const raw=req.headers.authorization||''; const t=raw.startsWith('Bearer ')?raw.slice(7):null; if(t && dbEnabled) await deleteSession(t); else if(t){const store=readStore(); store.sessions=store.sessions.filter(s=>s.token!==t); writeStore(store);} res.json({ok:true}); } catch(e){res.status(500).json({error:e.message});}
});
app.get('/api/auth/me',async(req,res)=>{ const u=await authUser(req); res.json({authenticated:Boolean(u),user:safeUser(u)}); });

app.get('/api/account/slips',requireAuth,async(req,res)=>{
  if(dbEnabled) return res.json({slips:await listUserSlips(req.user.id)});
  const store=readStore(); res.json({slips:store.slips.filter(s=>s.userId===req.user.id).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,100).map(({userId,...s})=>s)});
});
app.post('/api/slips',requireAuth,async(req,res)=>{
  try {
    const selections=Array.isArray(req.body.selections)?req.body.selections.slice(0,20):[];
    if(!selections.length) return res.status(400).json({error:'At least one selection is required.'});
    const slip={id:crypto.randomUUID(),userId:req.user.id,code:shareCode(),selections,stake:Number(req.body.stake||0),budget:Number(req.body.budget||0),createdAt:new Date().toISOString(),status:'DRAFT'};
    if(dbEnabled){
      const created=await createSlip(slip); return res.json({slip:created});
    }
    const store=readStore(); while(store.slips.some(s=>s.code===slip.code)) slip.code=shareCode(); store.slips.push(slip); writeStore(store); res.json({slip:{...slip,userId:undefined}});
  } catch(e){res.status(500).json({error:e.message});}
});

app.post('/api/slips/preview', requireAuth, async (req,res)=>{
  try {
    const bookmaker=req.body?.bookmaker||'CRATTO';
    const preview=bookmakerSlip(req.body?.selections,bookmaker);
    res.json(preview);
  } catch(e) { res.status(400).json({error:e.message}); }
});

app.post('/api/slips/:id/bookmaker', requireAuth, async (req,res)=>{
  try {
    const slips=await listUserSlips(req.user.id);
    const slip=slips.find(x=>x.id===req.params.id);
    if(!slip) return res.status(404).json({error:'Slip not found'});
    res.json(bookmakerSlip(slip.selections,req.body?.bookmaker||'CRATTO'));
  } catch(e) { res.status(500).json({error:e.message}); }
});

app.get('/api/slips/code/:code',async(req,res)=>{
  try {
    const code=String(req.params.code).toUpperCase();
    if(dbEnabled){const slip=await getSlipByCode(code); if(!slip)return res.status(404).json({error:'Slip code not found.'}); return res.json({slip});}
    const store=readStore(), slip=store.slips.find(s=>s.code.toUpperCase()===code); if(!slip) return res.status(404).json({error:'Slip code not found.'}); const {userId,...publicSlip}=slip; res.json({slip:publicSlip});
  } catch(e){res.status(500).json({error:e.message});}
});


app.get('/api/admin/users', async (req,res)=>{
  if(!adminAuthorized(req)) return res.status(403).json({error:'Admin authorization required'});
  try {
    if(dbEnabled) {
      const r=await (await import('./db.js')).pool.query('SELECT id,name,email,role,created_at AS "createdAt" FROM cctrl_users ORDER BY created_at DESC LIMIT 500');
      return res.json({users:r.rows});
    }
    const store=readStore(); res.json({users:store.users.map(safeUser)});
  } catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/admin/slips', async (req,res)=>{
  if(!adminAuthorized(req)) return res.status(403).json({error:'Admin authorization required'});
  try {
    if(dbEnabled) {
      const r=await (await import('./db.js')).pool.query('SELECT id,user_id AS "userId",code,bookmaker,status,stake,budget,created_at AS "createdAt" FROM cctrl_slips ORDER BY created_at DESC LIMIT 500');
      return res.json({slips:r.rows});
    }
    const store=readStore(); res.json({slips:store.slips.slice(-500).reverse()});
  } catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/health', (req, res) => {
  const store = readStore();
  res.json({
    ok: true,
    service: 'Ultra Next Gen Pro Predictor',
    brand: 'CRATTO CTRL',
    model: 'CRATTO-CTRL-30.0-INTELLIGENCE-CORE',
    providerConfigured: Boolean(process.env.FOOTBALL_DATA_API_KEY),
    storedMatches: store.matches.length,
    storedPredictions: store.predictions.length,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/competitions', async (req, res) => {
  try {
    const data = await apiFetch('/competitions');
    const competitions = (data.competitions || []).map(c => ({ id: c.id, code: c.code, name: c.name, type: c.type, plan: c.plan })).filter(c => c.code);
    res.json({ count: competitions.length, competitions });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/matches', async (req, res) => {
  try {
    const now = new Date();
    const from = req.query.dateFrom || now.toISOString().slice(0, 10);
    const to = req.query.dateTo || new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10);
    const extra = {};
    if (req.query.competitions) extra.competitions = String(req.query.competitions);
    if (req.query.status) extra.status = String(req.query.status);
    const data = await apiFetchMatchesRange(from, to, extra);
    const store = readStore();
    upsertMatches(store, data.matches || []);
    store.meta.lastProviderSync = new Date().toISOString();
    writeStore(store);
    res.json({ count: data.matches?.length || 0, matches: data.matches || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/data/status', requireAuth, (req,res)=>{
  const store=readStore();
  res.json({matches:store.matches.length,predictions:store.predictions.length,finished:store.matches.filter(m=>m.status==='FINISHED').length,scheduled:store.matches.filter(m=>['SCHEDULED','TIMED','POSTPONED'].includes(m.status)).length,teams:[...new Set(store.matches.flatMap(m=>[m.homeTeam?.name,m.awayTeam?.name].filter(Boolean)))].length,lastProviderSync:store.meta.lastProviderSync||null,lastHistoricalSync:store.meta.lastHistoricalSync||null});
});

app.post('/api/data/refresh', requireAuth, async (req,res)=>{
  try {
    const now=new Date();
    const from=new Date(now.getTime()-60*86400000).toISOString().slice(0,10);
    const to=new Date(now.getTime()+14*86400000).toISOString().slice(0,10);
    const extra={}; if(req.body?.competitions) extra.competitions=String(req.body.competitions);
    const data=await apiFetchMatchesRange(from,to,extra);
    const store=readStore(); upsertMatches(store,data.matches||[]);
    store.meta.lastProviderSync=new Date().toISOString();
    store.meta.lastHistoricalSync=new Date().toISOString();
    const history=store.matches.filter(m=>m.status==='FINISHED');
    const upcoming=store.matches.filter(m=>['SCHEDULED','TIMED'].includes(m.status));
    const predictions=upcoming.map(m=>ensemblePrediction(m,history));
    for(const p of predictions){const i=store.predictions.findIndex(x=>x.matchId===p.matchId); if(i>=0) store.predictions[i]=p; else store.predictions.push(p);}
    writeStore(store);
    res.json({ok:true,synced:data.matches?.length||0,finished:history.length,upcoming:upcoming.length,predictions:predictions.length,teams:[...new Set(upcoming.flatMap(m=>[m.homeTeam?.name,m.awayTeam?.name].filter(Boolean)))].length,from,to});
  } catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/predictions', async (req, res) => {
  try {
    const now = new Date();
    const from = req.query.dateFrom || now.toISOString().slice(0, 10);
    const to = req.query.dateTo || new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10);
    const extra = { status: 'SCHEDULED' };
    if (req.query.competitions) extra.competitions = String(req.query.competitions);
    const data = await apiFetchMatchesRange(from, to, extra);
    const store = readStore();
    upsertMatches(store, data.matches || []);
    const history = store.matches.filter(m => m.status === 'FINISHED');
    const predictions = (data.matches || []).map(m => ensemblePrediction(m, history));
    for (const p of predictions) {
      const i = store.predictions.findIndex(x => x.matchId === p.matchId);
      if (i >= 0) store.predictions[i] = p; else store.predictions.push(p);
    }
    store.predictions = store.predictions.slice(-3000);
    writeStore(store);
    res.json({ count: predictions.length, predictions });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/sync', async (req, res) => {
  try {
    if (!req.body.from || !req.body.to) return res.status(400).json({ error: 'from and to dates are required' });
    const extra = { status: 'FINISHED' };
    if (req.body.competitions) extra.competitions = String(req.body.competitions);
    const data = await apiFetchMatchesRange(req.body.from, req.body.to, extra);
    const store = readStore(); upsertMatches(store, data.matches || []);
    store.meta.lastHistoricalSync = new Date().toISOString(); writeStore(store);
    res.json({ synced: data.matches?.length || 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/strategy', async (req, res) => {
  try {
    const budget = Math.max(0, Number(req.body.budget ?? 150));
    const stake = Math.max(0, Number(req.body.stake ?? 1));
    const minConfidence = clamp(Number(req.body.minConfidence ?? 0.65));
    const maxSelections = Math.max(1, Math.min(20, Number(req.body.maxSelections ?? 5)));
    const risk = req.body.risk || 'ALL';
    const now = new Date();
    const q = new URLSearchParams({
      dateFrom: now.toISOString().slice(0, 10),
      dateTo: new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10),
      status: 'SCHEDULED'
    });
    if (req.body.competitions) q.set('competitions', req.body.competitions);
    const data = await apiFetch('/matches?' + q.toString());
    const store = readStore(); upsertMatches(store, data.matches || []);
    const history = store.matches.filter(m => m.status === 'FINISHED');
    const selections = (data.matches || [])
      .map(m => ensemblePrediction(m, history))
      .filter(p => p.confidence >= minConfidence && (risk === 'ALL' || p.risk === risk));
    const predictions = (data.matches || []).map(m => ensemblePrediction(m, history));
    const selected = buildPortfolio(predictions, { minConfidence, maxSelections, risk });
    res.json({
      budget, stake, minConfidence, risk,
      plannedStake: Math.min(budget, selected.length * stake),
      remaining: Math.max(0, budget - selected.length * stake),
      selections: selected,
      diversification: selected.length ? Number((selected.reduce((s,p)=>s+p.confidence,0)/selected.length).toFixed(3)) : 0
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/backtest', (req, res) => {
  const store = readStore();
  const finished = store.matches.filter(m => m.status === 'FINISHED').sort((a, b) => new Date(a.utcDate) - new Date(b.utcDate));
  const maxMatches = Math.min(1000, Math.max(10, Number(req.query.limit || 300)));
  const sample = finished.slice(-maxMatches);
  const results = [];
  for (let i = 0; i < sample.length; i++) {
    const match = sample[i];
    const history = finished.filter(x => new Date(x.utcDate) < new Date(match.utcDate)).slice(-3000);
    if (history.length < 5) continue;
    const p = ensemblePrediction(match, history);
    results.push(evaluateEnsemble(p, match));
  }
  const accuracy = results.length ? results.filter(x => x.correct).length / results.length : null;
  const brier = results.length ? results.reduce((s, x) => s + x.brier, 0) / results.length : null;
  const logLoss = results.length ? results.reduce((s,x)=>s+x.logLoss,0)/results.length : null;
  res.json({
    model: 'CRATTO-CTRL-30.0-INTELLIGENCE-CORE',
    evaluated: results.length,
    accuracy,
    brierScore: brier,
    logLoss,
    note: 'Walk-forward evaluation on stored finished matches. Results depend on the historical data available in the service.'
  });
});

app.get('/api/model/summary', (req, res) => {
  const store = readStore();
  const finished = store.matches.filter(m => m.status === 'FINISHED');
  const teams = new Set();
  for (const m of finished) { if (m.homeTeam?.id) teams.add(m.homeTeam.id); if (m.awayTeam?.id) teams.add(m.awayTeam.id); }
  const totalGoals = finished.reduce((s,m) => s + Number(m.score?.fullTime?.home ?? 0) + Number(m.score?.fullTime?.away ?? 0), 0);
  res.json({
    model: 'CRATTO-CTRL-30.0-INTELLIGENCE-CORE',
    historicalMatches: finished.length,
    teamsObserved: teams.size,
    averageGoalsPerMatch: finished.length ? Number((totalGoals / finished.length).toFixed(3)) : null,
    dataQuality: finished.length >= 500 ? 'GOOD' : finished.length >= 150 ? 'FAIR' : 'LOW',
    limitations: ['No guarantee of future outcomes', 'No bookmaker odds/value calculation unless odds data is supplied', 'Provider permissions and historical coverage affect sample size']
  });
});


app.get('/api/strengths', (req,res)=>{
  const store=readStore(), finished=store.matches.filter(m=>m.status==='FINISHED');
  const ratings=eloRatings(finished); const rows=[];
  for(const [id,rating] of ratings.entries()){
    const games=finished.filter(m=>m.homeTeam?.id===id||m.awayTeam?.id===id).slice(-12);
    const name=(games.map(m=>m.homeTeam?.id===id?m.homeTeam.name:m.awayTeam.name).pop())||String(id);
    rows.push({teamId:id,name,elo:Number(rating.toFixed(1)),matches:games.length});
  }
  rows.sort((a,b)=>b.elo-a.elo); res.json({count:rows.length,teams:rows.slice(0,100)});
});

app.get('/api/calibration', (req,res)=>{
  const store=readStore(), finished=store.matches.filter(m=>m.status==='FINISHED').sort((a,b)=>new Date(a.utcDate)-new Date(b.utcDate));
  const bins=Array.from({length:10},(_,i)=>({bin:i,from:i/10,to:(i+1)/10,count:0,correct:0,observed:null}));
  for(let i=0;i<finished.length;i++){
    const m=finished[i], hist=finished.slice(0,i); if(hist.length<5) continue;
    const p=ensemblePrediction(m,hist), arr=[p.probabilities.homeWin,p.probabilities.draw,p.probabilities.awayWin], prob=Math.max(...arr);
    const actual=m.score.fullTime.home>m.score.fullTime.away?0:m.score.fullTime.home===m.score.fullTime.away?1:2;
    const b=Math.min(9,Math.floor(prob*10)); bins[b].count++; bins[b].correct += arr.indexOf(prob)===actual?1:0;
  }
  for(const b of bins) if(b.count) b.observed=Number((b.correct/b.count).toFixed(4));
  res.json({bins, note:'Calibration compares predicted top-class probability with observed correctness in walk-forward bins.'});
});

app.get('/api/portfolio', async (req,res)=>{
  try{
    const now=new Date(), q=new URLSearchParams({dateFrom:now.toISOString().slice(0,10),dateTo:new Date(now.getTime()+7*86400000).toISOString().slice(0,10),status:'SCHEDULED'});
    if(req.query.competitions) q.set('competitions',req.query.competitions);
    const data=await apiFetch('/matches?'+q.toString()); const store=readStore(); upsertMatches(store,data.matches||[]);
    const history=store.matches.filter(m=>m.status==='FINISHED'); const predictions=(data.matches||[]).map(m=>ensemblePrediction(m,history));
    const selections=buildPortfolio(predictions,{minConfidence:req.query.minConfidence||.60,maxSelections:req.query.maxSelections||6,risk:req.query.risk||'ALL'});
    res.json({selections, count:selections.length, model:'CRATTO-CTRL-25.0-INTELLIGENCE'});
  }catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/model/diagnostics',(req,res)=>{
  const store=readStore(), finished=store.matches.filter(m=>m.status==='FINISHED').sort((a,b)=>new Date(a.utcDate)-new Date(b.utcDate));
  const recent=finished.slice(-100), prior=finished.slice(-200,-100);
  const score=(set)=>{ if(!set.length) return null; let c=0; for(let i=0;i<set.length;i++){const hist=finished.filter(x=>new Date(x.utcDate)<new Date(set[i].utcDate));if(hist.length<5)continue;const p=ensemblePrediction(set[i],hist);const a=set[i].score.fullTime.home>set[i].score.fullTime.away?0:set[i].score.fullTime.home===set[i].score.fullTime.away?1:2;const arr=[p.probabilities.homeWin,p.probabilities.draw,p.probabilities.awayWin];if(arr.indexOf(Math.max(...arr))===a)c++;} return c/set.length;};
  const r=score(recent), p=score(prior); res.json({recentAccuracy:r,priorAccuracy:p,drift:r!=null&&p!=null?Number((r-p).toFixed(4)):null,status:r!=null&&p!=null&&r<p-.12?'REVIEW':'STABLE',sampleRecent:recent.length,samplePrior:prior.length});
});

app.get('/api/analytics', (req, res) => {
  const store = readStore();
  const finished = store.matches.filter(x => x.status === 'FINISHED').length;
  res.json({
    matches: store.matches.length,
    predictions: store.predictions.length,
    finished,
    model: 'CRATTO-CTRL-30.0-INTELLIGENCE-CORE',
    dataQuality: finished >= 300 ? 'GOOD' : finished >= 100 ? 'FAIR' : 'LOW',
    lastProviderSync: store.meta?.lastProviderSync || null,
    lastHistoricalSync: store.meta?.lastHistoricalSync || null
  });
});


app.get('/api/notifications', requireAuth, async (req,res)=>{
  try { res.json({notifications: dbEnabled ? await listNotifications(req.user.id) : []}); }
  catch(e){ res.status(500).json({error:e.message}); }
});
app.post('/api/notifications/:id/read', requireAuth, async (req,res)=>{
  try { if(dbEnabled) await markNotificationRead(req.params.id, req.user.id); res.json({ok:true}); }
  catch(e){ res.status(500).json({error:e.message}); }
});

app.get('/api/operations/jobs', async (req,res)=>{
  if(!adminAuthorized(req)) return res.status(403).json({error:'Admin access denied.'});
  res.json({jobs: dbEnabled ? await recentJobs(50) : []});
});

async function scheduledSync(){
  const now=new Date(), from=new Date(now.getTime()-3*86400000);
  const q=new URLSearchParams({dateFrom:from.toISOString().slice(0,10),dateTo:now.toISOString().slice(0,10),status:'FINISHED'});
  const data=await apiFetch('/matches?'+q.toString());
  const store=readStore(); upsertMatches(store,data.matches||[]); store.meta.lastHistoricalSync=new Date().toISOString(); writeStore(store);
  return {synced:data.matches?.length||0};
}
async function scheduledPredictions(){
  const now=new Date(), end=new Date(now.getTime()+7*86400000);
  const q=new URLSearchParams({dateFrom:now.toISOString().slice(0,10),dateTo:end.toISOString().slice(0,10),status:'SCHEDULED'});
  const data=await apiFetch('/matches?'+q.toString());
  const store=readStore(); upsertMatches(store,data.matches||[]);
  const history=store.matches.filter(m=>m.status==='FINISHED');
  const predictions=(data.matches||[]).map(m=>ensemblePrediction(m,history));
  for(const p of predictions){ const i=store.predictions.findIndex(x=>x.matchId===p.matchId); if(i>=0) store.predictions[i]=p; else store.predictions.push(p); }
  store.meta.lastProviderSync=new Date().toISOString(); writeStore(store);
  return {predicted:predictions.length};
}

app.get('/api/operations/status',(req,res)=>{
  res.json({scheduler: scheduler ? {intervalMinutes:scheduler.intervalMinutes} : null, lastProviderSync:readStore().meta.lastProviderSync||null, lastHistoricalSync:readStore().meta.lastHistoricalSync||null});
});
app.post('/api/operations/run', async (req,res)=>{
  if(!adminAuthorized(req)) return res.status(403).json({error:'Admin access denied.'});
  try { const result=await scheduler?.runNow('manual-admin-run'); res.json(result||{error:'Scheduler unavailable'}); }
  catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/models', async (req,res)=>{
  const models = dbEnabled ? await listModels() : [{version:'CRATTO-CTRL-30.0-INTELLIGENCE-CORE',name:'Intelligence + value ensemble',status:'ACTIVE',metrics:{}}];
  res.json({models});
});
app.post('/api/models/register', async (req,res)=>{
  if(!adminAuthorized(req)) return res.status(403).json({error:'Admin access denied.'});
  const version=String(req.body.version||'').trim(), name=String(req.body.name||'').trim();
  if(!version||!name) return res.status(400).json({error:'version and name are required'});
  const row=await upsertModel({version,name,status:req.body.status||'ACTIVE',metrics:req.body.metrics||{}}); res.json({model:row});
});

app.get('/api/platform/status', async (req,res)=>{
  const store=readStore();
  let db='DISABLED';
  if(dbEnabled){ try { await import('./db.js').then(m=>m.pool.query('SELECT 1')); db='OK'; } catch { db='ERROR'; } }
  res.json({status:'OK',database:db,providerConfigured:Boolean(process.env.FOOTBALL_DATA_API_KEY),model:'CRATTO-CTRL-25.0-INTELLIGENCE',node:process.version,uptimeSeconds:Math.round(process.uptime()),storedMatches:store.matches.length});
});

app.get('/api/bookmakers/:bookmaker/export', requireAuth, async (req,res)=>{
  const bookmaker=String(req.params.bookmaker||'').toUpperCase();
  if(!['BETWAY','HOLLYWOODBETS'].includes(bookmaker)) return res.status(400).json({error:'Supported targets: BETWAY, HOLLYWOODBETS'});
  const selections=Array.isArray(req.body?.selections)?req.body.selections:[];
  const slip=bookmakerSlip(selections,bookmaker);
  await audit('BOOKMAKER_READY_EXPORT',req.user.id,{bookmaker,count:slip.selections.length});
  res.json({ ...slip, officialCode:null, officialCodeSource:'BOOKMAKER', note:'CRATTO CTRL does not fabricate official bookmaker booking codes.' });
});



app.post('/api/odds', requireAuth, async (req,res)=>{
  try {
    const matchId=String(req.body?.matchId||'').trim();
    const bookmaker=String(req.body?.bookmaker||'').trim().toUpperCase();
    const odds=req.body?.odds && typeof req.body.odds==='object' ? req.body.odds : {};
    if(!matchId || !bookmaker || !Object.keys(odds).length) return res.status(400).json({error:'matchId, bookmaker and odds are required.'});
    const saved=[];
    for(const [market,price] of Object.entries(odds)){
      const n=Number(price); if(!(n>1)) continue;
      saved.push(await saveOdds({id:crypto.randomUUID(),matchId,bookmaker,market:String(market).toUpperCase(),odds:n}));
    }
    await audit('ODDS_CAPTURED',req.user.id,{matchId,bookmaker,count:saved.length});
    res.json({count:saved.length,odds:saved});
  }catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/odds/:matchId', async (req,res)=>{
  try { res.json({odds:await listOdds(req.params.matchId)}); } catch(e){res.status(500).json({error:e.message});}
});

app.post('/api/value-analysis', async (req,res)=>{
  try {
    const predictions=Array.isArray(req.body?.predictions)?req.body.predictions:[];
    const oddsMap=req.body?.odds && typeof req.body.odds==='object'?req.body.odds:{};
    const ranked=rankValue(predictions,oddsMap).flatMap(p=>p.valueMarkets.map(v=>({...v,matchId:p.matchId,home:p.home,away:p.away,confidence:p.confidence}))).sort((a,b)=>(b.expectedValue??-999)-(a.expectedValue??-999));
    res.json({count:ranked.length,markets:ranked.slice(0,100),note:'Value is a statistical comparison between supplied odds and model probabilities; it is not a guarantee of profit.'});
  }catch(e){res.status(400).json({error:e.message});}
});

app.post('/api/markets/expand', async (req,res)=>{
  try {
    const p=req.body?.prediction; if(!p) return res.status(400).json({error:'prediction is required'});
    const markets=['HOME_WIN','DRAW','AWAY_WIN','OVER_2_5','UNDER_2_5','BTTS','BTTS_NO','DOUBLE_CHANCE_1X','DOUBLE_CHANCE_X2','DOUBLE_CHANCE_12'];
    res.json({matchId:p.matchId,markets:markets.map(m=>({market:m,probability:marketProbability(p,m)}))});
  }catch(e){res.status(400).json({error:e.message});}
});

app.post('/api/risk/simulate', async (req,res)=>{
  try {
    const selections=Array.isArray(req.body?.selections)?req.body.selections:[];
    const simulations=Math.max(100,Math.min(20000,Number(req.body?.simulations||5000)));
    if(!selections.length) return res.status(400).json({error:'selections are required'});
    let success=0;
    for(let i=0;i<simulations;i++){
      let ok=true;
      for(const x of selections){ if(Math.random() > Math.max(0,Math.min(1,Number(x.probability)||0))){ok=false;break;} }
      if(ok) success++;
    }
    const p=success/simulations;
    res.json({simulations,selections:selections.length,jointProbability:Number(p.toFixed(6)),estimatedFailureProbability:Number((1-p).toFixed(6)),method:'independent Monte Carlo approximation'});
  }catch(e){res.status(400).json({error:e.message});}
});

app.post('/api/evaluations/run', async (req,res)=>{
  if(!adminAuthorized(req)) return res.status(403).json({error:'Admin access denied.'});
  try {
    const store=readStore(), finished=store.matches.filter(m=>m.status==='FINISHED');
    const modelVersion='CRATTO-CTRL-25.0-INTELLIGENCE';
    let evaluated=0;
    for(const m of finished.slice(-500)){
      const pred=store.predictions.find(x=>x.matchId===m.id); if(!pred) continue;
      const actual=m.score?.winner==='HOME_TEAM'?'HOME_WIN':m.score?.winner==='AWAY_TEAM'?'AWAY_WIN':m.score?.winner==='DRAW'?'DRAW':null;
      if(!actual) continue;
      const probs=[pred.probabilities.homeWin,pred.probabilities.draw,pred.probabilities.awayWin];
      const idx=actual==='HOME_WIN'?0:actual==='DRAW'?1:2;
      const brier=probs.reduce((sum,v,i)=>sum+(v-(i===idx?1:0))**2,0);
      const pr=Math.max(1e-9,Math.min(1,probs[idx]));
      const logLoss=-Math.log(pr);
      await saveEvaluation({id:crypto.randomUUID(),matchId:m.id,modelVersion,predictedMarket:['HOME_WIN','DRAW','AWAY_WIN'][probs.indexOf(Math.max(...probs))],probability:probs[idx],actual,correct:probs.indexOf(Math.max(...probs))===idx,brier,logLoss});
      evaluated++;
    }
    const summary=await evaluationSummary(modelVersion);
    await upsertModel({version:modelVersion,name:'Intelligence + value layer',status:'ACTIVE',metrics:summary||{}});
    res.json({runId:makeRunId('EVAL'),evaluated,summary});
  }catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/evaluations/summary', async (req,res)=>{
  try { res.json({modelVersion:'CRATTO-CTRL-25.0-INTELLIGENCE',summary:await evaluationSummary('CRATTO-CTRL-25.0-INTELLIGENCE')}); } catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/alerts', requireAuth, async (req,res)=>{ try{res.json({alerts:dbEnabled?await listAlerts(req.user.id):[]});}catch(e){res.status(500).json({error:e.message});} });

app.post('/api/alerts/test', requireAuth, async (req,res)=>{ try{const a=await createAlert({id:crypto.randomUUID(),userId:req.user.id,type:'TEST',payload:{message:'CRATTO CTRL notification test'}}); await addNotification({id:crypto.randomUUID(),userId:req.user.id,type:'TEST',title:'CRATTO CTRL test',body:'Notification system is working.'}); res.json({ok:true,alert:a});}catch(e){res.status(500).json({error:e.message});} });

app.get('/api/admin/control-centre', async (req,res)=>{
  if(!adminAuthorized(req)) return res.status(403).json({error:'Admin access denied.'});
  try{
    const stats=dbEnabled?await adminStats():null, jobs=dbEnabled?await recentJobs(20):[], models=dbEnabled?await listModels():[];
    const store=readStore();
    res.json({status:'OK',runId:makeRunId('ADMIN'),stats,jobs,models,store:{matches:store.matches.length,predictions:store.predictions.length},scheduler:scheduler?{intervalMinutes:scheduler.intervalMinutes}:null,providerConfigured:Boolean(process.env.FOOTBALL_DATA_API_KEY)});
  }catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/usage', async (req,res)=>{
  const key=req.ip||'anonymous'; const u=await usage(key); res.json(u);
});

app.get('/api/admin/summary',async(req,res)=>{
  const key=String(req.headers['x-admin-key']||'');
  if(!process.env.ADMIN_KEY || key!==process.env.ADMIN_KEY) return res.status(403).json({error:'Admin access denied.'});
  const stats=dbEnabled ? await adminStats() : (()=>{const s=readStore();return {users:s.users.length,slips:s.slips.length};})();
  const store=readStore();
  res.json({database:dbEnabled,users:stats.users,slips:stats.slips,matches:store.matches.length,predictions:store.predictions.length,lastProviderSync:store.meta.lastProviderSync||null,lastHistoricalSync:store.meta.lastHistoricalSync||null});
});


app.get('/api/intelligence/overview', (req,res)=>{
  try{
    const store=readStore(), finished=store.matches.filter(m=>m.status==='FINISHED');
    const wf=walkForward(finished, Number(req.query.limit||500));
    const cal=advancedCalibration(finished, Number(req.query.limit||500));
    const leagues=leaguePerformance(finished);
    res.json({version:'CRATTO-CTRL-30.0-INTELLIGENCE-CORE',data:summarizeStore(store),coverage:coverage(store),walkForward:{evaluated:wf.evaluated,accuracy:wf.accuracy,brier:wf.brier,logLoss:wf.logLoss},calibration:cal.bins,leaguePerformance:leagues.slice(0,30),note:'Historical estimates only; no future outcome is guaranteed.'});
  }catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/intelligence/backtest', (req,res)=>{
  try{ const store=readStore(); const r=walkForward(store.matches.filter(m=>m.status==='FINISHED'),Number(req.query.limit||500)); res.json({model:'CRATTO-CTRL-30.0-ENSEMBLE',...r}); }
  catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/intelligence/calibration', (req,res)=>{
  try{ const store=readStore(); res.json(advancedCalibration(store.matches.filter(m=>m.status==='FINISHED'),Number(req.query.limit||500))); }
  catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/intelligence/leagues', (req,res)=>{
  try{ const store=readStore(); res.json({leagues:leaguePerformance(store.matches.filter(m=>m.status==='FINISHED'))}); }
  catch(e){res.status(500).json({error:e.message});}
});

app.post('/api/intelligence/predict', (req,res)=>{
  try{
    const match=req.body?.match; if(!match?.homeTeam?.id || !match?.awayTeam?.id) return res.status(400).json({error:'A complete match object is required.'});
    const store=readStore(), history=store.matches.filter(m=>m.status==='FINISHED');
    res.json({prediction:ensembleModels(match,history),sampleSize:history.length});
  }catch(e){res.status(400).json({error:e.message});}
});

app.get('/api/intelligence/coverage', (req,res)=>{ const store=readStore(); res.json({summary:summarizeStore(store),coverage:coverage(store)}); });

app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((req,res,next)=>{ if(req.path.startsWith('/api/')) return next(); res.sendFile(path.join(__dirname,'public','index.html')); });

let scheduler = null;
initDb().then(async () => {
  if (dbEnabled) {
    const persisted = await loadAppState('runtime_store').catch(()=>null);
    if (persisted && typeof persisted === 'object') runtimeStore = persisted;
    await upsertModel({version:'CRATTO-CTRL-30.0-INTELLIGENCE-CORE',name:'Intelligence + value ensemble',status:'ACTIVE',metrics:{family:'poisson+elo+form'}});
  }
  scheduler = startScheduler({syncProvider:scheduledSync, refreshPredictions:scheduledPredictions, intervalMinutes:Number(process.env.SYNC_INTERVAL_MINUTES||30)});
  // Start listening first: the initial data load below is paced for the provider's rate limit and takes about a minute.
  app.listen(PORT, HOST, () => console.log(`Ultra Next Gen Pro Predictor listening on http://${HOST}:${PORT} | database=${dbEnabled} | scheduler=${scheduler.intervalMinutes}m`));
  // Populate a meaningful initial dataset on a fresh deployment (fetched in chunks of at most 10 days).
  try {
    const initial=readStore();
    if (!initial.meta.initialDataBootstrapAt || initial.matches.length < 20) {
      const now=new Date(), from=new Date(now.getTime()-60*86400000).toISOString().slice(0,10), to=new Date(now.getTime()+14*86400000).toISOString().slice(0,10);
      const data=await apiFetchMatchesRange(from,to);
      const store=readStore(); // re-read after the slow fetch so newer writes are not overwritten
      upsertMatches(store,data.matches||[]); store.meta.initialDataBootstrapAt=new Date().toISOString(); store.meta.lastProviderSync=new Date().toISOString(); store.meta.lastHistoricalSync=new Date().toISOString();
      const history=store.matches.filter(m=>m.status==='FINISHED');
      const upcoming=store.matches.filter(m=>['SCHEDULED','TIMED'].includes(m.status));
      for(const m of upcoming){const pred=ensemblePrediction(m,history); const i=store.predictions.findIndex(x=>x.matchId===pred.matchId); if(i>=0) store.predictions[i]=pred; else store.predictions.push(pred);}
      writeStore(store);
      console.log(`Initial football dataset loaded: ${store.matches.length} matches, ${history.length} finished, ${upcoming.length} upcoming.`);
    }
  } catch(e) { console.error('Initial football data bootstrap skipped:', e.message); }
}).catch(err => { console.error('Database initialization failed:', err); process.exit(1); });
