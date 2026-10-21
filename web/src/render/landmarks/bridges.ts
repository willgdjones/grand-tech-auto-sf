import { type Group, type Mesh, MeshLambertMaterial } from 'three';
import { flags } from '@gtasf/shared/flags';
import { Parts, type BuilderOptions, type V3 } from './primitives';

// The Bridge District's International Orange, supplied as sRGB like every other colour.
const ORANGE='#c0362c';
// goldenGateOrange ON: a brighter, more saturated International Orange for the structural members, and those members
// are split into their own mesh with distance FOG DISABLED so the bridge keeps its iconic orange instead of washing to
// pale sky-pink across the strait (the dark base #c0362c desaturates to salmon under the haze from the city/Marina).
// Still lit (Lambert, flatShading) so the Art Deco towers keep their form; only the fog washout is removed.
const ORANGE_HI='#e35c2a', GROOVE_HI='#b8461e';

function suspendedSpan(p:Parts, from:number, to:number, top:number, low:number, width:number, colour:string, steps:number):void {
  const y=(t:number)=>low+(top-low)*(2*t-1)**2;
  for(const side of [-1,1]) for(let i=0;i<steps;i++) {
    const a=i/steps,b=(i+1)/steps,z=from+(to-from)*a;
    p.beam([side*width,y(a),z],[side*width,y(b),from+(to-from)*b],0.85,colour);
    p.beam([side*width,low-10,z],[side*width,y(a),z],0.22,colour);
  }
}

/** Two Art Deco portal towers, 1,280 m main span, 227.4 m above the water. */
export function createGoldenGateBridge({detail='near'}:BuilderOptions={}):Group {
  const p=new Parts(), length=1966,deck=75,width=27.4;
  const vivid=flags.goldenGateOrange;
  const O=vivid?ORANGE_HI:ORANGE, GROOVE=vivid?GROOVE_HI:'#a42e25';
  // When vivid, the orange structural members go into their own mesh `o` (fog disabled below); otherwise o===p and the
  // build is byte-identical to the original single-mesh bridge.
  const o=vivid?new Parts():p;
  p.box([0,deck-1.3,0],[width,2.6,length],'#5d6260');
  p.box([0,deck+0.12,0],[0.8,0.22,length],'#c7bfa4');
  for(const x of [-9,-4.5,4.5,9]) for(let z=-975;z<980;z+=24) p.box([x,deck+0.035,z],[0.16,0.05,10],'#e4ddc7');
  for(const side of [-1,1]) {
    o.box([side*13.3,deck+0.6,0],[0.35,1.2,length],O);
    o.box([side*13.3,deck-3.3,0],[0.45,2.4,length],O);
    for(let z=-975;z<975;z+=detail==='near'?15:30) {
      o.beam([side*13.3,deck-4.5,z],[side*13.3,deck-2.1,z+15],0.35,O);
      o.beam([side*13.3,deck+1,z],[side*13.3,deck+3,z],0.16,O);
    }
  }
  for(const z of [-640,640]) {
    p.box([0,7,z],[49,14,29],'#a59983');
    for(const side of [-1,1]) {
      o.box([side*18,33,z],[10,52,18],O);
      o.box([side*17,143.2,z],[7,168.4,10],O);
      // Stepped flanges cast the long Art Deco grooves seen in the approach photos.
      for(const dx of [-2.2,2.2]) o.box([side*17+dx,143.2,z+5.2],[0.7,168.4,0.8],GROOVE);
      o.box([side*17,226,z],[8.5,2.8,11.5],O);
    }
    for(const y of [61,82,116,151,186,222]) o.box([0,y,z],[34,4.5,8],O);
  }
  suspendedSpan(o,-640,640,222,86,12.5,O,detail==='near'?80:40);
  for(const side of [-1,1]) for(const end of [-1,1]) {
    let previous:V3=[side*12.5,222,end*640];
    for(let i=1;i<=22;i++) {
      const t=i/22,z=end*(640+343*t),y=75+147*(1-t)**2;
      const point:V3=[side*12.5,y,z];o.beam(previous,point,0.85,O);
      o.beam([side*12.5,deck,z],point,0.22,O);previous=point;
    }
  }
  for(const z of [-966,966]) p.box([0,40,z],[43,80,34],'#aa9b80');
  const root=p.finish('Golden Gate Bridge');
  if(vivid) {
    const orange=o.finish('Golden Gate Bridge orange');
    const mesh=orange.children[0] as Mesh | undefined;
    if(mesh) { (mesh.material as MeshLambertMaterial).fog=false; mesh.name='Golden Gate orange geometry'; root.add(mesh); }
  }
  root.userData.walkableSurfaces=[{minX:-13.4,maxX:13.4,minZ:-983,maxZ:983,y:75}];
  return root;
}

/** The western bridge: four X-braced towers, two main spans, central concrete anchorage. */
export function createBayBridge({detail='near'}:BuilderOptions={}):Group {
  const p=new Parts(), steel='#bac2bd',dark='#778985',deck=67,half=1410;
  for(const y of [deck,deck-7]) p.box([0,y-0.7,0],[26,1.4,half*2],'#767d78');
  for(const side of [-1,1]) {
    for(const y of [deck-8,deck-1,deck+1]) p.box([side*13,y,0],[0.6,0.65,half*2],steel);
    for(let z=-half;z<half;z+=detail==='near'?18:36) {
      p.beam([side*13,deck-8,z],[side*13,deck-1,z+18],0.45,dark);
      p.beam([side*13,deck-1,z],[side*13,deck-8,z+18],0.45,dark);
    }
  }
  for(const z of [-1056,-352,352,1056]) {
    p.box([0,8,z],[48,16,27],'#afa99b');
    for(const side of [-1,1]) p.beam([side*20,16,z],[side*15.5,160.3,z],5.3,steel,8);
    for(const [lo,hi] of [[20,52],[76,102],[104,131],[133,157]]) {
      p.beam([-16,lo!,z],[16,hi!,z],1.3,steel);
      p.beam([16,lo!,z],[-16,hi!,z],1.3,steel);
      p.box([0,hi!,z],[35,1.9,7],steel);
    }
  }
  p.box([0,39,0],[52,78,48],'#b0aa98');
  p.box([0,79,0],[58,3,52],'#c2bcad');
  for(const centre of [-704,704]) {
    suspendedSpan(p,centre-352,centre+352,157,77,12,steel,detail==='near'?48:24);
    for(const direction of [-1,1]) for(const side of [-1,1]) {
      let previous:V3=[side*12,157,centre+direction*352];
      for(let i=1;i<=22;i++) {
        const t=i/22,z=centre+direction*(352+352*t),y=70+87*(1-t)**2;
        const point:V3=[side*12,y,z];p.beam(previous,point,0.7,steel);
        p.beam([side*12,deck,z],point,0.18,dark);previous=point;
      }
    }
  }
  return p.finish('Bay Bridge western spans');
}
