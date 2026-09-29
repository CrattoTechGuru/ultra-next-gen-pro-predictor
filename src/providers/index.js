import * as fd from './football-data.js'; import * as af from './api-football.js';
const SA=['South Africa']; const AFRICA=['Africa','CAF','Egypt','Morocco','Algeria','Tunisia','Nigeria','Ghana','Kenya','Tanzania','Zambia','Zimbabwe'];
export function regionOf(c){const a=String(c?.area?.name||c?.country||''); if(SA.some(x=>a.toLowerCase().includes(x.toLowerCase())))return 'SOUTH_AFRICA'; if(AFRICA.some(x=>a.toLowerCase().includes(x.toLowerCase())))return 'AFRICA'; return 'OTHER'}
export async function discover(env){const out=[]; if(env.FOOTBALL_DATA_API_KEY){try{for(const c of await fd.competitions(env.FOOTBALL_DATA_API_KEY))out.push({...c,provider:'football-data.org',region:regionOf(c)})}catch(e){out.push({provider:'football-data.org',error:e.message})}}
 if(env.API_FOOTBALL_KEY){try{for(const country of ['South Africa','Egypt','Morocco','Nigeria','Ghana'])for(const c of await af.leagues(env.API_FOOTBALL_KEY,{country}))out.push({id:c.league?.id,name:c.league?.name,area:{name:c.country},type:c.league?.type,provider:'api-football',region:regionOf(c)})}catch(e){out.push({provider:'api-football',error:e.message})}}
 const map=new Map(); for(const c of out.filter(x=>!x.error)){const k=`${c.provider}:${c.id}:${c.name}`;map.set(k,c)} return {competitions:[...map.values()],errors:out.filter(x=>x.error)} }
export async function fetchFixtures(env,{from,to}={}){const all=[]; if(env.FOOTBALL_DATA_API_KEY){try{const ms=await fd.matches(env.FOOTBALL_DATA_API_KEY,{from,to});all.push(...ms.map(fd.normalize))}catch(e){all.push({error:e.message,provider:'football-data.org'})}}
 if(env.API_FOOTBALL_KEY){try{const ms=await af.fixtures(env.API_FOOTBALL_KEY,{from,to,live:null});all.push(...ms.map(af.normalize))}catch(e){all.push({error:e.message,provider:'api-football'})}}
 const map=new Map();for(const m of all.filter(x=>!x.error))map.set(`${m.provider}:${m.providerFixtureId}`,m);return {matches:[...map.values()],errors:all.filter(x=>x.error)}}
export {fd,af};
