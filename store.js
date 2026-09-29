export const MANUAL_KEY='ultra_v1000_manual_slips'; export const AUTO_KEY='ultra_v1000_auto_slips';
export function save(key,slip){const all=JSON.parse(localStorage.getItem(key)||'[]');all.unshift({...slip,id:crypto.randomUUID(),savedAt:new Date().toISOString()});localStorage.setItem(key,JSON.stringify(all.slice(0,50)));return all[0]}
export function load(key){return JSON.parse(localStorage.getItem(key)||'[]')}
export function remove(key,id){const all=load(key).filter(x=>x.id!==id);localStorage.setItem(key,JSON.stringify(all));return all}
