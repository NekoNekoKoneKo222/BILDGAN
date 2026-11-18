import test from 'node:test';
import assert from 'node:assert/strict';
import {ARENA_SOLIDS,CORE_LOCATIONS,blockedPlayerPosition,rayBoxDistance,nearestArenaHit} from '../shared/arena.js';

test('visible poles and relay towers have gameplay colliders',()=>{
 assert.ok(ARENA_SOLIDS.length>45);
 const pole=ARENA_SOLIDS.find(s=>s.kind==='post');
 assert.ok(pole);
 assert.equal(blockedPlayerPosition({x:pole.pos.x,y:1.65,z:pole.pos.z}),true);
 assert.equal(blockedPlayerPosition({x:0,y:1.65,z:43}),false);
 assert.ok(CORE_LOCATIONS.A.x<0&&CORE_LOCATIONS.B.x>0);
});
test('slab ray stops at the first box face',()=>{
 const box={pos:{x:4,y:2,z:0},half:{x:1,y:2,z:1}};
 assert.equal(rayBoxDistance({x:0,y:2,z:0},{x:1,y:0,z:0},box,20),3);
 assert.equal(rayBoxDistance({x:0,y:8,z:0},{x:1,y:0,z:0},box,20),Infinity);
});
test('arena raycasting hits posts and misses above them',()=>{
 const pillar=ARENA_SOLIDS.find(s=>s.kind==='tower');
 const from={x:pillar.pos.x-12,y:1.65,z:pillar.pos.z};
 const hit=rayBoxDistance(from,{x:1,y:0,z:0},pillar,20);
 assert.ok(hit>0&&hit<12);
 const miss=rayBoxDistance({...from,y:30},{x:1,y:0,z:0},pillar,20);
 assert.equal(miss,Infinity);
 const nearest=nearestArenaHit(from,{x:1,y:0,z:0},20);
 assert.ok(nearest);
});
