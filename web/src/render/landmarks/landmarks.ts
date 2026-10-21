import { Group } from 'three';
import { flags } from '@gtasf/shared/flags';
import { SF_FRAME } from '../../../../tools/map/src/config';
import { geodeticToWorld, worldToGeodetic } from '../../../../tools/map/src/geo';
import {
  createCoitTower, createFerryBuilding, createSalesforceTower,
  createSutroTower, createTransamericaPyramid,
} from './towers';
import type { BuilderOptions } from './primitives';
import { createBayBridge, createGoldenGateBridge } from './bridges';
import { createLombardFlowerBeds, createPaintedLadies, LOMBARD_ORIGIN } from './neighbourhoods';
import { createPier39 } from './pier39';
import { createDragonGate } from './dragonGate';
import { createCastroCrossing } from './castroCrossing';
import { createHarveyMilkFlag } from './harveyMilkFlag';
import { createCastroTheatre } from './castroTheatre';
import { createFishermansWharfSign } from './fishermansWharf';
import { createGhirardelliSign } from './ghirardelliSign';
import { createPeacePagoda } from './peacePagoda';
import { createCablecarTurntable } from './cablecarTurntable';
import { createHaightSign } from './haightSign';
import { createCityLightsSign } from './cityLightsSign';
import { createMissionMural } from './missionMural';
import { createVesuvioSign } from './vesuvioSign';
import { createEmbarcaderoStreetcar } from './streetcar';
import { createVaillancourtFountain } from './vaillancourtFountain';
import { createSfGeneralArrival, SF_GENERAL_ARRIVAL } from './sfGeneral';
import { BROADWAY_NEON, createBroadwayNeon } from './broadwayNeon';
import { MARKET_NEON, createMarketNeon } from './marketNeon';
import { createHospitalEntrance, HOSPITAL_ENTRANCES } from './hospitalEntrances';
import { createVcOfficeSign } from './vcOfficeSigns';
import { PITCH_VCS } from '@gtasf/shared/content/pitchVcs';

export interface LandmarkDefinition {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Structural height above its base, not sea-level elevation. */
  heightM: number;
  /** Used only until the map's real terrain sample is available. */
  fallbackBaseM: number;
  base: 'terrain' | 'sea';
  rotationYDeg: number;
  source: string;
  heightSource: string;
  heightEstimated?: boolean;
}

