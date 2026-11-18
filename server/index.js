import express from 'express';
import {createServer} from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {WebSocket,WebSocketServer} from 'ws';
import RAPIER from '@dimforge/rapier3d-compat';
import {GAME_MS,ARENA_LIMIT,PARTS,DEFAULT_PLAN,sanitizeGun,weaponStats,sanitizePlan,cleanName,clamp,validPosition} from './rules.js';

await RAPIER.init();
const app=express();
const __dirname=path.dirname(fileURLToPath(import.meta.url));
app.disable('x-powered-by');
app.get('/healthz',(_q,res)=>res.json({ok:true,game:'BILDGAN',version:'0.2.0'}));
app.use(express.static(path.resolve(__dirname,'../dist'),{maxAge:process.env.NODE_ENV==='production'?'1h':0}));
app.get('*',(req,res,next)=>{
 if(req.path.startsWith('/api/'))return res.status(404).json({error:'not found'});
 res.sendFile(path.resolve(__dirname,'../dist/index.html'),err=>err&&next(err));
});
const server=createServer(app);
const wss=new WebSocketServer({server,path:'/socket',maxPayload:16000,perMessageDeflate:false});
const rooms=new Map();
const V=(x=0,y=0,z=0)=>({x,y,z});
const D=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const N=p=>{const m=Math.hypot(p.x,p.y,p.z)||1;return V(p.x/m,p.y/m,p.z/m)};
const rnd=(min,max)=>min+Math.random()*(max-min);
const send=(ws,obj)=>{if(ws?.readyState===WebSocket.OPEN){try{ws.send(JSON.stringify(obj))}catch{}}};
const cast=(room,obj)=>{for(const p of room.players.values())send(p.ws,obj)};
// Place combatants near the objective lanes instead of pointing out into an empty corner.
const SPAWNS=[V(-27,1.65,-24),V(27,1.65,24),V(-27,1.65,24),V(27,1.65,-24)];
const spawn=n=>({...SPAWNS[n%SPAWNS.length]});
const roomCode=()=>crypto.randomBytes(3).toString('hex').toUpperCase();
const ROOM_MAX=80, PLAYER_MAX=4;
function makeRoom(mode){
 if(rooms.size>=ROOM_MAX)return null;
 let id=roomCode();while(rooms.has(id))id=roomCode();
 const world=new RAPIER.World(V(0,-13,0));world.timestep=1/30;
 world.createCollider(RAPIER.ColliderDesc.cuboid(62,.5,62).setTranslation(0,-.5,0).setFriction(.9));
 const room={id,mode,world,players:new Map(),parts:new Map(),debris:[],relays:[{id:'A',pos:V(-24,0,0),owner:'',progress:0,claimer:'',nextScore:0},{id:'B',pos:V(0,0,0),owner:'',progress:0,claimer:'',nextScore:0},{id:'C',pos:V(24,0,0),owner:'',progress:0,claimer:'',nextScore:0}],bot:null,boss:null,host:'',state:mode==='pvp'?'lobby':'running',created:Date.now(),started:0,last:Date.now(),events:[],result:null,lastSnapshot:0,tick:0};
 if(mode==='boss')room.boss={pos:V(0,3.2,0),hp:4700,maxHp:4700,phase:1,nextAttack:Date.now()+4500,attack:null,weakspot:0,lastSummon:0};
 rooms.set(id,room);
 return room;
}
function newPlayer(room,ws,name,gun,plan){
 const p={id:crypto.randomUUID(),ws,name:cleanName(name),pos:spawn(room.players.size),hp:100,alive:true,kills:0,deaths:0,score:0,energy:150,ammo:0,reloadAt:0,shotAt:0,movedAt:Date.now(),shotDir:V(0,0,-1),lastPlace:0,lastGrab:0,inv:sanitizePlan(plan),gun:weaponStats(gun),respawnAt:0,shield:Date.now()+2200,grab:null,lastInteract:0,damage:0};
 p.ammo=p.gun.mag;
 room.players.set(p.id,p);
 if(!room.host)room.host=p.id;
 return p;
}
function makeBot(){
 return {id:'BOT',name:'SCRAP BOT',pos:V(22,1.65,20),hp:100,alive:true,kills:0,deaths:0,score:0,energy:0,shotAt:0,respawnAt:0,shield:Date.now()+1500,dir:1,side:1};
}
function lobbyState(room){
 cast(room,{t:'lobby',id:room.id,host:room.host,players:[...room.players.values()].map(p=>({id:p.id,name:p.name})),maxPlayers:PLAYER_MAX});
}
function begin(room,botFill=false){
 if(room.state!=='lobby')return;
 room.state='running';room.started=Date.now();
 if(botFill&&room.players.size<2)room.bot=makeBot();
 cast(room,{t:'begin',id:room.id,duration:GAME_MS,mode:room.mode});
 cast(room,{t:'event',message:'対戦開始！ 3つのリレーを確保して12点を目指せ'});
}
function finish(room,message,winner=''){
 if(room.state==='ended')return;
 room.state='ended';room.last=Date.now();
 const players=[...room.players.values()];
 const scoreboard=[...players,...(room.bot?[room.bot]:[])].map(p=>({id:p.id,name:p.name,kills:p.kills,deaths:p.deaths,score:p.score,damage:Math.round(p.damage||0)})).sort((a,b)=>b.score-a.score||b.kills-a.kills);
 room.result={t:'ended',message,winner,scores:scoreboard};
 cast(room,room.result);
}
function deal(room,p,amount,from){
 if(!p||!p.alive||room.state!=='running'||Date.now()<p.shield)return false;
 p.hp=clamp(p.hp-Math.max(0,amount),0,100);
 if(p.hp>0)return true;
 p.alive=false;p.deaths++;p.respawnAt=Date.now()+3200;
 const killer=from==='BOT'?room.bot:room.players.get(from);
 if(killer&&killer.id!==p.id&&room.mode!=='boss'){killer.kills++;killer.score+=2;cast(room,{t:'event',message:killer.name+' 撃破 +2'});}
 cast(room,{t:'event',message:p.name+' DOWN · 3秒後に復帰'});
 return true;
}
function finishHit(room,shooter,target,damage,kind){
 if(kind==='part'){
  const part=target;
  if(part.owner===shooter.id&&room.mode!=='boss')return false;
  part.hp-=damage*1.5;
  if(part.body?.isDynamic())part.body.applyImpulse(V(rnd(-2,2),Math.max(1,damage*.25),rnd(-2,2)),true);
  if(part.hp<=0)destroyPart(room,part);
  return true;
 }
 if(kind==='boss'){
  room.boss.hp=Math.max(0,room.boss.hp-damage);
  shooter.damage+=damage;
  return true;
 }
 if(kind==='bot'){
  const ok=deal(room,room.bot,damage,shooter.id);
  if(ok)shooter.damage+=damage;
  return ok;
 }
 if(kind==='player'){
  const ok=deal(room,target,damage,shooter.id);
  if(ok)shooter.damage+=damage;
  return ok;
 }
 return false;
}
function physicsDebris(room,part){
 for(let n=0;n<2&&room.debris.length<55;n++){
  const half=rnd(.16,.29),pos=V(part.pos.x+rnd(-.3,.3),part.pos.y+rnd(.1,.6),part.pos.z+rnd(-.3,.3));
  const body=room.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x,pos.y,pos.z));
  room.world.createCollider(RAPIER.ColliderDesc.cuboid(half,half,half).setRestitution(.32),body);
  body.applyImpulse(V(rnd(-4,4),rnd(4,9),rnd(-4,4)),true);
  room.debris.push({body,at:Date.now(),half});
 }
}
function destroyPart(room,part){
 if(!room.parts.has(part.id))return;
 room.parts.delete(part.id);
 if(part.body)room.world.removeRigidBody(part.body);
 physicsDebris(room,part);
 cast(room,{t:'break',pos:part.pos,kind:part.kind});
 if(part.kind==='barrel')explode(room,part.pos,8,40,part.owner);
}
function explode(room,pos,radius,amount,source){
 cast(room,{t:'explosion',pos,radius});
 for(const p of room.players.values())if(D(p.pos,pos)<radius)deal(room,p,amount*(1-D(p.pos,pos)/radius),source);
 if(room.bot&&D(room.bot.pos,pos)<radius)deal(room,room.bot,amount*(1-D(room.bot.pos,pos)/radius),source);
 if(room.boss&&D(room.boss.pos,pos)<radius)room.boss.hp-=amount*.28;
 for(const part of [...room.parts.values()]){
  if(D(part.pos,pos)>radius)continue;
  part.hp-=amount*.48;
  if(part.body?.isDynamic()){
   const dir=N(V(part.pos.x-pos.x,3,part.pos.z-pos.z));
   part.body.applyImpulse(V(dir.x*17,dir.y*17,dir.z*17),true);
  }
  if(part.hp<=0)destroyPart(room,part);
 }
}
function addPart(room,owner,kind,pos,rotation){
 const spec=PARTS[kind];if(!spec||room.parts.size>=90)return null;
 const desc=kind==='piston'?RAPIER.RigidBodyDesc.kinematicPositionBased():spec.dynamic?RAPIER.RigidBodyDesc.dynamic():RAPIER.RigidBodyDesc.fixed();
 const body=room.world.createRigidBody(desc.setTranslation(pos.x,pos.y,pos.z).setCanSleep(true));
 const collider=RAPIER.ColliderDesc.cuboid(.88,.88,.88).setRestitution(kind==='spring'?.82:.1).setFriction(.8);
 room.world.createCollider(collider,body);
 const p={id:crypto.randomUUID(),kind,owner:owner?.id||'BOSS',pos:V(pos.x,pos.y,pos.z),basePos:V(pos.x,pos.y,pos.z),rot:Math.trunc(rotation)||0,hp:spec.hp,body,at:Date.now(),next:0};
 room.parts.set(p.id,p);return p;
}
function place(room,player,m){
 if(!player.alive||Date.now()-player.lastPlace<250)return;
 player.lastPlace=Date.now();
 const kind=String(m.kind||''),spec=PARTS[kind];
 if(!spec||!validPosition(m.pos)||player.inv[kind]<=0||player.energy<spec.cost)return send(player.ws,{t:'event',message:'パーツ不足またはエネルギー不足'});
 const pos=V(m.pos.x,m.pos.y,m.pos.z);
 if(Math.abs(pos.x)>ARENA_LIMIT||Math.abs(pos.z)>ARENA_LIMIT||pos.y<.8||pos.y>12||D(pos,player.pos)>11||D(pos,player.pos)<1.3)return;
 if(room.mode!=='boss'&&room.relays.some(x=>D(V(x.pos.x,1,x.pos.z),pos)<3.3))return;
 if([...room.parts.values()].some(x=>D(x.pos,pos)<1.75))return;
 const count=[...room.parts.values()].filter(x=>x.owner===player.id).length;
 if(count>=18)return send(player.ws,{t:'event',message:'個人の設置数上限は18個'});
 const part=addPart(room,player,kind,pos,Number(m.rot)||0);
 if(part){player.energy-=spec.cost;player.inv[kind]--;send(player.ws,{t:'inventory',inv:player.inv});}
}
function findHit(room,origin,dir,range,owner){
 let best=range,hit=null;
 function test(pos,rad,type,ref){
  const delta=V(pos.x-origin.x,pos.y-origin.y,pos.z-origin.z);
  const t=delta.x*dir.x+delta.y*dir.y+delta.z*dir.z;
  if(t<.3||t>best)return;
  const q=V(origin.x+t*dir.x,origin.y+t*dir.y,origin.z+t*dir.z);
  if(D(q,pos)<=rad){best=t;hit={type,ref,point:q};}
 }
 if(room.mode!=='boss')for(const p of room.players.values())if(p.id!==owner&&p.alive)test(p.pos,.79,'player',p);
 if(room.bot?.alive)test(room.bot.pos,.8,'bot',room.bot);
 if(room.boss&&room.boss.hp>0)test(room.boss.pos,2.6,'boss',room.boss);
 for(const part of room.parts.values())test(part.pos,1.1,'part',part);
 return hit;
}
function shoot(room,player,m){
 const now=Date.now();if(room.state!=='running'||!player.alive||now<player.shotAt||now<player.reloadAt)return;
 if(player.ammo<=0){reload(player);return;}
 if(!validPosition(m.dir))return;
 let dir=N(m.dir);player.shotAt=now+player.gun.ms;player.ammo--;
 const spread=player.gun.spread;
 dir=N(V(dir.x+rnd(-spread,spread),dir.y+rnd(-spread,spread),dir.z+rnd(-spread,spread)));
 const target=findHit(room,player.pos,dir,player.gun.range,player.id);
 const end=target?.point||V(player.pos.x+dir.x*player.gun.range,player.pos.y+dir.y*player.gun.range,player.pos.z+dir.z*player.gun.range);
 let confirmed=false;
 if(target){
  let dmg=player.gun.damage;
  if(target.type==='boss'){
   const boss=room.boss;
   const weak=V(boss.pos.x+(boss.weakspot===0?-1.1:1.1),boss.pos.y+1.25,boss.pos.z);
   if(D(end,weak)<1.5)dmg*=1.65;
  }
  confirmed=finishHit(room,player,target.ref,dmg,target.type);
 }
 cast(room,{t:'shot',from:player.pos,to:end,by:player.id});
 if(confirmed)send(player.ws,{t:'hit',damage:Math.round(player.gun.damage),target:target.type});
 send(player.ws,{t:'ammo',ammo:player.ammo,mag:player.gun.mag,reload:false});
 if(player.ammo===0)reload(player);
}
function reload(p){
 const now=Date.now();
 if(!p.alive||p.ammo===p.gun.mag||now<p.reloadAt)return;
 p.reloadAt=now+p.gun.reload*1000;
 send(p.ws,{t:'ammo',ammo:p.ammo,mag:p.gun.mag,reload:true,time:p.gun.reload});
}
function interactPhysics(room,p,m){
 const now=Date.now();if(now-p.lastGrab<160)return;
 p.lastGrab=now;
 if(m.action==='grab'){
  if(p.grab)return;
  const part=room.parts.get(String(m.id||''));
  if(!part||!part.body?.isDynamic()||D(part.pos,p.pos)>9||[...room.players.values()].some(x=>x.grab===part.id))return;
  p.grab=part.id;
  send(p.ws,{t:'grabbing',id:part.id});
 }else if(m.action==='throw'&&p.grab){
  const part=room.parts.get(p.grab);p.grab=null;
  if(part?.body?.isDynamic()){
   const dir=validPosition(m.dir)?N(m.dir):p.shotDir;
   part.body.applyImpulse(V(dir.x*48,dir.y*48+5,dir.z*48),true);
  }
  send(p.ws,{t:'grabbing',id:null});
 }
}
function updateBot(room,dt,now){
 const bot=room.bot;if(!bot)return;
 if(!bot.alive){if(now>=bot.respawnAt){bot.alive=true;bot.hp=100;bot.pos=V(22,1.65,20);bot.shield=now+1400;cast(room,{t:'event',message:'SCRAP BOT 復帰'});}return;}
 const player=[...room.players.values()].filter(x=>x.alive).sort((a,b)=>D(a.pos,bot.pos)-D(b.pos,bot.pos))[0];
 const targetRelay=room.relays.filter(r=>r.owner!=='BOT').sort((a,b)=>D(bot.pos,V(a.pos.x,1.65,a.pos.z))-D(bot.pos,V(b.pos.x,1.65,b.pos.z)))[0];
 const go=player&&D(player.pos,bot.pos)<24?player.pos:(targetRelay?V(targetRelay.pos.x,1.65,targetRelay.pos.z):V(0,1.65,0));
 const dir=N(V(go.x-bot.pos.x,0,go.z-bot.pos.z));
 bot.pos.x=clamp(bot.pos.x+dir.x*dt*5.2+Math.sin(now*.0011)*dt*1.2,-52,52);
 bot.pos.z=clamp(bot.pos.z+dir.z*dt*5.2+Math.cos(now*.0011)*dt*1.2,-52,52);
 if(player&&D(bot.pos,player.pos)<38&&now>bot.shotAt){
  bot.shotAt=now+rnd(620,1020);
  const miss=Math.random()<.22;
  if(!miss){deal(room,player,9,'BOT');}
  cast(room,{t:'shot',from:bot.pos,to:miss?V(player.pos.x+rnd(-5,5),1.65,player.pos.z+rnd(-5,5)):player.pos,by:'BOT'});
 }
}
function updateRelays(room,dt,now){
 if(room.mode==='boss')return;
 const subjects=[...room.players.values(),...(room.bot?[room.bot]:[])].filter(p=>p.alive);
 for(const relay of room.relays){
  const nearby=subjects.filter(p=>Math.hypot(p.pos.x-relay.pos.x,p.pos.z-relay.pos.z)<6.0);
  if(nearby.length===1){
   const p=nearby[0];
   if(relay.claimer!==p.id){relay.claimer=p.id;relay.progress=0;}
   if(relay.owner!==p.id){
    relay.progress=clamp(relay.progress+dt*26,0,100);
    if(relay.progress>=100){relay.owner=p.id;relay.nextScore=now+12000;p.score+=2;cast(room,{t:'event',message:p.name+' がリレー '+relay.id+' を確保 +2'});}
   }
  }else{relay.claimer='';relay.progress=Math.max(0,relay.progress-dt*15);}
  if(relay.owner&&relay.nextScore&&now>=relay.nextScore){
   const owner=room.players.get(relay.owner)||(room.bot?.id===relay.owner?room.bot:null);
   if(owner){owner.score+=now-(room.started+GAME_MS-40000)>0?2:1;relay.nextScore=now+12500;}
  }
 }
 for(const p of subjects)if(p.score>=12){finish(room,p.name+' の勝利！',p.id);break;}
}
function updateBoss(room,dt,now){
 const boss=room.boss;if(!boss||room.state!=='running')return;
 if(boss.hp<=0){finish(room,'CORE BREAKER 撃破！','TEAM');return;}
 const ratio=boss.hp/boss.maxHp;
 const phase=ratio>.67?1:ratio>.34?2:3;
 if(phase!==boss.phase){boss.phase=phase;boss.weakspot=(boss.weakspot+1)%2;cast(room,{t:'event',message:'ボス PHASE '+phase+' に移行！'});}
 const alive=[...room.players.values()].filter(p=>p.alive);
 if(!alive.length)return;
 const target=alive.sort((a,b)=>D(boss.pos,a.pos)-D(boss.pos,b.pos))[0];
 boss.pos.x=clamp(boss.pos.x+(target.pos.x-boss.pos.x)*dt*(phase===3?.14:.065),-24,24);
 boss.pos.z=clamp(boss.pos.z+(target.pos.z-boss.pos.z)*dt*(phase===3?.14:.065),-24,24);
 if(boss.attack&&now>=boss.attack.executeAt){
  const atk=boss.attack;boss.attack=null;
  cast(room,{t:'impact',pos:atk.pos,radius:atk.radius,kind:atk.kind});
  for(const p of alive){
   if(atk.kind==='wave'){
    if(D(p.pos,boss.pos)<atk.radius&&p.pos.y<2.5)deal(room,p,phase*6+10,'BOSS');
   }else if(D(p.pos,atk.pos)<atk.radius)deal(room,p,phase*7+11,'BOSS');
  }
 }
 if(!boss.attack&&now>=boss.nextAttack){
  const wave=Math.floor(now/3500)%2===0;
  const atk={kind:wave?'wave':'laser',pos:wave?V(boss.pos.x,1,boss.pos.z):V(target.pos.x,1,target.pos.z),radius:wave?10+phase*1.8:4.3+phase*.4,executeAt:now+1200};
  boss.attack=atk;boss.nextAttack=now+(phase===3?3600:phase===2?4500:5500);
  cast(room,{t:'telegraph',...atk});
 }
 if(phase>=2&&now-boss.lastSummon>24000){
  boss.lastSummon=now;
  for(let n=0;n<Math.min(phase,2);n++){
   const angle=Math.random()*Math.PI*2;
   const pos=V(clamp(boss.pos.x+Math.cos(angle)*9,-49,49),1,clamp(boss.pos.z+Math.sin(angle)*9,-49,49));
   if(room.parts.size<85)addPart(room,null,'turret',pos,0);
  }
  cast(room,{t:'event',message:'ボスが防衛砲台を展開！'});
 }
}
function updateTurrets(room,now){
 for(const part of room.parts.values()){
  if(part.kind!=='turret'||now<part.next)continue;
  let candidate=null,best=32;
  if(part.owner==='BOSS'){
   for(const p of room.players.values())if(p.alive&&D(p.pos,part.pos)<best){candidate=p;best=D(p.pos,part.pos);}
  }else if(room.mode==='boss'){if(room.boss?.hp>0&&D(room.boss.pos,part.pos)<best){candidate=room.boss;best=D(room.boss.pos,part.pos);}}
  else{
   for(const p of room.players.values())if(p.alive&&p.id!==part.owner&&D(p.pos,part.pos)<best){candidate=p;best=D(p.pos,part.pos);}
   if(room.bot?.alive&&D(room.bot.pos,part.pos)<best){candidate=room.bot;best=D(room.bot.pos,part.pos);}
  }
  if(!candidate)continue;
  part.next=now+1700;
  if(candidate===room.boss)room.boss.hp=Math.max(0,room.boss.hp-5);
  else deal(room,candidate,5,part.owner);
  cast(room,{t:'shot',from:part.pos,to:candidate.pos,by:part.id});
 }
}
function tickRoom(room,dt,now){
 if(room.state==='lobby')return;
 if(room.state==='ended')return;
 if(now-room.started>=GAME_MS){
  if(room.mode==='boss')finish(room,'制限時間終了 · ボスを倒せなかった');
  else{const all=[...room.players.values(),...(room.bot?[room.bot]:[])].sort((a,b)=>b.score-a.score||b.kills-a.kills);const top=all[0];finish(room,top?top.name+' が判定勝利':'時間切れ',top?.id||'');}
  return;
 }
 for(const p of room.parts.values()){
  if(p.kind==='piston'){
   p.body.setNextKinematicTranslation(V(p.basePos.x,p.basePos.y+Math.sin((now-p.at)*.004)*1.1,p.basePos.z));
  }
  if(p.kind==='magnet'&&p.body.isDynamic()){
   for(const q of room.parts.values()){
    if(q.id===p.id||!q.body?.isDynamic()||D(q.pos,p.pos)>9.5)continue;
    const d=N(V(p.pos.x-q.pos.x,p.pos.y-q.pos.y,p.pos.z-q.pos.z));
    q.body.applyImpulse(V(d.x*.65,d.y*.65,d.z*.65),true);
   }
  }
 }
 room.world.step();
 for(const p of room.parts.values()){
  if(!p.body?.isDynamic()&&p.kind!=='piston')continue;
  const t=p.body.translation();p.pos=V(t.x,t.y,t.z);
  if(p.pos.y<-5)destroyPart(room,p);
 }
 for(const debris of [...room.debris])if(now-debris.at>5500){
  room.world.removeRigidBody(debris.body);
  room.debris.splice(room.debris.indexOf(debris),1);
 }
 for(const rotor of room.parts.values())if(rotor.kind==='rotor'&&now>rotor.next){
  rotor.next=now+650;
  for(const p of room.players.values())if(p.alive&&D(p.pos,rotor.pos)<2.5)deal(room,p,10,rotor.owner);
  if(room.bot?.alive&&D(room.bot.pos,rotor.pos)<2.5)deal(room,room.bot,10,rotor.owner);
 }
 for(const p of room.players.values()){
  p.energy=Math.min(150,p.energy+dt*2.5);
  if(p.reloadAt&&now>=p.reloadAt){
   p.reloadAt=0;p.ammo=p.gun.mag;
   send(p.ws,{t:'ammo',ammo:p.ammo,mag:p.gun.mag,reload:false});
  }
  if(!p.alive&&now>=p.respawnAt){
   p.hp=100;p.alive=true;p.pos=spawn(Math.floor(Math.random()*4));p.shield=now+1800;p.ammo=p.gun.mag;p.reloadAt=0;p.grab=null;
   send(p.ws,{t:'respawn',pos:p.pos});cast(room,{t:'event',message:p.name+' RESPAWN'});
  }
  if(p.alive&&p.pos.y<-2)deal(room,p,100,'WORLD');
  if(p.grab){
   const part=room.parts.get(p.grab);
   if(!part?.body?.isDynamic()||D(part.pos,p.pos)>12){p.grab=null;send(p.ws,{t:'grabbing',id:null});continue;}
   const desired=V(p.pos.x+p.shotDir.x*3.8,p.pos.y+p.shotDir.y*3.8,p.pos.z+p.shotDir.z*3.8);
   const vel=part.body.linvel();const delta=V(desired.x-part.pos.x,desired.y-part.pos.y,desired.z-part.pos.z);
   part.body.applyImpulse(V(clamp((delta.x*12-vel.x*3),-25,25),clamp((delta.y*12-vel.y*3),-25,25),clamp((delta.z*12-vel.z*3),-25,25)),true);
  }
 }
 if(room.bot)updateBot(room,dt,now);
 if(room.boss)updateBoss(room,dt,now);
 updateRelays(room,dt,now);
 updateTurrets(room,now);
 if(now-room.started>GAME_MS-40000&&now-room.started<GAME_MS-39000&&room.tick%20===0)cast(room,{t:'event',message:'FINAL 40 SECONDS · リレー獲得点が2倍'});
 const boundary=now-room.started>GAME_MS-40000?34:ARENA_LIMIT;
 if(boundary<ARENA_LIMIT)for(const p of room.players.values())if(p.alive&&(Math.abs(p.pos.x)>boundary||Math.abs(p.pos.z)>boundary))deal(room,p,dt*5,'ZONE');
}
function snapshot(room,now){
 return {t:'state',mode:room.mode,id:room.id,remaining:Math.max(0,Math.ceil((GAME_MS-(now-room.started))/1000)),players:[...room.players.values()].map(p=>({id:p.id,name:p.name,pos:p.pos,hp:Math.round(p.hp),alive:p.alive,kills:p.kills,deaths:p.deaths,score:p.score,energy:Math.floor(p.energy),shield:p.shield>now})),
 bot:room.bot?{id:room.bot.id,name:room.bot.name,pos:room.bot.pos,hp:Math.round(room.bot.hp),alive:room.bot.alive,kills:room.bot.kills,score:room.bot.score}:null,
 relays:room.mode==='boss'?[]:room.relays.map(r=>({id:r.id,pos:r.pos,owner:r.owner,progress:Math.round(r.progress),claimer:r.claimer})),
 boss:room.boss?{pos:room.boss.pos,hp:Math.max(0,Math.round(room.boss.hp)),maxHp:room.boss.maxHp,phase:room.boss.phase,weakspot:room.boss.weakspot}:null,
 parts:[...room.parts.values()].map(p=>({id:p.id,kind:p.kind,owner:p.owner,pos:p.pos,rot:p.rot,angle:p.kind==='rotor'?((now-p.at)*.005):null,hp:Math.round(p.hp)})),
 debris:room.debris.slice(0,50).map(d=>({pos:d.body.translation(),size:d.half}))};
}
let prev=Date.now();setInterval(()=>{
 const now=Date.now(),dt=clamp((now-prev)/1000,.005,.07);prev=now;
 for(const room of rooms.values()){
  room.tick++;
  if(room.state==='running')tickRoom(room,dt,now);
  if(room.state==='running'&&now-room.lastSnapshot>=100){room.lastSnapshot=now;cast(room,snapshot(room,now));}
  if(room.players.size===0&&now-room.last>30000)rooms.delete(room.id);
  if(room.state==='ended'&&now-room.last>55000)rooms.delete(room.id);
  if(room.state==='lobby'&&now-room.created>20*60*1000)rooms.delete(room.id);
 }
},33);

