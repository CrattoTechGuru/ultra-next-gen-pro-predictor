import express from 'express';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

import {
  dbEnabled,
  initDb,
  loadAppState,
  saveAppState,
  getUserByEmail,
  getUserById,
  createUser,
  createSession,
  getSession,
  deleteSession,
  listUserSlips,
  createSlip,
  getSlipByCode,
  adminStats,
  createJob,
  finishJob,
  recentJobs,
  upsertModel,
  listModels,
  addNotification,
  listNotifications,
  markNotificationRead,
  audit,
  usage,
  saveOdds,
  listOdds,
  saveEvaluation,
  evaluationSummary,
  createAlert,
  listAlerts
} from './db.js';

import {
  startScheduler,
  makeJobId
} from './operations.js';

import {
  impliedProbability,
  valueMetrics,
  marketProbability,
  rankValue
} from './intelligence.js';

import {
  makeRunId
} from './automation.js';

import {
  rateLimit,
  safeCompare
} from './security.js';

import {
  ensembleModels,
  walkForward,
  calibration as advancedCalibration,
  leaguePerformance
} from './advanced_models.js';

import {
  summarizeStore,
  coverage
} from './data_engine.js';

dotenv.config();

/* =========================================================
   CONFIGURATION
========================================================= */

const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY;
const API_FOOTBALL_BASE = 'https://v3.football.api-sports.io';

const PORT = Number(process.env.PORT) || 10000;
const HOST = '0.0.0.0';

const API = 'https://api.football-data.org/v4';

const __dirname =
  path.dirname(fileURLToPath(import.meta.url));

const app = express();

app.use(express.json({ limit: '1mb' }));

app.use(
  '/api/',
  rateLimit({
    windowMs: 60_000,
    max: 180
  })
);

/* =========================================================
   API-FOOTBALL COMPETITIONS
========================================================= */

const API_FOOTBALL_TARGETS = [
  {
    key: 'psl',
    label: 'Betway Premiership',
    search: 'Premier Soccer League',
    country: 'South Africa'
  },
  {
    key: 'motsepe',
    label: 'Motsepe Foundation Championship',
    search: '1st Division',
    country: 'South Africa'
  },
  {
    key: 'nedbank',
    label: 'Nedbank Cup',
    search: 'Nedbank Cup',
    country: 'South Africa'
  },
  {
    key: 'carling',
    label: 'Carling Knockout Cup',
    search: 'Carling Knockout',
    country: 'South Africa'
  },
  {
    key: 'caf_cl',
    label: 'TotalEnergies CAF Champions League',
    search: 'CAF Champions League'
  },
  {
    key: 'caf_conf',
    label: 'TotalEnergies CAF Confederation Cup',
    search: 'CAF Confederation Cup'
  },
  {
    key: 'afl',
    label: 'African Football League',
    search: 'African Football League'
  }
];

/* =========================================================
   API-FOOTBALL CLIENT
========================================================= */

async function apiFootball(endpoint, params = {}) {
  if (!API_FOOTBALL_KEY) {
    throw new Error(
      'API_FOOTBALL_KEY is not configured'
    );
  }

  const url = new URL(
    `${API_FOOTBALL_BASE}${endpoint}`
  );

  for (const [key, value] of Object.entries(params)) {
    if (
      value !== undefined &&
      value !== null &&
      value !== ''
    ) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url, {
    headers: {
      'x-apisports-key': API_FOOTBALL_KEY
    }
  });

  if (!response.ok) {
    throw new Error(
      `API-Football returned HTTP ${response.status}: ${await response.text()}`
    );
  }

  return response.json();
}

/* =========================================================
   SLIP HELPERS
========================================================= */

function generateSlipCode() {
  const chars =
    'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  let value = '';

  for (let i = 0; i < 8; i++) {
    value += chars[
      crypto.randomInt(0, chars.length)
    ];
  }

  return `UHP-${value}`;
}

function buildCopyableSlip(slip) {
  return [
    'ULTRA NEXT GEN PRO PREDICTOR',
    `SLIP: ${slip.code}`,
    '',
    ...slip.selections.map(
      (selection, index) =>
        `${index + 1}. ${selection.home} vs ${selection.away} — ${selection.marketLabel}`
    ),
    '',
    `Selections: ${slip.selectionCount}`,
    `Risk: ${slip.risk}`,
    `Model confidence: ${slip.averageConfidence}%`,
    '',
    'MODEL-GENERATED SELECTIONS — NO GUARANTEE OF RESULT'
  ].join('\n');
}

/* =========================================================
   STORE
========================================================= */

const storePath =
  path.join(
    __dirname,
    'data',
    'store.json'
  );

let runtimeStore = null;
let stateWriteTimer = null;

