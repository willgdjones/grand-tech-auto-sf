import { expect, it } from 'vitest';
import { BufferAttribute, BufferGeometry, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { StructureCollisionIndex } from './structureCollision';
import { ThirdPersonCamera } from '../../camera/thirdPerson';
import { createMapCameraCollision } from '../../game/cameraCollision';
import { createDrivingState, updateDriving } from '../../vehicles/driving/controller';

it('uses transformed quantized walls and graded ceiling while keeping both portals and upper ground clear',()=>{
  const root=new Group();root.position.set(512,20,-256);root.rotation.y=.3;
  const geometry=new BufferGeometry(),positions:number[]=[],indices:number[]=[];
  const quad=(points:number[][])=>{
    const first=positions.length/3;
    for(const [x,y,z] of points)positions.push(Math.round(x!/4*32767),Math.round(y!/8*32767),Math.round(z!/12*32767));
    // Exactly the shell convention: two triangles with paired windings, no end caps.
    for(const tri of [[0,1,2],[0,2,3]])indices.push(...tri.map(n=>first+n),...[...tri].reverse().map(n=>first+n));
  };
  quad([[-4,0,0],[-4,1.2,12],[-4,5.7,12],[-4,4.5,0]]);
  quad([[4,0,0],[4,4.5,0],[4,5.7,12],[4,1.2,12]]);
  quad([[-4,4.5,0],[-4,5.7,12],[4,5.7,12],[4,4.5,0]]);
  geometry.setAttribute('position',new BufferAttribute(Int16Array.from(positions),3,true));geometry.setIndex(indices);
  const material=new MeshBasicMaterial(),mesh=new Mesh(geometry,material);mesh.name='structures_2';mesh.scale.set(4,8,12);root.add(mesh);
  const index=new StructureCollisionIndex();index.setChunk('2_-1',root);
  const worldPoint=(x:number,y:number,z:number)=>root.localToWorld(new Vector3(x,y,z));
  const hit=(x:number,y:number,z:number,r=.35,h=1.8)=>{const p=worldPoint(x,y,z);return index.collides(p.x,p.y,p.z,r,h);};
  expect(hit(3.8,.6,6)).toBe(true);expect(hit(3.3,.6,6)).toBe(false);
  expect(hit(0,3.5,6)).toBe(true);expect(hit(0,10,6)).toBe(false);
  expect(hit(4,-3,6)).toBe(false);expect(hit(0,2,-1)).toBe(false);expect(hit(0,2,13)).toBe(false);
  expect(index.stats.triangles).toBe(6); // Winding pairs do not double the collision work.
  const world={heightAt:(x:number,z:number)=>20+root.worldToLocal(new Vector3(x,20,z)).z*.1,
    collidesCircle:(x:number,z:number,r:number)=>index.collides(x,world.heightAt(x,z),z,r,1.8)};
  for(const direction of [1,-1]) {
    const p=worldPoint(0,direction===1?-.3:1.5,direction===1?-3:15);
    const car=createDrivingState({...p,yaw:.3+(direction===1?0:Math.PI)});
    for(let i=0;i<300;i++)updateDriving(car,{throttle:car.speed<6?.7:0,brake:car.speed>6.2?.1:0,steer:0,handbrake:false},1/60,world);
    const local=root.worldToLocal(new Vector3(car.x,car.y,car.z));
    expect(direction===1?local.z>13:local.z<-1).toBe(true);
  }
  const camera=new ThirdPersonCamera({walkable:world,occluders:createMapCameraCollision(index),activity:{camera(){}}});
  camera.setOrbit(.3,-.9);const foot=worldPoint(0,.3,3);
  for(let i=0;i<60;i++)expect(camera.update(1/60,foot)).toBe(true);
  const localCamera=root.worldToLocal(camera.camera.position.clone());
  expect(localCamera.y).toBeLessThan(4.5+localCamera.z*.1-.1);
  expect(camera.avatarOpacity).toBeGreaterThan(.2);
  expect(camera.pitch).toBeCloseTo(-.9); // Preserve requested intent for leaving the roof.
  // An explicitly close zoom keeps its ordinary fade rather than pushing out.
  const close=new ThirdPersonCamera({walkable:world,occluders:createMapCameraCollision(index),activity:{camera(){}}});
  close.setOrbit(.3,-.9);close.zoom(-20);
  for(let i=0;i<60;i++){close.follow(.3+Math.PI,40,1/60);expect(close.update(1/60,foot)).toBe(true);}
  expect(close.renderedBoom).toBeLessThan(3);expect(close.avatarOpacity).toBe(0);
  camera.recenter(.3+Math.PI);
  for(let i=0;i<120;i++)expect(camera.update(1/60,foot)).toBe(true);
  expect(camera.avatarOpacity).toBeGreaterThan(0);
  index.removeChunk('2_-1');expect(hit(3.8,.6,6)).toBe(false);expect(index.stats.cells).toBe(0);
  index.setChunk('2_-1',root);index.clear();expect(hit(0,3.5,6)).toBe(false);
  geometry.dispose();material.dispose();
});

it('indexes building meshes only when the buildings pattern is passed [gtasf-ntcl]',()=>{
  // A vertical wall quad: x in [10,14], y in [0,8], z=5 (two triangles), named like a coarse building.
  const root=new Group(),geometry=new BufferGeometry();
  geometry.setAttribute('position',new BufferAttribute(Float32Array.from([
    10,0,5, 14,0,5, 14,8,5,  10,0,5, 14,8,5, 10,8,5,
  ]),3));
  const material=new MeshBasicMaterial(),mesh=new Mesh(geometry,material);mesh.name='buildings';root.add(mesh);

  const off=new StructureCollisionIndex();off.setChunk('b',root); // default: tunnel structures only
  expect(off.stats.triangles).toBe(0);
  expect(off.collides(12,1,5,.5,1.8)).toBe(false);

  const on=new StructureCollisionIndex();on.setChunk('b',root,/^buildings(?:_|$)/);
  expect(on.stats.triangles).toBe(2);
  expect(on.collides(12,1,5,.5,1.8)).toBe(true);  // standing in the wall
  expect(on.collides(12,1,9,.5,1.8)).toBe(false); // 4 m clear of it in z
  on.removeChunk('b');expect(on.collides(12,1,5,.5,1.8)).toBe(false);
  geometry.dispose();material.dispose();
});