export const LANDMARKS = [
  // DataSF 201006.0000058 facade endpoints set the hall axis; the authored
  // 29 m hall centre sits 14.5 m behind that face (see README placement evidence).
  {id:'ferry-building',name:'Ferry Building',lat:37.79549794793267,lon:-122.39350856239018,heightM:74.676,fallbackBaseM:3.2,base:'terrain',rotationYDeg:-53.75631044148488,
    source:'https://en.wikipedia.org/wiki/San_Francisco_Ferry_Building',heightSource:'https://wilsonmeany.com/project/ferry-building/'},
  {id:'transamerica-pyramid',name:'Transamerica Pyramid',lat:37.7952,lon:-122.4028,heightM:260,fallbackBaseM:8,base:'terrain',rotationYDeg:-9,
    source:'https://en.wikipedia.org/wiki/Transamerica_Pyramid',heightSource:'https://www.skyscrapercenter.com/building/transamerica-pyramid-center/772'},
  {id:'salesforce-tower',name:'Salesforce Tower',lat:37.7899,lon:-122.3969,heightM:326.136,fallbackBaseM:6,base:'terrain',rotationYDeg:-45,
    source:'https://en.wikipedia.org/wiki/Salesforce_Tower',heightSource:'https://www.salesforce.com/in/news/?p=7029'},
  {id:'coit-tower',name:'Coit Tower',lat:37.8025,lon:-122.40583,heightM:64.616,fallbackBaseM:87,base:'terrain',rotationYDeg:0,
    source:'https://en.wikipedia.org/wiki/Coit_Tower',heightSource:'https://sfrecpark.org/DocumentCenter/View/7387/CoitTowerBrochure_V5'},
  {id:'sutro-tower',name:'Sutro Tower',lat:37.75523,lon:-122.45284,heightM:297.79,fallbackBaseM:254.2,base:'terrain',rotationYDeg:0,
    source:'https://en.wikipedia.org/wiki/Sutro_Tower',heightSource:'https://explore.sutrotower.com/tour/design/elevation-and-height'},
  {id:'golden-gate-bridge',name:'Golden Gate Bridge',lat:37.81972,lon:-122.47861,heightM:227.4,fallbackBaseM:0,base:'sea',rotationYDeg:10,
    source:'https://en.wikipedia.org/wiki/Golden_Gate_Bridge',heightSource:'https://www.goldengate.org/bridge/history-research/statistics-data/design-construction-stats/'},
  {id:'bay-bridge',name:'Bay Bridge',lat:37.7982,lon:-122.3779,heightM:160.3,fallbackBaseM:0,base:'sea',rotationYDeg:-64,
    source:'https://commons.wikimedia.org/wiki/Category:Western_span_of_the_San_Francisco%E2%80%93Oakland_Bay_Bridge',heightSource:'https://legacy.seaonc.org/structure/bay-bridge/'},
  {id:'painted-ladies',name:'Painted Ladies',lat:37.77625,lon:-122.432805,heightM:15.3,heightEstimated:true,fallbackBaseM:70,base:'terrain',rotationYDeg:-90,
    source:'https://www.fotospot.com/attractions/california/painted-ladies',heightSource:'https://www.photoprintingpros.com/products/row-houses-in-a-city-postcard-row-the-seven-sisters-painted-ladies-alamo-square-san-francisco-california-usa-pan347023'},
  {id:'lombard-flower-beds',name:'Lombard flower beds',...LOMBARD_ORIGIN,heightM:1.2,heightEstimated:true,fallbackBaseM:35,base:'terrain',rotationYDeg:0,
    source:'https://www.openstreetmap.org/way/402111597',heightSource:'https://www.sfgate.com/bayarea/article/worlds-crookedest-Lombard-Street-san-francisco-9125265.php'},
  {id:'pier-39',name:'Pier 39',lat:37.8100,lon:-122.4104,heightM:14.5,heightEstimated:true,fallbackBaseM:3.2,base:'sea',rotationYDeg:12,
    source:'https://www.wikidata.org/wiki/Q1856083',heightSource:'https://www.pier39.com/wp-content/uploads/2025/02/P39-2402-PIER-Map-for-Website-MR1.pdf'},
  {id:'dragon-gate',name:'Chinatown Dragon Gate',lat:37.790757,lon:-122.405654,heightM:12.6,heightEstimated:true,fallbackBaseM:30,base:'terrain',rotationYDeg:13.4,
    source:'https://en.wikipedia.org/wiki/Dragon_Gate_(San_Francisco)',heightSource:'https://en.wikipedia.org/wiki/Dragon_Gate_(San_Francisco)'},
  {id:'castro-crossing',name:'Castro rainbow crosswalk',lat:37.7609051,lon:-122.435015,heightM:0.5,heightEstimated:true,fallbackBaseM:78,base:'terrain',rotationYDeg:21.6,
    source:'https://en.wikipedia.org/wiki/Castro_Street',heightSource:'https://en.wikipedia.org/wiki/Castro_Street'},
  {id:'harvey-milk-flag',name:'Harvey Milk Plaza rainbow flag',lat:37.76277,lon:-122.43490,heightM:20,heightEstimated:true,fallbackBaseM:75,base:'terrain',rotationYDeg:35,
    source:'https://en.wikipedia.org/wiki/Harvey_Milk_Plaza',heightSource:'https://en.wikipedia.org/wiki/Rainbow_flag_(LGBT)'},
  {id:'castro-theatre',name:'Castro Theatre',lat:37.762020,lon:-122.435130,heightM:29,heightEstimated:true,fallbackBaseM:78,base:'terrain',rotationYDeg:102,
    source:'https://en.wikipedia.org/wiki/Castro_Theatre',heightSource:'https://en.wikipedia.org/wiki/Castro_Theatre'},
  {id:'fishermans-wharf-sign',name:'Fisherman\'s Wharf sign',lat:37.808490,lon:-122.415700,heightM:13,heightEstimated:true,fallbackBaseM:5,base:'terrain',rotationYDeg:0,
    source:'https://en.wikipedia.org/wiki/Fisherman%27s_Wharf,_San_Francisco',heightSource:'https://en.wikipedia.org/wiki/Fisherman%27s_Wharf,_San_Francisco'},
  {id:'ghirardelli-sign',name:'Ghirardelli sign',lat:37.805760,lon:-122.422950,heightM:21,heightEstimated:true,fallbackBaseM:6,base:'terrain',rotationYDeg:180,
    source:'https://en.wikipedia.org/wiki/Ghirardelli_Square',heightSource:'https://en.wikipedia.org/wiki/Ghirardelli_Square'},
  {id:'peace-pagoda',name:'Japantown Peace Pagoda',lat:37.785060,lon:-122.429730,heightM:22,heightEstimated:true,fallbackBaseM:22,base:'terrain',rotationYDeg:0,
    source:'https://en.wikipedia.org/wiki/Japantown,_San_Francisco',heightSource:'https://en.wikipedia.org/wiki/Japantown,_San_Francisco'},
  {id:'cablecar-turntable',name:'Hyde & Beach cable-car turntable',lat:37.806800,lon:-122.420680,heightM:4,heightEstimated:true,fallbackBaseM:6,base:'terrain',rotationYDeg:90,
    source:'https://en.wikipedia.org/wiki/San_Francisco_cable_car_system',heightSource:'https://en.wikipedia.org/wiki/San_Francisco_cable_car_system'},
  {id:'haight-ashbury-sign',name:'Haight & Ashbury street signs',lat:37.769980,lon:-122.446440,heightM:7,heightEstimated:true,fallbackBaseM:78,base:'terrain',rotationYDeg:225,
    source:'https://en.wikipedia.org/wiki/Haight-Ashbury',heightSource:'https://en.wikipedia.org/wiki/Haight-Ashbury'},
  {id:'city-lights-sign',name:'City Lights sign',lat:37.797650,lon:-122.406520,heightM:15,heightEstimated:true,fallbackBaseM:8,base:'terrain',rotationYDeg:120,
    source:'https://en.wikipedia.org/wiki/City_Lights_Bookstore',heightSource:'https://en.wikipedia.org/wiki/City_Lights_Bookstore'},
  {id:'mission-mural',name:'Clarion Alley mural',lat:37.764080,lon:-122.420700,heightM:11,heightEstimated:true,fallbackBaseM:12,base:'terrain',rotationYDeg:0,
    source:'https://en.wikipedia.org/wiki/Clarion_Alley_Mural_Project',heightSource:'https://en.wikipedia.org/wiki/Clarion_Alley_Mural_Project'},
  {id:'vesuvio-sign',name:'Vesuvio sign',lat:37.797520,lon:-122.406630,heightM:13,heightEstimated:true,fallbackBaseM:8,base:'terrain',rotationYDeg:120,
    source:'https://en.wikipedia.org/wiki/Vesuvio_Cafe',heightSource:'https://en.wikipedia.org/wiki/Vesuvio_Cafe'},
  {id:'embarcadero-streetcar',name:'F-line streetcar',lat:37.795164,lon:-122.394373,heightM:3.4,heightEstimated:true,fallbackBaseM:3.2,base:'terrain',rotationYDeg:-53.75631044148488,
    source:'https://en.wikipedia.org/wiki/F_Market_%26_Wharves',heightSource:'https://www.streetcar.org/streetcars/'},
  {id:'vaillancourt-fountain',name:'Vaillancourt Fountain',lat:37.795220,lon:-122.393980,heightM:11,heightEstimated:true,fallbackBaseM:3.2,base:'terrain',rotationYDeg:-54,
    source:'https://en.wikipedia.org/wiki/Vaillancourt_Fountain',heightSource:'https://en.wikipedia.org/wiki/Vaillancourt_Fountain'},
] as const satisfies readonly LandmarkDefinition[];
export type LandmarkId = typeof LANDMARKS[number]['id'];
const BUILDERS: Record<LandmarkId, (options?: BuilderOptions)=>Group> = {
  'ferry-building':createFerryBuilding,'transamerica-pyramid':createTransamericaPyramid,
  'salesforce-tower':createSalesforceTower,'coit-tower':createCoitTower,'sutro-tower':createSutroTower,
  'golden-gate-bridge':createGoldenGateBridge,'bay-bridge':createBayBridge,
  'painted-ladies':createPaintedLadies,'lombard-flower-beds':createLombardFlowerBeds,'pier-39':createPier39,
  'dragon-gate':createDragonGate,'castro-crossing':createCastroCrossing,
  'harvey-milk-flag':createHarveyMilkFlag,'castro-theatre':createCastroTheatre,
  'fishermans-wharf-sign':createFishermansWharfSign,'ghirardelli-sign':createGhirardelliSign,
  'peace-pagoda':createPeacePagoda,'cablecar-turntable':createCablecarTurntable,
  'haight-ashbury-sign':createHaightSign,'city-lights-sign':createCityLightsSign,
  'mission-mural':createMissionMural,'vesuvio-sign':createVesuvioSign,
  'embarcadero-streetcar':createEmbarcaderoStreetcar,
  'vaillancourt-fountain':createVaillancourtFountain,
};

