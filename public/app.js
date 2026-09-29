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
function nav() { document.querySelectorAll('#sideNav button').forEach(b => b.classList.toggle('active', b.dataset.page === page)); }
function shell(t, html) { title.textContent = t; app.innerHTML = html; nav(); }
function pct(x) { return `${(Number(x) * 100).toFixed(1)}%`; }
function setAuth(d) { authToken = d?.token || ''; if (authToken) localStorage.setItem('cctrl_token', authToken); else localStorage.removeItem('cctrl_token'); }

async function dashboard() {
  try {
    const [h, a, d, me, slips] = await Promise.all([
      api('/api/health'), api('/api/analytics'), api('/api/model/diagnostics'),
      api('/api/auth/me'), api('/api/account/slips').catch(() => ({slips:[]}))
    ]);
    status.textContent = h.providerConfigured ? 'ENGINE ONLINE' : 'API KEY REQUIRED';
    const recent = (slips.slips || []).slice(0,3);
    const setup = [
      ['01','Create your workspace','Account access is active.','account'],
      ['02','Analyse fixtures','Run the prediction engine on available fixtures.','predictor'],
      ['03','Build a strategy','Set your budget and selection rules.','strategy'],
      ['04','Review evidence','Use backtesting, calibration and diagnostics before relying on model outputs.','intelligence']
    ];
    shell('Command Centre', `
      <div class="hero-panel card">
        <div><div class="eyebrow">CONTROL CENTRE</div><h2>Welcome, ${esc(me.user?.name || 'Operator')}</h2><p class="muted">Your football intelligence workspace is ready. Use the menu to move between prediction, strategy, evaluation and system controls.</p></div>
        <div class="actions"><button class="btn" onclick="location.hash='predictor'">Analyse fixtures</button><button class="btn secondary" onclick="location.hash='strategy'">Open Strategy Lab</button></div>
      </div>
      <div class="grid">
        <div class="card metric"><div class="muted">Stored matches</div><div class="big">${a.matches}</div><span>Data coverage</span></div>
        <div class="card metric"><div class="muted">Predictions</div><div class="big">${a.predictions}</div><span>Engine activity</span></div>
        <div class="card metric"><div class="muted">Finished data</div><div class="big">${a.finished}</div><span>Evaluation base</span></div>
        <div class="card metric"><div class="muted">Data quality</div><div class="big">${esc(a.dataQuality)}</div><span>Current assessment</span></div>
        <div class="card metric"><div class="muted">Model status</div><div class="big">${esc(d.status)}</div><span>Diagnostics</span></div>
        <div class="card metric"><div class="muted">Provider</div><div class="big">${h.providerConfigured ? 'ONLINE' : 'SETUP'}</div><span>${h.providerConfigured ? 'Football data connected' : 'API key required'}</span></div>
      </div>
      <div class="split-grid">
        <div class="card panel"><div class="section-head"><div><div class="eyebrow">WORKSPACE FLOW</div><h3>Getting started</h3></div><span class="tag">${setup.length}/4 ready</span></div>
          <div class="steps">${setup.map(x=>`<button class="step" onclick="location.hash='${x[3]}'"><b>${x[0]}</b><span><strong>${x[1]}</strong><small>${x[2]}</small></span><i>›</i></button>`).join('')}</div>
        </div>
        <div class="card panel"><div class="section-head"><div><div class="eyebrow">ACTIVITY</div><h3>Recent slip codes</h3></div><button class="btn secondary small" onclick="location.hash='codes'">View all</button></div>
          <div class="list">${recent.length ? recent.map(s=>`<div class="activity-row"><div><b>${esc(s.code)}</b><small>${s.selections.length} selections · ${new Date(s.createdAt).toLocaleString()}</small></div><span class="tag">${esc(s.status || 'DRAFT')}</span></div>`).join('') : '<div class="empty">No saved slips yet. Generate one from Strategy Lab or Portfolio.</div>'}</div>
        </div>
      </div>
      <div class="card panel"><div class="section-head"><div><div class="eyebrow">MODEL GOVERNANCE</div><h3>Evidence before action</h3></div><span class="tag">No guarantees</span></div><p class="muted">CRATTO CTRL reports statistical estimates. Historical accuracy, Brier score, log loss and calibration should be reviewed as the data grows. No model output guarantees a match result or financial return.</p><div class="actions"><button class="btn secondary" onclick="location.hash='diagnostics'">Open diagnostics</button><button class="btn secondary" onclick="location.hash='calibration'">Check calibration</button><button class="btn secondary" onclick="location.hash='history'">View history</button></div></div>
      <div class="card panel"><h3>Evaluation</h3><p class="muted">Walk-forward testing uses only information available before each historical match.</p><button class="btn secondary" id="bt">Run Backtest</button><div id="bout" class="result"></div></div>`);
    document.querySelector('#bt').onclick = async () => { const o = document.querySelector('#bout'); o.textContent = 'Running…'; try { const b = await api('/api/backtest'); o.innerHTML = b.evaluated ? `<b>${b.evaluated}</b> matches evaluated · Accuracy <b>${pct(b.accuracy)}</b> · Brier <b>${b.brierScore.toFixed(4)}</b> · Log loss <b>${b.logLoss.toFixed(4)}</b>` : 'Not enough stored historical data yet.'; } catch(e) { o.textContent = e.message; } };
  } catch (e) { status.textContent = 'OFFLINE'; shell('Command Centre', `<div class="empty">${esc(e.message)}</div>`); }
}

