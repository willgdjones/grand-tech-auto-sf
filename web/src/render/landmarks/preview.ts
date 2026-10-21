import {
  Box3, Color, DirectionalLight, Fog, HemisphereLight, Mesh,
  PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer,
  type Group,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LANDMARKS, createLandmark, disposeLandmark, type LandmarkId } from './landmarks';
import { createLombardPreviewContext } from './neighbourhoods';
import { pier39LocalWorld } from './surfaces';
import { createDrivingState, updateDriving } from '../../vehicles/driving/controller';
import { loadVehicleTemplate, type VehicleInstance, type VehicleTemplate } from '../../vehicles/models/vehicle';
import './preview.css';

const canvas=document.querySelector<HTMLCanvasElement>('#world')!;
const renderer=new WebGLRenderer({canvas,antialias:false,alpha:false,powerPreference:'low-power'});
renderer.outputColorSpace=SRGBColorSpace;
const scene=new Scene();scene.background=new Color('#a8bfbb');
const fog=new Fog('#a8bfbb',600,3000);scene.fog=fog;
scene.add(new HemisphereLight('#edf3e6','#a09272',2));
const sun=new DirectionalLight('#ffefd2',2.2);sun.position.set(-160,220,160);scene.add(sun);
const camera=new PerspectiveCamera(45,1,0.1,10000);
const controls=new OrbitControls(camera,canvas);controls.enableDamping=false;controls.maxPolarAngle=Math.PI*0.8;
let dirty=true;controls.addEventListener('change',()=>{dirty=true;});
const select=document.querySelector<HTMLSelectElement>('#landmark')!;
for(const landmark of LANDMARKS) select.add(new Option(landmark.name,landmark.id));
let root:Group|undefined;
let context:Group|undefined;
let car:VehicleInstance|undefined,carTemplate:VehicleTemplate|undefined;
let driving=false;
const keys=new Set<string>();
const driveButton=document.querySelector<HTMLButtonElement>('#drive')!;
let driveState=createDrivingState({x:0,y:0,z:178,yaw:Math.PI});
let selected:LandmarkId='ferry-building';
const bounds=new Box3();