export function createLandmark(id: LandmarkId, options: BuilderOptions = {}): Group {
  const result=BUILDERS[id](options);
  result.userData.landmarkId=id;
  return result;
}

/** deferFarLandmarks (gtasf-g8ty9): built after READY on the default Ferry arrival instead of before it. Street-level
 *  landmarks > 1 km from the Ferry spawn, out of view from it, with no boot-time consumer (cityLife / parked cars use the
 *  Ferry + Pier 39, the night lights the Salesforce crown + Bay Bridge, the outbid crown Salesforce, so those stay; so do the
 *  skyline pieces seen from the plaza). ~a third of the pre-READY landmark build (node timings, 10-19). */
export const DEFERRABLE_LANDMARK_IDS: readonly string[] = ['painted-ladies', 'cablecar-turntable', 'fishermans-wharf-sign',
  'peace-pagoda', 'dragon-gate', 'harvey-milk-flag', 'city-lights-sign', 'castro-crossing', 'haight-ashbury-sign', 'castro-theatre',
  'mission-mural', 'ghirardelli-sign', 'vesuvio-sign'];

export type LandmarkHeightAt = (x:number,z:number)=>number|null;
export interface PlacementOptions extends BuilderOptions {
  heightAt?: LandmarkHeightAt;
  enabled?: boolean;
  ids?: readonly (LandmarkId | 'market-neon')[]; // 'market-neon': marketNeonLazy's post-READY mount (not a LANDMARKS entry)
}