async function predictor() {
  status.textContent = 'READY';
  shell('Predictor', `<div class="toolbar"><select id="comp"><option value="">All available competitions</option><option value="PL">Premier League</option><option value="BL1">Bundesliga</option><option value="SA">Serie A</option><option value="PD">La Liga</option><option value="FL1">Ligue 1</option></select><button class="btn" id="run">Analyse upcoming matches</button><button class="btn secondary" id="refreshData">Refresh football data</button></div><div class="note">Model outputs are statistical estimates. No accuracy or return is guaranteed.</div><div id="results" class="list"><div class="empty">Choose a competition if desired, then analyse upcoming fixtures.</div></div>`);
  document.querySelector('#refreshData').onclick = async () => { const o=document.querySelector('#results'); o.innerHTML='<div class="empty">Refreshing football dataset…</div>'; try { const r=await api('/api/data/refresh',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({competitions:document.querySelector('#comp').value})}); o.innerHTML=`<div class="card">Synced <b>${r.synced}</b> matches · <b>${r.teams}</b> teams · <b>${r.upcoming}</b> upcoming · <b>${r.finished}</b> historical.</div>`; } catch(e){o.innerHTML=`<div class="empty">${esc(e.message)}</div>`;} };
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
  shell('Slip Codes', `<div class="grid"><div class="card panel"><h3>Load a CRATTO code</h3><input id="codeInput" placeholder="CCTRL-XXXXXXXX"><button class="btn" id="loadCode">Load code</button><div id="codeOut" class="result"></div></div><div class="card panel"><h3>My saved codes</h3><div id="myCodes" class="list">Loading…</div></div></div><div class="note">CRATTO codes are app share codes. Betway and Hollywoodbets booking codes must be generated by their own platforms.</div>`);
  document.querySelector('#loadCode').onclick=async()=>{
    const o=document.querySelector('#codeOut');
    try {
      const d=await api('/api/slips/code/'+encodeURIComponent(document.querySelector('#codeInput').value.trim()));
      window.loadedSlip=d.slip;
      o.innerHTML=`<div class="card"><b>${esc(d.slip.code)}</b><p>${d.slip.selections.length} selections · ${new Date(d.slip.createdAt).toLocaleString()}</p><div class="actions"><button class="btn secondary" id="betwayReady">Betway-ready</button><button class="btn secondary" id="hollywoodReady">Hollywoodbets-ready</button></div><pre id="bookmakerOut" class="result"></pre>${d.slip.selections.map(s=>`<div class="muted">${esc(s.home)} vs ${esc(s.away)} · ${esc(s.recommendedMarket||'')}</div>`).join('')}</div>`;
      document.querySelector('#betwayReady').onclick=async()=>{document.querySelector('#bookmakerOut').textContent=await bookmakerPreview(d.slip.selections,'BETWAY');};
      document.querySelector('#hollywoodReady').onclick=async()=>{document.querySelector('#bookmakerOut').textContent=await bookmakerPreview(d.slip.selections,'HOLLYWOODBETS');};
    } catch(e){o.textContent=e.message;}
  };
  try {
    const d=await api('/api/account/slips');
    document.querySelector('#myCodes').innerHTML=d.slips.length?d.slips.map(s=>`<div class="card"><b>${esc(s.code)}</b><div class="muted">${s.selections.length} selections · ${esc(s.bookmaker||'CRATTO')} · ${new Date(s.createdAt).toLocaleString()}</div><div class="actions"><button class="btn secondary" data-bm="BETWAY" data-id="${esc(s.id)}">Betway-ready</button><button class="btn secondary" data-bm="HOLLYWOODBETS" data-id="${esc(s.id)}">Hollywoodbets-ready</button></div><pre class="result" id="bm-${esc(s.id)}"></pre></div>`).join(''):'<div class="empty">Log in to see your saved codes.</div>';
    document.querySelectorAll('[data-bm]').forEach(btn=>btn.onclick=async()=>{try{const d=await api('/api/slips/'+encodeURIComponent(btn.dataset.id)+'/bookmaker',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({bookmaker:btn.dataset.bm})});document.querySelector('#bm-'+CSS.escape(btn.dataset.id)).textContent=[d.title,'',...d.selections.map(x=>`${x.leg}. ${x.fixture} — ${x.market}`),'',d.instructions].join('\n');}catch(e){alert(e.message);}});
  } catch(e) { document.querySelector('#myCodes').innerHTML='<div class="empty">Log in to see your saved codes.</div>'; }
}


