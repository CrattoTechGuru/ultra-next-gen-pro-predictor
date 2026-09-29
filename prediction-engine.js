const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
function formScore(matches, teamId, home){
  const rows=(matches||[]).filter(m=>m.homeTeam?.id===teamId||m.awayTeam?.id===teamId).slice(-10);
  if(!rows.length) return {points:50,played:0,goalsFor:0,goalsAgainst:0};
  let pts=0,gf=0,ga=0;
  for(const m of rows){const isHome=m.homeTeam.id===teamId;const a=m.score?.fullTime?.home??0,b=m.score?.fullTime?.away??0;const f=isHome?a:b,g=isHome?b:a;gf+=f;ga+=g;pts+=f>g?3:f===g?1:0;}
  return {points:pts/(rows.length*3)*100,played:rows.length,goalsFor:gf/rows.length,goalsAgainst:ga/rows.length};
}
export function predictMatch(match, histories={}){
  const h=formScore(histories.home||[],match.homeTeam?.id,true), a=formScore(histories.away||[],match.awayTeam?.id,false);
  const homeAdv=7, strengthH=h.points, strengthA=a.points;
  let home=42+(strengthH-strengthA)*0.28+homeAdv;
  let away=28+(strengthA-strengthH)*0.28;
  let draw=100-home-away;
  home=clamp(home,5,90); away=clamp(away,5,90); draw=clamp(100-home-away,5,70);
  const total=home+draw+away; home=Math.round(home/total*100); draw=Math.round(draw/total*100); away=100-home-draw;
  const confidence=clamp(Math.round(Math.max(home,draw,away)*0.93 + Math.min(h.played+a.played,20)*0.35),50,97);
  const over25=clamp(Math.round(48+(h.goalsFor+a.goalsFor-h.goalsAgainst-a.goalsAgainst)*8),25,82);
  const btts=clamp(Math.round(46+(h.goalsFor+a.goalsFor)*8),25,82);
  const pick=home>=draw&&home>=away?'HOME':away>=home&&away>=draw?'AWAY':'DRAW';
  return {oneXtwo:{home,draw,away},pick,confidence,accuracy:confidence,over25,btts,risk:confidence>=90?'Low':confidence>=80?'Medium':'High',sample:h.played+a.played};
}
export function analyzeSlip(selections){
  const valid=selections.filter(Boolean); if(!valid.length)return {confidence:0,projectedAccuracy:0,risk:'High',count:0};
  const conf=valid.reduce((s,x)=>s+(Number(x.confidence)||0),0)/valid.length;
  const product=valid.reduce((p,x)=>p*(Number(x.odds)||1),1);
  return {confidence:Math.round(conf),projectedAccuracy:Math.round(conf),risk:conf>=90?'Low':conf>=80?'Medium':'High',count:valid.length,totalOdds:Number(product.toFixed(2))};
}
