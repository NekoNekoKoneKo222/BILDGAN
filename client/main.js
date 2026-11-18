import * as THREE from 'three';
import {PARTS,GUN_MODULES,DEFAULT_GUN,DEFAULT_PLAN,MAX_BUILD_PIECES,weaponStats,sanitizeGun,sanitizePlan} from '../server/rules.js';
import './style.css';
import {readMoveAxes} from '../shared/movement.js';
import {ARENA_SOLIDS,CORE_LOCATIONS} from '../shared/arena.js';
import {blockedSweep} from '../shared/collision.js';

const $=id=>document.getElementById(id);
// Daylight arena: prioritize silhouettes, target visibility and readable building pieces.
const palette={bg:0xb4d9e8,floor:0x748f87,cyan:0x3cf9dd,orange:0xffa367,blue:0x3185b2,red:0xff5962};
const STORAGE='bildgan-v2-';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const names={steel:'強化装甲',ramp:'斜面',barrel:'爆発タンク',spring:'ジャンプパッド',turret:'自動砲台',magnet:'磁力ブロック',piston:'昇降ピストン',rotor:'回転ブレード'};
const hints={steel:'遮蔽物と高い耐久値',ramp:'高低差を作り射線を変える',barrel:'爆発と物理連鎖',spring:'ジャンプして奇襲',turret:'近くの敵を自動攻撃',magnet:'磁力で周囲の動的パーツを引く',piston:'周期的な昇降で物体を押し上げる',rotor:'近接する対象へ連続ダメージ'};
let gun=sanitizeGun(readJson('gun',DEFAULT_GUN)),plan=sanitizePlan(readJson('plan',DEFAULT_PLAN)),stock={...plan};
let stats=weaponStats(gun),chosenKind='steel',rotation=0,buildMode=false;
let ws=null,gameMode='',gameRule='fortress',matchPhase='prep',myTeam='A',myHome=null,myReady=false,roomId='',me='',connected=false,gameState=null,remaining=285,lobbyHost='';
let currentHp=100,currentAmmo=stats.mag,currentEnergy=150,isReloading=false,grabId=null;
let playing=false,fireHeld=false,grabHeld=false,locked=false,respawning=false,lastMove=0,lastLook=0,lastFire=0,lastClock=0,menuTab='play';
let toastTimer=0;
const key={},stick={x:0,y:0},touchEnabled=matchMedia('(pointer:coarse)').matches;
// iPad Safari gesture suppression. Menus remain scrollable, inputs remain editable.
const editableTarget=target=>target?.closest?.('input, textarea, [contenteditable="true"]');
document.addEventListener('selectstart',e=>{if(!editableTarget(e.target))e.preventDefault();});
document.addEventListener('contextmenu',e=>{if(!editableTarget(e.target))e.preventDefault();});
document.addEventListener('dblclick',e=>e.preventDefault(),{passive:false});
document.addEventListener('gesturestart',e=>e.preventDefault(),{passive:false});
document.addEventListener('gesturechange',e=>e.preventDefault(),{passive:false});
document.addEventListener('gestureend',e=>e.preventDefault(),{passive:false});
document.addEventListener('touchmove',e=>{if(e.touches.length>=2)e.preventDefault();},{passive:false});
let touchTapLast=0;
document.addEventListener('touchend',e=>{
 if(editableTarget(e.target))return;
 const now=performance.now();
 if(now-touchTapLast<320)e.preventDefault();
 touchTapLast=now;
},{passive:false});
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
// Unlit arena floor stays clearly visible even if the device's lighting path is faulty.
const ground=new THREE.Mesh(new THREE.PlaneGeometry(124,124),new THREE.MeshBasicMaterial({color:0x91b3a5,side:THREE.DoubleSide}));
ground.rotation.x=-Math.PI/2;ground.userData.ground=true;scene.add(ground);
const grid=new THREE.GridHelper(122,61,0xb2e7d7,0x92b8b2);grid.position.y=.013;scene.add(grid);
const trim=new THREE.Group();scene.add(trim);
const box=(parent,w,h,d,x,y,z,m)=>{const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);o.position.set(x,y,z);parent.add(o);return o};
// High-contrast ground lanes, geometry and goal silhouettes: visible from EVERY spawn.
// Basic materials intentionally remain legible independent of the 3D lighting setup.
const laneA=new THREE.MeshBasicMaterial({color:0x325f69,side:THREE.DoubleSide});
const laneB=new THREE.MeshBasicMaterial({color:0xc2d8c4,side:THREE.DoubleSide});
const laneEdge=new THREE.MeshBasicMaterial({color:0x67f0d1,side:THREE.DoubleSide});
const gateMat=new THREE.MeshBasicMaterial({color:0x365367});
const gateTrim=new THREE.MeshBasicMaterial({color:0xffcb66});
function groundStripe(x,z,w,d,m,y=.035){box(trim,w,.025,d,x,y,z,m);}
for(const x of [-24,0,24]){
 groundStripe(x,0,11,104,laneA);
 groundStripe(x-6,0,.23,105,laneEdge,.055);
 groundStripe(x+6,0,.23,105,laneEdge,.055);
 for(let z=-44;z<=44;z+=10)groundStripe(x,z,3,.34,laneB,.06);
}
for(const z of [-34,34]){
 groundStripe(0,z,106,7,laneA);
 groundStripe(0,z-4,106,.2,laneEdge,.06);
 groundStripe(0,z+4,106,.2,laneEdge,.06);
}
// Bright outer-wall gates establish distance and silhouette; players stay inside them.
for(const x of [-51,51])for(const z of [-38,-15,15,38]){
 box(trim,3.8,10,3.8,x,5,z,gateMat);
 box(trim,4.2,.42,4.2,x,10.3,z,gateTrim);
 box(trim,.8,4,.24,x,5,z+(x<0?2.04:-2.04),laneEdge);
}
for(const z of [-51,51])for(const x of [-35,-12,12,35]){
 box(trim,3.8,9,3.8,x,4.5,z,gateMat);
 box(trim,4.4,.45,4.4,x,9.35,z,gateTrim);
}
const helipad=new THREE.Mesh(new THREE.RingGeometry(9.2,10.2,64),new THREE.MeshBasicMaterial({color:0xffd578,side:THREE.DoubleSide}));
helipad.rotation.x=-Math.PI/2;helipad.position.y=.115;trim.add(helipad);
function makeBeaconLabel(text,color){
 const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;
 const ctx=canvas.getContext('2d');ctx.clearRect(0,0,512,128);
 ctx.fillStyle='rgba(8,35,48,0.86)';ctx.fillRect(5,5,502,118);
 ctx.strokeStyle=color;ctx.lineWidth=8;ctx.strokeRect(5,5,502,118);
 ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='900 61px system-ui,sans-serif';ctx.fillStyle='white';ctx.fillText(text,256,65,490);
 const tex=new THREE.CanvasTexture(canvas);tex.colorSpace=THREE.SRGBColorSpace;
 const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,depthTest:false,transparent:true}));
 sprite.scale.set(8.5,2.1,1);return sprite;
}
for(const [label,x] of [['A',-24],['B',0],['C',24]]){
 const marker=new THREE.Group();marker.position.set(x,0,0);
 const tower=new THREE.Mesh(new THREE.CylinderGeometry(.9,1.45,7.5,10),new THREE.MeshBasicMaterial({color:0x255667}));tower.position.y=3.75;marker.add(tower);
 const light=new THREE.Mesh(new THREE.SphereGeometry(.72,12,8),new THREE.MeshBasicMaterial({color:0xffe28d}));light.position.y=8;marker.add(light);
 const labelSprite=makeBeaconLabel('RELAY '+label,'#6cf9d1');labelSprite.position.y=11;marker.add(labelSprite);
 // A broad glowing target triangle for a distant landmark.
 const tip=new THREE.Mesh(new THREE.ConeGeometry(2,2.8,4),new THREE.MeshBasicMaterial({color:0x3ceccc}));
 tip.position.y=8.1;tip.rotation.y=Math.PI/4;marker.add(tip);
 trim.add(marker);
}
// Distant skyline breaks up the horizon while staying outside the combat floor.
for(let i=0;i<20;i++){
 const angle=i*Math.PI*2/20;
 const x=Math.sin(angle)*67,z=Math.cos(angle)*67;
 const h=12+(i%4)*4;
 box(trim,7,h,7,x,h/2,z,i%3===0?gateMat:metal);
 box(trim,7.6,.5,7.6,x,h+.25,z,i%2?gateTrim:laneEdge);
}
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
const coreGlow=new THREE.Mesh(new THREE.TorusGeometry(.21,.05,8,16),new THREE.MeshBasicMaterial({color:0x72f6db}));
coreGlow.rotation.y=Math.PI/2;coreGlow.position.z=-.18;arm.add(coreGlow);
const coreColors={kinetic:0x5debcf,plasma:0xe393ff,pulse:0x76f6a1,scatter:0xffc868,breaker:0xff7f69};
let yaw=0,pitch=0,vy=0,onGround=true,shotKick=0,stepPhase=0;
// Spawn and respawn always face the center of the fighting area.
function orientTowardArena(){
 yaw=Math.atan2(camera.position.x,camera.position.z);
 pitch=-.105;
 rotateCamera();
}
function rotateCamera(){camera.rotation.set(pitch,yaw,0);camera.updateMatrixWorld(true);}
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

