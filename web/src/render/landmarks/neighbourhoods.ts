import { Group } from 'three';
import { flags } from '@gtasf/shared/flags';
import { SF_FRAME } from '../../../../tools/map/src/config';
import { geodeticToWorld } from '../../../../tools/map/src/geo';
import { Parts, profile, roof, type BuilderOptions, type V3 } from './primitives';
import { LOMBARD_CENTRELINE } from './lombardSource';
import { createLombardGarden } from './lombardFlowers';
import { paintedLadyScheme } from './paintedLadyPalette';

const hx=(n:number)=>'#'+n.toString(16).padStart(6,'0');

/** Seven Victorian silhouettes, stepped with Steiner Street rather than sitting on a flat slab. */
export function createPaintedLadies({detail='near'}:BuilderOptions={}):Group {
  const p=new Parts(), colours=['#c8bc97','#9baa91','#e0c68e','#c7c4ae','#b3b9bd','#c2b58c','#c6d0c1'];
  for(let i=0;i<7;i++) {
    // paintedLadiesColour: give each house its distinct curated body + trim (the "Painted Ladies" read) instead of
    // the near-monochrome inline palette. Flag off -> c = colours[i] and trim literals unchanged (byte-identical).
    const scheme=flags.paintedLadiesColour?paintedLadyScheme(i):null;
    const x=(i-3)*9.2,base=i*1.12,c=scheme?hx(scheme.body):colours[i]!;
    const trim=scheme?hx(scheme.trim):null;
    p.box([x,base+0.25,0],[9.2,0.5,28],'#9c9c86');
    p.box([x,base+6.1,-1],[8.6,12.2,18],c);
    p.box([x,base+1.1,9],[8.6,2.2,4],'#92978a');
    roof(p,x,base+12.2,-1,9.0,19.5,3.1,'#555d5c');
    // White rake boards and a front gable window remain clear in the park approach.
    p.beam([x-4.5,base+12.2,8.8],[x,base+15.3,8.8],0.22,(trim??'#eee6d4'));
    p.beam([x,base+15.3,8.8],[x+4.5,base+12.2,8.8],0.22,(trim??'#eee6d4'));
    p.arch([x,base+12.5,8.85],1.7,1.7,'#344650');
    const bay=(y:number):V3[]=>[[x-3.7,y,8],[x-2.9,y,10],[x-0.1,y,10],[x+0.7,y,8]];
    profile(p,[bay(base+2.3),bay(base+11.7)],c);
    for(const floor of [0,1]) {
      const y=base+3+floor*4.5;
      p.box([x-1.5,y+1.5,10.035],[2.0,3.0,0.1],'#3f535a');
      for(const dx of [-2.62,-0.38]) p.box([x+dx,y+1.5,10.12],[0.2,3.35,0.25],(trim??'#f1e8d6'));
      p.box([x-1.5,y+3.15,10.14],[2.55,0.3,0.3],(trim??'#f1e8d6'));
      p.box([x-1.5,y,10.14],[2.55,0.2,0.3],(trim??'#f1e8d6'));
      p.box([x-1.5,y+1.5,10.17],[2.1,0.14,0.12],'#d7d5c6');
      p.box([x+2.45,y+1.45,8.04],[1.8,3.0,0.1],'#3f535a');
      for(const dx of [1.45,3.45]) p.box([x+dx,y+1.5,8.13],[0.19,3.3,0.23],(trim??'#eee6d4'));
      for(const dy of [0,3.1]) p.box([x+2.45,y+dy,8.14],[2.25,0.23,0.26],(trim??'#eee6d4'));
    }
    for(const y of [2.3,6.8,11.6,12.05]) p.box([x,base+y,8.1],[8.9,0.22,0.5],(trim??'#ece4cf'));
    p.box([x+2.45,base+1.75,10.03],[1.45,3.1,0.14],'#645a49');
    for(let step=0;step<8;step++) p.box([x+2.45,base+(8-step)*0.15,10.5+step*0.4],[2.6,(8-step)*0.3,0.42],'#d1cbb7');
    for(const dx of [1,3.9]) p.beam([x+dx,base+3.1,10.4],[x+dx,base+0.9,13.7],0.12,'#5d675f');
    if(detail==='near') {
      for(let y=base+2.5;y<base+11.8;y+=0.42) p.box([x,y,8.065],[8.3,0.04,0.035],'#929d91');
      for(const dx of [-3.9,3.9]) p.box([x+dx,base+7.2,8.14],[0.25,9.5,0.25],(trim??'#eee6d4'));
    }
    p.box([x+2.7,base+13.1,-5],[1.1,3.0,1.2],'#ae8471');
  }
  return p.finish('Painted Ladies');
}

export const LOMBARD_ORIGIN={lat:37.802108,lon:-122.41881};
const origin=geodeticToWorld(LOMBARD_ORIGIN.lat,LOMBARD_ORIGIN.lon,SF_FRAME);
export const LOMBARD_LOCAL_PATH=LOMBARD_CENTRELINE.map(([lat,lon])=>{
  const [x,z]=geodeticToWorld(lat,lon,SF_FRAME);return [x-origin[0],z-origin[1]] as const;
});
export interface FlowerBedOptions extends BuilderOptions { heightAt?:(x:number,z:number)=>number|null }
/** Flowers follow real cached OSM curves. No replacement road or flat hill is inserted in the city. */
export function createLombardFlowerBeds({detail='near',heightAt}:FlowerBedOptions={}):Group {
  if (!flags.lombardFlowers) return new Group();
  return createLombardGarden({path:LOMBARD_LOCAL_PATH,detail,heightAt});
}

/** Workshop-only ground and the real OSM road line; never added to the streamed city. */
export function createLombardPreviewContext():Group {
  const p=new Parts(),first=LOMBARD_LOCAL_PATH[0]!,last=LOMBARD_LOCAL_PATH.at(-1)!;
  const length=Math.hypot(last[0]-first[0],last[1]-first[1]),dx=(last[0]-first[0])/length,dz=(last[1]-first[1])/length;
  const y=(x:number,z:number)=>-(x*dx+z*dz)*0.23;
  const point=(u:number,v:number):V3=>{const x=dx*u-dz*v,z=dz*u+dx*v;return [x,y(x,z)-0.2,z];};
  p.polygon([point(-78,13),point(78,13),point(78,-13),point(-78,-13)],'#6d7654');
  for(let i=1;i<LOMBARD_LOCAL_PATH.length;i++) {
    const a=LOMBARD_LOCAL_PATH[i-1]!,b=LOMBARD_LOCAL_PATH[i]!,d=Math.hypot(b[0]-a[0],b[1]-a[1]);
    if(d<0.01)continue;
    const nx=-(b[1]-a[1])/d*2.65,nz=(b[0]-a[0])/d*2.65;
    p.polygon([[a[0]+nx,y(a[0]+nx,a[1]+nz),a[1]+nz],[b[0]+nx,y(b[0]+nx,b[1]+nz),b[1]+nz],
      [b[0]-nx,y(b[0]-nx,b[1]-nz),b[1]-nz],[a[0]-nx,y(a[0]-nx,a[1]-nz),a[1]-nz]],'#9b7461');
  }
  return p.finish('Lombard workshop terrain context');
}
