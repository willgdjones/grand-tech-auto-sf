import { type Group, type Mesh, MeshBasicMaterial, type MeshLambertMaterial } from 'three';
import { flags } from '@gtasf/shared/flags';
import { createAnimatedSeaLion } from '../cityLifeModels';
import { createPier39Apron, PIER39_TRANSITION } from './pier39Apron';
import { Parts, lettering, roof, type BuilderOptions, type V3 } from './primitives';

export interface LocalRect { minX:number;maxX:number;minZ:number;maxZ:number }
export interface LocalSurface extends LocalRect { y:number }
export const PIER39_DECK:LocalSurface={minX:-45,maxX:45,minZ:-150,maxZ:150,y:0};
export const PIER39_APRON:LocalSurface={minX:-58,maxX:58,minZ:148,maxZ:195,y:0};
export const PIER39_SHOPS:readonly LocalRect[]=Array.from({length:16},(_,i)=>{
  const side=i<8?-1:1,z=117-(i%8)*27.5,x=side*26;
  return {minX:x-12,maxX:x+12,minZ:z-12,maxZ:z+12};
});
const CAROUSEL:LocalRect={minX:-24,maxX:-10,minZ:-122,maxZ:-108};
export const PIER39_OBSTACLES:readonly LocalRect[]=[...PIER39_SHOPS,CAROUSEL];

function seaLion(p:Parts,x:number,y:number,z:number,angle:number,colour:string):void {
  const local=(a:number,b:number,c:number):V3=>[x+a*Math.cos(angle)+c*Math.sin(angle),y+b,z-a*Math.sin(angle)+c*Math.cos(angle)];
  p.ellipsoid(local(0,0.45,0),[0.56,0.45,1.15],colour,angle);
  p.ellipsoid(local(0,0.88,0.82),[0.4,0.67,0.45],colour,angle);
  p.ellipsoid(local(0,1.38,1.05),[0.37,0.31,0.44],colour,angle);
  p.ellipsoid(local(0,1.26,1.4),[0.23,0.14,0.24],'#5a4936',angle);
  for(const side of [-1,1]) {
    const fin=[local(side*0.4,0.35,0.5),local(side*1.0,0.05,-0.1),local(side*0.4,0.14,-0.65)];
    p.polygon(fin,colour);p.polygon([...fin].reverse(),colour);
    p.ellipsoid(local(side*0.32,0.12,-1.15),[0.28,0.08,0.45],colour,angle+side*0.25);
    p.ellipsoid(local(side*0.24,1.45,1.29),[0.035,0.035,0.035],'#211f1a');
  }
}

