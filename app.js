const app = document.querySelector('#app');
const title = document.querySelector('#title');
const status = document.querySelector('#status');
let page = 'dashboard';
let authToken = localStorage.getItem('cctrl_token') || '';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(url, options = {}) {
  options.headers = { ...(options.headers || {}), ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) };
  const r = await fetch(url, options);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
}
function nav() { document.querySelectorAll('nav button').forEach(b => b.classList.toggle('active', b.dataset.page === page)); }
function shell(t, html) { title.textContent = t; app.innerHTML = html; nav(); }
function pct(x) { return `${(Number(x) * 100).toFixed(1)}%`; }
function setAuth(d) { authToken = d?.token || ''; if (authToken) localStorage.setItem('cctrl_token', authToken); else localStorage.removeItem('cctrl_token'); }

async function dashboard() {
  try {
    const [h, a, d, me] = await Promise.all([api('/api/health'), api('/api/analytics'), api('/api/model/diagnostics'), api('/api/auth/me')]);
    status.textContent = h.providerConfigured ? 'ENGINE ONLINE' : 'API KEY REQUIRED';
    shell('Command Centre', `
      <div class="grid">
        <div class="card"><div class="muted">Stored matches</div><div class="big">${a.matches}</div></div>
        <div class="card"><div class="muted">Predictions</div><div class="big">${a.predictions}</div></div>
        <div class="card"><div class="muted">Finished data</div><div class="big">${a.finished}</div></div>
        <div class="card"><div class="muted">Data quality</div><div class="big">${a.dataQuality}</div></div>
        <div class="card"><div class="muted">Model status</div><div class="big">${esc(d.status)}</div></div>
        <div class="card"><div class="muted">Account</div><div class="big">${me.authenticated ? esc(me.user.name) : 'Guest'}</div></div>
      </div>
      <div class="card panel"><h3>CRATTO CTRL Intelligence</h3><p class="muted">Transparent ensemble of Poisson goal modelling, Elo team strength, recent-form signals, calibration controls and diagnostics. Probabilities are estimates, not guarantees.</p><div class="actions"><button class="btn" onclick="location.hash='predictor'">Analyse Fixtures</button><button class="btn secondary" onclick="location.hash='strategy'">Strategy Lab</button><button class="btn secondary" onclick="location.hash='codes'">Slip Codes</button></div></div>
      <div class="card panel"><h3>Evaluation</h3><p class="muted">Walk-forward testing uses only information available before each historical match.</p><button class="btn secondary" id="bt">Run Backtest</button><div id="bout" class="result"></div></div>`);
    document.querySelector('#bt').onclick = async () => { const o = document.querySelector('#bout'); o.textContent = 'Running…'; try { const b = await api('/api/backtest'); o.innerHTML = b.evaluated ? `<b>${b.evaluated}</b> matches evaluated · Accuracy <b>${pct(b.accuracy)}</b> · Brier <b>${b.brierScore.toFixed(4)}</b> · Log loss <b>${b.logLoss.toFixed(4)}</b>` : 'Not enough stored historical data yet.'; } catch(e) { o.textContent = e.message; } };
  } catch (e) { status.textContent = 'OFFLINE'; shell('Command Centre', `<div class="empty">${esc(e.message)}</div>`); }
}

