import {
  AdditiveBlending, BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group,
  Mesh, MeshBasicMaterial, MeshLambertMaterial, ShaderMaterial, UniformsLib, UniformsUtils,
  type Object3D,
} from 'three';
import { FootprintIndex, sampleHeight } from './chunks/terrain';
import { flags } from '@gtasf/shared/flags';
import type { LampFootprint } from './lampLightMap';
import type { ShopfrontContext } from './shopfrontSigns';

/** A cool baked fill keeps authored charcoal asphalt readable between sodium pools. */
export function addNightRoadLight(material: MeshLambertMaterial, night: { value: number }): void {
  const prepare = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.customProgramCacheKey = () => `${key}:night-road-v1${flags.nightWarmth ? 'w' : ''}`;
  material.onBeforeCompile = (shader, renderer) => {
    prepare.call(material, shader, renderer);
    shader.uniforms.uRoadNight = night;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uRoadNight;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += ' + (flags.nightWarmth
        // nightWarmth (critic #15): half the albedo-proportional fill (pale pavers no longer glow grey-blue) on a faint warm
        // light-pollution base, so the ground sits darker and the sodium pools read.
        ? '(vec3(0.03,0.026,0.022)+diffuseColor.rgb*0.12)*uRoadNight;'
        : '(vec3(0.025,0.035,0.05)+diffuseColor.rgb*0.25)*uRoadNight;'));
  };
}