export function landmarkPosition(definition: LandmarkDefinition, heightAt?: LandmarkHeightAt) {
  const [x,z]=geodeticToWorld(definition.lat,definition.lon,SF_FRAME);
  // The building-centre DEM is lower than the plaza by ~1.2 m. Align the authored
  // paving to the actual arrival ground, so it neither buries nor raises the player.
  const a=definition.rotationYDeg*Math.PI/180;
  const plaza=definition.id==='ferry-building'?heightAt?.(x+Math.sin(a)*53,z+Math.cos(a)*53):undefined;
  const sample=typeof plaza==='number'&&Number.isFinite(plaza)?plaza-0.18:
    definition.base==='terrain'?heightAt?.(x,z):undefined;
  const y=typeof sample==='number'&&Number.isFinite(sample)?sample:definition.fallbackBaseM;
  return {x,y,z};
}

/** City entry point: the existing feature flag is honoured unless explicitly supplied by a preview. */
export function createPlacedLandmarks(options: PlacementOptions={}): Group {
  const build=placeLandmarks(options);
  for(let step=build.next();;step=build.next()) if(step.done) return step.value;
}
/** createPlacedLandmarks in slices (gtasf-ep30n): yields to the event loop whenever ~budgetMs of building has piled
 *  up, so the cold-load landmark build (~2.5 s on a 4x phone, one long task) no longer freezes the loading card, holds
 *  fetches issued just before it, or blocks the road-graph decode that arrived meanwhile. Same Group, same order.
 *  Yields via MessageChannel, not setTimeout: a hidden tab clamps timers to ~1 s, which would stretch a boot. */