function readStore() {
  if (runtimeStore) {
    return runtimeStore;
  }

  try {
    const s = JSON.parse(
      fs.readFileSync(
        storePath,
        'utf8'
      )
    );

    s.matches ??= [];
    s.predictions ??= [];
    s.evaluations ??= [];
    s.meta ??= {};
    s.users ??= [];
    s.sessions ??= [];
    s.slips ??= [];
    s.generatedSlips ??= [];

    return s;

  } catch {
    return {
      matches: [],
      predictions: [],
      evaluations: [],
      meta: {},
      users: [],
      sessions: [],
      slips: [],
      generatedSlips: []
    };
  }
}

function writeStore(store) {
  runtimeStore = store;

  store.users ??= [];
  store.sessions ??= [];
  store.slips ??= [];
  store.generatedSlips ??= [];

  fs.mkdirSync(
    path.dirname(storePath),
    { recursive: true }
  );

  fs.writeFileSync(
    storePath,
    JSON.stringify(store, null, 2)
  );

  if (dbEnabled) {
    clearTimeout(stateWriteTimer);

    stateWriteTimer = setTimeout(
      () =>
        saveAppState(
          'runtime_store',
          store
        ).catch(error =>
          console.error(
            'State persistence failed:',
            error.message
          )
        ),
      250
    );
  }
}

/* =========================================================
   GENERAL UTILITIES
========================================================= */

function clamp(
  x,
  min = 0,
  max = 1
) {
  return Math.max(
    min,
    Math.min(max, x)
  );
}

function factorial(n) {
  let result = 1;

  for (let i = 2; i <= n; i++) {
    result *= i;
  }

  return result;
}

function poisson(k, lambda) {
  return (
    Math.exp(-lambda) *
    Math.pow(lambda, k) /
    factorial(k)
  );
}

function isoDate(date) {
  return new Date(date)
    .toISOString()
    .slice(0, 10);
}

function sleep(ms) {
  return new Promise(
    resolve => setTimeout(resolve, ms)
  );
}

/* =========================================================
   FOOTBALL-DATA.ORG RATE CONTROL
========================================================= */

const API_RATE_SAFE_MS =
  Number(
    process.env.FOOTBALL_DATA_MIN_REQUEST_MS ||
    6500
  );

let lastProviderRequestAt = 0;
let providerPause = Promise.resolve();

async function waitForProviderSlot() {
  providerPause =
    providerPause.then(async () => {
      const elapsed =
        Date.now() -
        lastProviderRequestAt;

      if (
        elapsed <
        API_RATE_SAFE_MS
      ) {
        await sleep(
          API_RATE_SAFE_MS -
          elapsed
        );
      }

      lastProviderRequestAt =
        Date.now();
    });

  return providerPause;
}

async function apiFetch(
  endpoint,
  attempt = 0
) {
  const token =
    process.env.FOOTBALL_DATA_API_KEY;

  if (!token) {
    throw new Error(
      'FOOTBALL_DATA_API_KEY is not configured on Render.'
    );
  }

  await waitForProviderSlot();

  const response =
    await fetch(
      API + endpoint,
      {
        headers: {
          'X-Auth-Token': token,
          Accept: 'application/json'
        }
      }
    );

  const reset =
    Number(
      response.headers.get(
        'X-RequestCounter-Reset'
      ) || 0
    );

  const remaining =
    Number(
      response.headers.get(
        'X-Requests-Available-Minute'
      ) || -1
    );

  if (response.status === 429) {
    if (attempt >= 2) {
      throw new Error(
        'football-data.org rate limit reached. Try again after the provider counter resets.'
      );
    }

    await sleep(
      Math.max(
        5000,
        (reset + 2) * 1000
      )
    );

    return apiFetch(
      endpoint,
      attempt + 1
    );
  }

  if (!response.ok) {
    const body =
      await response.text();

    throw new Error(
      `football-data.org returned HTTP ${response.status}: ${body.slice(0, 500)}`
    );
  }

  const data =
    await response.json();

  return {
    ...data,
    __provider: {
      remaining,
      reset
    }
  };
}

/* =========================================================
   DATE CHUNKING
   IMPORTANT: 9 DAYS TO AVOID THE 10-DAY ERROR
========================================================= */

function dateChunks(
  from,
  to,
  maxDays = 9
) {
  const output = [];

  let cursor =
    new Date(
      `${from}T00:00:00Z`
    );

  const end =
    new Date(
      `${to}T00:00:00Z`
    );

  while (cursor <= end) {
    const chunkStart =
      new Date(cursor);

    const chunkEnd =
      new Date(cursor);

    chunkEnd.setUTCDate(
      chunkEnd.getUTCDate() +
      maxDays -
      1
    );

    if (chunkEnd > end) {
      chunkEnd.setTime(
        end.getTime()
      );
    }

    output.push({
      from: isoDate(chunkStart),
      to: isoDate(chunkEnd)
    });

    cursor =
      new Date(chunkEnd);

    cursor.setUTCDate(
      cursor.getUTCDate() + 1
    );
  }

  return output;
}