wss.on('connection',(ws,req)=>{
 let room=null,player=null;
 ws.on('message',raw=>{
  let m;
  try{m=JSON.parse(raw.toString());if(!m||typeof m!=='object'||typeof m.t!=='string')return;}catch{return;}
  if(m.t==='join'&&!player){
   const invite=String(m.room||'').toUpperCase().trim();
   const mode=['pvp','solo','boss'].includes(m.mode)?m.mode:'solo';
   room=invite?rooms.get(invite):makeRoom(mode);
   if(!room)return send(ws,{t:'error',message:'ルームを作成できません。時間をおいてください'});
   if(room.players.size>=PLAYER_MAX||room.mode==='solo'&&room.players.size>0||room.state==='ended'||(invite&&room.state==='running'&&room.mode!=='boss')||(invite&&room.state==='running'&&Date.now()-room.started>60000))return send(ws,{t:'error',message:'満員または参加できないルームです'});
   player=newPlayer(room,ws,m.name,m.gun,m.plan);
   if(room.mode==='solo'){room.bot=makeBot();room.started=Date.now();}
   if(room.mode==='boss'&&!room.started){room.started=Date.now();}
   if(room.mode==='boss'&&room.players.size>1){room.boss.maxHp+=1800;room.boss.hp+=1800;}
   room.last=Date.now();
   send(ws,{t:'welcome',id:room.id,mode:room.mode,playerId:player.id,pos:player.pos,ammo:player.ammo,gun:player.gun,inv:player.inv});
   if(room.state==='lobby')lobbyState(room);
   else{send(ws,{t:'begin',id:room.id,duration:GAME_MS,mode:room.mode});send(ws,snapshot(room,Date.now()));}
   cast(room,{t:'event',message:player.name+' JOINED'});
   return;
  }
  if(!player||!room)return;
  if(m.t==='start'&&room.state==='lobby'&&room.host===player.id){begin(room,true);return;}
  if(room.state!=='running')return;
  if(m.t==='clientdiag'){
   const calls=Number(m.drawCalls),tris=Number(m.triangles);
   if(Number.isFinite(calls)&&Number.isFinite(tris)&&room.tick%8===0){
    console.info('[BILDGAN/CLIENT3D]',JSON.stringify({calls:Math.trunc(calls),triangles:Math.trunc(tris),centerInside:!!m.centerInside,uniform:String(m.uniform||'').slice(0,64)}));
   }
   return;
  }
  if(m.t==='move'&&player.alive&&validPosition(m.pos)){
   const now=Date.now(),delta=clamp((now-player.movedAt)/1000,.03,.3);
   player.movedAt=now;
   const horiz=Math.hypot(m.pos.x-player.pos.x,m.pos.z-player.pos.z);
   if(horiz>15*delta+1.4||Math.abs(m.pos.x)>ARENA_LIMIT+2||Math.abs(m.pos.z)>ARENA_LIMIT+2||m.pos.y>22||m.pos.y<-4||Math.abs(m.pos.y-player.pos.y)>13*delta+2.5)return;
   player.pos=V(m.pos.x,m.pos.y,m.pos.z);
  }
  if(m.t==='look'&&validPosition(m.dir))player.shotDir=N(m.dir);
  if(m.t==='shoot')shoot(room,player,m);
  if(m.t==='reload')reload(player);
  if(m.t==='place')place(room,player,m);
  if(m.t==='physics'&&player.alive)interactPhysics(room,player,m);
  if(m.t==='emote'&&Date.now()-player.lastInteract>6000){
   player.lastInteract=Date.now();
   const e=['ナイス！','了解！','ここを守ろう','助けて！'].includes(m.emote)?m.emote:'ナイス！';
   cast(room,{t:'event',message:player.name+': '+e});
  }
 });
 ws.on('close',()=>{
  if(!player||!room)return;
  if(player.grab)player.grab=null;
  room.players.delete(player.id);room.last=Date.now();
  cast(room,{t:'event',message:player.name+' LEFT'});
  if(room.host===player.id)room.host=[...room.players.keys()][0]||'';
  if(room.state==='lobby')lobbyState(room);
 });
 ws.on('error',()=>{});
});
const port=Number(process.env.PORT||3000);
server.listen(port,'0.0.0.0',()=>console.log('BILDGAN listening on '+port));
