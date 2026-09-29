const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.static(path.join(__dirname,'public')));

function normalizeCompetition(c, provider){
  const name = c.name || c.competition?.name || 'Unknown';
  const country = (c.area?.name || c.country?.name || c.country || '').toLowerCase();
  let region = 'OTHER';
  if(country.includes('south africa')) region = 'SOUTH_AFRICA';
  else if(['caf','africa','egypt','morocco','tunisia','algeria','nigeria','ghana','tanzania','zambia','angola'].some(x=>name.toLowerCase().includes(x)||country.includes(x))) region='AFRICA';
  return {id:`${provider}:${c.id||c.league?.id||name}`,name,region,provider};
}

async function footballDataCompetitions(){
  const key=process.env.FOOTBALL_DATA_API_KEY;
  if(!key) return [];
  const r=await fetch('https://api.football-data.org/v4/competitions',{headers:{'X-Auth-Token':key}});
  if(!r.ok) throw new Error(`football-data.org HTTP ${r.status}`);
  const d=await r.json();
  return (d.competitions||[]).map(c=>normalizeCompetition(c,'football-data.org'));
}

async function apiFootballCompetitions(){
  const key=process.env.API_FOOTBALL_KEY;
  if(!key) return [];
  const r=await fetch('https://v3.football.api-sports.io/leagues?season=2026',{headers:{'x-apisports-key':key}});
  if(!r.ok) throw new Error(`API-Football HTTP ${r.status}`);
  const d=await r.json();
  return (d.response||[]).map(x=>normalizeCompetition({
    id:x.league?.id,name:x.league?.name,country:x.country?.name
  },'api-football'));
}

app.get('/api/competitions',async(req,res)=>{
  const results=[]; const sources=[];
  try{ const a=await footballDataCompetitions(); if(a.length){results.push(...a);sources.push('football-data.org');} }catch(e){console.error(e.message)}
  try{ const b=await apiFootballCompetitions(); if(b.length){results.push(...b);sources.push('api-football');} }catch(e){console.error(e.message)}
  const dedupe=new Map(results.map(x=>[x.id,x]));
  res.json({competitions:[...dedupe.values()],sources:sources.length?sources:['demo/configured']});
});

app.get('/api/health',(req,res)=>res.json({
  ok:true,
  providers:{
    footballData:!!process.env.FOOTBALL_DATA_API_KEY,
    apiFootball:!!process.env.API_FOOTBALL_KEY,
    twelveData:!!process.env.TWELVE_DATA_API_KEY
  }
}));

app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`V1000 additive upgrade listening on ${PORT}`));
