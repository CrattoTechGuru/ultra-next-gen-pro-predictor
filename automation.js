import crypto from 'crypto';
export function makeRunId(prefix='RUN'){return `${prefix}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;}
export function safeCronMinutes(v, fallback=30){const n=Number(v); return Number.isFinite(n)?Math.max(5,Math.min(1440,n)):fallback;}