/** Photo-referenced pedestrian pier adapted with a clear 20 m drive aisle and north turnaround. */
export function createPier39({detail='near'}:BuilderOptions={}):Group {
  const p=new Parts(),wood='#a1957d',trim='#ded9c7';
  const animated: ReturnType<typeof createAnimatedSeaLion>[] = [];
  p.box([0,-0.5,0],[90,1,300],wood);
  p.box([0,-0.35,169.5],[116,0.7,43],'#b2ad9a');
  for(let z=-149;z<=149;z+=detail==='near'?2.5:5) p.box([0,0.015,z],[89,0.025,0.055],'#7f8170');
  for(const side of [-1,1]) {
    p.box([side*44.5,1.1,0],[0.18,0.16,299],'#d3cec0');
    for(let z=-148;z<150;z+=6) p.box([side*44.5,0.55,z],[0.18,1.1,0.18],'#c0bca9');
  }
  p.box([0,1.1,-149.5],[89,0.16,0.18],'#d3cec0');
  for(let x=-42;x<=42;x+=6) p.box([x,0.55,-149.5],[0.18,1.1,0.18],'#c0bca9');
  const facades=['#849795','#aa9983','#b7a784','#a9b5b1','#8e9da2','#b6b7a7'];
  for(let i=0;i<PIER39_SHOPS.length;i++) {
    const r=PIER39_SHOPS[i]!,x=(r.minX+r.maxX)/2,z=(r.minZ+r.maxZ)/2,side=Math.sign(x),face=x-side*12.1;
    const height=8.8+(i%3)*0.7,colour=facades[i%facades.length]!;
    p.box([x,height/2,z],[24,height,24],colour);
    roof(p,x,height,z,25,25,3.1,'#687477');
    p.box([face,4.4,z],[3.2,0.35,25.5],trim);
    p.box([face,9,z],[0.2,0.25,24.8],trim);
    for(const y of [1.6,6.5]) for(const dz of [-8,-3,3,8]) {
      p.box([face-side*0.05,y+0.8,z+dz],[0.12,2.0,3.4],'#354e56');
      for(const edge of [-1.85,1.85]) p.box([face-side*0.16,y+0.8,z+dz+edge],[0.19,2.35,0.17],trim);
      for(const dy of [-0.3,1.9]) p.box([face-side*0.18,y+dy,z+dz],[0.2,0.19,3.85],trim);
      p.box([face-side*0.2,y+0.8,z+dz],[0.21,0.13,3.4],trim);
    }
    for(let n=0;n<7;n++) p.box([face-side*1.1,3.9,z-10+n*3.3],[2.1,0.2,3.25],n%2?trim:i%2?'#5a9da2':'#ae664f');
    for(let dz=-11;dz<=11;dz+=5.5) p.box([face-side*1.25,5.0,z+dz],[0.17,1.0,0.17],trim);
    p.box([face-side*1.25,5.55,z],[0.18,0.15,23],trim);
    if(detail==='near') for(let y=0.3;y<height;y+=0.45) p.box([face-side*0.03,y,z],[0.03,0.035,23.8],'#72827d');
    // Outer waterfront elevations and exposed gable ends also have authored facades.
    const outside=x+side*12.08;
    for(const y of [2.2,6.8]) for(const dz of [-8,0,8]) {
      p.box([outside,y,z+dz],[0.12,2.25,3.8],'#425a60');
      for(const edge of [-2.05,2.05]) p.box([outside+side*0.1,y,z+dz+edge],[0.2,2.6,0.2],trim);
      for(const dy of [-1.25,0,1.25]) p.box([outside+side*0.12,y+dy,z+dz],[0.22,0.18,4.3],trim);
    }
    for(const end of [-1,1]) {
      for(const dx of [-7,0,7]) for(const y of [2.2,6.8]) {
        p.box([x+dx,y,z+end*12.06],[3.8,2.25,0.12],'#425a60');
        for(const edge of [-2.05,2.05]) p.box([x+dx+edge,y,z+end*12.15],[0.2,2.6,0.2],trim);
        for(const dy of [-1.25,1.25]) p.box([x+dx,y+dy,z+end*12.15],[4.3,0.18,0.2],trim);
      }
      p.beam([x-12.4,height,z+end*12.6],[x,height+3.1,z+end*12.6],0.28,trim);
      p.beam([x,height+3.1,z+end*12.6],[x+12.4,height,z+end*12.6],0.28,trim);
    }
    p.box([x-side*5,height+2,z-5],[2,2.2,3],colour);
    roof(p,x-side*5,height+3.1,z-5,2.6,3.6,0.8,'#626e70');
  }
  // Carousel is off the driving axis; the north end remains wide enough to turn around.
  p.cylinder([-17,0.25,-115],7,7,0.5,'#ccac74',16);
  p.cylinder([-17,3.5,-115],0.3,0.3,6,'#e5cf8b',8);
  p.cylinder([-17,6.5,-115],7.2,0.7,3,'#b5564b',16);
  p.cylinder([-17,5.1,-115],7.25,7.25,0.45,'#e2c47f',16);
  for(let i=0;i<10;i++) {
    const a=i*Math.PI/5,x=-17+Math.sin(a)*5,z=-115+Math.cos(a)*5;
    p.cylinder([x,2.6,z],0.1,0.1,4.8,'#ddd0a0',6);
    p.ellipsoid([x,1.4,z],[0.35,0.45,0.85],i%2?'#d6cab0':'#b18b5e',a);
    p.ellipsoid([x+Math.sin(a)*0.6,1.95,z+Math.cos(a)*0.6],[0.28,0.45,0.3],'#d6cab0',a);
  }
  // Wide street entrance: overhead sign has 6.5 m clearance, no bollards across the route.
  // pier39Sign: when ON, the sign panel + "PIER 39" name go to their own UNLIT mesh (bright red name on a cream panel,
  // like the real Pier 39 marquee) so they read from the Embarcadero approach instead of a dim cream-on-teal that darkens
  // and washes on the Low/phone path; off, sg===p and the sign builds exactly as before (teal panel, cream letters).
  const brightSign=flags.pier39Sign, sg=brightSign?new Parts():p;
  const PANEL=brightSign?'#f1e7cf':'#365f77', NAME=brightSign?'#d2371d':'#eee4c4';
  for(const x of [-10,10]) p.box([x,4.1,142],[0.5,8.2,0.5],'#546f73');
  sg.box([0,7.4,142],[20.5,1.6,0.4],PANEL);
  lettering(sg,'PIER 39',0,6.95,142.3,1.05,NAME);
  for(const side of [-1,1]) for(let z=-125;z<=155;z+=35) {
    p.box([side*10.5,0.5,z],[2,1,2],'#716f57');
    p.ellipsoid([side*10.5,1.4,z],[1.05,1.1,1.05],'#5b7951');
  }
  // K Dock floats off the west edge; warm, asymmetrical sea-lion groups break up each raft.
  for(let row=0;row<3;row++) for(let column=0;column<3;column++) {
    const x=-57-column*10,z=-49-row*15;
    p.box([x,-1.1,z],[8,0.45,10],'#8b8269');
    for(let n=0;n<(detail==='near'?8:4);n++) {
      const nx=x-2.6+(n%3)*2.4,nz=z-3.5+Math.floor(n/3)*3.0;
      const angle=(n*1.71+row+column)%6.28,colour=['#9e794b','#746245','#ad8c58','#80684a'][(n+row)%4]!;
      if(flags.cityLife&&detail==='near'&&n===0){
        const lion=createAnimatedSeaLion(colour,row*3+column);lion.root.position.set(nx,-.85,nz);lion.root.rotation.y=angle;animated.push(lion);
      }else seaLion(p,nx,-0.85,nz,angle,colour);
    }
  }
  const root=p.finish('Pier 39');
  if(brightSign) {
    const s=sg.finish('Pier 39 sign');
    const mesh=s.children[0] as Mesh | undefined;
    if(mesh) { (mesh.material as MeshLambertMaterial).dispose?.(); mesh.material=new MeshBasicMaterial({vertexColors:true,toneMapped:false}); mesh.name='Pier 39 sign geometry'; root.add(mesh); }
  }
  for(const lion of animated)root.add(lion.root);
  root.userData.animateCityLife=(seconds:number,nearby:boolean,low=false)=>{
    animated.forEach((lion,i)=>{lion.root.visible=nearby&&(!low||i%3===0);if(lion.root.visible)lion.update(seconds);});
  };
  root.userData.solidFootprints=PIER39_OBSTACLES;
  root.userData.walkableSurfaces=[PIER39_DECK,{...PIER39_APRON,maxZ:PIER39_TRANSITION.minZ}];
  const apron=createPier39Apron();root.add(apron.mesh);
  root.userData.resampleTerrain=apron.resample;
  root.userData.dynamicSurfaceHeightAt=apron.heightAt;
  root.userData.seaLions=9*(detail==='near'?8:4);
  root.userData.driving={entrance:{x:0,y:0,z:178,yaw:Math.PI},turnaround:{x:10,y:0,z:-130},clearAisleWidthM:20};
  return root;
}
