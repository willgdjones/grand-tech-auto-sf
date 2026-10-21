import { CylinderGeometry,Group,InstancedMesh,Matrix4,MeshBasicMaterial,Quaternion,Vector3 } from 'three';
import { signalGreen } from '@gtasf/shared/traffic/signals';
import { flags } from '@gtasf/shared/flags';
import type { PropSite } from './layout';

type Lamp='red'|'green'|'amber';
type PlacedSignal={site:PropSite;height:number};
/** Three bounded batches paint the active lens without changing the mast-arm mesh. */
export function createSignalLenses(capacity:number){
  const root=new Group();root.name='Source-controlled traffic signal lenses';
  const geometry=new CylinderGeometry(.095,.095,.025,8);geometry.rotateX(Math.PI/2);
  const colours={red:0xf24932,green:0x43d875,amber:0xefad4f},levels={red:7.94,amber:7.66,green:7.38};
  const meshes=new Map<Lamp,InstancedMesh>();
  for(const colour of ['red','green','amber'] as const){
    const lens=new MeshBasicMaterial({color:colours[colour]});
    // Self-luminous lens: stay unlit on the realistic path too (applyRealisticMaterials honours this),
    // so the signal reads as a bright glowing disc, not a dull lit surface with no emissive.
    lens.userData.gtasfUnlit=true;
    const mesh=new InstancedMesh(geometry,lens,capacity);
    mesh.name=`Traffic signal ${colour} lenses`;mesh.count=0;mesh.frustumCulled=false;meshes.set(colour,mesh);root.add(mesh);
  }
  const sites:PlacedSignal[]=[],matrix=new Matrix4(),rotation=new Quaternion(),position=new Vector3(),scale=new Vector3(1,1,1),up=new Vector3(0,1,0);
  const stats={red:0,green:0,amber:0};let disposed=false;
  return {
    root,stats,
    reset(){sites.length=0;},
    add(site:PropSite,height:number){if(sites.length<capacity)sites.push({site,height});},
    update(serverNow:number,trafficEnabled:boolean){
      if(disposed)return;
      for(const mesh of meshes.values())mesh.count=0;
      for(const {site,height} of sites){
        const junction=site.signalJunction??site.signalNodeId!;
        // graphicsV2: the last 3s of each authoritative green shows amber (visual only; traffic rules unchanged).
        const colour:Lamp=!trafficEnabled?'amber':signalGreen(serverNow,junction,site.yaw)?(flags.graphicsV2&&!signalGreen(serverNow+3000,junction,site.yaw)?'amber':'green'):'red';
        const mesh=meshes.get(colour)!,sin=Math.sin(site.yaw),cos=Math.cos(site.yaw);
        position.set(site.x+cos*2.75+sin*.203,height+levels[colour],site.z-sin*2.75+cos*.203);
        rotation.setFromAxisAngle(up,site.yaw);matrix.compose(position,rotation,scale);mesh.setMatrixAt(mesh.count++,matrix);
      }
      for(const [colour,mesh] of meshes){mesh.instanceMatrix.needsUpdate=true;stats[colour]=mesh.count;}
    },
    destroy(){
      if(disposed)return;disposed=true;root.removeFromParent();sites.length=0;
      for(const mesh of meshes.values()){mesh.dispose();(mesh.material as MeshBasicMaterial).dispose();}
      geometry.dispose();stats.red=0;stats.green=0;stats.amber=0;
    },
  };
}
