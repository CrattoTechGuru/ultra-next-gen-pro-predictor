import express from 'express';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '1mb' }));

const PORT = Number(process.env.PORT) || 10000;
const HOST = '0.0.0.0';
const API = 'https://api.football-data.org/v4';
const storePath = path.join(__dirname, 'data', 'store.json');

function readStore() {
  try { return JSON.parse(fs.readFileSync(storePath, 'utf8')); }
  catch { return { matches: [], predictions: [], evaluations: [], meta: {} }; }
}
function writeStore(store) {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2));
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
    modelVersion: 'CRATTO-CTRL-11.0-Poisson'
  };
}

function predictionForMatch(match, history) { return predict(match, history); }

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

app.get('/api/health', (req, res) => {
  const store = readStore();
  res.json({
    ok: true,
    service: 'CRATTO CTRL',
    model: 'CRATTO-CTRL-11.0-Poisson',
    providerConfigured: Boolean(process.env.FOOTBALL_DATA_API_KEY),
    storedMatches: store.matches.length,
    storedPredictions: store.predictions.length,
    timestamp: new Date().toISOString()
  });
});

app.get('/api/matches', async (req, res) => {
  try {
    const now = new Date();
    const from = req.query.dateFrom || now.toISOString().slice(0, 10);
    const to = req.query.dateTo || new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10);
    const q = new URLSearchParams({ dateFrom: from, dateTo: to });
    if (req.query.competitions) q.set('competitions', req.query.competitions);
    if (req.query.status) q.set('status', req.query.status);
    const data = await apiFetch('/matches?' + q.toString());
    const store = readStore();
    upsertMatches(store, data.matches || []);
    store.meta.lastProviderSync = new Date().toISOString();
    writeStore(store);
    res.json({ count: data.matches?.length || 0, matches: data.matches || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/predictions', async (req, res) => {
  try {
    const now = new Date();
    const from = req.query.dateFrom || now.toISOString().slice(0, 10);
    const to = req.query.dateTo || new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10);
    const q = new URLSearchParams({ dateFrom: from, dateTo: to, status: 'SCHEDULED' });
    if (req.query.competitions) q.set('competitions', req.query.competitions);
    const data = await apiFetch('/matches?' + q.toString());
    const store = readStore();
    upsertMatches(store, data.matches || []);
    const history = store.matches.filter(m => m.status === 'FINISHED');
    const predictions = (data.matches || []).map(m => predictionForMatch(m, history));
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
    const q = new URLSearchParams({ dateFrom: req.body.from, dateTo: req.body.to, status: 'FINISHED' });
    if (req.body.competitions) q.set('competitions', req.body.competitions);
    const data = await apiFetch('/matches?' + q.toString());
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
      .map(m => predictionForMatch(m, history))
      .filter(p => p.confidence >= minConfidence && (risk === 'ALL' || p.risk === risk))
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, maxSelections);
    res.json({
      budget, stake, minConfidence, risk,
      plannedStake: Math.min(budget, selections.length * stake),
      remaining: Math.max(0, budget - selections.length * stake),
      selections
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
    const p = predict(match, history);
    results.push(evaluatePrediction(p, match));
  }
  const accuracy = results.length ? results.filter(x => x.correct).length / results.length : null;
  const brier = results.length ? results.reduce((s, x) => s + x.brier, 0) / results.length : null;
  res.json({
    model: 'CRATTO-CTRL-11.0-Poisson',
    evaluated: results.length,
    accuracy,
    brierScore: brier,
    note: 'Walk-forward evaluation on stored finished matches. Results depend on the historical data available in the service.'
  });
});

app.get('/api/analytics', (req, res) => {
  const store = readStore();
  const finished = store.matches.filter(x => x.status === 'FINISHED').length;
  res.json({
    matches: store.matches.length,
    predictions: store.predictions.length,
    finished,
    model: 'CRATTO-CTRL-11.0-Poisson',
    dataQuality: finished >= 300 ? 'GOOD' : finished >= 100 ? 'FAIR' : 'LOW',
    lastProviderSync: store.meta?.lastProviderSync || null,
    lastHistoricalSync: store.meta?.lastHistoricalSync || null
  });
});

app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, HOST, () => console.log(`CRATTO CTRL listening on http://${HOST}:${PORT}`));
