/** Finite CPU smoke on the exact emitted Broadway shell; no WebGL/gate claim. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { StructureCollisionIndex } from '../web/src/render/chunks/structureCollision';
import { ThirdPersonCamera } from '../web/src/camera/thirdPerson';
import { createMapCameraCollision } from '../web/src/game/cameraCollision';
import { createRoadSampler, decodeHeightfield, FootprintIndex, sampleHeight, type ChunkCollision, type Heightfield } from '../web/src/render/chunks/terrain';
import type { MapManifest } from '../web/src/render/chunks/world';
import type { RoadGraph } from '../shared/roadgraph';
import { createDrivingState, updateDriving } from '../web/src/vehicles/driving/controller';

const source=resolve('tools/map/out/sf'),out=resolve(process.env.GTASF_TUNNEL_EVIDENCE??'artifacts/tunnel-collision');
const manifestBytes=await readFile(resolve(source,'manifest.json')),manifest=JSON.parse(manifestBytes.toString()) as MapManifest;
const graph=JSON.parse(await readFile('artifacts/district-art/district-graph.json','utf8')) as RoadGraph;
const road=graph.edges.find(e=>e.id==='lane:1k8m');assert(road);
const a=road.points[0]!,b=road.points.at(-1)!,yaw=Math.atan2(b[0]-a[0],b[2]-a[2]);
const roadHeight=createRoadSampler(graph),shell=new StructureCollisionIndex(),buildings=new FootprintIndex(),fields=new Map<string,Heightfield>();
const collisions:ChunkCollision[]=[],inventory:{id:string;sha256:string;bytes:number}[]=[];
const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
for(const chunk of manifest.chunks.filter(c=>c.x>=-4&&c.x<=-2&&c.z>=-7&&c.z<=-5)) {
  const bytes=await readFile(resolve(source,chunk.lods[0]!.path));
  const root=(await loader.parseAsync(Uint8Array.from(bytes).buffer,'')).scene;root.position.set(chunk.x*256,0,chunk.z*256);
  shell.setChunk(chunk.id,root);
  fields.set(chunk.id,decodeHeightfield(Uint8Array.from(await readFile(resolve(source,chunk.terrain.path))).buffer));
  collisions.push(JSON.parse(await readFile(resolve(source,chunk.collision.path),'utf8')) as ChunkCollision);
  inventory.push({id:chunk.id,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
buildings.rebuild(collisions);
const world={collides:(x:number,y:number,z:number,r:number,h:number)=>buildings.collides(x,y,z,r,h)||shell.collides(x,y,z,r,h)};
const rows=[];
for(const fraction of [.1,.25,.5,.75,.9]) {
  const foot=new Vector3(...a).lerp(new Vector3(...b),fraction);
  const walkable={heightAt:(x:number,z:number)=>{
    const roadY=roadHeight(x,z,foot.y);if(roadY!==null)return roadY;
    const field=fields.get(`${Math.floor(x/256)}_${Math.floor(z/256)}`),height=field?sampleHeight(field,x,z):null;
    return height!==null&&height<=foot.y+5?height:null;
  }};
  // The native ArrowLeft trace adds about .34 rad before the steep roof view.
  for(const [heading,chase] of [[yaw,yaw],[yaw+.34,yaw],[yaw+Math.PI,yaw+Math.PI],[yaw+Math.PI+.34,yaw+Math.PI]] as const) {
    const camera=new ThirdPersonCamera({walkable,occluders:createMapCameraCollision(world),activity:{camera(){}}});
    camera.setOrbit(heading,-.9);
    for(const mode of ['high-orbit','recenter'] as const) {
      if(mode==='recenter')camera.recenter(chase+Math.PI);
      for(let i=0;i<120;i++)assert(camera.update(1/60,foot),`${mode} safe camera`);
      const p=camera.camera.position,roadY=roadHeight(p.x,p.z,foot.y);assert.notEqual(roadY,null);
      assert(p.y<roadY!+4.5,`${mode} ceiling containment`);
      assert(!shell.collides(p.x,p.y-.2,p.z,.2,.4),'Camera sphere outside walls/ceiling');
      assert(camera.avatarOpacity>.2,`${mode} keeps the avatar readable: ${JSON.stringify({fraction,heading,opacity:camera.avatarOpacity})}`);
      rows.push({fraction,heading,mode,foot:foot.toArray(),camera:p.toArray(),roadY,ceilingY:roadY!+4.5,opacity:camera.avatarOpacity,boom:camera.renderedBoom});
    }
  }
}
const drives=[],length=Math.hypot(b[0]-a[0],b[2]-a[2]),tx=(b[0]-a[0])/length,tz=(b[2]-a[2])/length;
for(const direction of [1,-1]) {
  const start=direction===1?a:b;
  const car=createDrivingState({x:start[0]-tx*direction*2,y:start[1]-(b[1]-a[1])/length*direction*2,z:start[2]-tz*direction*2,yaw:yaw+(direction===1?0:Math.PI)});
  const initial={...car};let progress=0,frames=0,stalled=0;
  const drivingWorld={heightAt:(x:number,z:number)=>{
    const roadY=roadHeight(x,z,car.y);if(roadY!==null)return roadY;
    const field=fields.get(`${Math.floor(x/256)}_${Math.floor(z/256)}`),height=field?sampleHeight(field,x,z):null;
    return height!==null&&Math.abs(height-car.y)<=5?height:null;
  },collidesCircle:(x:number,z:number,radius:number)=>{
    const y=drivingWorld.heightAt(x,z);return y===null||world.collides(x,y,z,radius,1.8);
  }};
  while(progress<length+4&&frames<7000) {
    const old=progress;
    updateDriving(car,{throttle:car.speed<12?.7:0,brake:car.speed>12.2?.1:0,steer:0,handbrake:false},1/60,drivingWorld);
    progress=((car.x-initial.x)*tx+(car.z-initial.z)*tz)*direction;frames++;
    stalled=progress-old<.001?stalled+1:0;
    assert(stalled<180,`Broadway drive stalled: ${JSON.stringify({direction,car,progress})}`);
  }
  assert(progress>=length+4,'Controller exits opposite open portal');
  drives.push({direction,frames,metres:progress,start:initial,end:{...car}});
}
assert(shell.stats.triangles>0);await mkdir(out,{recursive:true});
const report={passed:true,scope:'Exact emitted shell plus real camera/driving CPU smoke; native visual acceptance pending',manifestSha256:createHash('sha256').update(manifestBytes).digest('hex'),inventory,rows,drives,stats:shell.stats};
await writeFile(resolve(out,'source-report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({passed:true,rows:rows.length,drives:drives.map(d=>({direction:d.direction,metres:d.metres})),stats:shell.stats,out}));
