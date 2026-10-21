import { Box3, Group, Matrix4, Object3D } from 'three';
import type { VehicleEntry, VehicleKind } from '@gtasf/shared/protocol/types';
import { loadRealisticExtraTemplate, loadVehicleTemplate, vehicleAssetForKind } from '../vehicles/models/vehicle';
import type { VehicleInstance, VehicleTemplate } from '../vehicles/models/vehicle';
import type { DrivingState } from '../vehicles/driving/controller';
import { alignVehicleToGround } from '../vehicles/driving/controller';
import type { MovementWorld } from '../movement/world';
import { createVehicleInterpolation, type VehicleRenderPose } from './vehicleInterpolation';
import { flags } from '@gtasf/shared/flags';
import { vehicleEntryMode, vehicleEntryRadius } from './vehicleEntry';
import { cableCarIds, sampleCableCar } from '@gtasf/shared/transit/cableCars';
import { isMuniBus, muniBusIds, sampleMuniBus, type MuniPose } from '@gtasf/shared/transit/muni';
import { POLICE_FLAG } from '@gtasf/shared/combat/police';
import { applySfpdLivery } from '../combat/sfpdLivery';
import { createPoliceAirTemplates, policeAirDemoEntries, policeAirKind, type PoliceAirInstance } from '../combat/policeAir';
import { trafficDemoEntries } from '../render/vehicleLamps';

export interface FleetCar { data: VehicleEntry; model: VehicleInstance; cameraBounds: Box3; cameraInverse: Matrix4; muni?: MuniPose;
  /** SFPD b&w livery disposer (POLICE_FLAG 'subaru' cruisers, flags.sfpdLook); frees the cloned body material. */
  livery?: (() => void) & { refresh(): void };
  /** SFPD helicopter / SWAT van art (flags.policeAirArt) for lane B's Combat 5b units. */
  air?: PoliceAirInstance;
  /** Parked-car fast path (gtasf-pooa): last server pose and how many frames it has stayed unchanged. */
  still?: { x: number; y: number; z: number; yaw: number; frames: number } }