/** Baked road light cards, not real lights. Each streamed cell adds at most eight lamps. */
export function createNightLights() {
  const uniforms = UniformsUtils.merge([UniformsLib.fog!, { night: { value: 0 }, colour: { value: new Color('#ffb34e') } }]);
  const poolMaterial = new ShaderMaterial({
    name: 'Sodium road pools', uniforms, transparent: true, depthWrite: false,
    blending: AdditiveBlending, side: DoubleSide, fog: true, toneMapped: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    vertexShader: `varying vec2 vPool;
      #include <fog_pars_vertex>
      void main(){vPool=uv;vec4 mvPosition=modelViewMatrix*vec4(position,1.0);
        gl_Position=projectionMatrix*mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `uniform float night;uniform vec3 colour;varying vec2 vPool;
      #include <fog_pars_fragment>
      void main(){float d=length(vPool);float falloff=pow(max(0.0,1.0-d*d),2.0);
        gl_FragColor=vec4(colour,falloff*night*0.3);
        #ifdef USE_FOG
          gl_FragColor.a*=1.0-smoothstep(fogNear,fogFar,vFogDepth);
        #endif
      }`,
  });
  // Self-luminous: keep the additive light-pool ShaderMaterial and the full-bright sodium bulbs out of
  // the realisticRender PBR conversion — converting them would destroy the additive pool shader and dull
  // the bulbs to lit surfaces. The converter skips userData.gtasfUnlit (gtasf-h0mi). [gtasf-jiyd]
  poolMaterial.userData.gtasfUnlit = true;
  const poleMaterial = new MeshLambertMaterial({ name: 'Sodium lamp posts', color: '#687981', flatShading: true });
  const bulbMaterial = new MeshBasicMaterial({ name: 'Warm sodium lamps', color: '#ffdfa0', fog: true });
  bulbMaterial.userData.gtasfUnlit = true;
  const footprints = new Set<LampFootprint>();
  const releases = new Set<() => void>(), nightMeshes = new Set<Mesh>();
  const stats = { lamps: 0, cells: 0, poolTriangles: 0, night: 0 };
  let disposed = false;
  function mount(root: Object3D): () => void {
    const context = root.userData.gtasfShopfrontContext as ShopfrontContext | undefined;
    if (!context || disposed) return () => {};
    const { ground, nearestRoad, collision } = context;
    const blockers = new FootprintIndex(); blockers.rebuild([collision]);
    const originX = ground.x*256, originZ = ground.z*256;
    const points: { x: number; y: number; z: number; px: number; py: number; pz: number; nx: number; nz: number }[] = [];
    for (let gx=32;gx<256;gx+=64) for (let gz=32;gz<256;gz+=64) {
      const road = nearestRoad(originX+gx,originZ+gz,34);
      if (!road || points.length>=8 || Math.floor(road.x/256)!==ground.x || Math.floor(road.z/256)!==ground.z) continue;
      if (points.some(p=>Math.hypot(p.x-road.x,p.z-road.z)<35)) continue;
      const centre = sampleHeight(ground,road.x,road.z);
      if (centre===null || Math.abs(centre-road.y)>1.5) continue;
      // Find a clear roadside shoulder outside every nearby lane. Never place in buildings.
      let site: typeof points[number] | undefined;
      for (const side of [1,-1]) {
        const nx=Math.cos(road.yaw)*side,nz=-Math.sin(road.yaw)*side;
        for (let offset=5;offset<=17;offset+=3) {
          const px=road.x+nx*offset,pz=road.z+nz*offset,py=sampleHeight(ground,px,pz);
          if (py===null || Math.abs(py-road.y)>1.5 || nearestRoad(px,pz,3.8)
            || blockers.collides(px,py+.1,pz,.35,8)) continue;
          site={x:road.x,y:road.y,z:road.z,px,py,pz,nx,nz};break;
        }
        if(site)break;
      }
      if(site)points.push(site);
    }
    if (!points.length) return () => {};
    const lights = points.map(p => ({ x: p.x, y: p.y, z: p.z }));
    for (const light of lights) footprints.add(light);
    const group = new Group(); group.name = 'Night street lighting';
    const pools:number[]=[],uvs:number[]=[],posts:number[]=[],bulbs:number[]=[];
    const vertex=(list:number[],x:number,y:number,z:number)=>list.push(x-root.position.x,y-root.position.y,z-root.position.z);
    function box(list:number[],cx:number,cy:number,cz:number,sx:number,sy:number,sz:number) {
      const corners=[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
      for(const face of [[0,3,2,1],[4,5,6,7],[0,4,7,3],[1,2,6,5],[3,7,6,2],[0,1,5,4]])
        for(const index of [face[0]!,face[1]!,face[2]!,face[0]!,face[2]!,face[3]!]) {
          const p=corners[index]!;vertex(list,cx+p[0]!*sx/2,cy+p[1]!*sy/2,cz+p[2]!*sz/2);
        }
    }
    for (const p of points) {
      box(posts,p.px,p.py+3.8,p.pz,.18,7.6,.18);
      // Short street-facing arm and its glowing housing, all merged into cell batches.
      const hx=p.px-p.nx*1.4,hz=p.pz-p.nz*1.4;
      box(posts,(p.px+hx)/2,p.py+7.5,(p.pz+hz)/2,Math.abs(p.nx)*1.4+.14,.14,Math.abs(p.nz)*1.4+.14);
      box(bulbs,hx,p.py+7.43,hz,.65,.12,.4);
      // 4x4 draped grid follows source hills rather than floating one flat quad above roads.
      for(let x=0;x<4;x++)for(let z=0;z<4;z++)for(const [dx,dz]of[[0,0],[1,0],[1,1],[0,0],[1,1],[0,1]]) {
        const u=(x+dx!)/2-1,v=(z+dz!)/2-1;
        const wx=p.x+p.nx*u*6-p.nz*v*10,wz=p.z+p.nz*u*6+p.nx*v*10;
        const y=sampleHeight(ground,wx,wz);
        vertex(pools,wx,(y??p.y)+.19,wz);uvs.push(u,v);
      }
    }
    function mesh(vertices:number[],material:MeshLambertMaterial|MeshBasicMaterial|ShaderMaterial,name:string) {
      const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(vertices,3));
      if(material===poolMaterial)geometry.setAttribute('uv',new Float32BufferAttribute(uvs,2));
      else geometry.computeVertexNormals();
      geometry.computeBoundingSphere();const result=new Mesh(geometry,material);result.name=name;group.add(result);return result;
    }
    mesh(posts,poleMaterial,'Sodium posts');
    const bulb=mesh(bulbs,bulbMaterial,'Sodium bulbs'),pool=mesh(pools,poolMaterial,'Sodium pools');
    pool.renderOrder=2;pool.visible=!flags.graphicsV2&&stats.night>.001;bulb.visible=stats.night>.001;
    if(!flags.graphicsV2)nightMeshes.add(pool);nightMeshes.add(bulb);
    root.add(group);stats.cells++;stats.lamps+=points.length;stats.poolTriangles+=pools.length/9;
    let released=false;
    const release=()=>{if(released)return;released=true;root.remove(group);for(const child of group.children as Mesh[])child.geometry.dispose();
      for(const light of lights)footprints.delete(light);nightMeshes.delete(pool);nightMeshes.delete(bulb);stats.cells--;stats.lamps-=points.length;stats.poolTriangles-=pools.length/9;releases.delete(release);};
    releases.add(release);return release;
  }
  return {stats,mount,footprints,nightUniform:uniforms.night! as { value: number },
    setNight(value:number){stats.night=Math.max(0,Math.min(1,value));uniforms.night!.value=stats.night;for(const mesh of nightMeshes)mesh.visible=stats.night>.001;},
    dispose(){if(disposed)return;disposed=true;for(const release of releases)release();poolMaterial.dispose();poleMaterial.dispose();bulbMaterial.dispose();},
  };
}
