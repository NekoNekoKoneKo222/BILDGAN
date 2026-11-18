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
  for(let i=0;i<waiters.length;i++)if(waiters[i].predicate(data)){
   const w=waiters.splice(i,1)[0];clearTimeout(w.timer);w.resolve(data);return;
  }
  queue.push(data);if(queue.length>200)queue.shift();
 });
 return {
  send:msg=>ws.send(JSON.stringify(msg)),
  wait(predicate,limit=6000){
   const i=queue.findIndex(predicate);if(i>=0)return Promise.resolve(queue.splice(i,1)[0]);
   return new Promise((resolve,reject)=>{
    const waiter={predicate,resolve,timer:null};
    waiter.timer=setTimeout(()=>{waiters.splice(waiters.indexOf(waiter),1);reject(new Error('Timed out waiting for message '+predicate.toString().slice(0,120)+' last='+JSON.stringify(queue.slice(-3))))},limit);
    waiters.push(waiter);
   });
  },
  close:()=>ws.close()
 };
}
async function connect(){
 const ws=new WebSocket('ws://127.0.0.1:'+PORT+'/socket');
 await once(ws,'open');return channel(ws);
}
test('end-to-end: PvP lobby, start, building, reloading, solo, boss', {timeout:25000},async()=>{
 const child=spawn(process.execPath,['server/index.js'],{
  cwd:process.cwd(),env:{...process.env,PORT:String(PORT),NODE_ENV:'test'},stdio:['ignore','pipe','pipe']
 });
 let stderr='';child.stderr.on('data',x=>stderr+=x.toString().slice(0,1500));
 const ready=new Promise((resolve,reject)=>{
  let buffer='';let settled=false;
  child.stdout.on('data',chunk=>{buffer+=chunk.toString();if(!settled&&buffer.includes('listening on')){settled=true;resolve();}});
  child.once('exit',code=>{if(!settled){settled=true;reject(new Error('Server exited '+code+' '+stderr));}});
  setTimeout(()=>{if(!settled){settled=true;reject(new Error('Server startup timeout '+stderr));}},9000);
 });
 const peers=[];
 try{
  await ready;
  const p1=await connect();peers.push(p1);
  p1.send({t:'join',mode:'pvp',name:'Alpha'});
  const welcome1=await p1.wait(m=>m.t==='welcome');
  assert.match(welcome1.id,/^[A-F0-9]{6}$/);
  assert.equal(welcome1.mode,'pvp');console.log('STAGE p1 welcome',welcome1.id);
  const p2=await connect();peers.push(p2);
  p2.send({t:'join',room:welcome1.id,mode:'pvp',name:'Beta'});
  const welcome2=await p2.wait(m=>m.t==='welcome');
  assert.equal(welcome2.id,welcome1.id);console.log('STAGE p2 welcome');
  p1.send({t:'start'});
  const begin1=await p1.wait(m=>m.t==='begin');
  assert.equal(begin1.mode,'pvp');console.log('STAGE pvp begun');
  assert.ok(begin1.duration<300000);
  await p2.wait(m=>m.t==='begin');
  p1.send({t:'place',kind:'steel',pos:{x:welcome1.pos.x+5,y:1,z:welcome1.pos.z},rot:0});
  const stock=await p1.wait(m=>m.t==='inventory');
  assert.equal(stock.inv.steel,2);console.log('STAGE building');
  p1.send({t:'shoot',dir:{x:0,y:0,z:1}});
  const afterShot=await p1.wait(m=>m.t==='ammo'&&m.reload===false);
  assert.equal(afterShot.ammo,welcome1.gun.mag-1);console.log('STAGE shot');
  p1.send({t:'reload'});
  const reloading=await p1.wait(m=>m.t==='ammo'&&m.reload===true);
  assert.equal(reloading.reload,true);
  const reloaded=await p1.wait(m=>m.t==='ammo'&&m.reload===false,5500);
  assert.equal(reloaded.ammo,welcome1.gun.mag);console.log('STAGE reloaded');
  const snap=await p1.wait(m=>m.t==='state'&&m.parts?.some(x=>x.kind==='steel'));
  assert.equal(snap.relays.length,3);
  assert.equal(snap.players.length,2);
  const solo=await connect();peers.push(solo);
  solo.send({t:'join',mode:'solo',name:'Solo'});
  await solo.wait(m=>m.t==='welcome');console.log('STAGE solo welcome');
  await solo.wait(m=>m.t==='begin');
  const soloState=await solo.wait(m=>m.t==='state');
  assert.ok(soloState.bot);
  const boss=await connect();peers.push(boss);
  boss.send({t:'join',mode:'boss',name:'Raider'});
  await boss.wait(m=>m.t==='welcome');console.log('STAGE boss welcome');
  await boss.wait(m=>m.t==='begin');
  const bossState=await boss.wait(m=>m.t==='state');
  assert.ok(bossState.boss?.hp>3000);
  assert.equal(bossState.mode,'boss');
 }finally{
  for(const peer of peers)peer.close();
  child.kill('SIGTERM');
  await sleep(100);
 }
});