// GPU-conscious VFX budget; effects are tied to server-confirmed impacts.
const effectsOptions=['low','medium','high'];
let effectsQuality=localStorage.getItem(STORAGE+'effects')||(touchEnabled?'low':'medium');
if(!effectsOptions.includes(effectsQuality))effectsQuality='medium';
$('effectsSetting').value=effectsQuality;
$('effectsSetting').addEventListener('change',e=>{
 effectsQuality=effectsOptions.includes(e.target.value)?e.target.value:'medium';
 localStorage.setItem(STORAGE+'effects',effectsQuality);toast('エフェクト品質: '+effectsQuality);
});
const fxCount=()=>effectsQuality==='low'?3:effectsQuality==='medium'?7:12;
const fxLimit=()=>effectsQuality==='low'?35:effectsQuality==='medium'?75:140;
const particles=[],effectGroup=new THREE.Group();scene.add(effectGroup);
function removeEffect(p){effectGroup.remove(p.mesh);p.mesh.geometry.dispose();p.mesh.material.dispose();}
function addEffect(mesh,duration=450,expand=0,velocity=null){
 while(particles.length>=fxLimit())removeEffect(particles.shift());
 effectGroup.add(mesh);particles.push({mesh,start:performance.now(),duration,expand,velocity});
}
function flashLine(a,b,color=palette.cyan){
 const A=new THREE.Vector3(a.x,a.y,a.z),B=new THREE.Vector3(b.x,b.y,b.z);
 const delta=new THREE.Vector3().subVectors(B,A),len=delta.length();
 if(len<.1)return;
 const mesh=new THREE.Mesh(new THREE.CylinderGeometry(.04,.065,len,5),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.94,depthWrite:false}));
 mesh.position.copy(A.add(B).multiplyScalar(.5));mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());
 addEffect(mesh,150);
}
function shockRing(pos,radius,color,ms=1200){
 const mesh=new THREE.Mesh(new THREE.RingGeometry(Math.max(.2,radius-.22),radius,effectsQuality==='low'?24:48),new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide,transparent:true,opacity:.8,depthWrite:false}));
 mesh.rotation.x=-Math.PI/2;mesh.position.set(pos.x,.09,pos.z);addEffect(mesh,ms,.01);
}
function burst(pos,color){
 for(let i=0;i<fxCount();i++){
  const b=new THREE.Mesh(new THREE.IcosahedronGeometry(.08+Math.random()*.07,0),new THREE.MeshBasicMaterial({color,transparent:true,opacity:1,depthWrite:false}));
  b.position.set(pos.x+Math.random()*.35-.18,pos.y+Math.random()*.4,pos.z+Math.random()*.35-.18);
  const velocity=new THREE.Vector3((Math.random()-.5)*5,2.5+Math.random()*4,(Math.random()-.5)*5);
  addEffect(b,400+Math.random()*300,0,velocity);
 }
}
function impactFlare(pos,color,radius=.7){
 const mesh=new THREE.Mesh(new THREE.IcosahedronGeometry(radius,effectsQuality==='low'?0:1),
  new THREE.MeshBasicMaterial({color,transparent:true,opacity:.78,depthWrite:false,depthTest:true}));
 mesh.position.set(pos.x,pos.y,pos.z);addEffect(mesh,180,1.7);
}
function buildPulse(pos){
 impactFlare(pos,0x6fffe2,.38);shockRing(pos,1.25,0x36dcc5,520);
 if(effectsQuality!=='low')burst(pos,0x7bf7da);
}
function impactEffect(pos,type){
 if(!pos||type==='none')return;
 const color=type==='terrain'?0xffdda6:type==='part'?0xffd57e:type==='core'?0xf7a9ff:type==='boss'?0xff876a:0x74ffff;
 impactFlare(pos,color,type==='core'?.7:.25);
 if(type==='part'||type==='core'||type==='boss')burst(pos,color);
 if(type==='terrain'&&effectsQuality==='high')burst(pos,color);
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
const storedRule=localStorage.getItem(STORAGE+'rule')||'fortress';
$('ruleSelect').value=['fortress','relay','skirmish'].includes(storedRule)?storedRule:'fortress';
$('ruleSelect').addEventListener('change',()=>{localStorage.setItem(STORAGE+'rule',$('ruleSelect').value);gameRule=$('ruleSelect').value;});
gameRule=$('ruleSelect').value;
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
 $('buildAdvice').textContent='固有効果：'+stats.trait+'。 射撃間隔 '+stats.ms+'ms / リロード '+stats.reload.toFixed(2)+'秒 / 射程 '+stats.range+'m。弾の種類により戦い方が変化します。';
 $('weaponName').textContent=GUN_MODULES.barrel[gun.barrel].name.toUpperCase()+' / '+GUN_MODULES.core[gun.core].name.toUpperCase();
 $('weaponMeta').textContent='DMG '+stats.damage+'  ·  '+stats.rpm+' RPM';
 $('gunPreview').textContent=gun.barrel==='long'?'▰━━━━━━━━╾':gun.barrel==='short'?'▰━━╾':'▰━━━━╾';
 barrelMesh.scale.z=gun.barrel==='long'?1.55:gun.barrel==='short'?.65:1;
 viewWeapon.scale.setScalar(gun.frame==='heavy'?1.1:gun.frame==='light'?.87:1);
 coreGlow.material.color.setHex(coreColors[gun.core]||0x5debcf);
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
// Objectives are rendered from the same coordinates the server uses for damage.
const coreGroup=new THREE.Group();scene.add(coreGroup);
const coreModels=new Map();
for(const [team,location] of Object.entries(CORE_LOCATIONS)){
 const group=new THREE.Group();group.position.set(location.x,0,location.z);
 const c=new THREE.MeshBasicMaterial({color:team==='A'?0x4ff5d3:0xff986e});
 box(group,4.6,.65,4.6,0,.3,0,new THREE.MeshBasicMaterial({color:0x355568}));
 const shell=new THREE.Mesh(new THREE.OctahedronGeometry(2.25,0),c);
 shell.position.y=2.05;group.add(shell);
 for(const x of [-2.4,2.4])for(const z of [-2.4,2.4])box(group,.4,3.5,.4,x,1.75,z,new THREE.MeshBasicMaterial({color:0xffffff}));
 const ring=new THREE.Mesh(new THREE.TorusGeometry(3.1,.18,8,40),new THREE.MeshBasicMaterial({color:team==='A'?0x34ceb0:0xffa882}));
 ring.rotation.x=Math.PI/2;ring.position.y=.2;group.add(ring);
 const label=makeBeaconLabel('CORE '+team,team==='A'?'#52dfbe':'#ff9575');label.position.y=7.1;group.add(label);
 coreGroup.add(group);coreModels.set(team,{group,shell,c,ring});
}
coreGroup.visible=false;
const partGroup=new THREE.Group();scene.add(partGroup);
const partViews=new Map();
const ghost=buildPart(chosenKind,true);scene.add(ghost);ghost.visible=false;
// Eight quick-select slots are clickable on iPad; number keys remain on PC.
function refreshHotbar(){
 const bar=$('buildHotbar');bar.replaceChildren();
 for(const [index,kind] of Object.keys(PARTS).entries()){
  const button=document.createElement('button');button.type='button';button.className='buildSlot';
  if(kind===chosenKind)button.classList.add('selected');
  if((stock[kind]||0)===0)button.classList.add('empty');
  button.textContent=(index+1)+' · '+names[kind];
  const count=document.createElement('b');count.textContent=stock[kind]??0;button.append(count);
  button.onclick=()=>{changeKind(kind);playTone(490,.04);};
  bar.append(button);
 }
}
function updateMatchPhase(){
 if(!playing)return;
 const prep=matchPhase==='prep';
 $('prepHud').hidden=!prep;$('readyBuild').disabled=myReady;
 $('readyBuild').textContent=myReady?'準備完了済み（待機中）':'準備完了（全員準備で開戦）';
 if(prep)buildMode=true;
 $('buildReadout').hidden=!buildMode;
 $('buildHotbar').hidden=!buildMode;
 $('objectiveHud').style.display=gameRule==='relay'?'flex':'none';
 $('coreHud').hidden=gameRule!=='fortress';
 coreGroup.visible=gameRule==='fortress';relayGroup.visible=gameRule==='relay';
 setPhase(prep?'BUILD TIME':gameMode==='boss'?'CORE BREAKER':gameRule==='fortress'?'CORE SIEGE':gameRule==='relay'?'RELAY CLASH':'TEAM DEATHMATCH');
 refreshHotbar();
}
$('readyBuild').onclick=()=>{
 if(matchPhase!=='prep'||myReady)return;
 myReady=true;send({t:'ready'});updateMatchPhase();toast('自分の建築作業を完了。ほかのプレイヤーを待っています');
};
function changeKind(kind){
 if(!PARTS[kind])return;
 chosenKind=kind;ghost.clear();
 const fresh=buildPart(kind,true);
 while(fresh.children.length)ghost.add(fresh.children[0]);
 $('buildReadout').textContent=names[chosenKind]+' · '+PARTS[chosenKind].cost+'EN · Rで回転';
 refreshHotbar();
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
 if(matchPhase==='prep'&&myHome&&Math.hypot(point.x-myHome.x,point.z-myHome.z)>9.5)return null;
 if(ARENA_SOLIDS.some(s=>Math.abs(point.x-s.pos.x)<s.half.x+1&&Math.abs(point.z-s.pos.z)<s.half.z+1&&Math.abs(point.y-s.pos.y)<s.half.y+1))return null;
 if(gameRule==='fortress'&&Object.values(CORE_LOCATIONS).some(core=>Math.hypot(point.x-core.x,point.z-core.z)<3.3))return null;
 return point;
}
function makePlacement(){
 const p=canPlace();if(!p){toast('設置できる場所に近づいてください');return;}
 if((stock[chosenKind]||0)<=0){toast('このパーツは在庫切れです');return;}
 send({t:'place',kind:chosenKind,rot:rotation,pos:net(p)});
}
function send(obj){if(ws?.readyState===WebSocket.OPEN){try{ws.send(JSON.stringify(obj))}catch{}}}
function connect(mode,invite=''){
 if(ws){ws.onclose=null;ws.close();}
 gameMode=mode;gameRule=$('ruleSelect').value;matchPhase='prep';myReady=false;myHome=null;connected=false;playing=false;gameState=null;me='';roomId='';
 $('menu').hidden=true;$('waiting').hidden=true;$('matchEnd').hidden=true;
 setPhase('CONNECTING');$('statusline').textContent='サーバーに接続中…';
 const host=location.host,protocol=location.protocol==='https:'?'wss:':'ws:';
 try{ws=new WebSocket(protocol+'//'+host+'/socket');}
 catch{toast('WebSocketの起動に失敗しました');returnToMenu();return;}
 ws.onopen=()=>{
  send({t:'join',mode,room:invite,rule:gameRule,name:$('nickname').value.slice(0,16),gun,plan});
 };
 ws.onmessage=e=>{let data;try{data=JSON.parse(e.data)}catch{return;}onPacket(data);};
 ws.onerror=()=>{toast('サーバーとの接続に失敗しました');};
 ws.onclose=()=>{if($('menu').hidden&&!$('matchEnd').hidden)return;if($('menu').hidden){toast('接続が切れました');returnToMenu();}};
}
function onPacket(m){
 if(m.t==='error'){toast(m.message||'接続エラー');returnToMenu();return;}
 if(m.t==='welcome'){
  me=m.playerId;roomId=m.id;connected=true;gameMode=m.mode;gameRule=m.rule||gameRule;myTeam=m.team||'A';myHome={...m.pos};camera.position.set(m.pos.x,m.pos.y,m.pos.z);orientTowardArena();
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
  $('waiting').hidden=true;playing=true;matchPhase=m.phase||'battle';gameRule=m.rule||gameRule;myReady=false;buildMode=matchPhase==='prep';remaining=285;currentHp=100;
  setPhase(gameMode==='boss'?'CORE BREAKER':'SCRAP CLASH');
  $('statusline').textContent='ルーム '+roomId+' · '+(gameMode==='boss'?'弱点を狙え':'リレー A / B / C を確保');
  $('buildReadout').hidden=true;$('matchEnd').hidden=true;$('bossHud').hidden=gameMode!=='boss';$('inviteTop').hidden=gameMode==='solo';
  updateMatchPhase();
  if(!touchEnabled)toast(matchPhase==='prep'?'個人建築タイム：自分のエリアに設備を設置しよう':'攻防開始！ Bで建築');
  else toast('右側をドラッグして視点移動');
  playTone(700,.25);
  return;
 }
 if(m.t==='phase'){
  matchPhase=m.phase;if(matchPhase==='battle')buildMode=false;updateMatchPhase();
  if(matchPhase==='battle'){toast('建築完了！ 戦闘開始');playTone(730,.18);}
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
 if(m.t==='inventory'){stock=sanitizePlan(m.inv);refreshHotbar();return;}
 if(m.t==='grabbing'){grabId=m.id;toast(grabId?'物体を保持中 · 離すと投げます':'物体を投げました');return;}
 if(m.t==='shot'){
  flashLine(m.from,m.to,m.by===me?(coreColors[m.core]||palette.cyan):palette.orange);
  if(m.hitType&&m.hitType!=='none')impactEffect(m.to,m.hitType);
  if(m.by===me)muzzleFlash.intensity=5;
  return;
 }
 if(m.t==='placed'){buildPulse(m.pos);if(m.by===me)playTone(470,.08,'triangle',.04);return;}
 if(m.t==='physicsImpact'){impactFlare(m.pos,0xffffff,.7);burst(m.pos,0xffc886);playTone(180,.14,'sawtooth',.035);return;}
 if(m.t==='correction'){
  if(m.pos&&[m.pos.x,m.pos.y,m.pos.z].every(Number.isFinite)){camera.position.set(m.pos.x,m.pos.y,m.pos.z);vy=0;}
  return;
 }
 if(m.t==='break'){burst(m.pos,palette.orange);impactFlare(m.pos,0xffad69,.8);shockRing(m.pos,1.2,0xffa46c,380);playTone(190,.15,'sawtooth',.02);return;}
 if(m.t==='explosion'){shockRing(m.pos,m.radius,palette.orange,m.minor?250:480);impactFlare(m.pos,m.minor?0xbd86fa:0xffbd75,m.minor?.7:1.7);burst(m.pos,0xffaf7e);playTone(m.minor?260:130,m.minor?.1:.24,'sawtooth',m.minor?.025:.055);return;}
 if(m.t==='telegraph'){
  const tint=m.kind==='wave'?0xfbbd60:0xff6c6c;
  shockRing(m.pos,m.radius,tint,1200);feed('⚠ '+(m.kind==='wave'?'衝撃波をジャンプで避けろ！':'赤い範囲から離れろ！'));playTone(275,.2,'sawtooth',.035);return;
 }
 if(m.t==='impact'){shockRing(m.pos,m.radius,0xff6357,300);return;}
 if(m.t==='respawn'){
  camera.position.set(m.pos.x,m.pos.y,m.pos.z);orientTowardArena();currentHp=100;vy=0;respawning=false;
  $('damageOverlay').style.opacity='0';toast('復帰！ 1.8秒の無敵時間');return;
 }
 if(m.t==='ended'){showResult(m);return;}
}
function renderAmmo(){
 $('ammoText').textContent=isReloading?'RELOAD':currentAmmo+' / '+stats.mag;
}
function applyState(s){
 gameState=s;remaining=s.remaining;
 if(s.phase&&s.phase!==matchPhase){matchPhase=s.phase;updateMatchPhase();}
 $('timer').textContent=String(Math.floor(remaining/60)).padStart(2,'0')+':'+String(remaining%60).padStart(2,'0');
 if(matchPhase==='prep'){
  const seconds=s.prepRemaining||0;
  $('prepClock').textContent='0:'+String(seconds).padStart(2,'0');
 }
 gameRule=s.rule||gameRule;
 const mine=s.players.find(x=>x.id===me);
 if(mine){
  myTeam=mine.team||'A';myReady=!!mine.ready;
  if(matchPhase==='prep'){$('readyBuild').disabled=myReady;$('readyBuild').textContent=myReady?'準備完了済み（待機中）':'準備完了（全員準備で開戦）';}
  if(mine.hp<currentHp){$('damageOverlay').style.opacity='.7';setTimeout(()=>$('damageOverlay').style.opacity='0',300);playTone(170,.10,'sawtooth',.04);}
  currentHp=mine.hp;currentEnergy=mine.energy;respawning=!mine.alive;
  $('hpText').textContent=mine.alive?mine.hp:'DOWN';
  $('hpMeter').style.width=mine.hp+'%';
  $('buildReadout').textContent=names[chosenKind]+' · '+(stock[chosenKind]||0)+'個 · '+currentEnergy+' EN';
 }
 const board=$('scoreboard');board.replaceChildren();
 const all=[...s.players,...(s.bots||[])].sort((a,b)=>b.score-a.score||b.kills-a.kills);
 if(gameMode!=='boss'){
  for(const team of ['A','B']){
   const el=document.createElement('div');el.className='score'+(team===myTeam?' mine':'');
   const n=document.createElement('small');n.textContent='TEAM '+team+(team===myTeam?' · YOU':'');
   const v=document.createElement('strong');v.textContent=gameRule==='fortress'?(s.cores?.[team]?.hp??0).toFixed(0):s.teamScores?.[team]??0;
   el.append(n,v);board.append(el);
  }
 }
 for(const p of gameMode==='boss'?all:[]){
  const el=document.createElement('div');el.className='score'+(p.id===me?' mine':'')+(!p.alive?' dead':'');
  const n=document.createElement('small');n.textContent=p.name;
  const v=document.createElement('strong');v.textContent=gameMode==='boss'?p.kills:p.score;
  el.append(n,v);board.append(el);
 }
 for(const p of all){
  if(p.id===me)continue;
  let view=remoteViews.get(p.id);
  if(!view){view={root:makeFighter(p.team===myTeam?0x37b6ec:0xe95847),target:new THREE.Vector3()};remoteViews.set(p.id,view);remoteGroup.add(view.root);}
  view.target.set(p.pos.x,p.pos.y-.2,p.pos.z);view.root.visible=p.alive;
  view.root.userData.hp=p.hp;
 }
 for(const [id,view] of remoteViews)if(!all.some(p=>p.id===id)){remoteGroup.remove(view.root);remoteViews.delete(id);}
 const seen=new Set();
 for(const part of s.parts){
  seen.add(part.id);
  let view=partViews.get(part.id);
  if(!view){const root=buildPart(part.kind);root.userData.partId=part.id;partGroup.add(root);view={root,target:new THREE.Vector3(),rot:part.rot,kind:part.kind};partViews.set(part.id,view);}
  view.target.set(part.pos.x,part.pos.y,part.pos.z);view.root.rotation.y=part.angle===null?(part.rot||0)*Math.PI/2:part.angle;view.root.scale.setScalar(part.disabled?.88:1);
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
 coreGroup.visible=gameMode!=='boss'&&gameRule==='fortress';
 relayGroup.visible=gameMode!=='boss'&&gameRule==='relay';
 $('coreHud').hidden=gameMode==='boss'||gameRule!=='fortress';
 if(gameRule==='fortress'&&s.cores){
  const boxHud=$('coreHud');boxHud.replaceChildren();
  for(const [team,core] of Object.entries(s.cores)){
   const hp=Math.max(0,Math.ceil(core.hp));const el=document.createElement('div');
   el.className='coreRow'+(team===myTeam?' mine':' enemy');
   const label=document.createElement('label');label.textContent='CORE '+team+(team===myTeam?' (防衛)':' (攻撃)');
   const value=document.createElement('strong');value.textContent=hp+' / '+core.maxHp;
   el.append(label,value);boxHud.append(el);
   const model=coreModels.get(team);if(model){
    model.shell.scale.setScalar(.55+.45*hp/core.maxHp);
    model.shell.material.color.setHex(hp<core.maxHp*.35?0xff505e:team==='A'?0x4ff5d3:0xff986e);
   }
  }
 }
 if(gameRule==='relay'){
  const hud=$('objectiveHud');hud.replaceChildren();
  for(const relay of s.relays){
   const own=relay.owner===myTeam,enemy=relay.owner&&!own;
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
 const victory=m.winner==='TEAM'||m.winner===me||m.winnerTeam===myTeam;
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
 playing=false;connected=false;gameState=null;roomId='';me='';grabId=null;myHome=null;myReady=false;matchPhase='battle';
 if(ws){const old=ws;ws=null;old.onclose=null;try{old.close();}catch{}}
 document.exitPointerLock?.();$('menu').hidden=false;$('waiting').hidden=true;$('matchEnd').hidden=true;
 $('scoreboard').replaceChildren();$('objectiveHud').replaceChildren();
 $('bossHud').hidden=true;$('inviteTop').hidden=true;$('prepHud').hidden=true;$('buildHotbar').hidden=true;$('coreHud').hidden=true;coreGroup.visible=false;relayGroup.visible=true;setPhase('GARAGE');
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
 if(!playing||buildMode||matchPhase==='prep'||respawning||!connected)return;
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
 if(matchPhase==='prep'&&!value){toast('個人建築時間中は建築に専念できます');return;}
 buildMode=!!value;$('buildReadout').hidden=!buildMode;$('buildHotbar').hidden=!buildMode;refreshHotbar();
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
 if(matchPhase==='prep'&&myHome&&Math.hypot(x-myHome.x,z-myHome.z)>9.95)return true;
 const from={x:camera.position.x,y:camera.position.y,z:camera.position.z};
 const to={x,y:camera.position.y,z};
 return blockedSweep(from,to,gameState?.parts||[],gameRule==='fortress'&&gameMode!=='boss');
}
let lastFrame=performance.now();
let renderError='',renderStats='',diagVisible=false,lastDiagnostic=0,blankChecks=0;
const diagPanel=$('diagPanel');
const diagButton=$('diagnoseButton');
// A bright camera-attached cube verifies whether Three.js is drawing any geometry at all.
const calibrationCube=new THREE.Mesh(new THREE.BoxGeometry(.38,.38,.38),
  new THREE.MeshBasicMaterial({color:0x18ff24,depthTest:false,depthWrite:false}));
camera.add(calibrationCube);calibrationCube.position.set(1.05,.3,-2.2);calibrationCube.visible=false;
diagButton.onclick=()=>{
 diagVisible=!diagVisible;
 diagPanel.hidden=!diagVisible;calibrationCube.visible=diagVisible;
 if(diagVisible)diagPanel.textContent='診断情報を取得しています…\n緑色の3D立方体が画面右に見えるか確認してください。';
};
function reportRuntimeError(err){
 renderError=String(err?.message||err||'Unknown error').slice(0,160);
 diagPanel.hidden=false;diagVisible=true;diagButton.textContent='描画エラー';
 diagPanel.textContent='3D描画エラー: '+renderError;
 console.error('[BILDGAN] render failure:',err);
}
window.addEventListener('error',e=>{if(playing)reportRuntimeError(e.error||e.message);});
window.addEventListener('unhandledrejection',e=>{if(playing)reportRuntimeError(e.reason);});
renderer.domElement.addEventListener('webglcontextlost',e=>{
 e.preventDefault();reportRuntimeError('WebGL context lost. Browser/device GPU context unavailable.');
});
renderer.domElement.addEventListener('webglcontextrestored',()=>{renderError='';diagButton.textContent='3D診断';});
function diagnosticSample(now){
 if(!playing||now-lastDiagnostic<3500)return;
 lastDiagnostic=now;
 const info=renderer.info.render;
 const dir=forward(),pos=camera.position;
 const point=new THREE.Vector3(0,1,0).project(camera);
 const inside=point.z>-1&&point.z<1&&Math.abs(point.x)<1&&Math.abs(point.y)<1;
 const stats='Draw calls: '+info.calls+' · Triangles: '+info.triangles+
  '\nCamera: '+pos.x.toFixed(1)+', '+pos.y.toFixed(1)+', '+pos.z.toFixed(1)+
  '\nLook: '+dir.x.toFixed(2)+', '+dir.y.toFixed(2)+', '+dir.z.toFixed(2)+
  '\nArena center in view: '+(inside?'YES':'NO')+
  '\nWebGL: '+renderer.capabilities.isWebGL2+' · Canvas: '+renderer.domElement.width+'x'+renderer.domElement.height;
 let uniform='unknown';
 try{
  const gl=renderer.getContext(),pixels=[];
  for(const [fx,fy] of [[.12,.17],[.5,.17],[.83,.17],[.25,.35],[.75,.35],[.5,.65]]){
   const v=new Uint8Array(4);
   gl.readPixels(Math.floor(renderer.domElement.width*fx),Math.floor(renderer.domElement.height*fy),1,1,gl.RGBA,gl.UNSIGNED_BYTE,v);
   pixels.push([v[0],v[1],v[2]]);
  }
  const variation=Math.max(...[0,1,2].map(ch=>Math.max(...pixels.map(p=>p[ch]))-Math.min(...pixels.map(p=>p[ch]))));
  uniform=variation<8?'YES (nearly solid color)':'NO';
 }catch(err){uniform='unavailable';}
 renderStats=stats+'\nBlank-looking canvas: '+uniform+(renderError?'\nERROR: '+renderError:'');
 if(diagVisible)diagPanel.textContent=renderStats;
 if(info.calls===0||info.triangles===0||uniform.startsWith('YES')){
  blankChecks++;
  if(blankChecks>=2){diagVisible=true;diagPanel.hidden=false;calibrationCube.visible=true;diagPanel.textContent='3Dシーンの描画に異常を検出しました。緑の四角が見えるか確認してください。\n'+renderStats;}
 }else blankChecks=0;
 // Non-sensitive drawing stats are logged server-side to make a reproducible bug report possible.
 if(connected&&blankChecks>=2)send({t:'clientdiag',drawCalls:info.calls,triangles:info.triangles,centerInside:inside,uniform});
}
function loop(now){
 requestAnimationFrame(loop);try{const dt=clamp((now-lastFrame)/1000,.001,.05);lastFrame=now;
 const menuOpen=!$('menu').hidden;
 // Defensively recover from non-finite positions instead of silently rendering empty sky.
 if(playing&&(!Number.isFinite(camera.position.x)||!Number.isFinite(camera.position.y)||!Number.isFinite(camera.position.z))){
  const remote=gameState?.players?.find(p=>p.id===me);
  const valid=remote?.pos&&[remote.pos.x,remote.pos.y,remote.pos.z].every(Number.isFinite);
  const p=valid?remote.pos:{x:-27,y:1.65,z:-24};
  camera.position.set(p.x,p.y,p.z);vy=0;onGround=true;orientTowardArena();
  toast('カメラ位置の不具合を自動修復しました');
 }
 if(playing&&$('waiting').hidden&&$('matchEnd').hidden){
  const {ahead,sideways}=readMoveAxes(key,stick);
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
   removeEffect(p);particles.splice(i,1);
  }else{
   p.mesh.material.opacity=clamp(1-t,0,1)*.82;
   if(p.expand)p.mesh.scale.setScalar(1+p.expand*t);
   if(p.velocity){p.mesh.position.addScaledVector(p.velocity,dt);p.velocity.y-=dt*16;}
  }
 }
 if(menuOpen){
  camera.position.set(Math.sin(now*.00011)*27,8,32+Math.cos(now*.0001)*3);
  camera.lookAt(0,2,0);yaw=0;pitch=0;
 }
 }catch(err){reportRuntimeError(err);}finally{
  try{
   // Rendering must continue even if a physics, UI or animation update fails.
   camera.updateMatrixWorld(true);
   renderer.render(scene,camera);
   diagnosticSample(now);
  }catch(err){reportRuntimeError(err);}
 }
}
changeKind('steel');
requestAnimationFrame(loop);