async function operations(){
  try { const d=await api('/api/operations/status'); const ds=await api('/api/data/status'); shell('Operations', `<div class="grid"><div class="card">Scheduler <b>${d.scheduler?`ACTIVE · ${d.scheduler.intervalMinutes} min`:'OFF'}</b></div><div class="card">Provider sync <b>${d.lastProviderSync?new Date(d.lastProviderSync).toLocaleString():'—'}</b></div><div class="card">Historical sync <b>${d.lastHistoricalSync?new Date(d.lastHistoricalSync).toLocaleString():'—'}</b></div><div class="card">Teams tracked <b>${ds.teams}</b></div><div class="card">Upcoming <b>${ds.scheduled}</b></div><div class="card">Finished <b>${ds.finished}</b></div></div><div class="card panel"><h3>Data pipeline</h3><p class="muted">Operations status is available to all signed-in users. Administrative controls remain protected separately.</p><button class="btn" id="refreshOpsData">Refresh football data</button><div id="opsOut" class="result"></div></div>`); document.querySelector('#refreshOpsData').onclick=async()=>{const o=document.querySelector('#opsOut');o.textContent='Refreshing…';try{o.textContent=JSON.stringify(await api('/api/data/refresh',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),null,2)}catch(e){o.textContent=e.message}}; } catch(e){shell('Operations',`<div class="empty">${esc(e.message)}</div>`)}
}

async function models(){ try { const d=await api('/api/models'); shell('Model Registry', `<div class="card panel"><h3>Registered models</h3><div class="list">${d.models.map(m=>`<div class="card row"><b>${esc(m.version)}</b><span>${esc(m.name)} · ${esc(m.status)}</span></div>`).join('')||'<div class="empty">No models registered.</div>'}</div></div>`); } catch(e){shell('Model Registry',`<div class="empty">${esc(e.message)}</div>`)} }
async function notifications(){ try { const d=await api('/api/notifications'); shell('Notifications', `<div class="card panel"><h3>Account notifications</h3><div class="list">${d.notifications.map(n=>`<div class="card"><b>${esc(n.title)}</b><div>${esc(n.body)}</div><div class="muted">${new Date(n.createdAt).toLocaleString()}</div>${!n.readAt?`<button class="btn secondary" data-read="${esc(n.id)}">Mark read</button>`:''}</div>`).join('')||'<div class="empty">No notifications.</div>'}</div></div>`); document.querySelectorAll('[data-read]').forEach(b=>b.onclick=async()=>{await api('/api/notifications/'+encodeURIComponent(b.dataset.read)+'/read',{method:'POST'});notifications();}); } catch(e){shell('Notifications',`<div class="empty">Log in to view notifications.</div>`)} }
async function platform(){ try { const d=await api('/api/platform/status'); shell('Platform', `<div class="grid"><div class="card">Platform <b>${esc(d.status)}</b></div><div class="card">Database <b>${esc(d.database)}</b></div><div class="card">Football provider <b>${d.providerConfigured?'CONFIGURED':'MISSING'}</b></div><div class="card">Node <b>${esc(d.node)}</b></div><div class="card">Uptime <b>${d.uptimeSeconds}s</b></div><div class="card">Stored matches <b>${d.storedMatches}</b></div></div><div class="note">V20 includes API rate limiting, automated operations, model registry, audit hooks and platform health monitoring.</div>`); } catch(e){shell('Platform',`<div class="empty">${esc(e.message)}</div>`)} }


