import crypto from 'crypto';

const buckets = new Map();
export function rateLimit({windowMs=60_000,max=120,keyFn=(req)=>req.ip||'unknown'}={}) {
  return (req,res,next)=>{
    const key=keyFn(req), now=Date.now();
    let b=buckets.get(key);
    if(!b || now-b.start>=windowMs) b={start:now,count:0};
    b.count++; buckets.set(key,b);
    res.setHeader('X-RateLimit-Limit',String(max));
    res.setHeader('X-RateLimit-Remaining',String(Math.max(0,max-b.count)));
    if(b.count>max) return res.status(429).json({error:'Rate limit exceeded. Try again shortly.'});
    next();
  };
}
export function auditId(){ return crypto.randomUUID(); }
export function safeCompare(a,b){
  const aa=Buffer.from(String(a||'')), bb=Buffer.from(String(b||''));
  return aa.length===bb.length && crypto.timingSafeEqual(aa,bb);
}
