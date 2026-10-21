import { BatchedMesh, BoxGeometry, BufferGeometry, Color, CylinderGeometry, DoubleSide, Float32BufferAttribute,
  Group, InstancedMesh, LinearFilter, LinearMipmapLinearFilter, Matrix4, MeshLambertMaterial, NearestFilter, PlaneGeometry,
  Quaternion, SRGBColorSpace, Vector3, Texture } from 'three';
import { hdFurnitureGeometry } from './hdFurniture';
import { loadSceneryTexture } from '../sceneryTexture';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { flags } from '@gtasf/shared/flags';
import type { RoadGraph } from '@gtasf/shared/roadgraph';
import { addRealStreetTrees, createStreetPropLayout, withNearby, type PropKind, type PropSite, type RoadHeightAt, type WireSpan, type PropCell, type KerbCarSpot } from './layout';
import { createSignalLenses } from './signalLenses';
import { createLandmarkWireCollision, createWireRibbons, saggedWire, wireClearanceSteps } from './wires';
import { addFoliageCameraFade, addFoliageCanopyHide } from './foliageFade';
import { createKnockover } from './propKnockover';
import { createWaterSpray } from './waterSpray';
import treeAtlas from '../../../public/art/foliage/sf-trees.json';
import { graphicsPreset } from '../graphicsPreset';
import { createBlobShadow } from '../blobShadow';
import { propLampFootprints, propShopfrontFootprints, type LampFootprint } from '../lampLightMap';
import { createKerbCars } from './kerbCars';
import { fullRoadGraphSource } from '../chunks/world';
import { claimHeavyFrame } from '../mountScheduler';
import { registerPlaza } from '../plazas';

export interface StreetPropWorld {
  graph:RoadGraph;
  heightAt(x:number,z:number):number|null;
  /** Reuse the map's spatial road index when decorating the full city. */
  roadHeightAt?:RoadHeightAt;
  collides(x:number,y:number,z:number,radius?:number,height?:number):boolean;
  /** Changes with streamed geometry. Without it refresh is synchronous and never reuses clearance. */
  readonly collisionRevision?:number;
}
const TYPES:PropKind[]=['pole','light','trafficStop','parkingMeter','hydrant','newspaper','stop','palm','plane','cypress','fence','cone','bin',
  // Realistic furniture only gets instanced draws when its layout can produce it.
  ...(flags.streetDetail||flags.graphicsV2?['mailbox','bikeRack','streetLamp'] as PropKind[]:[]),
  ...(flags.graphicsV2?['bench','bicycle','planter','treeWell','eucalyptus','pine','ficus','yardPlanter','monument','bollard'] as PropKind[]:[])];
const WHITE=7,WOOD=0,HYDRANT=1,NEWS=2,STOP=3,METAL=4,FENCE=5;
/** Small props the driver's car can knock over (gtasf-arcade-props-knockover-30v0); big/fixed furniture
 *  (poles, lights, trees, fences) never topples. */