/* =========================================================
   FOOTBALL-DATA.ORG COMPETITIONS
========================================================= */

async function discoverCompetitions() {
  const data =
    await apiFetch(
      '/competitions'
    );

  return (
    data.competitions || []
  )
    .filter(
      competition =>
        competition &&
        competition.code
    )
    .map(competition => ({
      id: competition.id,
      code: competition.code,
      name: competition.name,
      type: competition.type,
      plan:
        competition.plan ||
        null,
      area:
        competition.area?.name ||
        null,
      currentSeason:
        competition.currentSeason ||
        null
    }));
}

/* =========================================================
   MATCH UPSERT
========================================================= */

function upsertMatches(
  store,
  matches = []
) {
  for (const match of matches) {
    const index =
      store.matches.findIndex(
        item =>
          item.id === match.id
      );

    if (index >= 0) {
      store.matches[index] =
        match;
    } else {
      store.matches.push(
        match
      );
    }
  }

  store.matches.sort(
    (a, b) =>
      new Date(a.utcDate) -
      new Date(b.utcDate)
  );

  if (
    store.matches.length >
    10000
  ) {
    store.matches =
      store.matches.slice(-10000);
  }
}

/* =========================================================
   LIVE FOOTBALL-DATA.ORG
========================================================= */

async function syncLiveMatches() {
  const store =
    readStore();

  const competitions =
    (
      store.meta
        .providerCompetitions ||
      []
    ).filter(
      competition =>
        competition.code
    );

  const codes =
    competitions
      .map(c => c.code)
      .join(',');

  const q =
    new URLSearchParams({
      status: 'LIVE'
    });

  if (codes) {
    q.set(
      'competitions',
      codes
    );
  }

  const data =
    await apiFetch(
      '/matches?' +
      q.toString()
    );

  const matches =
    data.matches || [];

  upsertMatches(
    store,
    matches
  );

  const history =
    store.matches.filter(
      m =>
        m.status ===
        'FINISHED'
    );

  const predictions =
    matches.map(
      match =>
        ensemblePrediction(
          match,
          history
        )
    );

  for (const prediction of predictions) {
    const index =
      store.predictions.findIndex(
        item =>
          item.matchId ===
          prediction.matchId
      );

    if (index >= 0) {
      store.predictions[index] = {
        ...store.predictions[index],
        ...prediction,
        liveUpdatedAt:
          new Date().toISOString()
      };
    } else {
      store.predictions.push({
        ...prediction,
        liveUpdatedAt:
          new Date().toISOString()
      });
    }
  }

  store.predictions =
    store.predictions.slice(-5000);

  store.meta.lastLiveSync =
    new Date().toISOString();

  store.meta.liveMatches =
    matches.length;

  store.meta.liveSyncError =
    null;

  writeStore(store);

  return {
    matches,
    predictions,
    lastLiveSync:
      store.meta.lastLiveSync
  };
}

/* =========================================================
   PROVIDER DATASET
========================================================= */

async function syncProviderDataset({
  historyDays =
    Number(
      process.env.HISTORY_DAYS || 9
    ),

  upcomingDays =
    Number(
      process.env.UPCOMING_DAYS || 9
    )
} = {}) {

  const store =
    readStore();

  const competitions =
    await discoverCompetitions();

  store.meta.providerCompetitions =
    competitions;

  store.meta.providerCompetitionCount =
    competitions.length;

  const today =
    new Date();

  const upcomingTo =
    isoDate(
      new Date(
        today.getTime() +
        upcomingDays *
        86400000
      )
    );

  const codes =
    competitions
      .map(c => c.code)
      .join(',');

  let syncedUpcoming = 0;
  let syncedHistory = 0;

  const errors = [];

  for (
    const chunk of dateChunks(
      isoDate(today),
      upcomingTo,
      9
    )
  ) {

    try {

      const q =
        new URLSearchParams({
          dateFrom: chunk.from,
          dateTo: chunk.to
        });

      if (codes) {
        q.set(
          'competitions',
          codes
        );
      }

      const data =
        await apiFetch(
          '/matches?' +
          q.toString()
        );

      const matches =
        data.matches || [];

      upsertMatches(
        store,
        matches
      );

      syncedUpcoming +=
        matches.length;

    } catch (error) {

      errors.push({
        scope: 'upcoming',
        ...chunk,
        error: error.message
      });
    }
  }

  for (const competition of competitions) {

    try {

      const seasonYear =
        competition
          .currentSeason
          ?.startDate
          ? new Date(
              competition
                .currentSeason
                .startDate
            ).getUTCFullYear()
          : new Date()
              .getUTCFullYear();

      const data =
        await apiFetch(
          `/competitions/${encodeURIComponent(competition.code)}/matches?season=${seasonYear}`
        );

      const matches =
        data.matches || [];

      upsertMatches(
        store,
        matches
      );

      syncedHistory +=
        matches.filter(
          m =>
            m.status ===
            'FINISHED'
        ).length;

    } catch (error) {

      errors.push({
        scope: 'history',
        competition:
          competition.code,
        error: error.message
      });
    }
  }

  const nowIso =
    new Date().toISOString();

  store.meta.lastProviderSync =
    nowIso;

  store.meta.lastHistoricalSync =
    nowIso;

  store.meta.lastSyncErrors =
    errors.slice(-50);

  store.meta.lastSyncStats = {
    syncedUpcoming,
    syncedHistory,
    competitions:
      competitions.length,
    historyDays,
    upcomingDays
  };

  writeStore(store);

  return {
    competitions,
    syncedUpcoming,
    syncedHistory,
    errors,
    stats:
      summarizeStore(store)
  };
}