async function predictor() {
  status.textContent = 'READY';
  shell('Predictor', `<div class="toolbar"><select id="comp"><option value="">All available competitions</option><option value="PL">Premier League</option><option value="BL1">Bundesliga</option><option value="SA">Serie A</option><option value="PD">La Liga</option><option value="FL1">Ligue 1</option></select><button class="btn" id="run">Analyse upcoming matches</button></div><div class="note">Model outputs are statistical estimates. No accuracy or return is guaranteed.</div><div id="results" class="list"><div class="empty">Choose a competition if desired, then analyse upcoming fixtures.</div></div>`);
  document.querySelector('#run').onclick = async () => {
    const r = document.querySelector('#results'); r.innerHTML = '<div class="empty">Fetching fixtures and calculating probabilities…</div>';
    try {
      const c = document.querySelector('#comp').value;
      const d = await api('/api/predictions' + (c ? `?competitions=${encodeURIComponent(c)}` : ''));
      r.innerHTML = d.predictions.length ? d.predictions.map(p => `<div class="card match"><div><h3>${esc(p.home)} <span class="muted">vs</span> ${esc(p.away)}</h3><div class="muted">${esc(p.competition)} · ${new Date(p.kickoff).toLocaleString()}</div><p><span class="tag">${esc(p.recommendedMarket)}</span><span class="tag">${pct(p.confidence)} confidence</span><span class="tag risk-${p.risk.toLowerCase()}">${p.risk}</span></p><div class="bar"><div class="fill" style="width:${Math.min(100,p.confidence*100)}%"></div></div></div><div class="numbers"><b>EG ${p.expectedGoals}</b><div class="muted">H ${pct(p.probabilities.homeWin)} · D ${pct(p.probabilities.draw)} · A ${pct(p.probabilities.awayWin)}</div><div class="muted">O2.5 ${pct(p.probabilities.over25)} · BTTS ${pct(p.probabilities.btts)}</div><div class="muted">Elo H ${Math.round(p.elo.home)} · A ${Math.round(p.elo.away)} · Trend ${p.trend.home.direction}/${p.trend.away.direction}</div></div></div>`).join('') : '<div class="empty">No upcoming fixtures were returned by the provider.</div>';
    } catch (e) { r.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  };
}

function strategy() {
  shell('Strategy Lab', `<div class="card"><div class="toolbar"><input id="budget" type="number" min="0" value="150" placeholder="Budget"><input id="stake" type="number" min="0" value="1" placeholder="Stake"><input id="min" type="number" step=".01" min="0" max="1" value=".65" placeholder="Minimum probability"><input id="max" type="number" min="1" max="20" value="5" placeholder="Max selections"><select id="risk"><option value="ALL">All risk levels</option><option value="LOW">Low only</option><option value="MEDIUM">Medium only</option></select><button class="btn" id="build">Generate strategy</button></div><div class="note">Rules-based strategy generation. Outcomes and returns are not guaranteed.</div><div id="strategyOut" class="list"></div></div>`);
  document.querySelector('#build').onclick = async () => {
    const out = document.querySelector('#strategyOut'); out.innerHTML = '<div class="empty">Calculating…</div>';
    try {
      const body = { budget:+document.querySelector('#budget').value, stake:+document.querySelector('#stake').value, minConfidence:+document.querySelector('#min').value, maxSelections:+document.querySelector('#max').value, risk:document.querySelector('#risk').value };
      const d = await api('/api/strategy', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body) });
      window.lastSelections = d.selections;
      out.innerHTML = `<div class="grid"><div class="card">Budget <b>R${d.budget.toFixed(2)}</b></div><div class="card">Planned stake <b>R${d.plannedStake.toFixed(2)}</b></div><div class="card">Remaining <b>R${d.remaining.toFixed(2)}</b></div><div class="card">Selections <b>${d.selections.length}</b></div></div>` + (d.selections.length ? `<div class="actions"><button class="btn" id="saveSlip">Generate CRATTO Slip Code</button></div>` + d.selections.map(p => `<div class="card"><b>${esc(p.home)} vs ${esc(p.away)}</b><div class="muted">${esc(p.recommendedMarket)} · ${pct(p.confidence)} · ${p.risk}</div></div>`).join('') : '<div class="empty">No selections met the rules.</div>');
      const btn=document.querySelector('#saveSlip'); if(btn) btn.onclick=()=>saveSelections(d.selections, d.stake, d.budget);
    } catch(e) { out.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  };
}

async function saveSelections(selections, stake=0, budget=0) {
  if(!authToken) { location.hash='account'; return; }
  try { const d=await api('/api/slips',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({selections,stake,budget})}); alert(`CRATTO Slip Code: ${d.slip.code}`); location.hash='codes'; } catch(e) { alert(e.message); }
}