export async function createPlacedLandmarksSliced(options: PlacementOptions={}, budgetMs=12): Promise<Group> {
  const build=placeLandmarks(options), channel=new MessageChannel(), waiting:(()=>void)[]=[];
  channel.port1.onmessage=()=>waiting.shift()?.();
  const yieldTask=()=>new Promise<void>(resolve=>{ waiting.push(resolve); channel.port2.postMessage(0); });
  try {
    let started=performance.now();
    for(let step=build.next();;step=build.next()) {
      if(step.done) return step.value;
      if(performance.now()-started>=budgetMs){ await yieldTask(); started=performance.now(); }
    }
  } finally { channel.port1.close(); }
}
function* placeLandmarks({heightAt,enabled=flags.landmarks,ids,detail='near'}: PlacementOptions): Generator<void, Group> {
  const city=new Group();city.name='SF landmarks';
  if(!enabled) return city;
  for(const def of LANDMARKS) {
    if(ids&&!ids.includes(def.id)) continue;
    if(def.id==='dragon-gate'&&!flags.chinatownDragonGate) continue;
    if(def.id==='castro-crossing'&&!flags.castroRainbowCrosswalk) continue;
    if(def.id==='harvey-milk-flag'&&!flags.harveyMilkFlag) continue;
    if(def.id==='castro-theatre'&&!flags.castroTheatre) continue;
    if(def.id==='fishermans-wharf-sign'&&!flags.fishermansWharfSign) continue;
    if(def.id==='ghirardelli-sign'&&!flags.ghirardelliSign) continue;
    if(def.id==='peace-pagoda'&&!flags.peacePagoda) continue;
    if(def.id==='cablecar-turntable'&&!flags.cablecarTurntable) continue;
    if(def.id==='haight-ashbury-sign'&&!flags.haightAshburySign) continue;
    if(def.id==='city-lights-sign'&&!flags.cityLightsSign) continue;
    if(def.id==='mission-mural'&&!flags.missionMural) continue;
    if(def.id==='vesuvio-sign'&&!flags.vesuvioSign) continue;
    if(def.id==='embarcadero-streetcar'&&!flags.embarcaderoStreetcar) continue;
    if(def.id==='vaillancourt-fountain'&&!flags.vaillancourtFountain) continue;
    const position=landmarkPosition(def,heightAt);
    const landmark=def.id==='lombard-flower-beds'&&heightAt?createLombardFlowerBeds({detail,heightAt:(x,z)=>{
      const y=heightAt(x+position.x,z+position.z);return y===null?null:y-position.y;
    }}):createLandmark(def.id,{detail});
    landmark.position.set(position.x,position.y,position.z);
    landmark.rotation.y=def.rotationYDeg*Math.PI/180;
    landmark.userData.definition=def;
    landmark.userData.landmarkId=def.id;
    city.add(landmark);
    yield;
  }
  // sfGeneralArrival: set dressing at the WASTED/BUSTED respawn (sfGeneral.ts). Not a LANDMARKS entry, so no radar
  // blip; terrain + per-cluster ground via its userData.definition / resampleTerrain in updateLandmarkTerrain.
  // Mounted with the main city call (main.ts passes every non-Lombard id), not the separate flower-bed call.
  if(flags.sfGeneralArrival&&(!ids||ids.includes('ferry-building'))) {
    const position=landmarkPosition(SF_GENERAL_ARRIVAL,heightAt), arrival=createSfGeneralArrival({detail});
    arrival.position.set(position.x,position.y,position.z);
    arrival.rotation.y=SF_GENERAL_ARRIVAL.rotationYDeg*Math.PI/180;
    arrival.userData.definition=SF_GENERAL_ARRIVAL; arrival.userData.landmarkId=SF_GENERAL_ARRIVAL.id;
    city.add(arrival);
    yield;
  }
  // broadwayNeon (critique #15): neon blade + fascia signs on the Broadway strip (broadwayNeon.ts). Same mount pattern as
  // sfGeneralArrival: not a LANDMARKS entry (no radar blip), terrain via userData.definition in updateLandmarkTerrain.
  if(flags.broadwayNeon&&(!ids||ids.includes('ferry-building'))) {
    const position=landmarkPosition(BROADWAY_NEON,heightAt), neon=createBroadwayNeon({detail});
    neon.position.set(position.x,position.y,position.z);
    neon.rotation.y=BROADWAY_NEON.rotationYDeg*Math.PI/180;
    neon.userData.definition=BROADWAY_NEON; neon.userData.landmarkId=BROADWAY_NEON.id;
    city.add(neon);
    yield;
  }
  // marketNeon (critique #15, lane D): the mid-Market theatre-row strip (marketNeon.ts), same mount as broadwayNeon.
  // marketNeonLazy: the strip leaves the boot (pre-READY) build; main.ts mounts it by id once the player nears Market.
  if(flags.marketNeon&&(!ids||ids.includes(flags.marketNeonLazy?'market-neon':'ferry-building'))) {
    const position=landmarkPosition(MARKET_NEON,heightAt), neon=createMarketNeon({detail});
    neon.position.set(position.x,position.y,position.z);
    neon.rotation.y=MARKET_NEON.rotationYDeg*Math.PI/180;
    neon.userData.definition=MARKET_NEON; neon.userData.landmarkId=MARKET_NEON.id;
    city.add(neon);
    yield;
  }
  // hospitalEntrances (critic N20 follow-up): sign, EMERGENCY pylon and entrance canopy at the three respawn hospitals
  // without authored dressing (hospitalEntrances.ts). Same mount pattern as sfGeneralArrival: no radar blip, terrain via
  // userData.definition, per-cluster ground via resampleTerrain.
  if(flags.hospitalEntrances&&(!ids||ids.includes('ferry-building'))) for(const entrance of HOSPITAL_ENTRANCES) {
    const position=landmarkPosition(entrance.def,heightAt), group=createHospitalEntrance(entrance,{detail});
    group.position.set(position.x,position.y,position.z);
    group.userData.definition=entrance.def; group.userData.landmarkId=entrance.def.id;
    city.add(group);
    yield;
  }
  // VC office monument signs at each pitch-destination firm (shared/content/pitchVcs.ts), so the robotaxi arrival
  // reads as a real firm's office instead of an unmarked building. Placed here to reuse the landmark mount + terrain
  // sampling; terrain y is resampled in updateLandmarkTerrain as the office's chunk streams in. Flag-off: not added.
  if(flags.vcOfficeSigns) for(const vc of PITCH_VCS) {
    const [x,z]=geodeticToWorld(vc.lat,vc.lon,SF_FRAME);
    const y=heightAt?.(x,z);
    const sign=createVcOfficeSign(vc.name,vc.id);
    sign.position.set(x,typeof y==='number'&&Number.isFinite(y)?y:3.2,z);
    sign.userData.vcOfficeSign=vc.id;
    sign.userData.vcX=x; sign.userData.vcZ=z;   // building point, for the kerb offset in updateLandmarkTerrain
    city.add(sign);
    yield;
  }
  if(heightAt)updateLandmarkTerrain(city,heightAt);
  return city;
}