/* =========================================================
   API-FOOTBALL COMPETITION RESOLVER
========================================================= */

function normalizeName(
  value = ''
) {
  return String(value)
    .toLowerCase()
    .replace(
      /[^a-z0-9]+/g,
      ' '
    )
    .trim();
}

async function resolveApiFootballCompetitions(
  store
) {
  store.meta.apiFootballCompetitions ??= {};

  for (
    const target of
    API_FOOTBALL_TARGETS
  ) {

    if (
      store.meta
        .apiFootballCompetitions
        [target.key]?.id
    ) {
      continue;
    }

    try {

      const params = {
        search:
          target.search
      };

      if (target.country) {
        params.country =
          target.country;
      }

      const data =
        await apiFootball(
          '/leagues',
          params
        );

      const response =
        data.response || [];

      const wanted =
        normalizeName(
          target.search
        );

      let found =
        response.find(
          item =>
            normalizeName(
              item.league?.name
            ) === wanted
        );

      if (
        !found &&
        response.length
      ) {
        found =
          response.find(item => {
            const name =
              normalizeName(
                item.league?.name
              );

            return (
              name.includes(wanted) ||
              wanted.includes(name)
            );
          });
      }

      if (!found) {
        console.warn(
          `API-Football competition not found: ${target.label}`
        );
        continue;
      }

      const seasons =
        found.seasons || [];

      const current =
        seasons.find(
          season =>
            season.current
        ) ||
        [...seasons].sort(
          (a, b) =>
            Number(b.year) -
            Number(a.year)
        )[0];

      store.meta
        .apiFootballCompetitions
        [target.key] = {
          id:
            found.league.id,
          name:
            found.league.name,
          country:
            found.country?.name ||
            target.country ||
            null,
          season:
            current?.year ||
            new Date()
              .getUTCFullYear(),
          label:
            target.label,
          resolvedAt:
            new Date().toISOString()
        };

      console.log(
        `API-Football mapped ${target.label} -> ${found.league.name} (${found.league.id}), season ${current?.year || 'unknown'}`
      );

    } catch (error) {

      console.error(
        `API-Football lookup failed for ${target.label}:`,
        error.message
      );
    }
  }

  return (
    store.meta
      .apiFootballCompetitions
  );
}

/* =========================================================
   API-FOOTBALL FIXTURE NORMALIZATION
========================================================= */

function apiFootballStatus(
  short = ''
) {

  const live =
    new Set([
      '1H',
      'HT',
      '2H',
      'ET',
      'BT',
      'INT',
      'LIVE'
    ]);

  const finished =
    new Set([
      'FT',
      'AET',
      'PEN',
      'AWD',
      'WO'
    ]);

  const cancelled =
    new Set([
      'PST',
      'CANC',
      'ABD'
    ]);

  if (live.has(short)) {
    return 'IN_PLAY';
  }

  if (finished.has(short)) {
    return 'FINISHED';
  }

  if (cancelled.has(short)) {
    return 'CANCELLED';
  }

  return 'SCHEDULED';
}

function normalizeApiFootballFixture(
  item,
  competition
) {

  const fixture =
    item.fixture || {};

  const teams =
    item.teams || {};

  const goals =
    item.goals || {};

  const league =
    item.league || {};

  if (
    !fixture.id ||
    !teams.home?.id ||
    !teams.away?.id
  ) {
    return null;
  }

  const status =
    apiFootballStatus(
      fixture.status?.short
    );

  return {
    id:
      `apifb-${fixture.id}`,

    provider:
      'api-football',

    providerFixtureId:
      fixture.id,

    utcDate:
      fixture.date,

    status,

    homeTeam: {
      id:
        `apifb-team-${teams.home.id}`,
      name:
        teams.home.name ||
        'Home'
    },

    awayTeam: {
      id:
        `apifb-team-${tea