async function intelligence(){
  try{
    const d=await api('/api/intelligence/overview?limit=500');
    const wf=d.walkForward;
    shell('Intelligence Core', `<div class="grid">
      <div class="card"><div class="muted">Historical matches</div><div class="big">${d.data.finished}</div></div>
      <div class="card"><div class="muted">Teams observed</div><div class="big">${d.data.teams}</div></div>
      <div class="card"><div class="muted">Walk-forward sample</div><div class="big">${wf.evaluated}</div></div>
      <div class="card"><div class="muted">Accuracy</div><div class="big">${wf.accuracy==null?'—':pct(wf.accuracy)}</div></div>
      <div class="card"><div class="muted">Brier</div><div class="big">${wf.brier==null?'—':Number(wf.brier).toFixed(4)}</div></div>
      <div class="card"><div class="muted">Log loss</div><div class="big">${wf.logLoss==null?'—':Number(wf.logLoss).toFixed(4)}</div></div>
    </div>
    <div class="card panel"><h3>Model stack</h3><p class="muted">Poisson + Dixon-Coles-style low-score adjustment + Elo + recent form, combined with adaptive weights based on historical sample size.</p><div class="actions"><button class="btn" id="runInt">Run walk-forward evaluation</button><button class="btn secondary" id="cov">Refresh data coverage</button></div><div id="intOut" class="result"></div></div>
    <div class="grid"><div class="card"><h3>Calibration</h3><div class="list">${d.calibration.filter(x=>x.count).map(x=>`<div class="row"><span>${pct(x.from)}–${pct(x.to)}</span><b>${x.count} · observed ${pct(x.observed)}</b></div>`).join('')||'<div class="empty">Not enough historical evaluations.</div>'}</div></div>
    <div class="card"><h3>Competition performance</h3><div class="list">${d.leaguePerformance.slice(0,10).map(x=>`<div class="row"><span>${esc(x.competition)}</span><b>${x.n} · ${pct(x.accuracy)}</b></div>`).join('')||'<div class="empty">Not enough data.</div>'}</div></div></div>`);
    document.querySelector('#runInt').onclick=async()=>{const o=document.querySelector('#intOut');o.textContent='Evaluating historical matches…';try{const r=await api('/api/intelligence/backtest?limit=500');o.textContent=`${r.evaluated} evaluated · accuracy ${r.accuracy==null?'—':pct(r.accuracy)} · Brier ${r.brier==null?'—':r.brier.toFixed(4)} · log loss ${r.logLoss==null?'—':r.logLoss.toFixed(4)}`;}catch(e){o.textContent=e.message;}};
    document.querySelector('#cov').onclick=async()=>{const o=document.querySelector('#intOut');try{const r=await api('/api/intelligence/coverage');o.textContent=`${r.summary.finished} finished matches across ${r.summary.teams} teams.`;}catch(e){o.textContent=e.message;}};
  }catch(e){shell('Intelligence Core',`<div class="empty">${esc(e.message)}</div>`)}
}

