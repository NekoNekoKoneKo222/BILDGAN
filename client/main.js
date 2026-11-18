import * as THREE from 'three';
import {PARTS,GUN_MODULES,DEFAULT_GUN,DEFAULT_PLAN,MAX_BUILD_PIECES,weaponStats,sanitizeGun,sanitizePlan} from '../server/rules.js';
import './style.css';

const $=id=>document.getElementById(id);
// Daylight arena: prioritize silhouettes, target visibility and readable building pieces.
const palette={bg:0xb4d9e8,floor:0x748f87,cyan:0x3cf9dd,orange:0xffa367,blue:0x3185b2,red:0xff5962};
const STORAGE='bildgan-v2-';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const names={steel:'強化装甲',ramp:'斜面',barrel:'爆発タンク',spring:'ジャンプパッド',turret:'自動砲台',magnet:'磁力ブロック',piston:'昇降ピストン',rotor:'回転ブレード'};
const hints={steel:'遮蔽物と高い耐久値',ramp:'高低差を作り射線を変える',barrel:'爆発と物理連鎖',spring:'ジャンプして奇襲',turret:'近くの敵を自動攻撃',magnet:'磁力で周囲の動的パーツを引く',piston:'周期的な昇降で物体を押し上げる',rotor:'近接する対象へ連続ダメージ'};
let gun=sanitizeGun(readJson('gun',DEFAULT_GUN)),plan=sanitizePlan(readJson('plan',DEFAULT_PLAN)),stock={...plan};
let stats=weaponStats(gun),chosenKind='steel',rotation=0,buildMode=false;
let ws=null,gameMode='',roomId='',me='',connected=false,gameState=null,remaining=285,lobbyHost='';
let currentHp=100,currentAmmo=stats.mag,currentEnergy=150,isReloading=false,grabId=null;
let playing=false,fireHeld=false,grabHeld=false,locked=false,respawning=false,lastMove=0,lastLook=0,lastFire=0,lastClock=0,menuTab='play';
let toastTimer=0;
const key={},stick={x:0,y:0},touchEnabled=matchMedia('(pointer:coarse)').matches;
const renderer=new THREE.WebGLRenderer({antialias:!touchEnabled,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,touchEnabled?1:1.5));
renderer.setSize(innerWidth,innerHeight);
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
// Accessible exposure adjustment; stored locally so brightness survives reloads.
const savedBrightness=Number(localStorage.getItem('bildgan-v2-brightness'));
let brightness=Number.isFinite(savedBrightness)&&savedBrightness>=80&&savedBrightness<=200?savedBrightness:135;
renderer.toneMappingExposure=brightness/100;
renderer.shadowMap.enabled=false;
renderer.domElement.style.touchAction='none';
$('root').prepend(renderer.domElement);
const scene=new THREE.Scene();
scene.background=new THREE.Color(palette.bg);
scene.fog=new THREE.FogExp2(palette.bg,.0036);
const camera=new THREE.PerspectiveCamera(78,innerWidth/innerHeight,.08,185);
camera.rotation.order='YXZ';
camera.position.set(0,1.65,32);
const ambient=new THREE.AmbientLight(0xffffff,1.45);scene.add(ambient);
const hemi=new THREE.HemisphereLight(0xe0f5ff,0x91b1a4,2.25);scene.add(hemi);
const sun=new THREE.DirectionalLight(0xfff3dc,3.1);sun.position.set(20,44,-24);scene.add(sun);
const fill=new THREE.DirectionalLight(0xb8e5ff,1.3);fill.position.set(-25,20,32);scene.add(fill);
const accent=new THREE.PointLight(0x37ffc8,2.1,55);accent.position.set(0,14,0);scene.add(accent);
// Metals without an environment map render nearly black. Use semi-matte materials for this arena.
const mat=(color,metalness=.22,roughness=.76)=>new THREE.MeshStandardMaterial({color,metalness,roughness});
const metal=mat(0x829cad,.26,.66),dark=mat(0x466578,.14,.78),bright=mat(0x35d2bc,.18,.58),floorMaterial=mat(palette.floor,.05,.92);
const ground=new THREE.Mesh(new THREE.PlaneGeometry(124,124),floorMaterial);ground.rotation.x=-Math.PI/2;ground.userData.ground=true;scene.add(ground);
const grid=new THREE.GridHelper(122,61,0xb2e7d7,0x92b8b2);grid.position.y=.013;scene.add(grid);
const trim=new THREE.Group();scene.add(trim);
const box=(parent,w,h,d,x,y,z,m)=>{const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);o.position.set(x,y,z);parent.add(o);return o};
for(let i=-3;i<=3;i++)for(const side of [-1,1]){
 const a=i*16;
 box(trim,2.5,9,3,a,4.5,side*59,metal);
 box(trim,3.3,.25,3.4,a,9.15,side*59,bright);
 box(trim,3,6,2,side*59,3,a,metal);
 box(trim,3.7,.2,2.5,side*59,6.1,a,bright);
}
for(const [x,z] of [[-34,-34],[-34,34],[34,34],[34,-34]]){
 box(trim,6,8,6,x,4,z,metal);
 box(trim,6.4,.27,6.4,x,8.2,z,bright);
 const lamp=new THREE.PointLight(0x42ddbf,2,25);lamp.position.set(x,9,z);trim.add(lamp);
}
for(const [x,z] of [[-12,-26],[12,26],[-12,26],[12,-26]]){
 box(trim,7,2.3,2.5,x,1.15,z,dark);
 box(trim,7.2,.16,2.7,x,2.35,z,metal);
}
for(let i=0;i<30;i++){
 const x=Math.sin(i*3.17)*49,z=Math.cos(i*1.92)*48;
 if(Math.abs(x)<10&&Math.abs(z)<14)continue;
 box(trim,1.1,2,1.1,x,1,z,dark);
}
const skyLight=new THREE.Group();scene.add(skyLight);
for(let i=0;i<15;i++){
 const a=(i/15)*Math.PI*2;
 const pole=box(skyLight,.12,11,.12,Math.sin(a)*57,5.5,Math.cos(a)*57,bright);
 pole.material=bright;
}
scene.add(camera);
const viewWeapon=new THREE.Group();camera.add(viewWeapon);viewWeapon.position.set(.43,-.44,-.73);
const arm=new THREE.Group();viewWeapon.add(arm);
const barrelMesh=box(arm,.16,.18,.64,0,.035,-.47,metal);
box(arm,.32,.25,.62,0,0,0,dark);
box(arm,.14,.35,.16,0,-.25,.14,metal);
box(arm,.3,.08,.14,0,.18,-.2,bright);
const muzzle=new THREE.Mesh(new THREE.CylinderGeometry(.055,.072,.4,9),mat(0x06121d,.9));muzzle.rotation.x=Math.PI/2;muzzle.position.z=-.85;arm.add(muzzle);
const muzzleFlash=new THREE.PointLight(0xffd4a7,0,8);muzzleFlash.position.set(0,.02,-1);viewWeapon.add(muzzleFlash);
let yaw=0,pitch=0,vy=0,onGround=true,shotKick=0,stepPhase=0;
function rotateCamera(){camera.rotation.set(pitch,yaw,0);}
function forward(){const out=new THREE.Vector3();camera.getWorldDirection(out);return out;}
function net(v){return {x:v.x,y:v.y,z:v.z};}
function readJson(key,fallback){try{return JSON.parse(localStorage.getItem(STORAGE+key)||'null')??structuredClone(fallback)}catch{return structuredClone(fallback)}}
function store(key,data){try{localStorage.setItem(STORAGE+key,JSON.stringify(data))}catch{}}
function setBrightness(raw){
 brightness=clamp(Math.round(Number(raw)||135),80,200);
 renderer.toneMappingExposure=brightness/100;
 $('brightnessSetting').value=String(brightness);
 $('brightnessPercent').textContent=brightness+'%';
 $('brightnessQuick').value=String(brightness);
 $('brightnessQuickValue').textContent=brightness+'%';
 try{localStorage.setItem(STORAGE+'brightness',String(brightness));}catch{}
}
$('brightnessSetting').addEventListener('input',e=>setBrightness(e.target.value));
$('brightnessQuick').addEventListener('input',e=>setBrightness(e.target.value));
setBrightness(brightness);

