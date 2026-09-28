function clamp(x, a=0, b=1){ return Math.max(a, Math.min(b, x)); }
function fact(n){ let r=1; for(let i=2;i<=n;i++) r*=i; return r; }
function pois(k,l){ return Math.exp(-l)*Math.pow(l,k)/fact(k); }

export function teamStats(teamId, history, limit=12){
  const games=history.filter(m=>m.status==='FINISHED' && (m.homeTeam?.id===teamId || m.awayTeam?.id===teamId))
    .sort((a,b)=>new Date(a.utcDate)-new Date(b.utcDate)).slice(-limit);
  let gf=0,ga=0,pts=0;
  for(const m of games){ const home=m.homeTeam.id===teamId; const h=+m.score?.fullTime?.home||0,a=+m.score?.fullTime?.away||0; const f=home?h:a,c=home?a:h; gf+=f;ga+=c;pts+=f>c?3:f===c?1:0; }
  return {n:games.length,gf:games.length?gf/games.length:1.35,ga:games.length?ga/games.length:1.35,ppg:games.length?pts/games.length:1.2};
}

export function poissonModel(match, history){
  const h=teamStats(match.homeTeam.id,history), a=teamStats(match.awayTeam.id,history);
  const avg=history.length?history.reduce((s,m)=>s+(+m.score?.fullTime?.home||0)+(+m.score?.fullTime?.away||0),0)/history.length/2:1.35;
  let lh=clamp((h.gf*.6+(2-h.ga)*.4)*1.07*.75+avg*.25,.25,3.8);
  let la=clamp((a.gf*.6+(2-a.ga)*.4)*.94*.75+avg*.25,.2,3.5);
  let H=0,D=0,A=0,O=0,B=0;
  for(let x=0;x<=8;x++) for(let y=0;y<=8;y++){ const p=pois(x,lh)*pois(y,la); if(x>y)H+=p;else if(x===y)D+=p;else A+=p;if(x+y>2)O+=p;if(x>0&&y>0)B+=p; }
  const t=H+D+A;
  return {homeWin:H/t,draw:D/t,awayWin:A/t,over25:O,btts:B,lambdaHome:lh,lambdaAway:la,sample:h.n+a.n};
}

export function eloModel(match, history){
  const ratings=new Map(), K=24, homeAdv=55, get=id=>ratings.has(id)?ratings.get(id):1500;
  for(const m of [...history].filter(x=>x.status==='FINISHED').sort((a,b)=>new Date(a.utcDate)-new Date(b.utcDate))){
    const h=m.homeTeam?.id,a=m.awayTeam?.id;if(!h||!a)continue;const hg=+m.score?.fullTime?.home||0,ag=+m.score?.fullTime?.away||0,rh=get(h),ra=get(a);
    const eh=1/(1+10**((ra-(rh+homeAdv))/400));const out=hg>ag?1:hg===ag?.5:0;const k=K*(1+Math.min(1,Math.log1p(Math.abs(hg-ag))*.18));
    ratings.set(h,rh+k*(out-eh));ratings.set(a,ra+k*((1-out)-(1-eh)));
  }
  const rh=ratings.get(match.homeTeam.id)||1500,ra=ratings.get(match.awayTeam.id)||1500;const x=(rh+homeAdv-ra)/400,hn=1/(1+10**(-x));
  const draw=clamp(.27-Math.min(.08,Math.abs(x)*.06),.16,.29);
  return {homeWin:hn*(1-draw),draw,awayWin:(1-hn)*(1-draw),homeRating:rh,awayRating:ra};
}

export function formModel(match,history){
  const h=teamStats(match.homeTeam.id,history,8),a=teamStats(match.awayTeam.id,history,8);
  const edge=clamp(.5+(h.ppg-a.ppg)/6,.18,.82);return {homeWin:edge*.72,draw:.28,awayWin:(1-edge)*.72};
}

export function dixonColesModel(match,history){
  const p=poissonModel(match,history); const rho=-.13;
  // Low-score adjustment to the 0-0, 1-0, 0-1 and 1-1 cells.
  const cells=[]; let total=0,H=0,D=0,A=0,O=0,B=0;
  for(let x=0;x<=8;x++) for(let y=0;y<=8;y++){
    let q=pois(x,p.lambdaHome)*pois(y,p.lambdaAway);
    if(x===0&&y===0)q*=1-p.lambdaHome*p.lambdaAway*rho;
    else if(x===1&&y===0)q*=1+p.lambdaAway*rho;
    else if(x===0&&y===1)q*=1+p.lambdaHome*rho;
    else if(x===1&&y===1)q*=1-rho;
    q=Math.max(0,q);cells.push([x,y,q]);total+=q;
  }
  for(const [x,y,q0] of cells){const q=q0/total;if(x>y)H+=q;else if(x===y)D+=q;else A+=q;if(x+y>2)O+=q;if(x>0&&y>0)B+=q;}
  return {homeWin:H,draw:D,awayWin:A,over25:O,btts:B,lambdaHome:p.lambdaHome,lambdaAway:p.lambdaAway};
}