async function analytics() { const a = await api('/api/analytics'); shell('Analytics', `<div class="grid"><div class="card">Matches <b>${a.matches}</b></div><div class="card">Predictions <b>${a.predictions}</b></div><div class="card">Finished <b>${a.finished}</b></div><div class="card">Quality <b>${a.dataQuality}</b></div></div><div class="card panel"><h3>Provider sync</h3><p class="muted">Latest fixture sync: ${esc(a.lastProviderSync || 'Not yet')}</p><p class="muted">Latest historical sync: ${esc(a.lastHistoricalSync || 'Not yet')}</p></div>`); }
async function modelPage() { try { const [m,b,d] = await Promise.all([api('/api/model/summary'), api('/api/backtest?limit=500'), api('/api/model/diagnostics')]); shell('Model Intelligence', `<div class="grid"><div class="card"><div class="muted">Model</div><div class="big">24.0</div></div><div class="card"><div class="muted">Historical matches</div><div class="big">${m.historicalMatches}</div></div><div class="card"><div class="muted">Teams observed</div><div class="big">${m.teamsObserved}</div></div><div class="card"><div class="muted">Data quality</div><div class="big">${esc(m.dataQuality)}</div></div></div><div class="grid"><div class="card"><div class="muted">Recent accuracy</div><div class="big">${d.recentAccuracy==null?'—':pct(d.recentAccuracy)}</div></div><div class="card"><div class="muted">Prior accuracy</div><div class="big">${d.priorAccuracy==null?'—':pct(d.priorAccuracy)}</div></div><div class="card"><div class="muted">Drift</div><div class="big">${d.drift==null?'—':d.drift}</div></div><div class="card"><div class="muted">Status</div><div class="big">${esc(d.status)}</div></div></div><div class="card panel"><h3>Walk-forward evaluation</h3><p class="muted">Evaluated: ${b.evaluated} · Accuracy: ${b.accuracy == null ? '—' : pct(b.accuracy)} · Brier: ${b.brierScore == null ? '—' : b.brierScore.toFixed(4)} · Log loss: ${b.logLoss == null ? '—' : b.logLoss.toFixed(4)}</p></div>`); } catch(e) { shell('Model Intelligence', `<div class="empty">${esc(e.message)}</div>`); } }
async function strength() { try { const d=await api('/api/strengths'); shell('Team Strength', `<div class="card panel"><h3>Elo strength table</h3><p class="muted">Relative model signal from stored finished matches.</p><div class="list">${d.teams.slice(0,40).map((x,i)=>`<div class="card row"><b>#${i+1} ${esc(x.name)}</b><span>Elo ${x.elo} · ${x.matches} matches</span></div>`).join('')||'<div class="empty">No historical teams yet.</div>'}</div></div>`); } catch(e){shell('Team Strength',`<div class="empty">${esc(e.message)}</div>`)} }
async function calibration() { try { const d=await api('/api/calibration'); shell('Calibration', `<div class="card panel"><h3>Probability reliability</h3><div class="list">${d.bins.filter(x=>x.count).map(x=>`<div class="card row"><b>${Math.round(x.from*100)}–${Math.round(x.to*100)}%</b><span>n=${x.count} · observed ${pct(x.observed)}</span></div>`).join('')||'<div class="empty">Not enough historical data.</div>'}</div></div>`); } catch(e){shell('Calibration',`<div class="empty">${esc(e.message)}</div>`)} }
async function diagnostics() { try { const d=await api('/api/model/diagnostics'); shell('Diagnostics', `<div class="grid"><div class="card">Recent accuracy <b>${d.recentAccuracy==null?'—':pct(d.recentAccuracy)}</b></div><div class="card">Prior accuracy <b>${d.priorAccuracy==null?'—':pct(d.priorAccuracy)}</b></div><div class="card">Drift <b>${d.drift==null?'—':d.drift}</b></div><div class="card">Status <b>${esc(d.status)}</b></div></div>`); } catch(e){shell('Diagnostics',`<div class="empty">${esc(e.message)}</div>`)} }
async function portfolio() { try { const d=await api('/api/portfolio'); window.lastSelections=d.selections; shell('Portfolio Builder', `<div class="card panel"><h3>Correlation-aware portfolio</h3><p class="muted">Filtered for confidence and basic market correlation. This is not a guarantee of profitability.</p><div class="grid"><div class="card">Selections <b>${d.count}</b></div><div class="card">Model <b>v24</b></div></div><div class="actions">${d.count?'<button class="btn" id="savePortfolio">Generate CRATTO Slip Code</button>':''}</div><div class="list">${d.selections.map(p=>`<div class="card"><b>${esc(p.home)} vs ${esc(p.away)}</b><div class="muted">${esc(p.recommendedMarket)} · ${pct(p.confidence)} · ${p.risk}</div></div>`).join('')||'<div class="empty">No selections met the current portfolio rules.</div>'}</div></div>`); const b=document.querySelector('#savePortfolio'); if(b)b.onclick=()=>saveSelections(d.selections); } catch(e){shell('Portfolio Builder',`<div class="empty">${esc(e.message)}</div>`)} }
async function history() { const h = await api('/api/health'); shell('History', `<div class="card"><h3>Stored data</h3><p>${h.storedMatches} matches · ${h.storedPredictions} predictions</p><p class="muted">Historical evaluation becomes more meaningful as finished match data accumulates.</p></div>`); }

async function account() {
  const me=await api('/api/auth/me');
  if(me.authenticated) {
    shell('Account', `<div class="card panel"><h3>Welcome, ${esc(me.user.name)}</h3><p class="muted">${esc(me.user.email)}</p><p class="muted">Account created ${new Date(me.user.createdAt).toLocaleDateString()}</p><div class="actions"><button class="btn" id="logout">Log out</button><button class="btn secondary" onclick="location.hash='codes'">My Slip Codes</button></div><div class="note">Keep your login credentials private. CRATTO CTRL does not create or store bookmaker passwords.</div></div>`);
    document.querySelector('#logout').onclick=async()=>{await api('/api/auth/logout',{method:'POST'});setAuth(null);location.hash='account';};
    return;
  }
  shell('Account', `<div class="grid"><div class="card panel"><h3>Create account</h3><input id="rname" placeholder="Full name"><input id="remail" type="email" placeholder="Email"><input id="rpass" type="password" placeholder="Password (8+ characters)"><button class="btn" id="register">Create account</button><div id="rmsg" class="result"></div></div><div class="card panel"><h3>Login</h3><input id="lemail" type="email" placeholder="Email"><input id="lpass" type="password" placeholder="Password"><button class="btn" id="login">Login</button><div id="lmsg" class="result"></div></div></div>`);
  document.querySelector('#register').onclick=async()=>{try{const d=await api('/api/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:document.querySelector('#rname').value,email:document.querySelector('#remail').value,password:document.querySelector('#rpass').value})});setAuth(d);location.hash='account';}catch(e){document.querySelector('#rmsg').textContent=e.message;}};
  document.querySelector('#login').onclick=async()=>{try{const d=await api('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:document.querySelector('#lemail').value,password:document.querySelector('#lpass').value})});setAuth(d);location.hash='account';}catch(e){document.querySelector('#lmsg').textContent=e.message;}};
}

async function codes() {
  shell('Slip Codes', `<div class="grid"><div class="card panel"><h3>Load a CRATTO code</h3><input id="codeInput" placeholder="CCTRL-XXXXXXXX"><button class="btn" id="loadCode">Load code</button><div id="codeOut" class="result"></div></div><div class="card panel"><h3>My saved codes</h3><div id="myCodes" class="list">Loading…</div></div></div><div class="note">These are CRATTO CTRL share codes for saved prediction slips. They are not bookmaker-issued codes and cannot place a wager by themselves.</div>`);
  document.querySelector('#loadCode').onclick=async()=>{const o=document.querySelector('#codeOut');try{const d=await api('/api/slips/code/'+encodeURIComponent(document.querySelector('#codeInput').value.trim()));o.innerHTML=`<div class="card"><b>${esc(d.slip.code)}</b><p>${d.slip.selections.length} selections · ${new Date(d.slip.createdAt).toLocaleString()}</p>${d.slip.selections.map(s=>`<div class="muted">${esc(s.home)} vs ${esc(s.away)} · ${esc(s.recommendedMarket||'')}</div>`).join('')}</div>`}catch(e){o.textContent=e.message;}};
  try { const d=await api('/api/account/slips'); document.querySelector('#myCodes').innerHTML=d.slips.length?d.slips.map(s=>`<div class="card"><b>${esc(s.code)}</b><div class="muted">${s.selections.length} selections · ${new Date(s.createdAt).toLocaleString()}</div></div>`).join(''):'<div class="empty">Log in to see your saved codes.</div>'; } catch(e) { document.querySelector('#myCodes').innerHTML='<div class="empty">Log in to see your saved codes.</div>'; }
}

async function route() {
  page = location.hash.slice(1) || 'dashboard';
  try {
    if(page==='dashboard') await dashboard(); else if(page==='predictor') await predictor(); else if(page==='strategy') strategy(); else if(page==='analytics') await analytics(); else if(page==='history') await history(); else if(page==='model') await modelPage(); else if(page==='strength') await strength(); else if(page==='calibration') await calibration(); else if(page==='diagnostics') await diagnostics(); else if(page==='portfolio') await portfolio(); else if(page==='account') await account(); else if(page==='codes') await codes(); else await dashboard();
  } catch(e) { shell('Error', `<div class="empty">${esc(e.message)}</div>`); }
}
window.addEventListener('hashchange', route); route();