const KNOCKABLE=new Set<PropKind>(['hydrant','newspaper','stop','trafficStop','parkingMeter','cone','bin']);
const HALF_PI=Math.PI/2;
const TREE_WELL_CORNERS=[[-1,-1],[-1,1],[1,-1],[1,1]] as const;
type PlacedSite={id:number;x:number;z:number;yaw:number;y:number};
type Point=readonly[number,number,number];
/** Shared textured geometry per prop kind. Atlas is 4x2 with an 8px gutter. */
function geometry(kind:PropKind,metricTrees=false):BufferGeometry {
  if(kind==='yardPlanter')return hdFurnitureGeometry('planter');
  if(kind==='bicycle'||kind==='planter'||kind==='treeWell')return hdFurnitureGeometry(kind);
  const parts:BufferGeometry[]=[];
  function add(input:BufferGeometry,position:Point,colour:string,tile=WHITE,rotationY=0){
    const g=input.index?input.toNonIndexed():input;if(g!==input)input.dispose();
    g.rotateY(rotationY).translate(...position);
    const c=new Color(colour),colours=new Float32Array(g.getAttribute('position').count*3);
    for(let i=0;i<colours.length;i+=3)c.toArray(colours,i);g.setAttribute('color',new Float32BufferAttribute(colours,3));
    const uv=g.getAttribute('uv');
    for(let i=0;i<uv.count;i++)uv.setXY(i,((tile%4)*256+8+uv.getX(i)*240)/1024,1-(Math.floor(tile/4)*256+8+(1-uv.getY(i))*240)/512);
    parts.push(g);
  }
  const box=(p:Point,size:Point,c:string,tile=WHITE)=>add(new BoxGeometry(...size),p,c,tile);
  const cylinder=(p:Point,bottom:number,top:number,height:number,c:string,tile=WHITE)=>add(new CylinderGeometry(top,bottom,height,8),p,c,tile);
  const face=(p:Point,width:number,height:number,tile:number)=>add(new PlaneGeometry(width,height),p,'#ffffff',tile);
  if(kind==='monument'){
    // Dewey Monument, Union Square: granite plinth, Corinthian column and the bronze Victory figure.
    box([0,1,0],[5.2,2,5.2],'#c9c1b0',WHITE);box([0,2.6,0],[3.6,1.2,3.6],'#d4ccbb',WHITE);
    cylinder([0,3.6,0],1.25,1.25,.8,'#cfc6b4');cylinder([0,16,0],.95,.82,24,'#e0d8c6');
    box([0,28.4,0],[2.3,.9,2.3],'#d8cfbd',WHITE);cylinder([0,29.2,0],.7,.7,.7,'#b8a98a');
    cylinder([0,31,0],.35,.5,3,'#6f5a2e',METAL);cylinder([0,33,0],.25,.25,.7,'#6f5a2e',METAL);
    box([.9,31.6,0],[1.8,.12,.5],'#6f5a2e',METAL);box([-.4,32.4,0],[.12,1.4,.12],'#6f5a2e',METAL);
  }else if(kind==='pole'){
    cylinder([0,5.3,0],.19,.13,10.6,'#d7c9a6',WOOD);
    box([0,9.6,0],[.18,.16,2.3],'#b7a482',WOOD);box([0,8.5,0],[.15,.14,1.6],'#aa9673',WOOD);
    for(const z of [-.85,0,.85])cylinder([0,9.84,z],.11,.09,.3,'#b4c6bf');
    cylinder([.38,8.5,.13],.25,.25,.85,'#8b9f9c',METAL);
    for(const y of [1.2,4.4,7.4])box([0,y,.145],[.38,.035,.075],'#473f31');
  }else if(kind==='light'){
    cylinder([0,4.1,0],.14,.09,8.2,'#889491',METAL);
    box([1.9,8.2,0],[3.9,.12,.14],'#909995',METAL);box([3.6,8.1,0],[.7,.12,.35],'#fff0a2');
    cylinder([0,.26,0],.3,.2,.52,'#646d68',METAL);
    // Active lenses are a separate bounded batch, sharing the authoritative phase.
    box([2.75,7.65,0],[.32,.94,.3],'#b6a349');
    for(let i=0;i<3;i++){
      const lens=new CylinderGeometry(.105,.105,.04,8);lens.rotateX(Math.PI/2);
      add(lens,[2.75,7.94-i*.28,.17],'#283c31');
    }
  }else if(kind==='hydrant'){
    cylinder([0,.1,0],.26,.24,.2,'#c95035',HYDRANT);cylinder([0,.49,0],.15,.16,.68,'#e9ac87',HYDRANT);
    cylinder([0,.9,0],.19,.08,.22,'#e8b49b',HYDRANT);box([0,.68,0],[.56,.2,.2],'#b14834',HYDRANT);
    cylinder([0,1.03,0],.055,.055,.07,'#aa977d',METAL);
  }else if(kind==='trafficStop'){
    cylinder([0,1.25,-.08],.04,.04,2.5,'#a2aaa3',METAL);
    const plate=new CylinderGeometry(.5,.5,.035,8);plate.rotateX(Math.PI/2).rotateZ(Math.PI/8);
    add(plate,[0,2.45,0],'#dedccf');
    const facePlate=new CylinderGeometry(.45,.45,.008,8);facePlate.rotateX(Math.PI/2).rotateZ(Math.PI/8);
    add(facePlate,[0,2.45,.024],'#b42d25');
    // Original block lettering is geometry, sharing the existing white atlas tile.
    // Row runs stay crisp at the PS2 scale without a font, texture or extra draw.
    const glyphs=[['11111','10000','10000','11111','00001','00001','11111'],
      ['11111','00100','00100','00100','00100','00100','00100'],
      ['01110','10001','10001','10001','10001','10001','01110'],
      ['11110','10001','10001','11110','10000','10000','10000']];
    const pixel=.024;
    for(let letter=0;letter<glyphs.length;letter++)for(let row=0;row<7;row++){
      const cells=glyphs[letter]![row]!;
      for(let column=0;column<cells.length;){
        if(cells[column]!=='1'){column++;continue;}
        const start=column;while(cells[column]==='1')column++;
        const width=(column-start)*pixel,x=(letter*6+start+(column-start)/2-11.5)*pixel,y=2.45+(3-row)*pixel;
        add(new PlaneGeometry(width,pixel),[x,y,.029],'#eee8d7');
      }
    }
  }else if(kind==='parkingMeter'){
    cylinder([0,.62,0],.046,.046,1.24,'#98a39a',METAL);
    cylinder([0,.055,0],.12,.10,.11,'#646d68',METAL);
    const cap=new CylinderGeometry(.25,.25,.28,8);cap.rotateX(Math.PI/2);
    add(cap,[0,1.55,0],'#5b6862',METAL);box([0,1.39,0],[.5,.3,.28],'#64736b',METAL);
    box([0,1.47,.15],[.39,.35,.018],'#c7cab6');
    box([0,1.59,.165],[.33,.13,.012],'#142924');
    // Original pixel-mesh rate display: a fictional price, no texture or payment UI.
    const glyphs=[['00100','01111','10100','01110','00101','11110','00100'],
      ['00100','01100','00100','00100','00100','00100','01110'],
      ['10010','10010','10010','11111','00010','00010','00010']];
    const pixel=.014;
    for(let letter=0;letter<glyphs.length;letter++)for(let row=0;row<7;row++){
      const cells=glyphs[letter]![row]!;
      for(let column=0;column<cells.length;){
        if(cells[column]!=='1'){column++;continue;}
        const start=column;while(cells[column]==='1')column++;
        const width=(column-start)*pixel,x=(letter*6+start+(column-start)/2-8.5)*pixel,y=1.59+(3-row)*pixel;
        add(new PlaneGeometry(width,pixel),[x,y,.172],'#e1e8be');
      }
    }
    box([0,1.39,.165],[.11,.017,.018],'#263730');
    for(const [x,colour] of [[-.095,'#688554'],[.095,'#9d5744']] as const){
      const button=new CylinderGeometry(.026,.026,.012,8);button.rotateX(Math.PI/2);add(button,[x,1.32,.168],colour);
    }
  }else if(kind==='newspaper'){
    box([0,.16,0],[.62,.32,.48],'#23473f');box([0,.7,0],[.67,.82,.5],'#2b6454',METAL);
    box([0,1.14,0],[.71,.09,.56],'#b7b09a',METAL);face([0,.74,.256],.59,.64,NEWS);
  }else if(kind==='stop'){
    cylinder([0,1.65,0],.045,.045,3.3,'#9aaba6',METAL);box([0,2.94,0],[.48,.68,.07],'#ded6bb');
    face([0,2.94,.041],.46,.66,STOP);
  }else if(kind==='fence'){
    for(const x of [-2.5,2.5])cylinder([x,1.2,0],.055,.055,2.4,'#869791',METAL);
    box([0,2.25,0],[5,.07,.07],'#b4bbaa',METAL);face([0,1.13,0],5,2.18,FENCE);
  }else if(kind==='cone'){
    cylinder([0,.28,0],.17,.03,.56,'#e4632a',METAL);  // orange traffic cone
    box([0,.035,0],[.34,.07,.34],'#c9ccc2',METAL);     // weighted base
    cylinder([0,.33,0],.135,.115,.1,'#f2f2f2');        // reflective white band
  }else if(kind==='bin'){
    cylinder([0,.42,0],.23,.2,.84,'#2f6b4f',METAL);    // green bin body
    cylinder([0,.87,0],.25,.25,.08,'#20402f',METAL);   // lid
    box([0,.52,.21],[.2,.26,.03],'#9aa39a');           // label panel
  }else if(kind==='bollard'){
    cylinder([0,.42,0],.09,.11,.84,'#2b2f34',METAL);   // cast-iron kerb bollard, slight taper
    cylinder([0,.88,0],.12,.10,.12,'#2b2f34',METAL);   // rounded cap
  }else if(kind==='bench'){
    // Slatted wood seat/back on cast-metal legs, facing local +Z.
    for(const x of [-.7,.7]){
      box([x,.25,0],[.09,.5,.52],'#35483c',METAL);
      box([x,.69,-.22],[.08,.85,.08],'#35483c',METAL);
    }
    for(const z of [-.2,0,.2])box([0,.49,z],[1.85,.075,.16],'#a38a61',WOOD);
    for(const y of [.73,.94])box([0,y,-.25],[1.85,.16,.06],'#a38a61',WOOD);
  }else if(kind==='mailbox'){
    // USPS-style blue collection box on two short legs, with a curved hood and pull handle.
    for(const x of [-.17,.17])box([x,.12,0],[.06,.24,.4],'#1d2a4a',METAL);
    box([0,.62,0],[.46,.76,.46],'#24427f',METAL);
    const hood=new CylinderGeometry(.23,.23,.46,10,1,false,0,Math.PI);hood.rotateZ(HALF_PI);hood.rotateY(HALF_PI);add(hood,[0,1,0],'#24427f',METAL);
    box([0,1.03,.2],[.3,.04,.1],'#c9ccd0',METAL);box([0,.74,.235],[.28,.14,.012],'#e6e9ef');
  }else if(kind==='bikeRack'){
    // Two galvanized inverted-U hoops on the sidewalk.
    for(const x of [-.45,.45]){
      for(const z of [-.32,.32])cylinder([x,.42,z],.03,.03,.84,'#b8bec0',METAL);
      const top=new CylinderGeometry(.03,.03,.64,6);top.rotateX(HALF_PI);add(top,[x,.84,0],'#b8bec0',METAL);
    }
  }else if(kind==='streetLamp'){
    // Galvanized cobra-head street light; the arm reaches over the carriageway (local -z).
    cylinder([0,4.4,0],.13,.08,8.8,'#8d9493',METAL);cylinder([0,.3,0],.22,.18,.6,'#6f7674',METAL);
    const arm=new CylinderGeometry(.05,.05,2.3,6);arm.rotateX(HALF_PI);add(arm,[0,8.75,-1.1],'#8d9493',METAL);
    box([0,8.72,-2.45],[.42,.16,.8],'#7f8685',METAL);box([0,8.62,-2.45],[.32,.04,.62],'#fff3cf');
  }else{
    // Whole-tree silhouettes on crossed alpha cards, no camera-facing updates.
    const cell=metricTrees?treeAtlas.cells.find(cell=>cell.id===kind):undefined;
    const height=cell?.heightMetres??(kind==='palm'?14:kind==='plane'?10:12),width=cell?.widthMetres??height;
    const a=new PlaneGeometry(width,height).translate(0,height/2,0),b=a.clone().rotateY(Math.PI/2);
    const merged=mergeGeometries([a,b],false)!;a.dispose();b.dispose();return merged;
  }
  const merged=mergeGeometries(parts,false)!;for(const p of parts)p.dispose();return merged;
}

