import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as sleep} from 'node:timers/promises';
import {WebSocket} from 'ws';

const PORT=43000+Math.floor(Math.random()*1500);
function channel(ws){
 const queue=[],waiters=[];
 ws.on('message',raw=>{
  let data;try{data=JSON.parse(raw.toString())}catch{return;}
  const i=waiters.findIndex(x=>x.predicate(data));
  if(i>=0){const w=waiters.splice(i,1)[0];clearTimeout(w.timer);w.resolve(data);}
  else{queue.push(data);if(queue.length>300)queue.shift();}
 });
 return {
  send:msg=>ws.send(JSON.stringify(msg)),
  wait(predicate,limit=7000){
   const i=queue.findIndex(predicate);if(i>=0)return Promise.resolve(queue.splice(i,1)[0]);
   return new Promise((resolve,reject)=>{
    const w={predicate,resolve,timer:null};
    w.timer=setTimeout(()=>{
     const at=waiters.indexOf(w);if(at>=0)waiters.splice(at,1);
     reject(new Error('Timed out '+predicate.toString().slice(0,130)+' last='+JSON.stringify(queue.slice(-3))));
    },limit);waiters.push(w);
   });
  },
  close:()=>ws.close()
 };
}
async function connect(){
 const ws=new WebSocket('ws://127.0.0.1:'+PORT+'/socket');
 await once(ws,'open');return channel(ws);
}
test('full match: personal preparation, bots, collisions, scoring, solo and coop', {timeout:28000},async()=>{
 const child=spawn(process.execPath,['server/index.js'],{
  cwd:process.cwd(),env:{...process.env,PORT:String(PORT),NODE_ENV:'test'},stdio:['ignore','pipe','pipe']
 });
 let stderr='';child.stderr.on('data',x=>stderr+=x.toString().slice(0,2000));
 let startTimer;
 const ready=new Promise((resolve,reject)=>{
  let buffer='';let settled=false;
  child.stdout.on('data',chunk=>{buffer+=chunk.toString();if(!settled&&buffer.includes('listening on')){settled=true;clearTimeout(startTimer);resolve();}});
  child.once('exit',code=>{if(!settled){settled=true;clearTimeout(startTimer);reject(new Error('Server exited '+code+' '+stderr));}});
  startTimer=setTimeout(()=>{if(!settled){settled=true;reject(new Error('Startup timeout '+stderr));}},10000);
 });
 const peers=[];
 try{
  await ready;console.log('STAGE running');
  const p1=await connect();peers.push(p1);
  p1.send({t:'join',mode:'pvp',rule:'fortress',name:'Alpha'});
  const welcome1=await p1.wait(m=>m.t==='welcome');
  assert.equal(welcome1.team,'A');
  assert.equal(welcome1.rule,'fortress');
  const p2=await connect();peers.push(p2);
  p2.send({t:'join',room:welcome1.id,mode:'pvp',name:'Beta'});
  const welcome2=await p2.wait(m=>m.t==='welcome');
  assert.equal(welcome2.id,welcome1.id);assert.equal(welcome2.team,'B');
  p1.send({t:'start'});
  const begin=await p1.wait(m=>m.t==='begin');
  assert.equal(begin.phase,'prep');assert.equal(begin.prepSeconds,50);
  assert.ok(begin.duration<300000);
  await p2.wait(m=>m.t==='begin');console.log('STAGE individual prep');
  p1.send({t:'shoot',dir:{x:1,y:0,z:0}}); // never spends ammo in personal build time
  p1.send({t:'place',kind:'steel',pos:{x:welcome1.pos.x+5,y:1,z:welcome1.pos.z},rot:0});
  const inventory=await p1.wait(m=>m.t==='inventory');
  assert.equal(inventory.inv.steel,2);console.log('STAGE constructed');
  const buildEvent=await p1.wait(m=>m.t==='placed');
  assert.equal(buildEvent.kind,'steel');
  const snapshotPrep=await p1.wait(m=>m.t==='state'&&m.parts.some(x=>x.kind==='steel'));
  assert.equal(snapshotPrep.phase,'prep');
  assert.equal(snapshotPrep.bots.length,2);
  assert.equal(snapshotPrep.cores.A.hp,750);
  assert.equal(snapshotPrep.cores.B.hp,750);
  assert.equal(snapshotPrep.bots.filter(x=>x.team==='A').length,1);
  assert.equal(snapshotPrep.bots.filter(x=>x.team==='B').length,1);
  p1.send({t:'ready'});p2.send({t:'ready'});
  await p1.wait(m=>m.t==='phase'&&m.phase==='battle');console.log('STAGE team battle');
  // Own physical wall should absorb the rifle shot. The shot cannot pass through it.
  p1.send({t:'shoot',dir:{x:1,y:0,z:0}});
  const bullet=await p1.wait(m=>m.t==='shot'&&m.by===welcome1.playerId);
  assert.equal(bullet.hitType,'part','a player-built wall must be detected before any target behind it');
  const ammo=await p1.wait(m=>m.t==='ammo'&&m.reload===false);
  assert.equal(ammo.ammo,welcome1.gun.mag-1,'prep must not spend ammunition');
  p1.send({t:'reload'});
  await p1.wait(m=>m.t==='ammo'&&m.reload===true);
  const reloaded=await p1.wait(m=>m.t==='ammo'&&m.reload===false,5500);
  assert.equal(reloaded.ammo,welcome1.gun.mag);console.log('STAGE bullets hit built cover');
  const solo=await connect();peers.push(solo);
  solo.send({t:'join',mode:'solo',name:'Solo'});
  await solo.wait(m=>m.t==='welcome');
  await solo.wait(m=>m.t==='begin');
  const stateSolo=await solo.wait(m=>m.t==='state');
  assert.equal(stateSolo.bots.length,3);
  assert.equal(stateSolo.bots.filter(x=>x.team==='A').length,1);
  assert.equal(stateSolo.bots.filter(x=>x.team==='B').length,2);
  assert.equal(stateSolo.phase,'prep');console.log('STAGE 2v2 solo bot fill');
  const boss=await connect();peers.push(boss);
  boss.send({t:'join',mode:'boss',name:'Raider'});
  await boss.wait(m=>m.t==='welcome');
  await boss.wait(m=>m.t==='begin');
  const stateBoss=await boss.wait(m=>m.t==='state');
  assert.equal(stateBoss.rule,'boss');
  assert.equal(stateBoss.phase,'prep');
  assert.equal(stateBoss.bots.length,0);
  assert.ok(stateBoss.boss?.hp>3000);console.log('STAGE boss coop');
 }finally{
  for(const peer of peers)peer.close();
  child.kill('SIGTERM');await sleep(100);
 }
});
