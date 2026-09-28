export function impliedProbability(odds){ const n=Number(odds); return n>1 ? 1/n : null; }
export function valueMetrics(probability, odds){
  const p=Math.max(0,Math.min(1,Number(probability)||0));
  const o=Number(odds);
  if(!(o>1)) return {implied:null,edge:null,expectedValue:null,value:null};
  const implied=1/o, edge=p-implied, expectedValue=p*o-1;
  return {implied:Number(implied.toFixed(4)),edge:Number(edge.toFixed(4)),expectedValue:Number(expectedValue.toFixed(4)),value:expectedValue>0?'POSITIVE':'NEGATIVE'};
}
export function bttsNo(prob){ return Math.max(0,1-(Number(prob)||0)); }
export function marketProbability(pred, market){
  const p=pred?.probabilities||{};
  const map={
    HOME_WIN:p.homeWin,DRAW:p.draw,AWAY_WIN:p.awayWin,OVER_2_5:p.over25,BTTS:p.btts,
    UNDER_2_5:1-p.over25,BTTS_NO:1-p.btts,
    DOUBLE_CHANCE_1X:p.homeWin+p.draw,DOUBLE_CHANCE_X2:p.draw+p.awayWin,DOUBLE_CHANCE_12:p.homeWin+p.awayWin
  };
  return map[market] ?? null;
}
export function rankValue(predictions, oddsMap={}){
  return predictions.map(p=>{
    const rows=Object.entries(oddsMap[p.matchId]||{}).map(([market,odds])=>({market,odds,probability:marketProbability(p,market),...valueMetrics(marketProbability(p,market),odds)})).filter(x=>x.probability!=null);
    rows.sort((a,b)=>(b.expectedValue??-999)-(a.expectedValue??-999));
    return {...p, valueMarkets:rows};
  });
}