/** Call every frame. Refresh once per second, after 45m movement, or when geometry changes. */
/** Smooth a foliage alpha card: Linear magnification + anisotropy so the leaves aren't pixelated and
 *  the alphaTest silhouette isn't jagged up close (founder look gap, gtasf-r0yf). The chunky SA prop
 *  atlas keeps NearestFilter; mipmaps (the default minFilter) still handle the distance minification. */
export function smoothFoliageTexture(map:Texture):void{
  map.magFilter=LinearFilter;
  map.anisotropy=Math.max(map.anisotropy,4);
  map.needsUpdate=true;
}

/** gtasf-c8sj: run the whole-city layout in layout.worker.ts; undefined (inline fallback) on any failure. */
async function layoutInWorker(graphicsV2Hd:boolean){
  const source=fullRoadGraphSource;
  if(!source||typeof Worker==='undefined')return undefined;
  let worker:Worker|undefined;
  try{
    worker=new Worker(new URL('./layout.worker.ts',import.meta.url),{type:'module',name:'GTASF street layout'});
    const result=await new Promise<{layout?:Omit<Awaited<ReturnType<typeof createStreetPropLayout>>,'nearby'>;plazas?:[number,number,number,number][];error?:string}>((resolve,reject)=>{
      const cells=new Map<string,PropCell>(),kerbCars:KerbCarSpot[]=[];
      // Batched stream (layout.worker.ts): cells and kerb-car batches, then the remainder of the layout.
      worker!.onmessage=event=>{const data=event.data as {cells?:[string,PropCell][];kerbCars?:KerbCarSpot[];layout?:object;plazas?:[number,number,number,number][];error?:string};
        if(data.cells){for(const [key,cell] of data.cells)cells.set(key,cell);return;}
        if(data.kerbCars){for(const spot of data.kerbCars)kerbCars.push(spot);return;}
        resolve({plazas:data.plazas,error:data.error,layout:data.layout?{...data.layout,cells,kerbCars} as never:undefined});};
      worker!.onerror=event=>reject(new Error(event.message||'layout worker failed'));
      worker!.postMessage({url:source.url,artifact:source.artifact,graphicsV2Hd});
    });
    if(!result.layout)throw new Error(result.error??'layout worker returned nothing');
    for(const [minX,minZ,maxX,maxZ] of result.plazas??[])registerPlaza(minX,minZ,maxX,maxZ);
    return withNearby(result.layout);
  }catch(error){console.warn('Street layout worker failed; laying out on the main thread.',error);return undefined;}
  finally{worker?.terminate();}
}
const TREE_DEBUG=typeof location!=='undefined'&&/[?&]debug=trees\b/.test(location.search);
export async function createStreetProps(options:{world:StreetPropWorld;landmarks?:Group;low?:boolean;enabled?:boolean;trafficEnabled?:boolean}) {
  if(!(options.enabled??flags.streetProps))return null;
  const hdPolish=flags.graphicsV2&&!options.low&&graphicsPreset()==='hd';
  const types=TYPES.filter(kind=>hdPolish||!['treeWell','eucalyptus','pine','ficus','yardPlanter'].includes(kind));
  const root=new Group();root.name='SF instanced street furniture';
  const textures:Texture[]=[];
  async function texture(path:string):Promise<Texture>{
    const value=await loadSceneryTexture(path);
    value.colorSpace=SRGBColorSpace;value.magFilter=NearestFilter;textures.push(value);return value;
  }
  // Start texture IO in parallel with the (CPU-bound, yield-batched) layout build so the network
  // fetch doesn't wait for the whole-city layout to finish — cold-load latency (CobaltHarbor, en7n).
  const treeKinds=hdPolish?treeAtlas.cells.map(cell=>cell.id):['palm','plane','cypress'];
  const foliagePaths=hdPolish?[treeAtlas.atlas]:treeKinds.map(name=>`/art/foliage/${name}.png`);
  const treeBitmaps:ImageBitmap[]=[];
  const texturesLoading=Promise.allSettled(['/art/props/street-props.png',...foliagePaths].map(texture));
  let layout:Awaited<ReturnType<typeof createStreetPropLayout>>;
  try{layout=(flags.layoutWorker?await layoutInWorker(hdPolish):undefined)??await createStreetPropLayout(options.world.graph,{roadHeightAt:options.world.roadHeightAt,graphicsV2Hd:hdPolish});}
  catch(error){await texturesLoading;for(const t of textures)t.dispose();throw error;}
  // gtasf-umar: real DataSF street trees replace the procedural ones (layout skips them under the same flag). A
  // failed fetch just leaves streets without trees; it never blocks the rest of the street furniture.
  if(flags.realStreetTrees){
    // treesOffCarriageway (gtasf-tr62l): the same DataSF set minus trunks within 2 m of a lane centre (a plane on the SoMa double
    // yellow), filtered offline by tools/map/street-trees-offroad.mts; no runtime cost.
    try{const response=await fetch(flags.treesOffCarriageway?'/art/trees/street-trees-offroad.bin':'/art/trees/street-trees.bin',{signal:AbortSignal.timeout(20_000)});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      addRealStreetTrees(layout.cells,await response.arrayBuffer(),hdPolish);}
    catch(error){console.warn('Street trees could not load.',error instanceof Error?error.message:error);}
  }
  // Cosmetic kerbside parked cars load beside the furniture; a failure never blocks street props.
  let kerbCars:Awaited<ReturnType<typeof createKerbCars>>=null,kerbGone=false;
  void createKerbCars(layout.kerbCars,{low:!hdPolish,heightAt:(x,z,y)=>options.world.roadHeightAt?.(x,z,y)??options.world.heightAt(x,z)})
    .then(cars=>{if(!cars)return;if(kerbGone){cars.dispose();return;}kerbCars=cars;root.add(cars.root);}).catch(()=>{});
  let atlas:Texture,foliage:(Texture|null)[]=[];
  try {
    const loaded=await texturesLoading;
    const props=loaded[0]!;
    if(props.status==='rejected')throw props.reason;
    atlas=props.value;
    if(hdPolish){
      const cropped:Texture[]=[];
      try {
        const trees=loaded[1]!;
        if(trees.status==='rejected')throw trees.reason;
        const source=trees.value.image as HTMLImageElement;
        if(source.width!==treeAtlas.width||source.height!==treeAtlas.height)throw new Error('Tree atlas dimensions');
        for(const cell of treeAtlas.cells){
          const [x,y,w,h]=cell.rect as [number,number,number,number];
          const bitmap=await createImageBitmap(source,x,y,w,h,{imageOrientation:'flipY',premultiplyAlpha:'none',colorSpaceConversion:'none'});
          treeBitmaps.push(bitmap);const map=new Texture(bitmap);map.flipY=false;map.colorSpace=SRGBColorSpace;map.needsUpdate=true;cropped.push(map);
        }
        textures.push(...cropped);foliage=cropped;
      } catch {
        // Optional HD artwork must not remove signals, poles, furniture or all trees.
        for(const map of cropped)map.dispose();for(const bitmap of treeBitmaps)bitmap.close();treeBitmaps.length=0;
        const legacy=await Promise.allSettled(['palm','plane','cypress'].map(name=>texture(`/art/foliage/${name}.png`)));
        const maps=legacy.map(result=>result.status==='fulfilled'?result.value:null);
        foliage=treeKinds.map(kind=>maps[kind==='palm'?0:kind==='cypress'||kind==='pine'?2:1]??null);
      } finally {
        // Species bitmaps own their pixels now; the full atlas is never rendered.
        // Drop its decoded image as well as the texture, including on crop failure.
        const trees=loaded[1]!;
        if(trees.status==='fulfilled'){
          const index=textures.indexOf(trees.value);if(index>=0)textures.splice(index,1);
          trees.value.dispose();trees.value.image=null;
        }
      }
    } else {
      if(!flags.graphicsV2){const failed=loaded.find(result=>result.status==='rejected');if(failed?.status==='rejected')throw failed.reason;}
      foliage=loaded.slice(1).map(result=>result.status==='fulfilled'?result.value:null);
    }
  } catch(error){for(const t of textures)t.dispose();for(const b of treeBitmaps)b.close();throw error;}
  for(const map of foliage){
    if(!map)continue;
    smoothFoliageTexture(map);
    if(flags.graphicsV2){map.minFilter=LinearMipmapLinearFilter;map.generateMipmaps=true;map.anisotropy=hdPolish?8:4;}
  }
  const propMaterial=new MeshLambertMaterial({map:atlas,vertexColors:true,flatShading:true,alphaTest:.5,side:DoubleSide});
  // On the realistic path this Lambert is converted to PBR (applyRealisticMaterials); hint a
  // metal-appropriate finish so poles/lamps/signs/boxes don't read as flat matte clay next to the
  // PBR road rails and manholes. Metalness stays 0 (dielectric sheen, no env-map darkening).
  propMaterial.userData.gtasfRoughness=0.58;
  const treeMaterials=foliage.map(map=>new MeshLambertMaterial({map,visible:map!==null,alphaTest:.5,side:DoubleSide,alphaToCoverage:hdPolish}));
  // The near-camera foliage fade dithers with a per-fragment `discard`, which defeats early-Z and is
  // costly on mobile/tiled GPUs. Skip it on the Low (phone) preset — plain alphaTest keeps early-Z,
  // trading a little near-camera card pop for frames on the phone-fps gate. Desktop/HD keeps the fade.
  // foliageCanopyHide (critic R1) replaces the HD dither (its 4x4 Bayer speckle over the player) on both tiers; see below.
  if(!options.low&&!flags.foliageCanopyHide)for(const material of treeMaterials)addFoliageCameraFade(material);
  // denseResidentialTrees raises the per-kind instance budget so more of the (capacity-limited) real + fill trees
  // render — mostly the distant canopy the near-first staging was dropping, which is what makes blocks read leafy.
  const denseCanopy=flags.denseResidentialTrees||flags.residentialYardTrees; // residentialYardTrees reuses the raised budget
  const capacity=(options.low?(denseCanopy?140:90):hdPolish?(denseCanopy?384:240):180),meshes=new Map<PropKind,InstancedMesh>();
  // One shared, bounded contact-shadow draw; no tree shadow-map rendering.
  const shadowSource=hdPolish?createBlobShadow(1,1):undefined;
  const treeShadows=shadowSource?new InstancedMesh(shadowSource.root.geometry,shadowSource.root.material,capacity):undefined;
  const shadowMatrices=treeShadows?new Float32Array(capacity*16):undefined;
  if(treeShadows){treeShadows.name='HD tree contact shadows';treeShadows.count=0;treeShadows.frustumCulled=false;treeShadows.renderOrder=1;treeShadows.material.opacity=.55;root.add(treeShadows);}
  for(const kind of types){
    const index=treeKinds.indexOf(kind),mesh=new InstancedMesh(geometry(kind,hdPolish),index<0?propMaterial:treeMaterials[index]!,capacity);
    if(index>=0&&flags.foliageCanopyHide){mesh.geometry.computeBoundingBox();addFoliageCanopyHide(treeMaterials[index]!,mesh.geometry.boundingBox!);}
    mesh.name=`SF ${kind} instances`;mesh.visible=index<0||foliage[index]!==null;mesh.count=0;mesh.castShadow=false;mesh.receiveShadow=false;mesh.frustumCulled=false;meshes.set(kind,mesh);root.add(mesh);
  }
  // gtasf-c8sj: on Low, every prop-material kind draws through one BatchedMesh (multi-draw, per-instance culling)
  // mirrored from the per-kind InstancedMeshes, which stay authoritative (refresh/knockover) on a hidden layer.
  const batched=options.low&&flags.lowBatchedProps?(()=>{
    const kinds=types.filter(kind=>treeKinds.indexOf(kind)<0);
    try{
      let vertices=0,indices=0;
      for(const kind of kinds){const g=meshes.get(kind)!.geometry;vertices+=g.getAttribute('position').count;indices+=g.index?.count??g.getAttribute('position').count;}
      const mesh=new BatchedMesh(kinds.length*capacity,vertices,indices,propMaterial);mesh.name='SF batched street props';mesh.frustumCulled=false;mesh.perObjectFrustumCulled=true;
      const slots=new Map<PropKind,{instances:number[];version:number;count:number}>();
      for(const kind of kinds){
        const geometryId=mesh.addGeometry(meshes.get(kind)!.geometry),instances:number[]=[];
        for(let i=0;i<capacity;i++){const id=mesh.addInstance(geometryId);mesh.setVisibleAt(id,false);instances.push(id);}
        slots.set(kind,{instances,version:-1,count:0});
      }
      for(const kind of kinds)meshes.get(kind)!.layers.set(31);
      root.add(mesh);
      const m=new Matrix4();
      return {mesh,sync(){
        for(const [kind,slot] of slots){
          const source=meshes.get(kind)!,count=source.visible?source.count:0;
          if(source.instanceMatrix.version===slot.version&&count===slot.count)continue;
          for(let i=0;i<capacity;i++){const id=slot.instances[i]!;
            if(i<count){source.getMatrixAt(i,m);mesh.setMatrixAt(id,m);mesh.setVisibleAt(id,true);}else if(i<slot.count)mesh.setVisibleAt(id,false);}
          slot.version=source.instanceMatrix.version;slot.count=count;
        }
      }};
    }catch(error){console.warn('Batched street props unavailable; using per-kind draws.',error);for(const kind of kinds)meshes.get(kind)!.layers.set(0);return undefined;}
  })():undefined;
  const wires=createWireRibbons(options.low?1400:2800,options.low);root.add(wires.mesh);
  const landmarkCollision=createLandmarkWireCollision(options.landmarks);
  const wireCollision=(x:number,y:number,z:number,radius:number,height:number)=>options.world.collides(x,y,z,radius,height)||landmarkCollision(x,y,z,radius,height);
  type CachedSpan={ay:number;by:number;cables:Point[][];clear:boolean[]};
  const wireCache=new Map<WireSpan,CachedSpan>(),cacheCapacity=512;
  let cachedCollisionRevision:number|undefined,cachedLandmarkRevision=-1;
  const signalLenses=createSignalLenses(capacity);root.add(signalLenses.root);
  const transform=new Matrix4(),rotation=new Quaternion(),up=new Vector3(0,1,0),scale=new Vector3(1,1,1),position=new Vector3();
  // One staging buffer per existing draw, reused when a refresh is cancelled.
  const staged=new Map(types.map(kind=>[kind,{matrices:new Float32Array(capacity*16),count:0,sites:[] as PlacedSite[]}]));
  // Knock-over overlay (flag-gated, dormant when off). Topples are applied on top of the staged base
  // matrices each frame; the base poses live in `placed`, rebuilt per spatial refresh.
  const knockEnabled=flags.propKnockover;
  const knockover=createKnockover();
  const waterSpray=knockEnabled?createWaterSpray(root):null; // hydrant spray on topple
  const placed=new Map<PropKind,PlacedSite[]>();
  const overlaidByKind=new Map<PropKind,Set<number>>();for(const k of KNOCKABLE)overlaidByKind.set(k,new Set<number>());
  const overlayMatrix=new Matrix4(),overlayQuat=new Quaternion(),yawQuat=new Quaternion(),overlayAxis=new Vector3();
  let lastNow=-Infinity;
  let nextUpdate=-Infinity,nextSignalUpdate=-Infinity,disposed=false,lastX=Infinity,lastZ=Infinity;
  let refresh:Generator<void,void>|undefined;
  const stats={sites:layout.siteCount,sourceCounts:layout.counts,visible:0,signals:0,stopSigns:0,routeVisible:0,cityVisible:0,
    wireSegments:0,wireBlockedSpans:0,muniSpans:0,crossStreetSpans:0,wireCacheHits:0,wireCacheMisses:0,wireCacheSize:0,updates:0,
    refreshPending:false,refreshSlices:0,lastRefreshSliceMs:0,maxRefreshSliceMs:0,signalLenses:signalLenses.stats};
  function matrix(x:number,y:number,z:number,yaw:number,width=1,height=1){position.set(x,y,z);rotation.setFromAxisAngle(up,yaw);scale.set(width,height,width);transform.compose(position,rotation,scale);scale.set(1,1,1);return transform;}
  /** Like matrix() with a separate local-z scale (treeFacadeAlign narrows the card that points into a wall). */
  function matrixScaled(x:number,y:number,z:number,yaw:number,width:number,height:number,depth:number){position.set(x,y,z);rotation.setFromAxisAngle(up,yaw);scale.set(width,height,depth);transform.compose(position,rotation,scale);scale.set(1,1,1);return transform;}
  function paintSignals(now:number,serverNow:number,force=false){
    if(!force&&now<nextSignalUpdate)return;
    nextSignalUpdate=now+100;signalLenses.update(serverNow,options.trafficEnabled??flags.traffic);
  }
  function* buildRefresh(focus:{x:number;z:number},canCache:boolean):Generator<void,void>{
    const result={signals:0,stopSigns:0,routeVisible:0,cityVisible:0,
      wireBlockedSpans:0,muniSpans:0,crossStreetSpans:0,wireCacheHits:0,wireCacheMisses:0};
    const signals:{site:PropSite;height:number}[]=[],accepted:Point[][]=[],lamps:LampFootprint[]=[],shops:(LampFootprint&{yaw:number})[]=[];
    let wireCount=0,shadowCount=0;
    const radius=options.low?230:380,cells=layout.nearby(focus.x,focus.z,radius),heights=new Map<number,number>();
    const candidates=cells.flatMap(c=>c.sites).filter(p=>(p.x-focus.x)**2+(p.z-focus.z)**2<radius*radius)
      .sort((a,b)=>(a.x-focus.x)**2+(a.z-focus.z)**2-((b.x-focus.x)**2+(b.z-focus.z)**2));
    for(const batch of staged.values())batch.count=0;
    yield;
    // ?debug=trees: why real street trees are (not) drawn (gtasf-umar).
    const treeDebug=TREE_DEBUG?(window as {__gtasfTrees?:Record<string,number>}).__gtasfTrees??={}:undefined;
    if(treeDebug)for(const k of Object.keys(treeDebug))treeDebug[k]=0;
    for(const p of candidates){
      // shopfrontGlow: light-only sites feed the night lamp map, never a mesh.
      if(p.kind==='shopGlow'){if(shops.length<120){const y=options.world.heightAt(p.x,p.z);if(y!==null)shops.push({x:p.x,y,z:p.z,yaw:p.yaw});}continue;}
      const batch=staged.get(p.kind);if(!batch||batch.count>=capacity){if(treeDebug&&p.real)treeDebug[batch?'capacity':'noBatch:'+p.kind]=(treeDebug[batch?'capacity':'noBatch:'+p.kind]??0)+1;continue;}
      const y=options.world.heightAt(p.x,p.z);
      if(treeDebug&&p.real){const k=y===null?'noGround':options.world.collides(p.x,y+.15,p.z,p.kind==='plane'?1:.4,3)?'collides':'ok';treeDebug[k]=(treeDebug[k]??0)+1;}
      // Garden tubs require a nearby house behind them, clear ground and no mapped road.
      if(p.kind==='yardPlanter'&&(y===null||options.world.roadHeightAt?.(p.x,p.z)!=null||!options.world.collides(p.x+Math.sin(p.yaw)*2.5,(y??0)+.2,p.z+Math.cos(p.yaw)*2.5,.4,2)))continue;
      if(y!==null&&Number.isFinite(y)&&(p.real||Math.abs(y-p.y)<=7)&&!options.world.collides(p.x,y+.15,p.z,p.kind==='bicycle'?1.05:(p.kind==='planter'||p.kind==='yardPlanter')?.65:p.kind==='plane'?1:.4,3)){
        const tree=treeKinds.includes(p.kind);
        // denseResidentialTrees: fuller, more mature canopies so street trees read as leafy canopy from the
        // street AND the aerial, not thin billboards -- more green per instance (perf-safe, no new instances),
        // the lever the earlier denser-but-SUBTLE fill lacked. Canopy only (tree kinds); wider than taller so
        // they overhang the street without turning into lollipops. Off keeps the DBH-accurate size.
        const canopyW=flags.denseResidentialTrees&&tree ? 1.32 : 1;
        const canopyH=flags.denseResidentialTrees&&tree ? 1.22 : 1;
        const width=(hdPolish&&tree ? .88+(p.id%9)*.03 : 1)*(p.scale??1)*canopyW;
        const height=(hdPolish&&tree ? .9+(p.id%7)*.035 : 1)*(p.scale??1)*canopyH;
        // treeFacadeAlign (critic nit on gtasf-tr62l): a street tree hugging a facade gets its crossed cards turned so one lies along
        // the wall and the card pointing INTO the wall narrowed, so leaves don't slice through the building. Open-sidewalk trees
        // keep their yaw and size.
        let yaw=p.yaw,depth=width;
        if(flags.treeFacadeAlign&&tree){
          let nx=0,nz=0,hits=0;
          for(let k=0;k<8;k++){const a=k*Math.PI/4,dx=Math.sin(a),dz=Math.cos(a);if(options.world.collides(p.x+dx*1.6,y+3.5,p.z+dz*1.6,.3,2)){nx-=dx;nz-=dz;hits++;}}
          const len=Math.hypot(nx,nz);
          if(hits&&len>.1){nx/=len;nz/=len;yaw=Math.atan2(nx,nz);depth=width*.45; // local z (card b, narrowed) along the wall normal; local x (card a) along the wall
          if(treeDebug)treeDebug.facadeAlign=(treeDebug.facadeAlign??0)+1;}
        }
        const slot=batch.count++;(depth===width?matrix(p.x,y+.04,p.z,yaw,width,height):matrixScaled(p.x,y+.04,p.z,yaw,width,height,depth)).toArray(batch.matrices,slot*16);heights.set(p.id,y+.04);
        if(treeShadows&&shadowMatrices&&tree&&foliage[treeKinds.indexOf(p.kind)]&&shadowCount<capacity){
          const distance=Math.hypot(p.x-focus.x,p.z-focus.z);
          if(distance<90){
            const canopy=treeAtlas.cells.find(cell=>cell.id===p.kind)?.widthMetres??9;
            const diameter=Math.min(4,canopy*.32)*width;
            const radius=diameter*.5;
            const level=TREE_WELL_CORNERS.every(([dx,dz])=>{
              const h=options.world.heightAt(p.x+dx*radius,p.z+dz*radius);
              return h!==null&&Math.abs(h-y)<.08;
            });
            if(level&&!options.world.collides(p.x,y+.2,p.z,radius,.2)){
              // Stay above cosmetic sidewalk slabs; shrink out over the last 25m.
              const size=diameter*Math.min(1,(90-distance)/25);
              matrix(p.x,y+.145,p.z,0,size,1).toArray(shadowMatrices,shadowCount++*16);
            }
          }
        }
        if(hdPolish&&tree&&p.kind!=='cypress'&&p.density==='route'){
          const well=staged.get('treeWell')!;
          // Keep surrounds off steep ground and out of nearby facade footprints.
          const c=Math.cos(p.yaw),s=Math.sin(p.yaw);
          const level=TREE_WELL_CORNERS.every(([dx,dz])=>{
            const x=p.x+c*dx+s*dz,z=p.z-s*dx+c*dz,h=options.world.heightAt(x,z);
            return h!==null&&Math.abs(h-y)<.12&&(options.world.roadHeightAt?.(x,z)??null)===null;
          });
          if(well.count<capacity&&level&&!options.world.collides(p.x,y+.1,p.z,1.45,.2))
            // Road-detail sidewalks rise .12m above their sampled terrain surface.
            matrix(p.x,y+.13,p.z,p.yaw).toArray(well.matrices,well.count++*16);
        }
        if(knockEnabled&&KNOCKABLE.has(p.kind))batch.sites[slot]={id:p.id,x:p.x,z:p.z,yaw:p.yaw,y:y+.04};
        if(p.kind==='streetLamp'&&lamps.length<160)lamps.push({x:p.x,y,z:p.z});
        if(p.kind==='light'){result.signals++;signals.push({site:p,height:y+.04});}
        if(p.kind==='trafficStop')result.stopSigns++;
        if(p.density==='route')result.routeVisible++;else result.cityVisible++;
      }
      yield;
    }
    for(const cell of cells)for(const span of cell.wires){
      const {a,b,muni,crossStreet}=span;
      const ay=heights.get(a.id),by=heights.get(b.id);if(ay===undefined||by===undefined)continue;
      const requiredSegments=crossStreet?8:muni?42:24,powerCount=crossStreet?1:3;
      if(wireCount+requiredSegments>wires.capacity)continue;
      let cached=wireCache.get(span);
      if(cached&&cached.ay===ay&&cached.by===by){result.wireCacheHits++;}
      else{
        result.wireCacheMisses++;
        const sag=Math.min(2,Math.max(.35,Math.hypot(a.x-b.x,a.z-b.z)*.014));
        const cables:Point[][]=[];
        for(const offset of crossStreet?[0]:[-.85,0,.85]){
          cables.push(saggedWire([a.x+Math.sin(a.yaw)*offset,ay+10,a.z+Math.cos(a.yaw)*offset],[b.x+Math.sin(b.yaw)*offset,by+10,b.z+Math.cos(b.yaw)*offset],sag));
        }
        if(muni){
          // Twin contact wires over the adjacent travel lane, with transverse supports.
          const ac:Point=[a.x-Math.sin(a.yaw)*5.5,ay+7.8,a.z-Math.cos(a.yaw)*5.5],bc:Point=[b.x-Math.sin(b.yaw)*5.5,by+7.8,b.z-Math.cos(b.yaw)*5.5];
          cables.push([[a.x,ay+9,a.z],ac],[[b.x,by+9,b.z],bc]);
          for(const offset of [-.32,.32])cables.push(saggedWire([ac[0]+Math.sin(a.yaw)*offset,ac[1],ac[2]+Math.cos(a.yaw)*offset],[bc[0]+Math.sin(b.yaw)*offset,bc[1],bc[2]+Math.cos(b.yaw)*offset],.12));
        }
        const clear:boolean[]=[];let contactClear=true;
        for(let i=0;i<cables.length;i++){
          clear[i]=(i<powerCount||contactClear)&&(yield* wireClearanceSteps(cables[i]!,wireCollision));
          if(i>=powerCount&&!clear[i])contactClear=false;
          yield;
        }
        cached={ay,by,cables,clear};
        if(canCache){
          if(!wireCache.has(span)&&wireCache.size>=cacheCapacity)wireCache.delete(wireCache.keys().next().value!);
          wireCache.set(span,cached);
        }
      }
      const {cables,clear}=cached;
      let blocked=false,drawnPower=false;
      // Each power cable is complete between its two supports. A building-side
      // cable must not erase an adjacent clear cable on the street side.
      for(let i=0;i<powerCount;i++){
        if(clear[i]){accepted.push(cables[i]!);wireCount+=cables[i]!.length-1;drawnPower=true;}else blocked=true;
      }
      // Contact wires and transverse supports are one connected Muni assembly.
      if(muni){
        let contactClear=true;for(let i=powerCount;i<cables.length;i++)if(!clear[i])contactClear=false;
        if(contactClear){for(let i=powerCount;i<cables.length;i++){accepted.push(cables[i]!);wireCount+=cables[i]!.length-1;}result.muniSpans++;}
        else blocked=true;
      }
      if(blocked)result.wireBlockedSpans++;
      if(crossStreet&&drawnPower)result.crossStreetSpans++;
      yield;
    }
    // Publish complete matrices, lenses and cables together. No partially
    // checked power cable or incomplete Muni assembly reaches a render frame.
    for(const [kind,mesh] of meshes){const batch=staged.get(kind)!;mesh.count=batch.count;
      // gtasf-c8sj: frustumCulled=false meshes still cost a program bind + draw at count 0.
      if(flags.emptyInstanceSkip)mesh.visible=batch.count>0&&(treeKinds.indexOf(kind)<0||foliage[treeKinds.indexOf(kind)]!==null);mesh.instanceMatrix.array.set(batch.matrices.subarray(0,batch.count*16));mesh.instanceMatrix.needsUpdate=true;
      if(knockEnabled&&KNOCKABLE.has(kind))placed.set(kind,batch.sites.slice(0,batch.count));}
    signalLenses.reset();for(const {site,height} of signals)signalLenses.add(site,height);
    if(treeShadows&&shadowMatrices){treeShadows.count=shadowCount;treeShadows.instanceMatrix.array.set(shadowMatrices.subarray(0,shadowCount*16));treeShadows.instanceMatrix.needsUpdate=true;}
    wires.reset();for(const cable of accepted)wires.add(cable);wires.flush();
    propLampFootprints.length=0;propLampFootprints.push(...lamps); // night lamp map pools (gtasf-06gj)
    propShopfrontFootprints.length=0;propShopfrontFootprints.push(...shops);(stats as {shopGlows?:number}).shopGlows=shops.length;
    Object.assign(stats,result);stats.visible=[...meshes.values()].reduce((n,m)=>n+m.count,0);stats.wireSegments=wires.count;stats.wireCacheSize=wireCache.size;
  }
  // Overlay topple transforms on the staged base matrices. Pivots at each prop's ground base so it
  // falls flat away from the car; props that have risen are restored to their base pose. Cheap: only
  // leaning instances (usually zero) touch the buffer, and needsUpdate fires only when one changed.
  function applyKnockover(dt:number,carBump:{x:number;z:number}|null|undefined){
    knockover.tick(dt);
    waterSpray?.update(dt);
    for(const kind of KNOCKABLE){
      const sites=placed.get(kind),mesh=meshes.get(kind);if(!sites||!mesh)continue;
      if(carBump)for(const s of sites){const newly=knockover.bump(s.id,s.x,s.z,carBump.x,carBump.z);if(newly&&kind==='hydrant')waterSpray?.burst(s.x,s.y+.9,s.z);}
      const prev=overlaidByKind.get(kind)!,next=new Set<number>(),arr=mesh.instanceMatrix.array as Float32Array;
      for(let i=0;i<sites.length;i++){
        const s=sites[i]!,lean=knockover.lean(s.id);if(!lean)continue;
        overlayAxis.set(Math.cos(lean.fallYaw),0,-Math.sin(lean.fallYaw));
        overlayQuat.setFromAxisAngle(overlayAxis,lean.amount*HALF_PI);yawQuat.setFromAxisAngle(up,s.yaw);overlayQuat.multiply(yawQuat);
        position.set(s.x,s.y,s.z);overlayMatrix.compose(position,overlayQuat,scale).toArray(arr,i*16);next.add(i);
      }
      let dirty=next.size>0;
      for(const i of prev)if(!next.has(i)&&i<sites.length){const s=sites[i]!;matrix(s.x,s.y,s.z,s.yaw).toArray(arr,i*16);dirty=true;}
      overlaidByKind.set(kind,next);
      if(dirty)mesh.instanceMatrix.needsUpdate=true;
    }
  }
  function update(focus:{x:number;z:number},now=performance.now(),serverNow=Date.now(),carBump?:{x:number;z:number}|null){
    if(disposed)return;
    kerbCars?.update(focus);
    if(knockEnabled){const dt=lastNow===-Infinity?0:(now-lastNow)/1000;lastNow=now;applyKnockover(dt,carBump);}
    const rawRevision=options.world.collisionRevision,collisionRevision=Number.isSafeInteger(rawRevision)?rawRevision:undefined;
    const landmarkRevision=landmarkCollision.revision(),canCache=collisionRevision!==undefined;
    const changed=collisionRevision!==cachedCollisionRevision||landmarkRevision!==cachedLandmarkRevision;
    const moved=Math.hypot(focus.x-lastX,focus.z-lastZ)>=45;
    if(changed){
      refresh?.return();refresh=undefined;wireCache.clear();stats.wireCacheSize=0;nextUpdate=-Infinity;
      // A newly streamed footprint may intersect any old span. Hide old wires
      // immediately, even before the next once-per-second spatial refresh.
      wires.reset();wires.flush();stats.wireSegments=0;stats.wireBlockedSpans=0;stats.muniSpans=0;stats.crossStreetSpans=0;
      cachedCollisionRevision=collisionRevision;cachedLandmarkRevision=landmarkRevision;
    }else if(moved&&refresh){refresh.return();refresh=undefined;}
    if(!refresh){
      if(now<nextUpdate&&!moved){paintSignals(now,serverNow);batched?.sync();return;}
      if(!canCache)wireCache.clear();
      lastX=focus.x;lastZ=focus.z;stats.updates++;stats.refreshSlices=0;
      refresh=buildRefresh({x:focus.x,z:focus.z},canCache);stats.refreshPending=true;
    }
    // gtasf-3k35 (sequencedMount): advance the collision-bound prop build only on a frame this stage owns,
    // so its slice never piles onto the road/billboard/radar builds during the mount. The generator stays
    // pending and resumes next owned frame; cheap signal/batched work still runs. No-op when the flag is off.
    if(!claimHeavyFrame('streetProps')){paintSignals(now,serverNow);batched?.sync();return;}
    const started=performance.now(),deadline=canCache?started+2:Infinity;
    let complete=false;
    do{
      if(refresh.next().done){refresh=undefined;stats.refreshPending=false;nextUpdate=now+1000;complete=true;break;}
    }while(performance.now()<deadline);
    stats.refreshSlices++;stats.lastRefreshSliceMs=performance.now()-started;
    stats.maxRefreshSliceMs=Math.max(stats.maxRefreshSliceMs,stats.lastRefreshSliceMs);
    paintSignals(now,serverNow,complete);
    batched?.sync();
  }
  return {root,update,stats,destroy(){if(disposed)return;disposed=true;kerbGone=true;kerbCars?.dispose();refresh?.return();refresh=undefined;stats.refreshPending=false;wireCache.clear();stats.wireCacheSize=0;root.removeFromParent();treeShadows?.dispose();shadowSource?.dispose();batched?.mesh.dispose();signalLenses.destroy();wires.destroy();waterSpray?.destroy();for(const mesh of meshes.values()){mesh.geometry.dispose();mesh.dispose();}for(const material of [propMaterial,...treeMaterials])material.dispose();for(const t of textures)t.dispose();for(const b of treeBitmaps)b.close();}};
}