function frame(mode:'arrival'|'orbit'|'back') {
  if(!root) return;
  driving=false;controls.enabled=true;keys.clear();if(car)car.root.visible=false;
  delete canvas.dataset.driving;
  document.querySelector<HTMLElement>('#drive-touch')!.hidden=true;
  bounds.setFromObject(root);
  const size=bounds.getSize(new Vector3()),centre=bounds.getCenter(new Vector3());
  const radius=Math.max(size.x,size.y,size.z);
  fog.near=radius*3;fog.far=radius*12;
  controls.minDistance=2;controls.maxDistance=radius*5;
  camera.fov=mode==='arrival'?75:45;
  if(selected==='ferry-building') {
    if(mode==='arrival') { camera.position.set(0,4.5,53);controls.target.set(0,28,0); }
    else if(mode==='back') {camera.position.set(-145,86,-205);controls.target.set(0,20,-25);}
    else {camera.position.set(165,115,242);controls.target.set(0,20,-5);}
  } else if(selected==='golden-gate-bridge'||selected==='bay-bridge') {
    if(mode==='arrival') {
      const deck=selected==='golden-gate-bridge'?75:67;
      camera.position.set(0,deck+8,size.z/2+25);controls.target.set(0,deck+40,size.z/2-300);
    } else {
      const side=mode==='back'?-1:1;
      camera.position.set(radius*1.2*side,radius*0.24,radius*0.18*side);
      controls.target.set(0,centre.y,radius*0.18*side);
    }
  } else if(selected==='pier-39') {
    camera.position.set(mode==='arrival'?0:185,mode==='arrival'?8:120,mode==='back'?-250:255);controls.target.set(0,5,-10);
  } else {
    const distance=radius*1.5;
    camera.position.set(centre.x+(mode==='arrival'?0:distance*0.75),centre.y+distance*0.3,centre.z+(mode==='back'?-distance:distance));
    controls.target.copy(centre);
  }
  camera.near=Math.max(0.05,radius/10000);camera.far=radius*20;camera.updateProjectionMatrix();controls.update();
}
function show(id:LandmarkId) {
  if(root) disposeLandmark(root);
  if(context){disposeLandmark(context);context=undefined;}
  selected=id;select.value=id;root=createLandmark(id);scene.add(root);
  if(id==='lombard-flower-beds'){context=createLombardPreviewContext();scene.add(context);}
  driveButton.hidden=id!=='pier-39';
  document.querySelector<HTMLElement>('#drive-help')!.hidden=id!=='pier-39';
  root.visible=document.querySelector<HTMLInputElement>('#visible')!.checked;
  const def=LANDMARKS.find(x=>x.id===id)!;
  document.querySelector('#name')!.textContent=def.name;
  const estimate='heightEstimated' in def&&def.heightEstimated?'approx. ':'';
  document.querySelector('#meta')!.textContent=`${estimate}${def.heightM.toFixed(1)} m tall · ${def.lat.toFixed(5)}°, ${def.lon.toFixed(5)}°`;
  document.querySelector<HTMLAnchorElement>('#game-link')!.href=`/go/${id==='lombard-flower-beds'?'lombard':id==='transamerica-pyramid'?'transamerica':id}`;
  document.querySelector<HTMLAnchorElement>('#source')!.href=def.source;
  let triangles=0,meshes=0;
  root.traverse(o=>{if(o instanceof Mesh){meshes++;triangles+=(o.geometry.index?.count??o.geometry.getAttribute('position').count)/3;}});
  document.querySelector('#stats')!.textContent=`${triangles.toLocaleString()} triangles · ${meshes} mesh · 0 textures`;
  frame('orbit');canvas.dataset.ready='true';canvas.dataset.landmark=id;
}
select.addEventListener('change',()=>show(select.value as LandmarkId));
document.querySelector('#arrival')!.addEventListener('click',()=>frame('arrival'));
document.querySelector('#orbit')!.addEventListener('click',()=>frame('orbit'));
document.querySelector('#back')!.addEventListener('click',()=>frame('back'));
document.querySelector('#visible')!.addEventListener('change',()=>{if(root)root.visible=document.querySelector<HTMLInputElement>('#visible')!.checked;dirty=true;});
driveButton.addEventListener('click',async()=>{
  driveButton.disabled=true;
  try {
    carTemplate??=await loadVehicleTemplate('prius');
    if(!carTemplate)throw new Error('Enable the driving feature to use this preview.');
    if(!car){car=carTemplate.createInstance();scene.add(car.root);}
    if(selected!=='pier-39')return;
    driveState=createDrivingState({x:0,y:0,z:178,yaw:Math.PI});
    driving=true;controls.enabled=false;car.root.visible=true;keys.clear();
    (document.activeElement as HTMLElement|null)?.blur();canvas.tabIndex=0;canvas.focus();
    camera.fov=65;camera.near=0.1;camera.updateProjectionMatrix();
    document.querySelector<HTMLElement>('#drive-touch')!.hidden=false;
    canvas.dataset.driving='true';
  }catch(error){document.querySelector('#drive-help')!.textContent=String(error);}
  finally{driveButton.disabled=false;}
});
addEventListener('keydown',event=>{if(driving&&!['INPUT','SELECT'].includes((event.target as HTMLElement)?.tagName)){keys.add(event.code);if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.code))event.preventDefault();}});
addEventListener('keyup',event=>keys.delete(event.code));
addEventListener('blur',()=>keys.clear());
for(const button of document.querySelectorAll<HTMLButtonElement>('[data-key]')) {
  button.addEventListener('pointerdown',event=>{event.preventDefault();button.setPointerCapture(event.pointerId);keys.add(button.dataset.key!);});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(type,()=>keys.delete(button.dataset.key!));
}
function resize(){const w=innerWidth,h=innerHeight;renderer.setPixelRatio(Math.min(devicePixelRatio,1.5,Math.sqrt(1_000_000/(w*h))));renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();dirty=true;}
addEventListener('resize',resize);resize();
const query=new URLSearchParams(location.search).get('landmark');
show(LANDMARKS.some(x=>x.id===query)?query as LandmarkId:'ferry-building');
let previous=performance.now();
renderer.setAnimationLoop(now=>{
  if(driving&&now-previous<1000/30)return;
  const dt=Math.min(0.1,(now-previous)/1000);previous=now;
  if(driving&&car){
    const held=(...codes:string[])=>codes.some(c=>keys.has(c));
    updateDriving(driveState,{throttle:+held('KeyW','ArrowUp'),brake:+held('KeyS','ArrowDown'),steer:+held('KeyD','ArrowRight')-+held('KeyA','ArrowLeft'),handbrake:held('Space')},dt,pier39LocalWorld);
    car.root.position.set(driveState.x,driveState.y,driveState.z);car.root.rotation.y=driveState.yaw;
    car.update(dt,driveState.speed,driveState.steering);
    const s=Math.sin(driveState.yaw),c=Math.cos(driveState.yaw);
    camera.position.set(driveState.x-s*9,4.5,driveState.z-c*9);camera.lookAt(driveState.x+s*12,1.2,driveState.z+c*12);
    canvas.dataset.carX=driveState.x.toFixed(2);canvas.dataset.carZ=driveState.z.toFixed(2);
  }else controls.update();
  if(driving||dirty){renderer.render(scene,camera);dirty=false;}
});
addEventListener('pagehide',()=>{renderer.setAnimationLoop(null);controls.dispose();if(root)disposeLandmark(root);if(context)disposeLandmark(context);carTemplate?.dispose();renderer.dispose();},{once:true});