const particles=[],effectGroup=new THREE.Group();scene.add(effectGroup);
function addEffect(mesh,duration=450,expand=0){effectGroup.add(mesh);particles.push({mesh,start:performance.now(),duration,expand});}
function flashLine(a,b,color=palette.cyan){
 const A=new THREE.Vector3(a.x,a.y,a.z),B=new THREE.Vector3(b.x,b.y,b.z);
 const delta=new THREE.Vector3().subVectors(B,A),len=delta.length();
 if(len<.1)return;
 const mesh=new THREE.Mesh(new THREE.CylinderGeometry(.026,.037,len,5),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.95}));
 mesh.position.copy(A.add(B).multiplyScalar(.5));mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());
 addEffect(mesh,150);
}
function shockRing(pos,radius,color,ms=1200){
 const mesh=new THREE.Mesh(new THREE.RingGeometry(Math.max(.2,radius-.22),radius,48),new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide,transparent:true,opacity:.8,depthWrite:false}));
 mesh.rotation.x=-Math.PI/2;mesh.position.set(pos.x,.09,pos.z);addEffect(mesh,ms,.01);
}
function burst(pos,color){
 for(let i=0;i<7;i++){
  const b=new THREE.Mesh(new THREE.IcosahedronGeometry(.13,0),new THREE.MeshBasicMaterial({color,transparent:true,opacity:1}));
  b.position.set(pos.x+Math.random()*.8-.4,pos.y+Math.random()*.9,pos.z+Math.random()*.8-.4);
  addEffect(b,350,1.8);
 }
}
function playTone(freq,duration=.08,type='triangle',gain=.055){
 try{
  if(!window.__bgAudio)window.__bgAudio=new (window.AudioContext||window.webkitAudioContext)();
  const ac=window.__bgAudio;if(ac.state==='suspended')ac.resume().catch(()=>{});
  const osc=ac.createOscillator(),g=ac.createGain();osc.type=type;osc.frequency.setValueAtTime(freq,ac.currentTime);
  g.gain.setValueAtTime(gain,ac.currentTime);g.gain.exponentialRampToValueAtTime(.0001,ac.currentTime+duration);
  osc.connect(g);g.connect(ac.destination);osc.start();osc.stop(ac.currentTime+duration);
 }catch{}
}
function toast(s){
 const t=$('toast');t.textContent=s;t.classList.add('visible');
 clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('visible'),3200);
}
function feed(s){
 const wrap=$('eventFeed'),p=document.createElement('div');
 p.textContent=s;wrap.prepend(p);while(wrap.children.length>5)wrap.lastChild.remove();
 setTimeout(()=>p.remove(),4800);
}
function setPhase(s){$('phase').textContent=s;}
function setTab(tab){
 menuTab=tab;
 document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===tab));
 document.querySelectorAll('.pane').forEach(x=>x.hidden=x.id!==tab);
}
document.querySelectorAll('.tab').forEach(x=>x.addEventListener('click',()=>setTab(x.dataset.tab)));
function renderModules(){
 $('moduleList').replaceChildren();
 for(const [slot,options] of Object.entries(GUN_MODULES)){
  const row=document.createElement('div');row.className='moduleRow';
  const name=document.createElement('div');name.innerHTML='<b>'+({frame:'FRAME',barrel:'BARREL',core:'POWER CORE',mag:'MAGAZINE',optic:'OPTIC'}[slot])+'</b><small>モジュールを交換</small>';
  const sel=document.createElement('select');sel.setAttribute('aria-label',slot);
  for(const [id,opt] of Object.entries(options)){const e=document.createElement('option');e.value=id;e.textContent=opt.name;sel.append(e);}
  sel.value=gun[slot];sel.onchange=()=>{gun[slot]=sel.value;refreshGun();playTone(400,.045);};
  row.append(name,sel);$('moduleList').append(row);
 }
 refreshGun();
}
function refreshGun(){
 stats=weaponStats(gun);
 const entries=[['DAMAGE',stats.damage,30],['FIRE RATE',stats.rpm,660],['ACCURACY',Math.round(100*(1-stats.spread/.09)),100],['RECOIL CONTROL',Math.round(100*(1-stats.recoil/3.6)),100],['CAPACITY',stats.mag,30]];
 const host=$('weaponStats');host.replaceChildren();
 for(const [label,value,max] of entries){
  const r=document.createElement('div');r.className='statRow';
  const l=document.createElement('label');l.textContent=label;
  const track=document.createElement('div');track.className='statTrack';const fill=document.createElement('div');fill.style.width=(100*value/max)+'%';track.append(fill);
  const text=document.createElement('span');text.className='statValue';text.textContent=value;
  r.append(l,track,text);host.append(r);
 }
 $('buildAdvice').textContent='射撃間隔 '+stats.ms+'ms / リロード '+stats.reload.toFixed(2)+'秒 / 有効射程 '+stats.range+'m。高火力は連射が遅く、軽量型は反動を抑えやすくなります。';
 $('weaponName').textContent=GUN_MODULES.barrel[gun.barrel].name.toUpperCase()+' / '+GUN_MODULES.core[gun.core].name.toUpperCase();
 $('weaponMeta').textContent='DMG '+stats.damage+'  ·  '+stats.rpm+' RPM';
 $('gunPreview').textContent=gun.barrel==='long'?'▰━━━━━━━━╾':gun.barrel==='short'?'▰━━╾':'▰━━━━╾';
 barrelMesh.scale.z=gun.barrel==='long'?1.55:gun.barrel==='short'?.65:1;
 viewWeapon.scale.setScalar(gun.frame==='heavy'?1.1:gun.frame==='light'?.87:1);
 currentAmmo=stats.mag;renderAmmo();
}
$('saveWeapon').onclick=()=>{store('gun',gun);toast('武器の設計を保存しました');playTone(640,.1);};
$('resetWeapon').onclick=()=>{gun={...DEFAULT_GUN};renderModules();store('gun',gun);};
function renderPlan(){
 const wrap=$('buildLab');wrap.replaceChildren();
 for(const [kind,spec] of Object.entries(PARTS)){
  const card=document.createElement('label');card.className='partCard';
  const title=document.createElement('strong');title.textContent=names[kind];
  const desc=document.createElement('small');desc.textContent=hints[kind]+' · '+spec.cost+'EN';
  const count=document.createElement('input');count.type='number';count.min='0';count.max='6';count.step='1';count.value=plan[kind]||0;count.setAttribute('aria-label',names[kind]+'の個数');
  count.onchange=()=>{
   const old=plan[kind]||0;
   plan[kind]=clamp(Math.trunc(Number(count.value)||0),0,6);
   if(Object.values(plan).reduce((a,b)=>a+b,0)>MAX_BUILD_PIECES){plan[kind]=old;toast('ビルド枠は合計12個まで');}
   count.value=plan[kind];renderPlanSummary();
  };
  const sub=document.createElement('span');sub.textContent='在庫 '+(plan[kind]||0);
  card.append(title,desc,count,sub);wrap.append(card);
 }
 renderPlanSummary();
}
function renderPlanSummary(){
 const total=Object.values(plan).reduce((a,b)=>a+b,0);
 $('clearPlan').textContent='初期化（'+total+'/'+MAX_BUILD_PIECES+'個）';
}
$('savePlan').onclick=()=>{store('plan',plan);toast('防衛キットを保存しました');};
$('clearPlan').onclick=()=>{plan={...DEFAULT_PLAN};renderPlan();store('plan',plan);};
renderModules();renderPlan();
$('nickname').value=localStorage.getItem(STORAGE+'name')||'SCRAPPER';
$('nickname').addEventListener('change',()=>{localStorage.setItem(STORAGE+'name',$('nickname').value.slice(0,16));});
function buildPart(kind,ghost=false){
 const group=new THREE.Group(),base=mat(({steel:0x65909b,ramp:0x7b95ad,barrel:0xc9694e,spring:0x50bd89,turret:0x48c9b7,magnet:0xa98ae6,piston:0xe8b868,rotor:0xef7e8f})[kind]||0x627d8a);
 if(ghost){base.transparent=true;base.opacity=.48;base.depthWrite=false;}
 const block=box(group,1.7,1.7,1.7,0,0,0,base);
 if(kind==='barrel'){
  group.remove(block);
  const drum=new THREE.Mesh(new THREE.CylinderGeometry(.73,.73,1.65,12),base);group.add(drum);
  for(const y of [-.5,.5]){const ring=new THREE.Mesh(new THREE.TorusGeometry(.75,.065,5,16),dark);ring.rotation.x=Math.PI/2;ring.position.y=y;group.add(ring);}
 }
 if(kind==='ramp'){
  block.rotation.x=-.33;block.scale.y=.65;block.position.y=-.2;
  box(group,1.75,.14,1.75,0,-.75,0,metal);
 }
 if(kind==='spring'){
  const pad=new THREE.Mesh(new THREE.CylinderGeometry(.73,.73,.22,16),bright);pad.position.y=.95;group.add(pad);
  for(let y=-.4;y<.7;y+=.28){const ring=new THREE.Mesh(new THREE.TorusGeometry(.38,.06,6,12),dark);ring.rotation.x=Math.PI/2;ring.position.y=y;group.add(ring);}
 }
 if(kind==='steel'){
  for(const y of [-.85,.85])box(group,1.87,.13,1.87,0,y,0,dark);
 }
 if(kind==='turret'){
  const basePlate=new THREE.Mesh(new THREE.CylinderGeometry(.58,.62,.38,8),dark);basePlate.position.y=.98;group.add(basePlate);
  const cannon=new THREE.Mesh(new THREE.CylinderGeometry(.2,.2,1.55,10),bright);cannon.rotation.x=Math.PI/2;cannon.position.set(0,1.04,-.68);group.add(cannon);
 }
 if(kind==='piston'){
  box(group,1.15,.65,1.15,0,1.08,0,bright);
  box(group,.38,.9,.38,0,.55,0,dark);
 }
 if(kind==='rotor'){
  for(let i=0;i<4;i++){const a=i*Math.PI/2;const blade=box(group,2.7,.2,.4,Math.sin(a)*.85,1,Math.cos(a)*.85,bright);blade.rotation.y=a;}
  box(group,.65,.35,.65,0,1.05,0,dark);
 }
 if(kind==='magnet'){
  for(const x of [-.55,.55])box(group,.24,1.75,.25,x,0,-.85,bright);
  box(group,1.1,.25,.25,0,-.75,-.85,metal);
 }
 group.userData.kind=kind;
 return group;
}
const partGroup=new THREE.Group();scene.add(partGroup);
const partViews=new Map();
const ghost=buildPart(chosenKind,true);scene.add(ghost);ghost.visible=false;
function changeKind(kind){
 if(!PARTS[kind])return;
 chosenKind=kind;ghost.clear();
 const fresh=buildPart(kind,true);
 while(fresh.children.length)ghost.add(fresh.children[0]);
 $('buildReadout').textContent=names[chosenKind]+' · '+PARTS[chosenKind].cost+'EN · Rで回転';
}
const relayGroup=new THREE.Group();scene.add(relayGroup);
const relays=new Map();
for(const [id,x] of [['A',-24],['B',0],['C',24]]){
 const root=new THREE.Group();root.position.set(x,.065,0);
 const pad=new THREE.Mesh(new THREE.CylinderGeometry(5.5,5.5,.07,48),new THREE.MeshBasicMaterial({color:0x0b453f,transparent:true,opacity:.35}));root.add(pad);
 const torus=new THREE.Mesh(new THREE.TorusGeometry(5.6,.12,6,50),new THREE.MeshBasicMaterial({color:0x368a87}));torus.rotation.x=Math.PI/2;root.add(torus);
 const core=new THREE.Mesh(new THREE.OctahedronGeometry(.9,0),new THREE.MeshStandardMaterial({color:0x54d8b7,emissive:0x176857,emissiveIntensity:1.1}));core.position.y=2.6;root.add(core);
 const stem=new THREE.Mesh(new THREE.CylinderGeometry(.22,.33,2.4,8),metal);stem.position.y=1.2;root.add(stem);
 relayGroup.add(root);relays.set(id,{root,torus,core});
}
const remoteGroup=new THREE.Group();scene.add(remoteGroup);
const remoteViews=new Map();
function makeFighter(color=0xff693e){
 const root=new THREE.Group();
 const m=mat(color,.6),black=mat(0x10232b,.75);
 box(root,.85,1.05,.55,0,-.35,0,m);
 box(root,.64,.62,.61,0,.54,0,m);
 const visor=box(root,.54,.2,.12,0,.56,-.34,bright);visor.material=bright;
 for(const x of [-.28,.28]){box(root,.24,.72,.28,x,-1.17,0,black);box(root,.28,.85,.3,x*1.9,-.4,0,black);}
 box(root,.75,.14,.62,0,-.92,0,black);
 root.userData.hp=100;return root;
}
const bossMesh=new THREE.Group();scene.add(bossMesh);
const bossShell=new THREE.Group();bossMesh.add(bossShell);
box(bossShell,4.8,4.8,3.6,0,0,0,metal);
box(bossShell,5.8,1.2,2,0,1.6,0,dark);
for(const s of [-1,1]){
 box(bossShell,1.8,4.4,1.9,s*3.2,0,0,metal);
 box(bossShell,2.15,1.35,2.15,s*3.25,-1.15,-.3,dark);
 const armCannon=new THREE.Mesh(new THREE.CylinderGeometry(.5,.65,2.7,12),bright);
 armCannon.rotation.x=Math.PI/2;armCannon.position.set(s*3.2,-.3,-2);bossShell.add(armCannon);
}
const weakLeft=box(bossShell,1.1,1.1,.25,-1.1,1.1,-1.93,new THREE.MeshBasicMaterial({color:0xffdf89}));
const weakRight=box(bossShell,1.1,1.1,.25,1.1,1.1,-1.93,new THREE.MeshBasicMaterial({color:0x6f5141}));
bossMesh.visible=false;
const aimRay=new THREE.Raycaster();aimRay.far=11;
function canPlace(){
 aimRay.setFromCamera(new THREE.Vector2(0,0),camera);
 const hits=aimRay.intersectObjects([ground,...[...partViews.values()].map(x=>x.root)],true);
 if(!hits.length)return null;
 const hit=hits[0],normal=hit.face?.normal?.clone()?.transformDirection(hit.object.matrixWorld)||new THREE.Vector3(0,1,0);
 const point=hit.point.clone().addScaledVector(normal,.95);
 const snap=v=>Math.round(v/2)*2;
 point.set(snap(point.x),Math.max(.95,Math.round((point.y-.95)/2)*2+.95),snap(point.z));
 if(point.distanceTo(camera.position)>10.5||Math.abs(point.x)>54||Math.abs(point.z)>54||point.y>12)return null;
 return point;
}
function makePlacement(){
 const p=canPlace();if(!p){toast('設置できる場所に近づいてください');return;}
 send({t:'place',kind:chosenKind,rot:rotation,pos:net(p)});
 playTone(355,.09,'square',.02);
}
function send(obj){if(ws?.readyState===WebSocket.OPEN){try{ws.send(JSON.stringify(obj))}catch{}}}
function connect(mode,invite=''){
 if(ws){ws.onclose=null;ws.close();}
 gameMode=mode;connected=false;playing=false;gameState=null;me='';roomId='';
 $('menu').hidden=true;$('waiting').hidden=true;$('matchEnd').hidden=true;
 setPhase('CONNECTING');$('statusline').textContent='サーバーに接続中…';
 const host=location.host,protocol=location.protocol==='https:'?'wss:':'ws:';
 try{ws=new WebSocket(protocol+'//'+host+'/socket');}
 catch{toast('WebSocketの起動に失敗しました');returnToMenu();return;}
 ws.onopen=()=>{
  send({t:'join',mode,room:invite,name:$('nickname').value.slice(0,16),gun,plan});
 };
 ws.onmessage=e=>{let data;try{data=JSON.parse(e.data)}catch{return;}onPacket(data);};
 ws.onerror=()=>{toast('サーバーとの接続に失敗しました');};
 ws.onclose=()=>{if($('menu').hidden&&!$('matchEnd').hidden)return;if($('menu').hidden){toast('接続が切れました');returnToMenu();}};
}
function onPacket(m){
 if(m.t==='error'){toast(m.message||'接続エラー');returnToMenu();return;}
 if(m.t==='welcome'){
  me=m.playerId;roomId=m.id;connected=true;gameMode=m.mode;camera.position.set(m.pos.x,m.pos.y,m.pos.z);yaw=0;pitch=0;rotateCamera();
  currentAmmo=m.ammo;stats=m.gun;stock=sanitizePlan(m.inv);currentEnergy=150;renderAmmo();setPhase(gameMode.toUpperCase());$('statusline').textContent='ROOM '+roomId;
  return;
 }
 if(m.t==='lobby'){
  $('waiting').hidden=false;playing=false;lobbyHost=m.host;
  $('waitCode').textContent=m.id;
  $('waitMembers').textContent=(m.players||[]).map(p=>p.name).join(' · ');
  $('startRoom').disabled=me!==lobbyHost;
  $('startRoom').textContent=m.players?.length===1?'CPUを追加して開始':'この人数で開始';
  return;
 }
 if(m.t==='begin'){
  $('waiting').hidden=true;playing=true;buildMode=false;remaining=285;currentHp=100;
  setPhase(gameMode==='boss'?'CORE BREAKER':'SCRAP CLASH');
  $('statusline').textContent='ルーム '+roomId+' · '+(gameMode==='boss'?'弱点を狙え':'リレー A / B / C を確保');
  $('buildReadout').hidden=true;$('matchEnd').hidden=true;$('bossHud').hidden=gameMode!=='boss';$('inviteTop').hidden=gameMode==='solo';
  $('objectiveHud').style.display=gameMode==='boss'?'none':'flex';relayGroup.visible=gameMode!=='boss';
  if(!touchEnabled)toast('画面をクリックして視点固定 · Bで建築');
  else toast('右側をドラッグして視点移動');
  playTone(700,.25);
  return;
 }
 if(m.t==='state'){applyState(m);return;}
 if(m.t==='event'){feed(String(m.message||''));return;}
 if(m.t==='hit'){
  const mark=$('hitmarker');mark.style.opacity='1';
  setTimeout(()=>mark.style.opacity='0',120);
  playTone(920,.06,'sine',.038);return;
 }
 if(m.t==='ammo'){
  currentAmmo=m.ammo;isReloading=m.reload;
  renderAmmo();
  if(isReloading)toast('リロード中 · '+Number(m.time).toFixed(1)+'秒');
  return;
 }
 if(m.t==='inventory'){stock=sanitizePlan(m.inv);return;}
 if(m.t==='grabbing'){grabId=m.id;toast(grabId?'物体を保持中 · 離すと投げます':'物体を投げました');return;}
 if(m.t==='shot'){
  flashLine(m.from,m.to,m.by===me?palette.cyan:palette.orange);if(m.by===me)muzzleFlash.intensity=5;return;
 }
 if(m.t==='break'){burst(m.pos,palette.orange);playTone(190,.15,'sawtooth',.02);return;}
 if(m.t==='explosion'){shockRing(m.pos,m.radius,palette.orange,350);burst(m.pos,0xffaf7e);playTone(130,.24,'sawtooth',.07);return;}
 if(m.t==='telegraph'){
  const tint=m.kind==='wave'?0xfbbd60:0xff6c6c;
  shockRing(m.pos,m.radius,tint,1200);feed('⚠ '+(m.kind==='wave'?'衝撃波をジャンプで避けろ！':'赤い範囲から離れろ！'));playTone(275,.2,'sawtooth',.035);return;
 }
 if(m.t==='impact'){shockRing(m.pos,m.radius,0xff6357,300);return;}
 if(m.t==='respawn'){
  camera.position.set(m.pos.x,m.pos.y,m.pos.z);currentHp=100;vy=0;respawning=false;
  $('damageOverlay').style.opacity='0';toast('復帰！ 1.8秒の無敵時間');return;
 }
 if(m.t==='ended'){showResult(m);return;}
}
function renderAmmo(){
 $('ammoText').textContent=isReloading?'RELOAD':currentAmmo+' / '+stats.mag;
}
function applyState(s){
 gameState=s;remaining=s.remaining;$('timer').textContent=String(Math.floor(remaining/60)).padStart(2,'0')+':'+String(remaining%60).padStart(2,'0');
 const mine=s.players.find(x=>x.id===me);
 if(mine){
  if(mine.hp<currentHp){$('damageOverlay').style.opacity='.7';setTimeout(()=>$('damageOverlay').style.opacity='0',300);playTone(170,.10,'sawtooth',.04);}
  currentHp=mine.hp;currentEnergy=mine.energy;respawning=!mine.alive;
  $('hpText').textContent=mine.alive?mine.hp:'DOWN';
  $('hpMeter').style.width=mine.hp+'%';
  $('buildReadout').textContent=names[chosenKind]+' · '+(stock[chosenKind]||0)+'個 · '+currentEnergy+' EN';
 }
 const board=$('scoreboard');board.replaceChildren();
 const all=[...s.players,...(s.bot?[s.bot]:[])].sort((a,b)=>b.score-a.score||b.kills-a.kills);
 for(const p of all){
  const el=document.createElement('div');el.className='score'+(p.id===me?' mine':'')+(!p.alive?' dead':'');
  const n=document.createElement('small');n.textContent=p.name;
  const v=document.createElement('strong');v.textContent=gameMode==='boss'?p.kills:p.score;
  el.append(n,v);board.append(el);
 }
 for(const p of all){
  if(p.id===me)continue;
  let view=remoteViews.get(p.id);
  if(!view){view={root:makeFighter(p.id==='BOT'?0xfca837:0xe95847),target:new THREE.Vector3()};remoteViews.set(p.id,view);remoteGroup.add(view.root);}
  view.target.set(p.pos.x,p.pos.y-.2,p.pos.z);view.root.visible=p.alive;
  view.root.userData.hp=p.hp;
 }
 for(const [id,view] of remoteViews)if(!all.some(p=>p.id===id)){remoteGroup.remove(view.root);remoteViews.delete(id);}
 const seen=new Set();
 for(const part of s.parts){
  seen.add(part.id);
  let view=partViews.get(part.id);
  if(!view){const root=buildPart(part.kind);root.userData.partId=part.id;partGroup.add(root);view={root,target:new THREE.Vector3(),rot:part.rot,kind:part.kind};partViews.set(part.id,view);}
  view.target.set(part.pos.x,part.pos.y,part.pos.z);view.root.rotation.y=part.angle===null?(part.rot||0)*Math.PI/2:part.angle;
 }
 for(const [id,view] of partViews)if(!seen.has(id)){partGroup.remove(view.root);partViews.delete(id);}
 if(s.boss){
  bossMesh.visible=s.boss.hp>0;
  bossMesh.position.set(s.boss.pos.x,s.boss.pos.y,s.boss.pos.z);
  weakLeft.material.color.setHex(s.boss.weakspot===0?0xffe48d:0x7c5353);
  weakRight.material.color.setHex(s.boss.weakspot===1?0xffe48d:0x7c5353);
  $('bossPhase').textContent='PHASE '+s.boss.phase;
  $('bossMeter').style.width=(100*s.boss.hp/s.boss.maxHp)+'%';
 }else bossMesh.visible=false;
 if(gameMode!=='boss'){
  const hud=$('objectiveHud');hud.replaceChildren();
  for(const relay of s.relays){
   const own=relay.owner===me,enemy=relay.owner&&!own;
   const el=document.createElement('div');el.className='relay'+(own?' owned':enemy?' enemy':'');
   el.textContent='RELAY '+relay.id+' · '+(own?'YOU':enemy?'ENEMY':'NEUTRAL')+(relay.progress>0&&relay.owner!==relay.claimer?' · '+relay.progress+'%':'');
   hud.append(el);
   const visual=relays.get(relay.id);if(visual){
    const hex=own?0x42f4c4:enemy?0xff9475:0x4f9aa0;
    visual.torus.material.color.setHex(hex);visual.core.material.color.setHex(hex);
   }
  }
 }
 for(let i=0;i<Math.min(50,s.debris?.length||0);i++){
  // Debris is deliberately drawn with the shared instanced mesh below.
 }
 updateDebris(s.debris||[]);
}
const debrisGeometry=new THREE.BoxGeometry(.4,.4,.4);
const debrisMaterial=mat(0x7e9aa1,.9);
const debrisInstances=new THREE.InstancedMesh(debrisGeometry,debrisMaterial,50);scene.add(debrisInstances);
debrisInstances.count=0;
const dummy=new THREE.Object3D();
function updateDebris(data){
 debrisInstances.count=Math.min(50,data.length);
 data.slice(0,50).forEach((d,i)=>{
  dummy.position.set(d.pos.x,d.pos.y,d.pos.z);dummy.scale.setScalar(Math.max(.2,d.size*4));dummy.rotation.set(0,0,0);dummy.updateMatrix();debrisInstances.setMatrixAt(i,dummy.matrix);
 });
 debrisInstances.instanceMatrix.needsUpdate=true;
}
function showResult(m){
 playing=false;fireHeld=false;grabHeld=false;buildMode=false;document.exitPointerLock?.();
 $('waiting').hidden=true;$('matchEnd').hidden=false;setPhase('ROUND COMPLETE');
 const victory=m.winner==='TEAM'||m.winner===me;
 $('endTitle').textContent=gameMode==='boss'?(victory?'BOSS DESTROYED':'MISSION FAILED'):(victory?'VICTORY':'ROUND FINISHED');
 $('endDetail').textContent=m.message||'試合終了';
 const host=$('endStats');host.replaceChildren();
 const mine=(m.scores||[]).find(x=>x.id===me);
 for(const [label,value] of [['SCORE',mine?.score??0],['KOs',mine?.kills??0],['DAMAGE',mine?.damage??0]]){
  const item=document.createElement('div'),b=document.createElement('b'),l=document.createElement('small');
  b.textContent=value;l.textContent=label;item.append(b,l);host.append(item);
 }
 playTone(victory?750:310,.38);
}
function returnToMenu(){
 playing=false;connected=false;gameState=null;roomId='';me='';grabId=null;
 if(ws){const old=ws;ws=null;old.onclose=null;try{old.close();}catch{}}
 document.exitPointerLock?.();$('menu').hidden=false;$('waiting').hidden=true;$('matchEnd').hidden=true;
 $('scoreboard').replaceChildren();$('objectiveHud').replaceChildren();
 $('bossHud').hidden=true;$('inviteTop').hidden=true;relayGroup.visible=true;setPhase('GARAGE');
 $('statusline').textContent='';
 for(const view of remoteViews.values())remoteGroup.remove(view.root);remoteViews.clear();
 for(const view of partViews.values())partGroup.remove(view.root);partViews.clear();
 bossMesh.visible=false;camera.position.set(0,1.65,32);yaw=0;pitch=0;rotateCamera();
}
$('solo').onclick=()=>connect('solo');
$('pvp').onclick=()=>connect('pvp');
$('boss').onclick=()=>connect('boss');
$('join').onclick=()=>{
 const code=$('joinCode').value.trim().toUpperCase();
 if(!/^[0-9A-F]{6}$/.test(code)){toast('ルームコードは6桁の英数字です');return;}
 connect('pvp',code);
};
$('startRoom').onclick=()=>{send({t:'start'});if(!touchEnabled)Promise.resolve(renderer.domElement.requestPointerLock?.()).catch(()=>{});};
$('leaveRoom').onclick=returnToMenu;
$('inviteTop').onclick=()=>{const url=new URL(location.href);url.searchParams.set('room',roomId);navigator.clipboard?.writeText(url.href).then(()=>toast('招待URLをコピーしました')).catch(()=>toast('ルームID: '+roomId));};
$('copyRoom').onclick=()=>{
 const url=new URL(location.href);url.searchParams.set('room',roomId);
 navigator.clipboard?.writeText(url.href).then(()=>toast('招待URLをコピーしました')).catch(()=>toast('コード: '+roomId));
};
$('backHome').onclick=returnToMenu;
$('replay').onclick=()=>{const last=gameMode;returnToMenu();connect(last);};
const qs=new URLSearchParams(location.search);if(/^[0-9A-F]{6}$/i.test(qs.get('room')||'')){
 $('joinCode').value=qs.get('room').toUpperCase();setTab('play');toast('招待されたルームへ参加できます');
}
fetch('/healthz',{cache:'no-store'}).then(r=>r.ok?r.json():Promise.reject()).then(()=>$('networkStatus').textContent='SERVER ONLINE').catch(()=>$('networkStatus').textContent='LOCAL CLIENT / SERVER UNAVAILABLE');
function fire(){
 if(!playing||buildMode||respawning||!connected)return;
 if(isReloading||currentAmmo<=0)return;
 const now=performance.now();if(now-lastFire<stats.ms)return;
 lastFire=now;currentAmmo--;renderAmmo();
 const d=forward();send({t:'shoot',dir:net(d)});
 playTone(gun.core==='plasma'?410:170,.06,'sawtooth',.026);
 shotKick=stats.recoil*.017;pitch=clamp(pitch-stats.recoil*.010*(touchEnabled?.72:1),-1.48,1.48);yaw+=(Math.random()-.5)*stats.spread*.22;rotateCamera();muzzleFlash.intensity=4;
}
function build(){if(!playing||!connected||respawning)return;makePlacement();}
function trigger(){if(buildMode)build();else fire();}
function setBuild(value){
 if(!playing)return;
 buildMode=!!value;$('buildReadout').hidden=!buildMode;
 setPhase(buildMode?'CONSTRUCT':gameMode==='boss'?'CORE BREAKER':'SCRAP CLASH');
 toast(buildMode?'建築モード · 1〜8 パーツ選択':'戦闘モード');
}
function getAimPart(){
 aimRay.setFromCamera(new THREE.Vector2(0,0),camera);
 const hits=aimRay.intersectObjects([...partViews.values()].map(v=>v.root),true);
 for(const hit of hits){
  let obj=hit.object;
  while(obj&&obj.userData.partId===undefined)obj=obj.parent;
  if(!obj||hit.distance>9)continue;
  const view=partViews.get(obj.userData.partId);
  if(view&&['barrel','magnet'].includes(view.kind))return obj.userData.partId;
 }
 return null;
}
function grabStart(){
 if(!playing||!connected||buildMode)return;
 const id=getAimPart();if(!id){toast('近くのタンクか磁力ブロックを狙ってください');return;}
 grabHeld=true;send({t:'physics',action:'grab',id,dir:net(forward())});
}
function grabStop(){if(!grabHeld&&!grabId)return;grabHeld=false;send({t:'physics',action:'throw',dir:net(forward())});}
renderer.domElement.addEventListener('pointerdown',e=>{
 if(touchEnabled||!playing||$('waiting').hidden===false||$('matchEnd').hidden===false)return;
 if(!locked){renderer.domElement.requestPointerLock?.().catch(()=>{});return;}
 if(e.button===0){fireHeld=true;trigger();}
 if(e.button===2)grabStart();
});
document.addEventListener('pointerup',e=>{if(e.button===0)fireHeld=false;if(e.button===2)grabStop();});
renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());
document.addEventListener('pointerlockchange',()=>locked=document.pointerLockElement===renderer.domElement);
document.addEventListener('mousemove',e=>{
 if(!locked||!playing)return;
 yaw-=e.movementX*.00215;pitch=clamp(pitch-e.movementY*.00215,-1.48,1.48);rotateCamera();
});
document.addEventListener('keydown',e=>{
 if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName))return;
 key[e.code]=true;
 if(['Space','ArrowUp','ArrowDown'].includes(e.code))e.preventDefault();
 if(e.repeat)return;
 if(e.code==='BracketRight')setBrightness(brightness+10);
 if(e.code==='BracketLeft')setBrightness(brightness-10);
 if(e.code==='KeyB')setBuild(!buildMode);
 if(e.code==='KeyR'&&buildMode)rotation=(rotation+1)%4;
 else if(e.code==='KeyR'||e.code==='KeyF'){if(playing)send({t:'reload'});}
 if(e.code==='KeyQ'&&playing)send({t:'emote',emote:'ナイス！'});
 if(/^Digit[1-8]$/.test(e.code))changeKind(Object.keys(PARTS)[Number(e.code[5])-1]);
});
document.addEventListener('keyup',e=>{key[e.code]=false;});
window.addEventListener('blur',()=>{for(const k of Object.keys(key))key[k]=false;fireHeld=false;grabStop();});
if(touchEnabled){
 document.body.classList.add('touch');$('mobile').hidden=false;
 let joystickId=null,origin=null;
 const stickEl=$('stick');
 stickEl.addEventListener('pointerdown',e=>{e.preventDefault();joystickId=e.pointerId;origin={x:e.clientX,y:e.clientY};stickEl.setPointerCapture(e.pointerId);});
 stickEl.addEventListener('pointermove',e=>{
  if(e.pointerId!==joystickId||!origin)return;
  stick.x=clamp((e.clientX-origin.x)/49,-1,1);stick.y=clamp((e.clientY-origin.y)/49,-1,1);
  $('nub').style.transform='translate('+(stick.x*37)+'px,'+(stick.y*37)+'px)';
 });
 for(const ev of ['pointerup','pointercancel'])stickEl.addEventListener(ev,()=>{joystickId=null;stick.x=0;stick.y=0;$('nub').style.transform='translate(0,0)';});
 let lookId=null,lastLookTouch=null;
 $('touchLook').addEventListener('pointerdown',e=>{lookId=e.pointerId;lastLookTouch={x:e.clientX,y:e.clientY};$('touchLook').setPointerCapture(e.pointerId);});
 $('touchLook').addEventListener('pointermove',e=>{
  if(e.pointerId!==lookId||!lastLookTouch||!playing)return;
  yaw-=(e.clientX-lastLookTouch.x)*.006;pitch=clamp(pitch-(e.clientY-lastLookTouch.y)*.006,-1.48,1.48);
  lastLookTouch={x:e.clientX,y:e.clientY};rotateCamera();
 });
 for(const ev of ['pointerup','pointercancel'])$('touchLook').addEventListener(ev,()=>{lookId=null;lastLookTouch=null;});
 const bindHold=(id,on,off)=>{
  const el=$(id);el.addEventListener('pointerdown',e=>{e.preventDefault();on();el.setPointerCapture(e.pointerId);});
  for(const ev of ['pointerup','pointercancel'])el.addEventListener(ev,e=>{e.preventDefault();off?.();});
 };
 bindHold('touchFire',()=>{fireHeld=true;trigger();},()=>fireHeld=false);
 bindHold('touchGrab',grabStart,grabStop);
 bindHold('touchJump',()=>key.Space=true,()=>key.Space=false);
 bindHold('touchBuild',()=>setBuild(!buildMode));
}
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
function collide(x,z){
 if(Math.abs(x)>54||Math.abs(z)>54)return true;
 if(!gameState)return false;
 for(const p of gameState.parts){
  if(Math.abs(camera.position.y-p.pos.y)>2.0)continue;
  if(Math.abs(x-p.pos.x)<1.17&&Math.abs(z-p.pos.z)<1.17)return true;
 }
 return false;
}
let lastFrame=performance.now();
function loop(now){
 requestAnimationFrame(loop);const dt=clamp((now-lastFrame)/1000,.001,.05);lastFrame=now;
 const menuOpen=!$('menu').hidden;
 if(playing&&$('waiting').hidden&&$('matchEnd').hidden){
  const ahead=Number(key.KeyW||key.ArrowUp)-Number(key.KeyS||key.ArrowDown)-stick.y;
  const sideways=Number(key.KeyD||key.ArrowRight)-Number(key.KeyA||key.ArrowLeft)+stick.x;
  const speed=(key.ShiftLeft?10.5:7.1)*(gun.frame==='heavy'?.92:gun.frame==='light'?1.06:1);
  const front=new THREE.Vector3(-Math.sin(yaw),0,-Math.cos(yaw)),right=new THREE.Vector3(Math.cos(yaw),0,-Math.sin(yaw));
  const move=front.multiplyScalar(ahead).addScaledVector(right,sideways);
  if(move.length()>1)move.normalize();
  const nx=camera.position.x+move.x*speed*dt,nz=camera.position.z+move.z*speed*dt;
  if(!collide(nx,camera.position.z))camera.position.x=nx;
  if(!collide(camera.position.x,nz))camera.position.z=nz;
  if((key.Space)&&onGround){vy=7.7;onGround=false;}
  vy-=22*dt;camera.position.y+=vy*dt;
  if(camera.position.y<=1.65){camera.position.y=1.65;vy=0;onGround=true;}
  if(gameState)for(const part of gameState.parts)if(part.kind==='spring'&&onGround&&Math.hypot(camera.position.x-part.pos.x,camera.position.z-part.pos.z)<1.6){vy=12;onGround=false;}
  const motion=move.length();stepPhase+=dt*motion*10;
  viewWeapon.position.y=-.44+Math.sin(stepPhase)*motion*.02;
  shotKick=THREE.MathUtils.damp(shotKick,0,10,dt);
  viewWeapon.rotation.x=-shotKick;
  if(fireHeld)trigger();
  if(now-lastMove>85){lastMove=now;send({t:'move',pos:net(camera.position)});}
  if(now-lastLook>100){lastLook=now;send({t:'look',dir:net(forward())});}
 }
 viewWeapon.visible=playing&&!buildMode&&!respawning;
 muzzleFlash.intensity=Math.max(0,muzzleFlash.intensity-dt*47);
 if(playing&&buildMode){
  const p=canPlace();ghost.visible=!!p;
  if(p){ghost.position.copy(p);ghost.rotation.y=rotation*Math.PI/2;}
 }else ghost.visible=false;
 for(const view of remoteViews.values()){
  view.root.position.lerp(view.target,Math.min(1,dt*13));
  view.root.rotation.y=Math.atan2(camera.position.x-view.root.position.x,camera.position.z-view.root.position.z);
 }
 for(const view of partViews.values())view.root.position.lerp(view.target,Math.min(1,dt*18));
 for(const [id,obj] of relays.entries()){
  obj.core.rotation.y+=dt*.65;
  obj.core.position.y=2.6+Math.sin(now*.002+(id==='A'?0:id==='B'?1:2))*.22;
 }
 if(bossMesh.visible){bossShell.rotation.y=Math.sin(now*.0005)*.07;bossMesh.position.y+=0;}
 for(let i=particles.length-1;i>=0;i--){
  const p=particles[i],t=(now-p.start)/p.duration;
  if(t>=1){
   effectGroup.remove(p.mesh);p.mesh.geometry.dispose();p.mesh.material.dispose();particles.splice(i,1);
  }else{
   p.mesh.material.opacity=clamp(1-t,0,1)*.82;
   if(p.expand)p.mesh.scale.setScalar(1+p.expand*t);
  }
 }
 if(menuOpen){
  camera.position.set(Math.sin(now*.00011)*27,8,32+Math.cos(now*.0001)*3);
  camera.lookAt(0,2,0);yaw=0;pitch=0;
 }
 renderer.render(scene,camera);
}
changeKind('steel');
requestAnimationFrame(loop);
