// AUTOMATION EXTENSIONS - DATA SYNC, CASH-OUT ENGINE, & TICKET FORMULATOR
const intelligence = require('./intelligence');
const db = require('./db');

class HighAccuracyTicketEngine {
  constructor(minConfidence = 0.85, minMatchesPerSlip = 3, baseStakeZAR = 100) {
    this.minConfidence = minConfidence; 
    this.minMatchesPerSlip = minMatchesPerSlip;
    this.baseStakeZAR = baseStakeZAR; 
  }

  async formulateOptimalSlips(upcomingMatches) {
    const qualifiedSelections = [];
    for (const match of upcomingMatches) {
      const pred = await intelligence.predictMatchOutcome(match.id); 
      if (pred && pred.confidence_score >= this.minConfidence) {
        qualifiedSelections.push({
          match_id: match.id,
          teams: `${match.home_team} vs ${match.away_team}`,
          league: match.league_name,
          pick: pred.recommended_market, 
          odds: match.odds[pred.recommended_market] || 1.50,
          accuracy: pred.confidence_score
        });
      }
    }
    if (qualifiedSelections.length >= this.minMatchesPerSlip) {
      return this.buildAccumulator(qualifiedSelections);
    }
    return null;
  }

  buildAccumulator(selections) {
    const totalOdds = selections.reduce((acc, item) => acc * item.odds, 1);
    const avgAcc = selections.reduce((acc, item) => acc + item.accuracy, 0) / selections.length;
    const potentialPayout = this.baseStakeZAR * totalOdds;

    return {
      slip_id: `SLIP-${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
      combined_odds: totalOdds.toFixed(2),
      avg_confidence: (avgAcc * 100).toFixed(1),
      base_stake: `R${this.baseStakeZAR}`,
      potential_payout: `R${potentialPayout.toFixed(2)}`,
      selections: selections
    };
  }
}

class AutomatedSyncAndCashOutEngine {
  constructor(updateIntervalMs = 60000) {
    this.updateIntervalMs = updateIntervalMs; 
    this.cronInterval = null;
  }

  startAutomatedSync() {
    console.log("🚀 Starting automated fixture synchronization worker...");
    this.cronInterval = setInterval(async () => {
      try {
        await this.syncUpcomingFixturesFromFeed();
        await this.updateLiveMatchData();
      } catch (error) {
        console.error("❌ Error in background automation sync cycle:", error);
      }
    }, this.updateIntervalMs);
  }

  async syncUpcomingFixturesFromFeed() { console.log("🔄 Background Worker: Refreshing upcoming league schedules..."); }
  async updateLiveMatchData() { console.log("🔄 Background Worker: Fetching real-time in-play statistics..."); }

  calculateLiveCashOut(originalStakeZAR, originalOdds, currentLiveOdds, matchMinute) {
    if (matchMinute >= 90) return { cash_out_value: "R0.00", status: "EXPIRED" };
    const riskPremiumFactor = 0.92; 
    const timeDecay = (90 - matchMinute) / 90;
    let calculatedOffer = (originalStakeZAR * (originalOdds / currentLiveOdds)) * riskPremiumFactor;
    calculatedOffer = calculatedOffer * (1 + (timeDecay * 0.05));
    const maxPayout = originalStakeZAR * originalOdds;
    if (calculatedOffer > maxPayout) calculatedOffer = maxPayout * 0.95;
    if (calculatedOffer < 0) calculatedOffer = 0.00;
    return {
      cash_out_value: `R${calculatedOffer.toFixed(2)}`,
      status: calculatedOffer > originalStakeZAR ? "PROFITABLE" : "LOSS_MITIGATION"
    };
  }
}

class OfficialThresholdAlertSystem {
  constructor(officialThreshold = 0.90) {
    this.officialThreshold = officialThreshold; 
  }

  evaluateAndDispatchAlert(slip) {
    if (!slip || !slip.avg_confidence) return null;
    const absoluteConfidence = parseFloat(slip.avg_confidence) / 100;
    if (absoluteConfidence >= this.officialThreshold) {
      const alertPayload = {
        alert_id: `ALERT-${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
        timestamp: new Date().toISOString(),
        title: "🚨 OFFICIAL HIGH-ACCURACY TICKET ALERTER",
        severity: "CRITICAL_GOLD",
        confidence: `${slip.avg_confidence}%`,
        combined_odds: slip.combined_odds,
        stake: slip.base_stake,
        payout: slip.potential_payout,
        selections: slip.selections.map(s => ({
          fixture: s.teams,
          market: s.pick,
          individual_odds: s.odds
        }))
      };
      this.triggerSystemNotification(alertPayload);
      return alertPayload;
    }
    return null;
  }

  triggerSystemNotification(payload) {
    console.log(`🔥 ${payload.title} GENERATED! ACCURACY: ${payload.confidence} | RETURN: ${payload.payout}`);
    if (global.io) { global.io.emit('official_high_accuracy_alert', payload); }
  }
}

const syncEngine = new AutomatedSyncAndCashOutEngine(60000);
const officialAlertSystem = new OfficialThresholdAlertSystem(0.90);

module.exports = { HighAccuracyTicketEngine, syncEngine, officialAlertSystem };
