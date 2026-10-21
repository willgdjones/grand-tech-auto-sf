import { describe, expect, it } from 'vitest';
import { Group } from 'three';
import { createDrivingState, updateDriving } from '../../vehicles/driving/controller';
import { createLandmark, createPlacedLandmarks, disposeLandmark, ferrySpawn } from './landmarks';
import { pier39LocalWorld, withLandmarkSurfaces } from './surfaces';
import { PIER39_DECK } from './pier39';
import { updateOnFoot } from '../../movement/onFoot';

describe('Ferry alignment at the Embarcadero',()=>{
  it('keeps both sourced driving lanes clear while retaining the authored hall collision',()=>{
    const city=createPlacedLandmarks({enabled:true,ids:['ferry-building'],heightAt:()=>3.2,detail:'far'});
    const world=withLandmarkSurfaces({heightAt:()=>3.2},city);
    // OSM 850162148, city bake: both northbound lanes at the former obstruction.
    for(const points of [
      [[1203.726,-1250.730],[1184.539,-1277.024],[1172.329,-1293.757]],
      [[1206.311,-1252.616],[1187.124,-1278.910],[1174.914,-1295.643]],
    ])for(let i=1;i<points.length;i++)for(let step=0;step<=50;step++){
      const a=points[i-1]!,b=points[i]!,t=step/50;
      expect(world.collidesCircle!(a[0]!+(b[0]!-a[0]!)*t,a[1]!+(b[1]!-a[1]!)*t,.92)).toBe(false);
    }
    const hall=city.children[0]!;
    expect(world.collidesCircle!(hall.position.x,hall.position.z,.92)).toBe(true);
    const spawn=ferrySpawn();
    const heading=(180-Math.atan2(spawn.lookAt.x-spawn.x,spawn.lookAt.z-spawn.z)*180/Math.PI+360)%360;
    expect(spawn.heading).toBeCloseTo(heading,8);
    disposeLandmark(city);
  });
});

describe('Pier 39 playable route smoke',()=>{
  it('drives from the apron, turns at the north end and returns without crossing shops or water',()=>{
    const city=new Group();city.add(createLandmark('pier-39',{detail:'far'}));
    city.children[0]!.userData.resampleTerrain((_x:number,z:number)=>z>=193?0:null);
    // Flat loaded quay beyond the authored apron; no terrain is invented over water.
    const world=withLandmarkSurfaces({heightAt:(_x,z)=>z>=193?0:null},city);
    const state=createDrivingState({x:-6,y:0,z:200,yaw:Math.PI});
    const step=(steer=0)=>updateDriving(state,{throttle:state.speed<8?0.8:0,brake:state.speed>8.2?0.12:0,steer,handbrake:false},1/60,world);
    for(let i=0;i<3600&&state.z>-114;i++)step();
    expect(state.z).toBeLessThan(-114);
    for(let i=0;i<1800&&state.yaw>0.025;i++)step(1);
    expect(Math.abs(state.yaw)).toBeLessThan(0.04);
    expect(state.x).toBeGreaterThan(3);
    expect(state.x).toBeLessThan(10);
    for(let i=0;i<3600&&state.z<200;i++){
      const target=Math.atan2(6-state.x,12),error=Math.atan2(Math.sin(target-state.yaw),Math.cos(target-state.yaw));
      step(Math.max(-1,Math.min(1,-error*3)));
    }
    expect(state.z).toBeGreaterThan(200);
    expect(state.y).toBe(0);
    expect(pier39LocalWorld.collidesCircle!(26,117,0.92)).toBe(true);
    expect(pier39LocalWorld.heightAt(-60,-130)).toBeNull();
    disposeLandmark(city);
  });
  it('walks across the raised quay and returns at 120fps without relaxing cliff limits',()=>{
    const city=new Group(),pier=createLandmark('pier-39',{detail:'far'});city.add(pier);
    const ground=(_x:number,z:number)=>z>=193 ? .39 : null;
    const world=withLandmarkSurfaces({heightAt:ground},city);
    expect(pier.userData.dynamicSurfaceHeightAt(0,194)).toBeNull();
    pier.userData.resampleTerrain(ground);
    const pose={x:0,y:.39,z:200,yaw:Math.PI};
    for(let i=0;i<600;i++)updateOnFoot(pose,{x:0,z:-1,run:false},0,1/120,world);
    expect(pose.z).toBeLessThan(186);expect(pose.y).toBe(0);
    for(let i=0;i<600;i++)updateOnFoot(pose,{x:0,z:1,run:false},0,1/120,world);
    expect(pose.z).toBeGreaterThan(199);expect(pose.y).toBeCloseTo(.39);
    pier.userData.resampleTerrain(()=>null);
    expect(pier.userData.dynamicSurfaceHeightAt(0,194)).toBeNull();
    expect(pier.getObjectByName('Pier 39 quay transition')!.visible).toBe(false);
    disposeLandmark(city);
  });
});

describe('deferFarLandmarks (gtasf-g8ty9)',()=>{
  it('a surfaces wrapper made before a landmark joins the group still walks on it afterwards',()=>{
    const city=new Group(), world=withLandmarkSurfaces({heightAt:()=>null,collidesCircle:()=>false},city);
    const deck={x:(PIER39_DECK.minX+PIER39_DECK.maxX)/2,z:(PIER39_DECK.minZ+PIER39_DECK.maxZ)/2};
    expect(world.heightAt(deck.x,deck.z)).toBeNull(); // nothing built yet
    city.add(createLandmark('pier-39',{detail:'far'})); // joins after READY
    expect(world.heightAt(deck.x,deck.z)).not.toBeNull();
  });
});