export function ensembleModels(match,history){
  const poisson=poissonModel(match,history), dixon=dixonColesModel(match,history), elo=eloModel(match,history), form=formModel(match,history);
  const n=history.length; const weights=n>=300?{poisson:.35,dixon:.30,elo:.25,form:.10}:n>=100?{poisson:.40,dixon:.30,elo:.20,form:.10}:{poisson:.55,dixon:.25,elo:.15,form:.05};
  const mix=k=>clamp(weights.poisson*poisson[k]+weights.dixon*dixon[k]+weights.elo*elo[k]+weights.form*form[k]);
  let h=mix('homeWin'),d=mix('draw'),a=mix('awayWin');const s=h+d+a;h/=s;d/=s;a/=s;
  const markets={HOME_WIN:h,DRAW:d,AWAY_WIN:a,OVER_2_5:weights.poisson*poisson.over25+weights.dixon*dixon.over25,BTTS:weights.poisson*poisson.btts+weights.dixon*dixon.btts};
  const top=Object.entries(markets).sort((x,y)=>y[1]-x[1])[0];
  const entropy=-(h*Math.log(h)+d*Math.log(d)+a*Math.log(a))/Math.log(3);
  const sampleFactor=Math.min(1,n/250); const confidence=clamp(top[1]*(1-.14*entropy)*(.82+.18*sampleFactor));
  return {matchId:match.id,home:match.homeTeam.name,away:match.awayTeam.name,kickoff:match.utcDate,competition:match.competition?.name||'Unknown',probabilities:{homeWin:h,draw:d,awayWin:a,over25:markets.OVER_2_5,btts:markets.BTTS},expectedGoals:Number((poisson.lambdaHome+poisson.lambdaAway).toFixed(2)),recommendedMarket:top[0],rawTopProbability:top[1],confidence,risk:confidence>=.7?'LOW':confidence>=.58?'MEDIUM':'HIGH',models:{poisson,dixonColes:dixon,elo,form},weights,modelVersion:'CRATTO-CTRL-30.0-ENSEMBLE'};
}

export function evaluateModelPrediction(pred,match){
  const probs=[pred.probabilities.homeWin,pred.probabilities.draw,pred.probabilities.awayWin];
  const actual=+match.score?.fullTime?.home||0 > (+match.score?.fullTime?.away||0)?0:(+match.score?.fullTime?.home||0)=== (+match.score?.fullTime?.away||0)?1:2;
  const winner=probs.indexOf(Math.max(...probs)); const brier=probs.reduce((s,p,i)=>s+(p-(i===actual?1:0))**2,0); const logLoss=-Math.log(Math.max(1e-9,probs[actual]));
  return {correct:winner===actual,actual:['HOME_WIN','DRAW','AWAY_WIN'][actual],predicted:['HOME_WIN','DRAW','AWAY_WIN'][winner],brier,logLoss,probability:probs[actual]};
}

export function walkForward(history,limit=500){
  const finished=[...history].filter(m=>m.status==='FINISHED').sort((a,b)=>new Date(a.utcDate)-new Date(b.utcDate));
  const sample=finished.slice(-Math.min(limit,finished.length)); const out=[];
  for(const m of sample){const hist=finished.filter(x=>new Date(x.utcDate)<new Date(m.utcDate));if(hist.length<10)continue;const pred=ensembleModels(m,hist);out.push({matchId:m.id,date:m.utcDate,competition:m.competition?.code||m.competition?.name||'',home:m.homeTeam.name,away:m.awayTeam.name,...evaluateModelPrediction(pred,m),confidence:pred.confidence});}
  const n=out.length;return {evaluated:n,accuracy:n?out.filter(x=>x.correct).length/n:null,brier:n?out.reduce((s,x)=>s+x.brier,0)/n:null,logLoss:n?out.reduce((s,x)=>s+x.logLoss,0)/n:null,results:out};
}

export function calibration(history,limit=1000){
  const wf=walkForward(history,limit),bins=Array.from({length:10},(_,i)=>({from:i/10,to:(i+1)/10,count:0,correct:0,observed:null}));
  for(const r of wf.results){const i=Math.min(9,Math.floor(r.confidence*10));bins[i].count++;if(r.correct)bins[i].correct++;}
  for(const b of bins)if(b.count)b.observed=b.correct/b.count;return {bins,evaluated:wf.evaluated};
}

export function leaguePerformance(history){
  const groups=new Map(); const finished=[...history].filter(m=>m.status==='FINISHED').sort((a,b)=>new Date(a.utcDate)-new Date(b.utcDate));
  for(const m of finished){const hist=finished.filter(x=>new Date(x.utcDate)<new Date(m.utcDate));if(hist.length<10)continue;const p=ensembleModels(m,hist),e=evaluateModelPrediction(p,m),key=m.competition?.code||m.competition?.name||'UNKNOWN';const g=groups.get(key)||{competition:key,n:0,correct:0,brier:0,logLoss:0};g.n++;g.correct+=e.correct?1:0;g.brier+=e.brier;g.logLoss+=e.logLoss;groups.set(key,g);}
  return [...groups.values()].map(g=>({...g,accuracy:g.correct/g.n,brier:g.brier/g.n,logLoss:g.logLoss/g.n})).sort((a,b)=>b.n-a.n);
}