async function master() {
  status.textContent = 'MASTER CONTROL';
  shell('Master Console', `
    <div class="hero-panel card"><div><div class="eyebrow">ULTRA NEXT GEN PRO PREDICTOR V50</div><h2>Unified intelligence control</h2><p class="muted">One workspace for data, prediction, strategy, evaluation, risk, slips, operations and account controls. V50 consolidates the platform; it does not guarantee outcomes.</p></div><div class="actions"><button class="btn" id="refreshMaster">Refresh system</button><button class="btn secondary" onclick="location.hash='predictor'">Open Predictor</button></div></div>
    <div id="masterGrid" class="grid"><div class="empty">Loading system intelligence…</div></div>
    <div class="split-grid">
      <div class="card panel"><div class="section-head"><div><div class="eyebrow">CONTROL PATH</div><h3>Full platform</h3></div></div><div class="master-links">
        ${[['predictor','Prediction engine'],['strategy','Strategy Lab'],['portfolio','Risk & portfolio'],['codes','Slip builder & codes'],['history','Prediction history'],['analytics','Analytics'],['intelligence','Intelligence Core'],['model','Model performance'],['strength','Team strength'],['calibration','Calibration'],['diagnostics','Diagnostics'],['models','Model registry'],['notifications','Notifications'],['operations','Operations'],['platform','Platform'],['account','Account'],['admin','Admin']].map(([p,n])=>`<button class="step" onclick="location.hash='${p}'"><span><strong>${n}</strong><small>Open module</small></span><i>›</i></button>`).join('')}
      </div></div>
      <div class="card panel"><div class="section-head"><div><div class="eyebrow">OPERATING PRINCIPLES</div><h3>Evidence controls</h3></div></div><div class="list"><div class="note">Predictions are probabilities, not certainties.</div><div class="note">Historical metrics should be interpreted with sample size and calibration.</div><div class="note">Bookmaker-ready outputs are not official bookmaker-issued codes.</div><div class="note">Risk tools model scenarios; they cannot remove financial risk.</div><div class="note">Data freshness depends on the configured football-data provider plan.</div></div></div>
    </div>`);
  const load = async () => {
    const g=document.querySelector('#masterGrid'); g.innerHTML='<div class="empty">Refreshing…</div>';
    try {
      const [h,a,d,c,e,o,p,n] = await Promise.all([
        api('/api/health'), api('/api/analytics'), api('/api/model/diagnostics'), api('/api/intelligence/coverage'), api('/api/evaluations/summary').catch(()=>({})), api('/api/operations/status').catch(()=>({})), api('/api/platform/status').catch(()=>({})), api('/api/notifications').catch(()=>({notifications:[]}))
      ]);
      const cards=[
        ['Provider',h.providerConfigured?'CONNECTED':'CONFIGURE',h.providerConfigured?'Football data API configured':'Add FOOTBALL_DATA_API_KEY on Render'],
        ['Matches',a.matches ?? 0,`${a.finished ?? 0} finished`],
        ['Predictions',a.predictions ?? 0,'Stored engine outputs'],
        ['Data quality',a.dataQuality ?? '—','Current assessment'],
        ['Model',d.status ?? '—',`${d.sampleSize ?? 0} evaluation samples`],
        ['Coverage',c.summary?.competitions ?? 0,`${c.summary?.teams ?? 0} teams tracked`],
        ['Evaluations',e.evaluations ?? e.count ?? 0,'Recorded model evaluations'],
        ['Operations',o.running ? 'RUNNING' : 'READY','Scheduler/operations state'],
        ['Platform',p.status ?? 'ONLINE','System status'],
        ['Alerts',n.notifications?.length ?? 0,'Notifications available']
      ];
      g.innerHTML=cards.map(x=>`<div class="card metric"><div class="muted">${esc(x[0])}</div><div class="big">${esc(x[1])}</div><span>${esc(x[2])}</span></div>`).join('');
      status.textContent=h.providerConfigured?'ENGINE ONLINE':'API KEY REQUIRED';
    } catch(err) { g.innerHTML=`<div class="empty">${esc(err.message)}</div>`; status.textContent='DEGRADED'; }
  };
  document.querySelector('#refreshMaster').onclick=load;
  await load();
}

