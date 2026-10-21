import { BoxGeometry, Group, InstancedMesh, LinearFilter, Matrix4, MeshLambertMaterial, NearestFilter,
  PlaneGeometry, Quaternion, SRGBColorSpace, Vector3 } from 'three';
import { loadSceneryTexture } from '../sceneryTexture';
import { flags } from '@gtasf/shared/flags';
import { BILLBOARD_SURFACES } from '@gtasf/shared/content/billboards';
import { geodeticToWorld } from '../../../../tools/map/src/geo';
import { SF_FRAME } from '../../../../tools/map/src/config';
import { createRoadSampler } from '../chunks/terrain';
import { claimHeavyFrame } from '../mountScheduler';
import type { StreetPropWorld } from './streetProps';

/** Original unsold artwork only; paid slot authority remains outside this module. */
export async function createParodyBillboards(options:{
  world:StreetPropWorld;low?:boolean;enabled?:boolean;
  /** Required once rentals are on. Unknown/unapproved ownership must return false. */
  isUnsold?(id:string):boolean;
}){
  if(!(options.enabled??('parodyBillboards' in flags&&Boolean(flags.parodyBillboards))))return null;
  const loaded=await Promise.allSettled([
    loadSceneryTexture('/art/billboards/unsold-atlas.png'),
    loadSceneryTexture('/art/props/street-props.png'),
  ]);
  const failure=loaded.find(result=>result.status==='rejected');
  if(failure?.status==='rejected'){
    for(const result of loaded)if(result.status==='fulfilled')result.value.dispose();
    throw failure.reason;
  }
  const texture=(loaded[0] as PromiseFulfilledResult<import('three').Texture>).value;
  const frameTexture=(loaded[1] as PromiseFulfilledResult<import('three').Texture>).value;
  texture.colorSpace=SRGBColorSpace;texture.magFilter=NearestFilter;texture.minFilter=LinearFilter;texture.generateMipmaps=false;
  frameTexture.colorSpace=SRGBColorSpace;frameTexture.magFilter=NearestFilter;
  const material=new MeshLambertMaterial({map:texture}),frameMaterial=new MeshLambertMaterial({map:frameTexture,color:'#a0aaa0'});
  const root=new Group();root.name='Original unsold SF parody billboards';
  // Founder feedback (gtasf-more-billboards-sky-ads-hyvs): far more boards on screen. These are
  // InstancedMesh, so a higher cap adds instances, not draw calls; frames stay one mesh.
  const capacity=options.low?12:30,faces:InstancedMesh[]=[];
  for(let i=0;i<6;i++){
    const geometry=new PlaneGeometry(1,1),uv=geometry.getAttribute('uv');
    for(let j=0;j<uv.count;j++)uv.setXY(j,((i%2)*512+8+uv.getX(j)*496)/1024,1-(Math.floor(i/2)*256+8+(1-uv.getY(j))*240)/768);
    const mesh=new InstancedMesh(geometry,material,capacity);mesh.count=0;mesh.frustumCulled=false;mesh.userData.gtasfBillboard=true;
    mesh.name=`Unsold parody creative ${i+1}`;faces.push(mesh);root.add(mesh);
  }
  const frameGeometry=new BoxGeometry(1,1,1),frameUv=frameGeometry.getAttribute('uv');
  for(let i=0;i<frameUv.count;i++)frameUv.setXY(i,(8+frameUv.getX(i)*240)/1024,1-(264+(1-frameUv.getY(i))*240)/512);
  const frames=new InstancedMesh(frameGeometry,frameMaterial,capacity*7);frames.count=0;frames.frustumCulled=false;frames.name='Billboard frames and posts';root.add(frames);
  const candidates=BILLBOARD_SURFACES.filter(surface=>surface.coverage==='sf').map((surface,index)=>{
    const [x,z]=geodeticToWorld(surface.lat,surface.lon,SF_FRAME);return {surface,index,p:{x,z}};
  });
  const roadAt=options.world.roadHeightAt??createRoadSampler(options.world.graph),position=new Vector3(),rotation=new Quaternion(),scale=new Vector3(),matrix=new Matrix4(),up=new Vector3(0,1,0);
  let nextUpdate=-Infinity,lastX=Infinity,lastZ=Infinity,disposed=false;
  // `placed` exposes each visible board's id + world centre so the clickable slot overlay
  // (gtasf-buy-ad-slot-page-yxua) can project a "Buy this billboard" hotspot onto it.
  const stats={visible:0,ids:[] as string[],placed:[] as {id:string;x:number;y:number;z:number}[]};
  function box(x:number,y:number,z:number,yaw:number,width:number,height:number,depth:number){
    if(frames.count>=frames.instanceMatrix.count)return;
    position.set(x,y,z);rotation.setFromAxisAngle(up,yaw);scale.set(width,height,depth);matrix.compose(position,rotation,scale);frames.setMatrixAt(frames.count++,matrix);
  }
  function update(focus:{x:number;z:number},now=performance.now()){
    if(disposed||(now<nextUpdate&&Math.hypot(focus.x-lastX,focus.z-lastZ)<40))return;
    // gtasf-3k35 (sequencedMount): this placement is an unsliced one-shot (collision + height probes for
    // every nearby board). Run it only on a frame this stage owns so it never shares the mount frame with
    // the prop/road/radar builds; retry next frame otherwise (nextUpdate is only armed once it runs).
    if(!claimHeavyFrame('billboards'))return;
    nextUpdate=now+1500;lastX=focus.x;lastZ=focus.z;frames.count=0;for(const face of faces)face.count=0;stats.ids=[];stats.placed=[];
    const radius=options.low?300:520;
    const nearest=candidates.filter(c=>(c.p.x-focus.x)**2+(c.p.z-focus.z)**2<radius*radius)
      .sort((a,b)=>(a.p.x-focus.x)**2+(a.p.z-focus.z)**2-((b.p.x-focus.x)**2+(b.p.z-focus.z)**2));
    for(const {surface,index,p} of nearest){
      if(stats.ids.length>=capacity)break;
      if(!(options.isUnsold?options.isUnsold(surface.id):!flags.rentals))continue;
      const heading=surface.headingDeg*Math.PI/180,nx=Math.sin(heading),nz=-Math.cos(heading),yaw=Math.PI-heading;
      const width=Math.min(surface.widthMetres,10),height=Math.min(surface.heightMetres,4),tx=Math.cos(yaw),tz=-Math.sin(yaw);
      let x=p.x,z=p.z,y:number|null=null;
      // Catalogue positions are candidates. Only modest moves along the face normal
      // are allowed, to stand outside a source footprint and preserve drivable lanes.
      for(let offset=0;offset<=18;offset+=1.5){
        x=p.x+nx*offset;z=p.z+nz*offset;y=options.world.heightAt(x,z);
        if(y===null)break;
        if(!options.world.collides(x,y+.1,z,1,12)&&[-1,0,1].every(side=>{
          const px=x+tx*width*.3*side,pz=z+tz*width*.3*side;
          return roadAt(px,pz,y!)===null&&!options.world.collides(px,y!+.1,pz,.4,12);
        }))break;
        y=null;
      }
      if(y===null)continue;
      const centerY=y+Math.max(5,surface.centerHeightAboveGroundMetres);
      const face=faces[index%6]!;position.set(x+nx*.17,centerY,z+nz*.17);rotation.setFromAxisAngle(up,yaw);scale.set(width,height,1);
      matrix.compose(position,rotation,scale);face.setMatrixAt(face.count++,matrix);
      box(x,centerY,z,yaw,width+.28,height+.28,.22);
      // Back is steel; front artwork sits 6 cm in front of the frame backing.
      for(const side of [-1,1]){
        const px=x+tx*width*.3*side,pz=z+tz*width*.3*side,ground=options.world.heightAt(px,pz)??y,poleHeight=centerY-ground-height*.43;
        box(px,ground+poleHeight/2,pz,yaw,.2,poleHeight,.2);
      }
      stats.ids.push(surface.id);stats.placed.push({id:surface.id,x:x+nx*.17,y:centerY,z:z+nz*.17});
    }
    frames.instanceMatrix.needsUpdate=true;for(const face of faces)face.instanceMatrix.needsUpdate=true;stats.visible=stats.ids.length;
    if(flags.emptyInstanceSkip)for(const mesh of [...faces,frames])mesh.visible=mesh.count>0; // no empty draws (gtasf-c8sj)
  }
  return {root,update,stats,destroy(){if(disposed)return;disposed=true;root.removeFromParent();for(const mesh of [...faces,frames]){mesh.geometry.dispose();mesh.dispose();}material.dispose();frameMaterial.dispose();texture.dispose();frameTexture.dispose();}};
}
