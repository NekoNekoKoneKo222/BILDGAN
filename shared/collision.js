import {ARENA_SOLIDS,CORE_LOCATIONS,PLAYER_RADIUS,intersectsSolid,rayBoxDistance} from './arena.js';

export const PART_HALF={x:.88,y:.88,z:.88};
export const coreCollider=team=>({id:'core-'+team,kind:'core',pos:CORE_LOCATIONS[team],half:{x:2.2,y:1.9,z:2.2}});
export const partCollider=part=>({id:part.id,kind:part.kind,pos:part.pos,half:PART_HALF});
export function collidersFor(parts=[],withCores=false,solids=ARENA_SOLIDS){
 const result=[...solids,...parts.map(partCollider)];
 if(withCores)result.push(coreCollider('A'),coreCollider('B'));
 return result;
}
// Shared by bots, human clients and server: fixed map + player-built physical parts.
export function blockedActor(pos,parts=[],withCores=false,solids=ARENA_SOLIDS,radius=PLAYER_RADIUS){
 for(const shape of solids)if(intersectsSolid(pos,shape,radius))return true;
 for(const part of parts)if(intersectsSolid(pos,partCollider(part),radius))return true;
 if(withCores)for(const team of ['A','B'])if(intersectsSolid(pos,coreCollider(team),radius))return true;
 return false;
}
// Sweep a character capsule along the COMPLETE path; no jumping through small walls on a slow device.
export function blockedSweep(from,to,parts=[],withCores=false,solids=ARENA_SOLIDS,radius=PLAYER_RADIUS){
 const dist=Math.hypot(to.x-from.x,to.y-from.y,to.z-from.z);
 const steps=Math.max(1,Math.ceil(dist/.22));
 for(let i=1;i<=steps;i++){
  const t=i/steps,pos={x:from.x+(to.x-from.x)*t,y:from.y+(to.y-from.y)*t,z:from.z+(to.z-from.z)*t};
  if(blockedActor(pos,parts,withCores,solids,radius))return true;
 }
 return false;
}
// Supports damage blocking by upright walls, mobile physics bodies and low cover.
export function nearestCover(origin,dir,limit,parts=[],withCores=false,solids=ARENA_SOLIDS,ignoreId=''){
 let closest=null,d=limit;
 for(const solid of collidersFor(parts,withCores,solids)){
  if(solid.id===ignoreId)continue;
  const hit=rayBoxDistance(origin,dir,solid,d);
  if(hit<d){d=hit;closest={solid,distance:hit,point:{x:origin.x+dir.x*hit,y:origin.y+dir.y*hit,z:origin.z+dir.z*hit}};}
 }
 return closest;
}
export function clearSight(from,to,parts=[],withCores=false,solids=ARENA_SOLIDS,ignoreId=''){
 const length=Math.hypot(to.x-from.x,to.y-from.y,to.z-from.z);
 if(length<.01)return true;
 const dir={x:(to.x-from.x)/length,y:(to.y-from.y)/length,z:(to.z-from.z)/length};
 const first=nearestCover(from,dir,length-.08,parts,withCores,solids,ignoreId);
 return first===null;
}
// A 2D grid route used only by CPU. Each waypoint is collision-tested with the SAME solids.
// A* is unnecessary at this tiny map size, breadth-first search is predictable and robust.
export function findBotPath(from,goal,parts=[],withCores=false,solids=ARENA_SOLIDS){
 const size=3,MAX=17,width=MAX*2+1;
 const grid=v=>Math.max(0,Math.min(width-1,Math.round(v/size)+MAX));
 const world=(x,z)=>({x:(x-MAX)*size,y:1.65,z:(z-MAX)*size});
 const initialX=grid(from.x),initialZ=grid(from.z),start=initialZ*width+initialX;
 const visited=new Int32Array(width*width);visited.fill(-1);
 const queue=new Int32Array(width*width);queue[0]=start;let qhead=0,qtail=1;visited[start]=start;
 let best=start,bestDist=Infinity;
 while(qhead<qtail){
  const node=queue[qhead++],x=node%width,z=Math.floor(node/width),point=world(x,z);
  const dist=Math.hypot(point.x-goal.x,point.z-goal.z);
  if(dist<bestDist){bestDist=dist;best=node;}
  if(dist<size*.6)break;
  for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
   const nx=x+dx,nz=z+dz;
   if(nx<0||nz<0||nx>=width||nz>=width)continue;
   const index=nz*width+nx;if(visited[index]!==-1)continue;
   const next=world(nx,nz);
   if(blockedActor(next,parts,withCores,solids))continue;
   if(blockedSweep(point,next,parts,withCores,solids))continue;
   visited[index]=node;queue[qtail++]=index;
  }
 }
 const path=[];let current=best;
 while(current!==start&&current>=0&&path.length<width*width){
  path.push(world(current%width,Math.floor(current/width)));
  current=visited[current];
 }
 path.reverse();
 return path;
}
