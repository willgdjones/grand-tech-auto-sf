import type { Group } from 'three';
import type { MovementWorld } from '../../movement/world';
import { PIER39_APRON, PIER39_DECK, PIER39_OBSTACLES, type LocalRect, type LocalSurface } from './pier39';

function within(r:LocalRect,x:number,z:number,radius=0):boolean {
  return x-radius>=r.minX&&x+radius<=r.maxX&&z-radius>=r.minZ&&z+radius<=r.maxZ;
}
function intersects(r:LocalRect,x:number,z:number,radius:number):boolean {
  const dx=x-Math.max(r.minX,Math.min(r.maxX,x)),dz=z-Math.max(r.minZ,Math.min(r.maxZ,z));
  return dx*dx+dz*dz<=radius*radius;
}
export const pier39LocalWorld:MovementWorld={
  heightAt(x,z){return within(PIER39_DECK,x,z)||within(PIER39_APRON,x,z)?0:null;},
  collidesCircle(x,z,radius){
    const deck=within(PIER39_DECK,x,z,radius),apron=within(PIER39_APRON,x,z,radius);
    // The two surfaces overlap by 2 m, allowing wheel and circle probes across the seam.
    return !(deck||apron)||PIER39_OBSTACLES.some(r=>intersects(r,x,z,radius));
  },
};

/** Compose authored decks with live map contact. Model transforms use rotationY + translation only. */
export function withLandmarkSurfaces(base:MovementWorld,landmarks:Group):MovementWorld {
  // Attach after the fixed city group is built. Height/collision probes run many
  // times per frame; cache eligibility, while reading visibility/transforms live.
  // deferFarLandmarks (gtasf-g8ty9): far landmarks join the group after READY, so the candidates re-scan whenever the
  // child count changes (one integer compare per probe).
  let candidates:typeof landmarks.children=[],reach2:number[]=[],scanned=-1;
  const rescan=()=>{
    if(landmarks.children.length===scanned)return;
    scanned=landmarks.children.length;
    candidates=landmarks.children.filter(o=>Array.isArray(o.userData.walkableSurfaces));
    // gtasf-qvajw: squared reach of each candidate's authored surfaces (farthest rect corner from its origin, so it holds
    // for any rotation). A probe beyond it can't land on any surface: skip before the trig. Candidates with a dynamic
    // surface function have an unknown extent and are never skipped.
    reach2=candidates.map(o=>{
      if(o.userData.dynamicSurfaceHeightAt)return Infinity;
      let r2=0;
      for(const r of o.userData.walkableSurfaces as LocalRect[])for(const x of [r.minX,r.maxX])for(const z of [r.minZ,r.maxZ])r2=Math.max(r2,x*x+z*z);
      return r2;
    });
  };
  const local=(x:number,z:number,o:typeof landmarks.children[number])=>{
    const dx=x-o.position.x,dz=z-o.position.z,c=Math.cos(o.rotation.y),s=Math.sin(o.rotation.y);
    return {x:c*dx-s*dz,z:s*dx+c*dz};
  };
  return {
    heightAt(x,z){
      rescan();
      // No per-candidate objects/closures: this runs many times per frame (gtasf-pooa allocation profile).
      for(let i=0;i<candidates.length;i++) {
        const o=candidates[i]!;
        if(!o.visible||o.parent!==landmarks)continue;
        const dx=x-o.position.x,dz=z-o.position.z;if(dx*dx+dz*dz>reach2[i]!)continue;
        const c=Math.cos(o.rotation.y),s=Math.sin(o.rotation.y),px=c*dx-s*dz,pz=s*dx+c*dz;
        const surfaces=o.userData.walkableSurfaces as LocalSurface[];
        const dynamic=o.userData.dynamicSurfaceHeightAt as ((x:number,z:number)=>number|null)|undefined;
        const extra=dynamic?.(px,pz);if(typeof extra==='number')return o.position.y+extra;
        for(let j=0;j<surfaces.length;j++)if(within(surfaces[j]!,px,pz))return o.position.y+surfaces[j]!.y;
      }
      return base.heightAt(x,z);
    },
    collidesCircle(x,z,radius){
      rescan();
      for(let i=0;i<candidates.length;i++) {
        const o=candidates[i]!;
        if(!o.visible||o.parent!==landmarks)continue;
        const ox=x-o.position.x,oz=z-o.position.z;if(ox*ox+oz*oz>reach2[i]!)continue;
        const p=local(x,z,o),surfaces=o.userData.walkableSurfaces as LocalSurface[];
        const dynamic=o.userData.dynamicSurfaceHeightAt as ((x:number,z:number)=>number|null)|undefined;
        if(!surfaces.some(r=>within(r,p.x,p.z))&&typeof dynamic?.(p.x,p.z)!=='number')continue;
        const solids=(o.userData.solidFootprints??[]) as LocalRect[];
        if(solids.some(r=>intersects(r,p.x,p.z,radius)))return true;
        if(o.userData.landmarkId==='pier-39') {
          // The quay edge is an entrance, unlike the railed water-facing edges.
          const leavesToLand=p.z>PIER39_APRON.maxZ-radius&&p.x-radius>=PIER39_APRON.minX&&p.x+radius<=PIER39_APRON.maxX;
          if(leavesToLand&&base.heightAt(x,z)!==null)return base.collidesCircle?.(x,z,radius)??false;
          return pier39LocalWorld.collidesCircle!(p.x,p.z,radius);
        }
      }
      return base.collidesCircle?.(x,z,radius)??false;
    },
  };
}
