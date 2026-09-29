import express from 'express'; import dotenv from 'dotenv'; import {discover,fetchFixtures,fd,af} from './src/providers/index.js'; import {predictMatch} from './src/prediction-engine.js';
dotenv.config(); const app=express(); app.use(express.json()); app.use(express.static('public'));
const env=process.env;
app.get('/api/health',(req,res)=>res.json({ok:true,version:'V1000-COMBINED',providers:{footballData:!!env.FOOTBALL_DATA_API_KEY,apiFootball:!!env.API_FOOTBALL_KEY}}));
app.get('/api/competitions',async(req,res)=>{try{res.json(await discover(env))}catch(e){res.status(500).json({error:e.message})}});
app.get('/api/matches',async(req,res)=>{const d=new Date();const from=req.query.from||d.toISOString().slice(0,10);const to=req.query.to||new Date(d.getTime()+86400000*9).toISOString().slice(0,10);try{res.json(await fetchFixtures(env,{from,to}))}catch(e){res.status(500).json({error:e.message})}});
app.post('/api/predict',async(req,res)=>{try{const m=req.body.match; const histories={home:req.body.homeHistory||[],away:req.body.awayHistory||[]};res.json(predictMatch(m,histories))}catch(e){res.status(400).json({error:e.message})}});
app.get('/{*splat}',(req,res)=>res.sendFile(process.cwd()+'/public/index.html'));
app.listen(Number(env.PORT||10000),'0.0.0.0',()=>console.log(`Ultra Next Gen Pro Predictor V1000 Combined listening on ${env.PORT||10000}`));