type NearestRoad=(x:number,z:number,max?:number)=>{x:number;y:number;z:number;yaw:number}|null;
/** Resample terrain contacts after chunk loads; sea-level landmarks retain their fixed deck height.
 *  nearestRoad (once the road graph is lazy-loaded) moves each VC office sign from its building point out to the
 *  kerb and rotates it to face the street, so the robotaxi arrival sees it instead of a sign buried in the facade. */
export function updateLandmarkTerrain(city:Group,heightAt:LandmarkHeightAt,nearestRoad?:NearestRoad):void {
  for(const landmark of city.children){
    if(landmark.userData.vcOfficeSign){
      if(nearestRoad&&!landmark.userData.vcKerbPlaced){
        const vx=landmark.userData.vcX as number,vz=landmark.userData.vcZ as number;
        const road=nearestRoad(vx,vz,70);
        if(road){
          const dx=road.x-vx,dz=road.z-vz,d=Math.hypot(dx,dz);
          if(d>1){
            const ux=dx/d,uz=dz/d;
            landmark.position.x=road.x-ux*2.8;landmark.position.z=road.z-uz*2.8;
            landmark.rotation.y=Math.atan2(ux,uz);   // front face (+Z) toward the road / arriving robotaxi
            // Except First Round (the Seed step): the ladder robotaxi drops the player ON the street facing downhill,
            // not from the lane, so the road-facing sign showed only its narrow edge and "arrived at First Round"
            // never read. Turn its lettered face to the prod-verified Seed drop pose (gtasf phase-4; both broad faces
            // are lettered, so either reads). Coupled to that drop point; update if the Seed swoop drop moves.
            if(landmark.userData.vcOfficeSign==='first-round')
              landmark.rotation.y=Math.atan2(647.02-landmark.position.x,-1717.22-landmark.position.z);
            landmark.userData.vcKerbPlaced=true;
          }
        }
      }
      const y=heightAt(landmark.position.x,landmark.position.z);
      if(y!==null)landmark.position.y=y;
      continue;
    }
    const definition=landmark.userData.definition as LandmarkDefinition|undefined;
    if(!definition)continue;
    if(definition.base==='terrain'){
      const position=landmarkPosition(definition,heightAt);
      if(heightAt(position.x,position.z)!==null)landmark.position.y=position.y;
    }
    const position=landmark.position;
    const resample=landmark.userData.resampleTerrain as ((sample:LandmarkHeightAt)=>void)|undefined;
    if(resample){
      const c=Math.cos(landmark.rotation.y),s=Math.sin(landmark.rotation.y);
      resample((x,z)=>{const y=heightAt(position.x+c*x+s*z,position.z-s*x+c*z);return y===null?null:y-landmark.position.y;});
    }
  }
}

/** Open plaza on the SW facade, facing the clock tower. Heading is compass degrees, north=0. */
export function ferrySpawn(heightAt?: LandmarkHeightAt) {
  const definition=LANDMARKS[0], centre=landmarkPosition(definition,heightAt),a=definition.rotationYDeg*Math.PI/180;
  const x=centre.x+Math.sin(a)*53,z=centre.z+Math.cos(a)*53;
  const geo=worldToGeodetic(x,z,SF_FRAME);
  return {x,y:centre.y+0.18,z,lat:geo.lat,lon:geo.lon,heading:(-definition.rotationYDeg+360)%360,lookAt:{x:centre.x,y:centre.y+34,z:centre.z}};
}
export const FERRY_SPAWN=ferrySpawn();

export { createCoitTower, createFerryBuilding, createSalesforceTower, createSutroTower, createTransamericaPyramid };
export { createBayBridge, createGoldenGateBridge, createLombardFlowerBeds, createPaintedLadies, createPier39 };
export { withLandmarkSurfaces } from './surfaces';
export { disposeLandmark } from './primitives';
