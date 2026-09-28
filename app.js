const app = document.querySelector('#app');
const title = document.querySelector('#title');
const status = document.querySelector('#status');
let page = 'dashboard';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(url, options) {
  const r = await fetch(url, options);
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
}
function nav() { document.querySelectorAll('nav button').forEach(b => b.classList.toggle('active', b.dataset.page === page)); }
function shell(t, html) { title.textContent = t; app.innerHTML = html; nav(); }
function pct(x) { return `${(Number(x) * 100).toFixed(1)}%`; }

async function dashboard() {
  try {
    const [h, a] = await Promise.all([api('/api/health'), api('/api/analytics')]);
    status.textContent = h.providerConfigured ? 'ENGINE ONLINE' : 'API KEY REQUIRED';
    shell('Command Centre', `
      <div class="grid">
        <div class="card"><div class="muted">Stored matches</div><div class="big">${a.matches}</div></div>
        <div class="card"><div class="muted">Predictions</div><div class="big">${a.predictions}</div></div>
        <div class="card"><div class="muted">Finished data</div><div class="big">${a.finished}</div></div>
        <div class="card"><div class="muted">Data quality</div><div class="big">${a.dataQuality}</div></div>
      </div>
      <div class="card panel"><h3>Model status</h3><p class="muted">CRATTO-CTRL-11.0-Poisson uses recent venue-specific form, goal rates and a transparent Poisson probability model.</p><div class="actions"><button class="btn" onclick="location.hash='predictor'">Analyse Fixtures</button><button class="btn secondary" onclick="location.hash='strategy'">Open Strategy Lab</button></div></div>
      <div class="card panel"><h3>Evaluation</h3><p class="muted">Backtesting is walk-forward: each historical match is predicted using only information available before that match.</p><button class="btn secondary" id="bt">Run Backtest</button><div id="bout" class="result"></div></div>`);
    document.querySelector('#bt').onclick = async () => { const o = document.querySelector('#bout'); o.textContent = 'Running…'; try { const b = await api('/api/backtest'); o.innerHTML = b.evaluated ? `<b>${b.evaluated}</b> matches evaluated · Accuracy <b>${pct(b.accuracy)}</b> · Brier <b>${b.brierScore.toFixed(4)}</b>` : 'Not enough stored historical data yet.'; } catch(e) { o.textContent = e.message; } };
  } catch (e) { status.textContent = 'OFFLINE'; shell('Command Centre', `<div class="empty">${esc(e.message)}</div>`); }
}

async function predictor() {
  status.textContent = 'READY';
  shell('Predictor', `<div class="toolbar"><select id="comp"><option value="">All available competitions</option><option value="PL">Premier League</option><option value="BL1">Bundesliga</option><option value="SA">Serie A</option><option value="PD">La Liga</option><option value="FL1">Ligue 1</option></select><button class="btn" id="run">Analyse upcoming matches</button></div><div id="results" class="list"><div class="empty">Choose a competition if desired, then analyse upcoming fixtures.</div></div>`);
  document.querySelector('#run').onclick = async () => {
    const r = document.querySelector('#results'); r.innerHTML = '<div class="empty">Fetching fixtures and calculating probabilities…</div>';
    try {
      const c = document.querySelector('#comp').value;
      const d = await api('/api/predictions' + (c ? `?competitions=${encodeURIComponent(c)}` : ''));
      r.innerHTML = d.predictions.length ? d.predictions.map(p => `<div class="card match"><div><h3>${esc(p.home)} <span class="muted">vs</span> ${esc(p.away)}</h3><div class="muted">${esc(p.competition)} · ${new Date(p.kickoff).toLocaleString()}</div><p><span class="tag">${esc(p.recommendedMarket)}</span><span class="tag">${pct(p.confidence)} confidence</span><span class="tag risk-${p.risk.toLowerCase()}">${p.risk}</span></p><div class="bar"><div class="fill" style="width:${Math.min(100,p.confidence*100)}%"></div></div></div><div class="numbers"><b>EG ${p.expectedGoals}</b><div class="muted">H ${pct(p.probabilities.homeWin)} · D ${pct(p.probabilities.draw)} · A ${pct(p.probabilities.awayWin)}</div><div class="muted">O2.5 ${pct(p.probabilities.over25)} · BTTS ${pct(p.probabilities.btts)}</div></div></div>`).join('') : '<div class="empty">No upcoming fixtures were returned by the provider.</div>';
    } catch (e) { r.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  };
}

function strategy() {
  shell('Strategy Lab', `<div class="card"><div class="toolbar"><input id="budget" type="number" min="0" value="150" placeholder="Budget"><input id="stake" type="number" min="0" value="1" placeholder="Stake"><input id="min" type="number" step=".01" min="0" max="1" value=".65" placeholder="Minimum probability"><input id="max" type="number" min="1" max="20" value="5" placeholder="Max selections"><select id="risk"><option value="ALL">All risk levels</option><option value="LOW">Low only</option><option value="MEDIUM">Medium only</option></select><button class="btn" id="build">Generate strategy</button></div><div class="note">This tool generates a rules-based selection list from model probabilities. It does not guarantee outcomes or returns.</div><div id="strategyOut" class="list"></div></div>`);
  document.querySelector('#build').onclick = async () => {
    const out = document.querySelector('#strategyOut'); out.innerHTML = '<div class="empty">Calculating…</div>';
    try {
      const body = { budget:+budget.value, stake:+stake.value, minConfidence:+min.value, maxSelections:+max.value, risk:risk.value };
      const d = await api('/api/strategy', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body) });
      out.innerHTML = `<div class="grid"><div class="card">Budget <b>R${d.budget.toFixed(2)}</b></div><div class="card">Planned stake <b>R${d.plannedStake.toFixed(2)}</b></div><div class="card">Remaining <b>R${d.remaining.toFixed(2)}</b></div><div class="card">Selections <b>${d.selections.length}</b></div></div>` + (d.selections.length ? d.selections.map(p => `<div class="card"><b>${esc(p.home)} vs ${esc(p.away)}</b><div class="muted">${esc(p.recommendedMarket)} · ${pct(p.confidence)} · ${p.risk}</div></div>`).join('') : '<div class="empty">No selections met the rules.</div>');
    } catch(e) { out.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  };
}

async function analytics() { const a = await api('/api/analytics'); shell('Analytics', `<div class="grid"><div class="card">Matches <b>${a.matches}</b></div><div class="card">Predictions <b>${a.predictions}</b></div><div class="card">Finished <b>${a.finished}</b></div><div class="card">Quality <b>${a.dataQuality}</b></div></div><div class="card panel"><h3>Provider sync</h3><p class="muted">Latest fixture sync: ${esc(a.lastProviderSync || 'Not yet')}</p><p class="muted">Latest historical sync: ${esc(a.lastHistoricalSync || 'Not yet')}</p></div>`); }
async function history() { const h = await api('/api/health'); shell('History', `<div class="card"><h3>Stored data</h3><p>${h.storedMatches} matches · ${h.storedPredictions} predictions</p><p class="muted">Historical evaluation becomes more meaningful as finished match data accumulates.</p></div>`); }

async function route() { page = location.hash.slice(1) || 'dashboard'; try { if(page==='dashboard') await dashboard(); else if(page==='predictor') await predictor(); else if(page==='strategy') strategy(); else if(page==='analytics') await analytics(); else if(page==='history') await history(); else await dashboard(); } catch(e) { shell('Error', `<div class="empty">${esc(e.message)}</div>`); } }
window.addEventListener('hashchange', route); route();
