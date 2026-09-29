// INTELLIGENCE EXTENSIONS - KELLY ARBITRAGE & SA BOOKMAKER TRACKING
class KellyArbitrageOptimizer {
  calculateValueAndStake(modelProbability, bookmakerOdds, totalBankrollZAR = 1000, kellyFraction = 0.25) {
    const bookieImpliedProbability = 1 / bookmakerOdds;
    const expectedValue = (modelProbability * bookmakerOdds) - 1;
    if (expectedValue <= 0) {
      return { hasValue: false, evPercentage: (expectedValue * 100).toFixed(2) + "%", recommendedStakeZAR: "R0.00" };
    }
    const netOdds = bookmakerOdds - 1;
    const probabilityOfLoss = 1 - modelProbability;
    const standardKellyFraction = ((modelProbability * netOdds) - probabilityOfLoss) / netOdds;
    const optimizedFraction = standardKellyFraction * kellyFraction;
    const finalStakeAmountZAR = totalBankrollZAR * optimizedFraction;

    return {
      hasValue: true,
      evPercentage: `+${(expectedValue * 100).toFixed(1)}%`,
      impliedProbability: `${(bookieImpliedProbability * 100).toFixed(1)}%`,
      trueProbability: `${(modelProbability * 100).toFixed(1)}%`,
      recommendedStakeZAR: `R${Math.max(10, finalStakeAmountZAR).toFixed(2)}`,
      potentialProfitZAR: `R${(Math.max(10, finalStakeAmountZAR) * netOdds).toFixed(2)}`
    };
  }
}

class SABookmakerLogEngine {
  constructor() {
    this.bookieMargins = { betway_za: 0.045, hollywoodbets: 0.052, sportingbet_za: 0.048 };
  }

  mapSABookmakerOdds(rawFeedData) {
    return {
      fixture_id: rawFeedData.id,
      event: `${rawFeedData.home} vs ${rawFeedData.away}`,
      markets: {
        betway: { home_win: parseFloat(rawFeedData.odds.betway.1).toFixed(2), draw: parseFloat(rawFeedData.odds.betway.X).toFixed(2), away_win: parseFloat(rawFeedData.odds.betway.2).toFixed(2) },
        hollywood: { home_win: parseFloat(rawFeedData.odds.hollywood.1).toFixed(2), draw: parseFloat(rawFeedData.odds.hollywood.X).toFixed(2), away_win: parseFloat(rawFeedData.odds.hollywood.2).toFixed(2) },
        sportingbet: { home_win: parseFloat(rawFeedData.odds.sportingbet.1).toFixed(2), draw: parseFloat(rawFeedData.odds.sportingbet.X).toFixed(2), away_win: parseFloat(rawFeedData.odds.sportingbet.2).toFixed(2) }
      }
    };
  }

  async logSettledTransaction(slipId, fixture, choice, stakeZAR, closingOdds, status) {
    const numericStake = parseFloat(stakeZAR.replace(/[^0-9.]/g, ''));
    const winAmount = numericStake * closingOdds;
    const netProfitLoss = status === 'WON' ? (winAmount - numericStake) : -numericStake;
    return {
      slip_id: slipId,
      timestamp: new Date().toISOString(),
      match: fixture,
      selection: choice,
      stake_amount: `R${numericStake.toFixed(2)}`,
      odds: closingOdds,
      result_status: status,
      net_return_zar: `${netProfitLoss >= 0 ? '+' : ''}R${netProfitLoss.toFixed(2)}`
    };
  }
}

const arbitrageBot = new KellyArbitrageOptimizer();
const saBookieEngine = new SABookmakerLogEngine();

module.exports = { arbitrageBot, saBookieEngine };
