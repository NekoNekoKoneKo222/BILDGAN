import test from 'node:test';
import assert from 'node:assert/strict';
import {readMoveAxes} from '../shared/movement.js';

test('idle keyboard and touch input never produce NaN',()=>{
 assert.deepEqual(readMoveAxes({},{}),{ahead:0,sideways:0});
 assert.deepEqual(readMoveAxes({},{x:0,y:0}),{ahead:0,sideways:0});
 const v=readMoveAxes({KeyW:undefined,KeyA:undefined},{x:undefined,y:undefined});
 assert.equal(Number.isFinite(v.ahead)&&Number.isFinite(v.sideways),true);
});
test('WASD and arrow movement input maps correctly',()=>{
 assert.deepEqual(readMoveAxes({KeyW:true,KeyD:true}),{ahead:1,sideways:1});
 assert.deepEqual(readMoveAxes({ArrowDown:true,ArrowLeft:true}),{ahead:-1,sideways:-1});
 assert.deepEqual(readMoveAxes({KeyW:true,KeyS:true,KeyA:true,KeyD:true}),{ahead:0,sideways:0});
});
test('touch stick is finite and clamped',()=>{
 assert.deepEqual(readMoveAxes({},{x:.5,y:-.75}),{ahead:.75,sideways:.5});
 assert.deepEqual(readMoveAxes({},{x:Infinity,y:NaN}),{ahead:0,sideways:0});
 assert.deepEqual(readMoveAxes({},{x:8,y:-9}),{ahead:1,sideways:1});
});