/** Frames a car must sit motionless before it is refreshed only every STILL_REFRESH frames. */
const STILL_SETTLE = 30, STILL_REFRESH = 30;
// gtasf-dr19 (fleetMatrixSkipDeep): a no-op updateMatrixWorld genuinely skips a hidden/settled vehicle's
// whole-subtree matrix walk. three.js 0.186 recurses into every child unconditionally, so setting
// matrixWorldAutoUpdate=false only skips the root's own multiply — the ~40-48 children still walk. Restored
// to the prototype method when the vehicle is active again (position is refreshed via updateWorldMatrix).
const skipMatrixWorld = function (this: Object3D): void {};
const protoUpdateMatrixWorld = Object3D.prototype.updateMatrixWorld;
export async function createFleet(parent: Group | import('three').Scene) {
  const templates = new Map<VehicleKind, VehicleTemplate>();
  const kinds: VehicleKind[] = ['prius', 'tesla', 'subaru', 'robotaxi'];
  if (flags.cableCars) kinds.push('cable-car');
  if (flags.muni || (flags.rideAnyVehicle && !flags.zonedWorld)) kinds.push('bus');
  await Promise.all(kinds.map(async kind => {
    const template = await loadVehicleTemplate(vehicleAssetForKind[kind]);
    if (template) templates.set(kind, template);
  }));
  // realisticRender only: some server prius/tesla cars render as Meshy cab/van models (cosmetic, by id).
  const [cab, van] = flags.realisticRender && !flags.graphicsV2
    ? await Promise.all([loadRealisticExtraTemplate('cab'), loadRealisticExtraTemplate('van')]) : [];
  // policeAirArt: lane B's helicopter / SWAT stand-in kinds get the procedural SFPD art, built on first sight.
  let airTemplates: ReturnType<typeof createPoliceAirTemplates> | undefined;
  const airDemo = flags.policeAirArt && flags.testingHarness && typeof location !== 'undefined' && new URLSearchParams(location.search).has('policeairdemo');
  let lastViewer: { x: number; z: number; y: number } | undefined;
  // ?trafficdemo=<heading°> (lane D night-lamp capture aid, testingHarness only): parked-ahead lit cars.
  const trafficDemo = flags.testingHarness && typeof location !== 'undefined' ? new URLSearchParams(location.search).get('trafficdemo') : null;
  const templateFor = (data: VehicleEntry) => {
    const airKind = flags.policeAirArt ? policeAirKind(data) : undefined;
    if (airKind) return (airTemplates ??= createPoliceAirTemplates())[airKind];
    if (data.kind === 'prius' || data.kind === 'tesla') {
      if (cab && data.id % 6 === 0) return cab;
      if (van && data.id % 6 === 3) return van;
    }
    return templates.get(data.kind);
  };
  const cars = new Map<number, FleetCar>();
  const interpolation = createVehicleInterpolation();
  const rendered: VehicleRenderPose = { x: 0, y: 0, z: 0, yaw: 0, speedCmps: 0 };
  let cruiseMode = false, frame = 0;
  // Reused per-frame scratch transforms (gtasf-pooa): filled and consumed within one car's update.
  const groundScratch = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 };
  const settled = new Set<number>();
  function add(data: VehicleEntry, serverT: number) {
    const old = cars.get(data.id);
    if (old) { interpolation.push(data, serverT); old.data = data; return; }
    const model = templateFor(data)?.createInstance();
    if (!model) return;
    const air = 'air' in model ? model as PoliceAirInstance : undefined;
    if(flags.graphicsV2 && air?.air !== 'heli') model.root.userData.gtasfHeadlight = { active: false, front: data.kind === 'bus' || data.kind === 'cable-car' ? 5 : 2 };
    // SFPD black-and-white livery on POLICE_FLAG cruisers (kind 'subaru'), client-side. Clones the body material.
    const livery = flags.sfpdLook && (data.flags & POLICE_FLAG) && data.kind === 'subaru' ? applySfpdLivery(model.root) : undefined;
    interpolation.push(data, serverT);
    const cameraBounds = new Box3().setFromObject(model.root), cameraInverse = new Matrix4();
    model.root.position.set(data.x / 100, data.y / 100, data.z / 100);
    model.root.rotation.y = data.yaw / 256 * Math.PI * 2;
    parent.add(model.root); model.root.updateMatrixWorld(true); cameraInverse.copy(model.root.matrixWorld).invert();
    cars.set(data.id, { data, model, cameraBounds, cameraInverse, livery, air, muni: flags.muni ? sampleMuniBus(data.id, serverT) : undefined });
  }
  if (flags.cableCars) for (const id of cableCarIds) add(sampleCableCar(id, Date.now())!.entry, Date.now());
  if (flags.muni) for (const id of muniBusIds) add(sampleMuniBus(id, Date.now())!.entry, Date.now());
  return {
    cars,
    setCruiseMode(enabled: boolean) { cruiseMode = enabled; },
    /** A standalone, client-only model of a fleet kind (eventRideDrive's robotaxi); the caller adds and disposes it. */
    createLocal(kind: VehicleKind) { return templates.get(kind)?.createInstance(); },
    get cruiseMode() { return cruiseMode; },
    sync(entries: VehicleEntry[], serverT = performance.now()): void {
      if (airDemo && lastViewer) entries = entries.concat(policeAirDemoEntries(lastViewer, lastViewer.y));
      if (trafficDemo !== null && lastViewer) entries = entries.concat(trafficDemoEntries(lastViewer, lastViewer.y, Number(trafficDemo) || 0));
      const present = new Set(entries.map(entry => entry.id));
      for (const [id, car] of cars) if (car.data.kind !== 'cable-car' && !isMuniBus(id) && !present.has(id)) { car.livery?.(); car.model.dispose(); cars.delete(id); interpolation.remove(id); }
      for (const data of entries) add(data, serverT);
      for (const car of cars.values()) car.livery?.refresh(); // a lazily-added HD level (carNearDetail) gets the paint too
    },
    update(dt: number, drivingId: number, driving?: DrivingState, surface?: MovementWorld, serverNow = performance.now(), viewer?: { x: number; z: number; range: number }): void {
      frame++;
      // carNearDetail adds a cruiser's HD level asynchronously, so it can land between server syncs and stay stock-painted
      // until the next one (regression livery check, 10-17). Re-paint police cars ~2x/s too; paint() skips painted levels.
      if (frame % 30 === 0) for (const car of cars.values()) car.livery?.refresh();
      if ((airDemo || trafficDemo !== null) && viewer && surface) { const y = surface.heightAt(viewer.x, viewer.z); if (y !== null) lastViewer ??= { x: viewer.x, z: viewer.z, y }; }
      // gtasf-pooa: far vehicles keep their sampled data (radar) but skip model animation and drawing.
      // Squared range: no Math.hypot allocation per vehicle per frame (gtasf-pooa).
      const range2 = viewer ? viewer.range * viewer.range : 0;
      const far = (x: number, z: number) => viewer !== undefined && (x - viewer.x) ** 2 + (z - viewer.z) ** 2 > range2;
      settled.clear();
      // keys() + get(): Map entry iteration allocates a [key, value] array per vehicle per frame (gtasf-pooa).
      for (const id of cars.keys()) {
        const car = cars.get(id)!;
        const { data, model, cameraInverse } = car;
        model.root.visible = id === drivingId || !(cruiseMode && (data.flags & 0x20));
        if(flags.graphicsV2 && model.root.userData.gtasfHeadlight) model.root.userData.gtasfHeadlight.active = Math.abs(data.speedCmps)>10 || id===drivingId;
        if (!model.root.visible) continue;
        if (car.muni) {
          const bus = sampleMuniBus(id, serverNow, car.muni)!;
          car.data = bus.entry;
          if (id !== drivingId && far(bus.entry.x / 100, bus.entry.z / 100)) { model.root.visible = false; continue; }
          model.root.position.set(bus.entry.x / 100, bus.entry.y / 100, bus.entry.z / 100);
          model.root.rotation.set(bus.pitch, bus.yaw, 0, 'YXZ');
          model.update(dt, bus.entry.speedCmps / 100);
          model.root.updateWorldMatrix(true, false); cameraInverse.copy(model.root.matrixWorld).invert();
          continue;
        }
        const cable = data.kind === 'cable-car' ? sampleCableCar(id, serverNow) : undefined;
        if (cable) {
          car.data = cable.entry;
          if (id !== drivingId && far(cable.entry.x / 100, cable.entry.z / 100)) { model.root.visible = false; continue; }
          model.root.position.set(cable.entry.x / 100, cable.entry.y / 100, cable.entry.z / 100);
          model.root.rotation.set(cable.pitch, cable.entry.yaw / 256 * Math.PI * 2, 0, 'YXZ');
          model.update(dt, cable.entry.speedCmps / 100);
          model.root.updateWorldMatrix(true, false); cameraInverse.copy(model.root.matrixWorld).invert();
          continue;
        }
        if (id === drivingId && driving) {
          // visualY is the jitter-smoothed render height; driving.y stays the true physics height.
          model.root.position.set(driving.x, driving.visualY, driving.z);
          model.root.rotation.set(driving.pitch, driving.yaw, driving.roll, 'YXZ');
          model.update(dt, driving.speed, driving.steering);
        } else {
          const pose = interpolation.sample(id, serverNow, rendered) ? rendered : data;
          if (far(pose.x / 100, pose.z / 100)) { model.root.visible = false; continue; }
          if (car.air?.air === 'heli') {
            // Flies at the server's hover altitude: no ground snap, no parked-car settle (rotors always turn).
            model.root.position.set(pose.x / 100, pose.y / 100, pose.z / 100);
            model.root.rotation.set(0, pose.yaw / 256 * Math.PI * 2, 0);
            car.air.setGround(surface?.heightAt(model.root.position.x, model.root.position.z) ?? null);
            model.update(dt, pose.speedCmps / 100);
            model.root.updateWorldMatrix(true, false); cameraInverse.copy(model.root.matrixWorld).invert();
            continue;
          }
          // Parked cars (most of the fleet near spawn) keep one server pose: once their ground alignment has
          // settled, refresh them only every STILL_REFRESH frames, staggered by id. The periodic refresh still
          // picks up terrain that finishes loading under them; any pose change resumes per-frame updates.
          const still = car.still ??= { x: NaN, y: NaN, z: NaN, yaw: NaN, frames: 0 };
          if (pose.speedCmps === 0 && pose.x === still.x && pose.y === still.y && pose.z === still.z && pose.yaw === still.yaw) still.frames++;
          else { still.x = pose.x; still.y = pose.y; still.z = pose.z; still.yaw = pose.yaw; still.frames = 0; }
          if (still.frames > STILL_SETTLE && (frame + id) % STILL_REFRESH !== 0) { settled.add(id); continue; }
          model.root.position.set(pose.x / 100, pose.y / 100, pose.z / 100);
          model.root.rotation.y = pose.yaw / 256 * Math.PI * 2;
          if (surface) {
            // One reused scratch pose (alignVehicleToGround only mutates it), not a new object per car per frame.
            const pose = groundScratch;
            pose.x = model.root.position.x; pose.y = model.root.position.y; pose.z = model.root.position.z;
            pose.yaw = model.root.rotation.y; pose.pitch = model.root.rotation.x; pose.roll = model.root.rotation.z;
            if (alignVehicleToGround(pose, dt, surface)) {
              model.root.position.y = pose.y;
              model.root.rotation.set(pose.pitch, pose.yaw, pose.roll, 'YXZ');
            }
          }
          // Robotaxis drive like normal cars: the old Mad-Max weave/drift/hill-hop render flair (gtasf-7oun) was
          // removed at the founder's request ("that weird motion they don't need any more", 2026-10-14).
          model.update(dt, pose.speedCmps / 100);
        }
        // Collision needs only the root. The render pass updates wheels and riders
        // after animation; the chase target refreshes its own ancestor chain.
        model.root.updateWorldMatrix(true, false);
        cameraInverse.copy(model.root.matrixWorld).invert();
      }
      // gtasf-c8sj: hidden (far/cruise) vehicles skip the render pass's whole-subtree matrix walk;
      // updateMatrixWorld still visits them otherwise (22 cable cars + buses ~1,300 objects at Ferry).
      // Settled parked cars keep last frame's matrices too (their pose and wheels did not change).
      if (flags.hiddenFleetMatrixSkip) for (const [id, { model }] of cars) {
        const active = model.root.visible && !settled.has(id);
        model.root.matrixWorldAutoUpdate = active;
        // gtasf-dr19: with the deep skip, swap the hidden/settled root's updateMatrixWorld for a no-op so the
        // renderer's scene traversal skips the entire vehicle subtree (not just the root's own multiply).
        if (flags.fleetMatrixSkipDeep) model.root.updateMatrixWorld = active ? protoUpdateMatrixWorld : skipMatrixWorld;
      }
    },
    nearest(position: { x: number; y?: number; z: number }, maxDistance = 5.5): FleetCar | undefined {
      let closest: FleetCar | undefined, distance = maxDistance;
      for (const car of cars.values()) {
        if (!car.model.root.visible || !vehicleEntryMode(car.data, car.muni?.boarding ?? true)) continue;
        const at = car.model.root.position;
        const d = Math.hypot(at.x - position.x, at.y - (position.y ?? at.y), at.z - position.z);
        if (d <= vehicleEntryRadius(car.data) && d < distance) { distance = d; closest = car; }
      }
      return closest;
    },
    dispose(): void { for (const car of cars.values()) { car.livery?.(); car.model.dispose(); } for (const template of templates.values()) template.dispose(); cab?.dispose(); van?.dispose(); airTemplates?.dispose(); cars.clear(); interpolation.clear(); },
  };
}