async function route() {
  page = location.hash.slice(1) || 'dashboard';
  try {
    if(page==='dashboard') await dashboard(); else if(page==='master') await master(); else if(page==='predictor') await predictor(); else if(page==='strategy') strategy(); else if(page==='analytics') await analytics(); else if(page==='history') await history(); else if(page==='model') await modelPage(); else if(page==='strength') await strength(); else if(page==='calibration') await calibration(); else if(page==='diagnostics') await diagnostics(); else if(page==='portfolio') await portfolio(); else if(page==='account') await account(); else if(page==='codes') await codes(); else if(page==='admin') await adminPage(); else if(page==='operations') await operations(); else if(page==='models') await models(); else if(page==='notifications') await notifications(); else if(page==='platform') await platform(); else if(page==='intelligence') await intelligence(); else await dashboard();
  } catch(e) { shell('Error', `<div class="empty">${esc(e.message)}</div>`); }
}
let authMode = 'login';
const authScreen = document.querySelector('#authScreen');
const appShell = document.querySelector('#appShell');
const authForm = document.querySelector('#authForm');
const authError = document.querySelector('#authError');
const nameField = document.querySelector('#nameField');
const authTitle = document.querySelector('#authTitle');
const authSubtitle = document.querySelector('#authSubtitle');
const authSubmit = document.querySelector('#authSubmit');
function setMode(mode){
  authMode=mode;
  const signup=mode==='signup';
  document.querySelector('#loginTab').classList.toggle('active',!signup);
  document.querySelector('#signupTab').classList.toggle('active',signup);
  nameField.classList.toggle('hidden',!signup);
  document.querySelector('#authName').required=signup;
  authTitle.textContent=signup?'Create your account':'Welcome back';
  authSubtitle.textContent=signup?'Create your Ultra Next Gen Pro Predictor workspace to continue.':'Sign in to your Ultra Next Gen Pro Predictor workspace.';
  authSubmit.textContent=signup?'Create account':'Login';
  document.querySelector('#authPassword').autocomplete=signup?'new-password':'current-password';
  authError.textContent='';
}
async function showWorkspace(){
  authScreen.classList.add('hidden'); appShell.classList.remove('hidden');
  const me=await api('/api/auth/me');
  if(!me.authenticated){ return showAuth(); }
  const u=me.user||{};
  document.querySelector('#drawerUser').innerHTML=`<b>${esc(u.name||'User')}</b><small>${esc(u.email||'')}</small>`;
  document.querySelector('#userBtn').textContent=(u.name||'Account').split(' ')[0];
  window.addEventListener('hashchange', route);
  route();
}
function showAuth(){ authScreen.classList.remove('hidden'); appShell.classList.add('hidden'); setMode(authMode); }
document.querySelector('#loginTab').onclick=()=>setMode('login');
document.querySelector('#signupTab').onclick=()=>setMode('signup');
authForm.addEventListener('submit',async e=>{
  e.preventDefault(); authError.textContent=''; authSubmit.disabled=true; authSubmit.textContent='Please wait…';
  try{
    const body={email:document.querySelector('#authEmail').value.trim(),password:document.querySelector('#authPassword').value};
    if(authMode==='signup') body.name=document.querySelector('#authName').value.trim();
    const d=await api(authMode==='signup'?'/api/auth/register':'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    setAuth(d); location.hash='dashboard'; await showWorkspace();
  }catch(err){authError.textContent=err.message;}
  finally{authSubmit.disabled=false;authSubmit.textContent=authMode==='signup'?'Create account':'Login';}
});
async function logout(){
  try{await api('/api/auth/logout',{method:'POST'});}catch{}
  setAuth(null); location.hash=''; showAuth();
}
document.querySelector('#logoutBtn').onclick=logout;
const drawer=document.querySelector('#drawer'), backdrop=document.querySelector('#drawerBackdrop');
function closeDrawer(){drawer.classList.remove('open');backdrop.classList.add('hidden');}
function openDrawer(){drawer.classList.add('open');backdrop.classList.remove('hidden');}
document.querySelector('#menuBtn').onclick=openDrawer;
document.querySelector('#closeMenu').onclick=closeDrawer;
backdrop.onclick=closeDrawer;
document.querySelector('#userBtn').onclick=()=>{location.hash='account';closeDrawer();};
document.querySelectorAll('#sideNav button[data-page]').forEach(b=>b.onclick=()=>{location.hash=b.dataset.page;closeDrawer();});
const originalShell=shell;
shell=(t,html)=>{ originalShell(t,html); closeDrawer(); };
(async()=>{
  try{const me=await api('/api/auth/me'); if(me.authenticated){await showWorkspace();} else showAuth();}
  catch{showAuth();}
})();
