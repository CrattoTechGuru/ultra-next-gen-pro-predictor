// FRONTEND OPERATIONS PIPELINE - SYNC, ARBITRAGE & TICKETS
const socket = typeof io !== 'undefined' ? io() : { on: () => {} };

const LivePredictorDashboard = {
  async runLiveSync() {
    try {
      const res = await fetch('/api/competitions/live');
      const json = await res.json();
      this.drawLiveInterface(json.data || []);
    } catch(e) { console.error("Live streaming sync failed", e); }
  },

  async studyLeague(leagueName = 'all') {
    try {
      const res = await fetch(`/api/competitions/upcoming?league=${leagueName}`);
      const json = await res.json();
      if (json.recommended_high_accuracy_slip) {
        this.drawHighAccuracyTicket(json.recommended_high_accuracy_slip);
      }
    } catch(e) { console.error("League pipeline lookup failed", e); }
  },

  drawLiveInterface(liveMatches) {
    const grid = document.getElementById('live-matches-grid');
    if (!grid) return;
    grid.innerHTML = liveMatches.length === 0 ? '<p>No live matches currently in play.</p>' : liveMatches.map(m => `
      <div class="live-card">
        <div class="live-timer">MIN: ${m.elapsed_minute}'</div>
        <h4>${m.home_team} ${m.home_score} - ${m.away_score} ${m.away_team}</h4>
        <p>Prediction: <strong>${m.live_predicted_outcome}</strong> (${m.live_confidence_percentage}%)</p>
      </div>
    `).join('');
  },

  drawHighAccuracyTicket(slip) {
    const container = document.getElementById('ticket-alerts-container');
    if (!container) return;
    container.innerHTML = `
      <div class="zar-ticket-box" style="background:#1e272e; padding:15px; border-radius:8px; border-left:4px solid #ffbc00;">
        <h3>🔥 High Accuracy Multi-Bet Formed!</h3>
        <p>Odds: <strong>${slip.combined_odds}</strong> | Accuracy: <strong>${slip.avg_confidence}%</strong></p>
        <p>Stake: <strong>${slip.base_stake}</strong> | Est Payout: <strong style="color:#4cd137;">${slip.potential_payout}</strong></p>
      </div>
    `;
  }
};

const LiveArbitrageScanner = {
  async loadValueBets() {
    const bankrollEl = document.getElementById('bankroll-input-zar');
    const bankrollValue = bankrollEl ? bankrollEl.value : 1000;
    try {
      const response = await fetch(`/api/intelligence/value-bets?bankroll=${bankrollValue}`);
      const json = await response.json();
      this.drawArbitrageCards(json.opportunities || []);
    } catch (err) { console.error("Error reading value discrepancies:", err); }
  },

  drawArbitrageCards(opportunities) {
    const grid = document.getElementById('arbitrage-bot-results-grid');
    if (!grid) return;
    if (opportunities.length === 0) {
      grid.innerHTML = `<p style="color:#85929e; font-style:italic;">No active +EV opportunities found right now.</p>`;
      return;
    }
    grid.innerHTML = opportunities.map(op => `
      <div class="arbitrage-value-card" style="background:#222f3e; padding:12px; border-radius:6px; margin-bottom:10px;">
        <span style="color:#ffbc00; font-size:11px;">${op.league} (Edge: ${op.metrics.evPercentage})</span>
        <h4 style="margin:4px 0; color:#fff;">${op.fixture}</h4>
        <p style="font-size:12px; color:#c8d6e5;">Pick: ${op.market} @ ${op.odds}</p>
        <div style="font-size:11px; color:#95a5a6;">Stake: ${op.metrics.recommendedStakeZAR} | Profit: ${op.metrics.potentialProfitZAR}</div>
      </div>
    `).join('');
  }
};

const SABookieLedgerInterface = {
  async fetchAnalyticsLedger() {
    try {
      const response = await fetch('/api/intelligence/ledger-summary');
      const json = await response.json();
      const pnlBadge = document.getElementById('zar-cumulative-pnl-badge');
      if (pnlBadge) {
        pnlBadge.textContent = json.total_net_balance;
        pnlBadge.style.background = json.total_net_balance.startsWith('-') ? '#e84118' : '#4cd137';
      }
      const rowsContainer = document.getElementById('sa-ledger-history-rows');
      if (rowsContainer) {
        rowsContainer.innerHTML = json.history.map(row => `
          <div style="display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px solid rgba(255,255,255,0.05);">
            <span>Slip: ${row.id}</span>
            <span style="color:${row.status === 'WON' ? '#4cd137' : '#e84118'};">${row.payout}</span>
          </div>
        `).join('');
      }
    } catch(err) { console.error("Could not sync SA sportsbook ledger boards:", err); }
  }
};

socket.on('official_high_accuracy_alert', (payload) => {
  const alertContainer = document.getElementById('official-threshold-alert-banner');
  if (!alertContainer) return;
  alertContainer.innerHTML = `
    <div class="official-gold-alert" style="background:#1e272e; border:3px solid #ffbc00; border-radius:12px; padding:20px; box-shadow:0 0 20px rgba(255,188,0,0.3); color:#fff;">
      <h3 style="color:#ffbc00; margin-top:0;">${payload.title} (${payload.confidence})</h3>
      <p>Total Accumulator Odds: <strong>v${payload.combined_odds}</strong> | Return: <strong style="color:#4cd137;">${payload.payout}</strong></p>
    </div>
  `;
});

// Execution intervals
setInterval(() => LivePredictorDashboard.runLiveSync(), 25000);
setTimeout(() => {
  LiveArbitrageScanner.loadValueBets();
  SABookieLedgerInterface.fetchAnalyticsLedger();
}, 2000);
