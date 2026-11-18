import test from 'node:test';
import assert from 'node:assert/strict';
import {blockedActor,blockedSweep,nearestCover,clearSight,findBotPath} from '../shared/collision.js';

const wall={id:'player-built-wall',kind:'steel',pos:{x:0,y:1,z:0}};
const empty=[];
const s={x:-5,y:1.65,z:0},t={x:5,y:1.65,z:0};
test('physical buildings stop ALL fighters, not only human players',()=>{
 assert.equal(blockedActor({x:0,y:1.65,z:0},[wall],false,empty),true);
 assert.equal(blockedActor({x:3,y:1.65,z:0},[wall],false,empty),false);
 assert.equal(blockedSweep(s,t,[wall],false,empty),true);
 assert.equal(blockedSweep(s,{x:-3,y:1.65,z:0},[wall],false,empty),false);
});
test('single thin post cannot be crossed by a long client movement packet',()=>{
 const post={id:'post',kind:'post',pos:{x:0,y:1,z:0},half:{x:.3,y:1,z:.3}};
 assert.equal(blockedSweep(s,t,[],false,[post]),true);
});
test('shooting an enemy through a built wall always hits the wall first',()=>{
 const hit=nearestCover(s,{x:1,y:0,z:0},20,[wall],false,empty);
 assert.equal(hit.solid.id,'player-built-wall');
 assert.ok(hit.distance<5);
 assert.equal(clearSight(s,t,[wall],false,empty),false);
 assert.equal(clearSight(s,{x:-2,y:1.65,z:0},[wall],false,empty),true);
});
test('cover at a different height does not block shots',()=>{
 const high={id:'upstairs',pos:{x:0,y:8,z:0},kind:'steel'};
 assert.equal(nearestCover(s,{x:1,y:0,z:0},20,[high],false,empty),null);
});
test('CPU pathfinding routes AROUND human buildings, never through them',()=>{
 const thick=[-6,-3,0,3,6].map((z,i)=>({id:'w'+i,kind:'steel',pos:{x:0,y:1,z}}));
 const route=findBotPath(s,t,thick,false,empty);
 assert.ok(route.length>0,'bot must find an alternate path');
 let previous=s;
 for(const node of route){
  assert.equal(blockedSweep(previous,node,thick,false,empty),false,'every nav waypoint must avoid walls');
  previous=node;
 }
});
test('core structures block physical movement and bullets',()=>{
 const location={x:-39,y:1.65,z:0};
 assert.equal(blockedActor(location,[],true,empty),true);
 const hit=nearestCover({x:-47,y:1.65,z:0},{x:1,y:0,z:0},20,[],true,empty);
 assert.equal(hit.solid.kind,'core');
});
