export const GAME_MS = 285000;
export const ARENA_LIMIT = 55;
export const PARTS = Object.freeze({
  steel:{name:'装甲',cost:18,hp:165,dynamic:false},
  ramp:{name:'斜面',cost:16,hp:105,dynamic:false},
  barrel:{name:'爆発タンク',cost:18,hp:42,dynamic:true},
  spring:{name:'ジャンプパッド',cost:20,hp:100,dynamic:false},
  turret:{name:'自動砲台',cost:35,hp:90,dynamic:false},
  magnet:{name:'磁力ブロック',cost:26,hp:88,dynamic:true},
  piston:{name:'昇降ピストン',cost:30,hp:105,dynamic:false},
  rotor:{name:'回転ブレード',cost:32,hp:95,dynamic:false}
});
export const GUN_MODULES = Object.freeze({
 frame:{balanced:{name:'スタンダード',damage:0,rate:0,recoil:0,spread:0,mag:0},light:{name:'ライト',damage:-2,rate:1.5,recoil:-0.4,spread:0.01,mag:0},heavy:{name:'ヘビー',damage:4,rate:-1.2,recoil:1.1,spread:-0.002,mag:0}},
 barrel:{standard:{name:'カービン',damage:0,rate:0,spread:0,range:0},long:{name:'ロング',damage:3,rate:-1,spread:-0.006,range:15},short:{name:'ショート',damage:-3,rate:2,spread:0.015,range:-15}},
 core:{kinetic:{name:'キネティック',damage:0,rate:0},plasma:{name:'プラズマ',damage:2,rate:-1},pulse:{name:'パルス',damage:-2,rate:2}},
 mag:{balanced:{name:'20ラウンド',mag:20,reload:1.7},drum:{name:'ドラム30',mag:30,reload:2.25},quick:{name:'クイック12',mag:12,reload:1.15}},
 optic:{iron:{name:'アイアン',spread:0,recoil:0},stabilizer:{name:'安定化',spread:-0.009,recoil:-0.6},target:{name:'マークスマン',spread:-0.013,recoil:0.55}}
});
export const DEFAULT_GUN = Object.freeze({frame:'balanced',barrel:'standard',core:'kinetic',mag:'balanced',optic:'iron'});
export const DEFAULT_PLAN = Object.freeze({steel:3,ramp:1,barrel:1,spring:1,turret:1,magnet:0,piston:0,rotor:0});
export const MAX_BUILD_PIECES = 12;
export function clamp(n,lo,hi){return Math.max(lo,Math.min(hi,n))}
export function cleanName(name){return String(name||'SCRAPPER').replace(/[<>\n\r]/g,'').trim().slice(0,16)||'SCRAPPER'}
export function sanitizeGun(source={}){
  const g={};for(const [slot,choices] of Object.entries(GUN_MODULES)){
    const v=source&&typeof source==='object'?source[slot]:undefined;
    g[slot]=Object.hasOwn(choices,v)?v:DEFAULT_GUN[slot];
  }return g
}
export function weaponStats(raw){
  const gun=sanitizeGun(raw);
  let damage=12,rate=6.1,spread=.029,recoil=1.5,range=68;
  for(const [slot,key] of Object.entries(gun)){
    const mod=GUN_MODULES[slot][key];
    damage+=(mod.damage||0);rate+=(mod.rate||0);
    spread+=(mod.spread||0);recoil+=(mod.recoil||0);range+=(mod.range||0);
  }
  return {gun,damage:clamp(damage,7,29),rpm:Math.round(clamp(rate,2.8,11)*60),ms:Math.round(1000/clamp(rate,2.8,11)),spread:clamp(spread,.006,.085),recoil:clamp(recoil,.25,3.2),range:clamp(range,28,90),mag:GUN_MODULES.mag[gun.mag].mag,reload:GUN_MODULES.mag[gun.mag].reload}
}
export function sanitizePlan(raw){
  const source=raw&&typeof raw==='object'?raw:{};
  const out={};let remaining=MAX_BUILD_PIECES;
  for(const type of Object.keys(PARTS)){const v=Math.trunc(Number(source[type]??DEFAULT_PLAN[type]));out[type]=clamp(Number.isFinite(v)?v:0,0,Math.min(6,remaining));remaining-=out[type]}
  return out
}
export const validNumber=n=>typeof n==='number'&&Number.isFinite(n);
export const validPosition=p=>p&&validNumber(p.x)&&validNumber(p.y)&&validNumber(p.z);
