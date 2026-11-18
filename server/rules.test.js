import test from 'node:test';
import assert from 'node:assert/strict';
import {GAME_MS,PARTS,DEFAULT_PLAN,sanitizeGun,weaponStats,sanitizePlan,cleanName,MAX_BUILD_PIECES,validPosition} from './rules.js';
test('matches last less than five minutes',()=>assert.ok(GAME_MS<300000));
test('weapon input is whitelisted and bounded',()=>{
 const w=weaponStats({frame:'nuke',barrel:'long',core:'plasma',mag:'drum',optic:'target'});
 assert.equal(w.gun.frame,'balanced');assert.ok(w.damage<30&&w.damage>0);assert.ok(w.rpm>0&&w.mag<=30&&w.range<=90);
});
test('every gun combination has limits',()=>{
 for(const frame of ['balanced','light','heavy'])for(const barrel of ['standard','long','short'])for(const core of ['kinetic','plasma','pulse'])for(const mag of ['balanced','drum','quick'])for(const optic of ['iron','stabilizer','target']){
 const w=weaponStats({frame,barrel,core,mag,optic});
 assert.ok(w.damage>=7&&w.damage<=29);assert.ok(w.ms>=70&&w.ms<=400);assert.ok(w.spread>0);
 }
});
test('building counts are safely capped',()=>{
 const p=sanitizePlan(Object.fromEntries(Object.keys(PARTS).map(k=>[k,999])));
 assert.ok(Object.values(p).reduce((a,b)=>a+b,0)<=MAX_BUILD_PIECES);
 assert.deepEqual(sanitizePlan(),DEFAULT_PLAN);
});
test('nickname and coordinates are sanitized',()=>{
 assert.equal(cleanName('<script>'), 'script');
 assert.ok(!validPosition({x:Infinity,y:0,z:0}));
 assert.ok(validPosition({x:1,y:2,z:3}));
});
