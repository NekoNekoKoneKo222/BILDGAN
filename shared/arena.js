// Shared arena collision data: what the client shows is what the server blocks.
// All dimensions are half-extents, and every obstacle can stop movement and bullets.
const O=[];
const add=(id,x,y,z,hx,hy,hz,kind='pillar')=>O.push({id,pos:{x,y,z},half:{x:hx,y:hy,z:hz},kind});
for(const x of [-34,34])for(const z of [-34,34])add('corner-'+x+'-'+z,x,4,z,3,4,3,'tower');
for(const x of [-12,12])for(const z of [-26,26])add('barrier-'+x+'-'+z,x,1.15,z,3.5,1.15,1.25,'barrier');
for(let i=0;i<30;i++){
 const x=Math.sin(i*3.17)*49,z=Math.cos(i*1.92)*48;
 if(Math.abs(x)<10&&Math.abs(z)<14)continue;
 add('post-'+i,x,1,z,.55,1,.55,'post');
}
for(const x of [-24,0,24])add('relay-'+x,x,3.75,0,1.2,3.75,1.2,'relay');
for(const x of [-51,51])for(const z of [-38,-15,15,38])add('gateX-'+x+'-'+z,x,5,z,1.9,5,1.9,'gate');
for(const z of [-51,51])for(const x of [-35,-12,12,35])add('gateZ-'+x+'-'+z,x,4.5,z,1.9,4.5,1.9,'gate');
export const ARENA_SOLIDS=Object.freeze(O.map(o=>Object.freeze(o)));
export const CORE_LOCATIONS=Object.freeze({A:Object.freeze({x:-39,y:1.75,z:0}),B:Object.freeze({x:39,y:1.75,z:0})});
export const PLAYER_RADIUS=.53;
// Vertical slabs allow bullets to fly above short boxes; horizontal footprint prevents players walking through poles.
export function intersectsSolid(pos,solid,radius=PLAYER_RADIUS){
 if(pos.y+1<solid.pos.y-solid.half.y||pos.y-1.3>solid.pos.y+solid.half.y)return false;
 const dx=Math.max(Math.abs(pos.x-solid.pos.x)-solid.half.x,0);
 const dz=Math.max(Math.abs(pos.z-solid.pos.z)-solid.half.z,0);
 return dx*dx+dz*dz<radius*radius;
}
export function blockedPlayerPosition(pos,solids=ARENA_SOLIDS,radius=PLAYER_RADIUS){
 return solids.some(s=>intersectsSolid(pos,s,radius));
}
// Slab-based ray/AABB intersection returns first distance or Infinity; ray need not be normalized.
export function rayBoxDistance(origin,dir,solid,maxDist=Infinity){
 let near=0,far=maxDist;
 for(const axis of ['x','y','z']){
  const min=solid.pos[axis]-solid.half[axis],max=solid.pos[axis]+solid.half[axis],v=dir[axis];
  if(Math.abs(v)<1e-9){if(origin[axis]<min||origin[axis]>max)return Infinity;continue;}
  const a=(min-origin[axis])/v,b=(max-origin[axis])/v;
  near=Math.max(near,Math.min(a,b));
  far=Math.min(far,Math.max(a,b));
  if(far<near)return Infinity;
 }
 return near>=0&&near<=maxDist?near:Infinity;
}
export function nearestArenaHit(origin,dir,maxDist=Infinity,solids=ARENA_SOLIDS){
 let closest=null,d=maxDist;
 for(const solid of solids){
  const hit=rayBoxDistance(origin,dir,solid,d);
  if(hit<d){d=hit;closest=solid;}
 }
 return closest?{solid:closest,distance:d}:null;
}
