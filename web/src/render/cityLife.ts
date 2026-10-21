import { Box3, Group, Mesh, Texture, Vector3, type Material } from 'three';
import { flags } from '@gtasf/shared/flags';
import { SF_HAZARDS, NPC_CHATTER } from '@gtasf/shared/content/flavour';
import { SF_FRAME } from '../../../tools/map/src/config';
import { worldToGeodetic } from '../../../tools/map/src/geo';
import { loadVehicleTemplate, type VehicleInstance, type VehicleTemplate } from '../vehicles/models/vehicle';
import { createCityBanner, createCone } from './cityLifeModels';
import { createDeliveryRobot } from './deliveryRobot';
import type { LocalRect } from './landmarks/pier39';

type Point = { x: number; y: number; z: number };
type Landmark = Group & { userData: { landmarkId?: string; solidFootprints?: LocalRect[]; animateCityLife?: (seconds: number, nearby: boolean, low: boolean) => void } };
export interface CityLifeDestination extends Point { id: string; title: string; lat: number; lon: number; description: string }
type Site = { root: Group; source: Landmark; local: Point; yaw: number; radius: number; title: string; text: string; near: boolean; animate?: (seconds: number) => void };

/** City-only atmosphere: source landmarks own placements and temporary collider footprints. */
export async function createCityLife(options: {
  landmarks: Group; parent?: HTMLElement; low?: boolean;
  onDestination?(destination: CityLifeDestination): boolean | void;
  onNotice?(text: string): void;
}) {
  if (!flags.hazards && !flags.cityLife) return null;
  const root = new Group(); root.name = 'SF city life';
  const ferry = options.landmarks.children.find(o => o.userData.landmarkId === 'ferry-building') as Landmark | undefined;
  const pier = options.landmarks.children.find(o => o.userData.landmarkId === 'pier-39') as Landmark | undefined;
  const sites: Site[] = [], footprints: { source: Landmark; rect: LocalRect }[] = [];
  let car: VehicleInstance | undefined, template: VehicleTemplate | undefined, disposed = false, nextGround = 0, nextNotice = 0;
  const point = new Vector3();
  const coned = SF_HAZARDS.find(hazard => hazard.id === 'coned-robotaxi')!, muni = SF_HAZARDS.find(hazard => hazard.id === 'late-muni')!;
  function addSite(model: Group, source: Landmark, local: Point, yaw: number, title: string, text: string, radius = 150, animate?: (seconds: number) => void) {
    root.add(model); sites.push({ root: model, source, local, yaw, title, text, radius, near: false, animate });
  }
  function collider(source: Landmark, rect: LocalRect) { source.userData.solidFootprints = [...(source.userData.solidFootprints ?? []), rect]; footprints.push({ source, rect }); }
  function poleColliders(source: Landmark, x: number, z: number) {
    for (const dx of [-2.4, 2.4]) collider(source, { minX: x + dx - .1, maxX: x + dx + .1, minZ: z - .1, maxZ: z + .1 });
  }
  function at(source: Landmark, local: Point): Point { source.updateWorldMatrix(true, false); point.set(local.x, local.y, local.z).applyMatrix4(source.matrixWorld); return { x: point.x, y: point.y, z: point.z }; }
  function destination(source: Landmark, local: Point, id: string, title: string, description: string): CityLifeDestination {
    const location = at(source, local), geo = worldToGeodetic(location.x, location.z, SF_FRAME); return { ...location, lat: geo.lat, lon: geo.lon, id, title, description };
  }
  function dispose() {
    if (disposed) return; disposed = true; car?.dispose(); template?.dispose();
    for (const { source, rect } of footprints) source.userData.solidFootprints = source.userData.solidFootprints?.filter(value => value !== rect);
    const materials = new Set<Material>(), textures = new Set<Texture>();
    root.traverse(object => { if (object instanceof Mesh) { object.geometry.dispose(); for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material); } });
    for (const material of materials) { for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value); material.dispose(); }
    for (const texture of textures) texture.dispose(); root.removeFromParent(); controls?.remove();
  }
  let controls: HTMLElement | undefined;
  try {
    if (flags.hazards && ferry) {
      template = await loadVehicleTemplate('robotaxi');
      if (template) {
        car = template.createInstance(); const parked = new Group(); parked.name = 'Coned robotaxi'; parked.add(car.root);
        const roof = new Box3().setFromObject(car.root).max.y, cone = createCone(); cone.position.set(0, roof - .08, -.2); parked.add(cone);
        for (const [x, z] of [[-1.3, -2.7], [1.3, -2.7]] as const) { const floorCone = createCone(); floorCone.position.set(x, .02, z); parked.add(floorCone); }
        parked.rotation.y = Math.PI / 2; const bounds = new Box3().setFromObject(parked);
        addSite(parked, ferry, { x: 25, y: .18, z: 64 }, Math.PI / 2, coned.title, coned.warning);
        collider(ferry, { minX: 25 + bounds.min.x - .1, maxX: 25 + bounds.max.x + .1, minZ: 64 + bounds.min.z - .1, maxZ: 64 + bounds.max.z + .1 });
      }
      const sign = createCityBanner('MUNI: EVENTUALLY', '3 MINUTES · SUBJECT TO VIBES');
      addSite(sign, ferry, { x: -35, y: .18, z: 76 }, 0, muni.title, muni.warning); poleColliders(ferry, -35, 76);
      const courier = createDeliveryRobot(), delivery = SF_HAZARDS.find(hazard => hazard.id === 'delivery-robot')!;
      addSite(courier.root, ferry, { x: -58, y: .18, z: 56 }, 0, delivery.title, `${delivery.warning} Scenery only — find a parked car to drive.`, 100, courier.update);
      collider(ferry, { minX: -58.58, maxX: -57.42, minZ: 55.28, maxZ: 56.72 });
    }
    if (flags.hazards && pier) {
      const sign = createCityBanner('MUNI: EVENTUALLY', 'THE BUS IS AROUND THE CORNER. SPIRITUALLY.');
      addSite(sign, pier, { x: -20, y: 0, z: 178 }, 0, muni.title, muni.detail); poleColliders(pier, -20, 178);
    }
    if (flags.cityLife && pier) {
      const sign = createCityBanner('SEA LION BOARD', 'K DOCK · WEST BOARDWALK', '#3b6e75');
      addSite(sign, pier, { x: -40, y: 0, z: -49 }, Math.PI / 2, 'SEA LION BOARD MEETING', NPC_CHATTER.find(group => group.id === 'pier-visitor')!.lines[0]!);
      // Parallel to the railing: posts do not narrow the central drive aisle.
      for (const dz of [-2.4, 2.4]) collider(pier, { minX: -40.1, maxX: -39.9, minZ: -49 + dz - .1, maxZ: -49 + dz + .1 });
    }
    if (options.parent) {
      controls = document.createElement('section'); controls.className = 'gt-city-life-controls'; controls.setAttribute('aria-label', 'SF city life');
      const heading = document.createElement('h3'); heading.textContent = 'Around the city'; controls.append(heading);
      const notice = document.createElement('p'); notice.style.cssText = 'font:12px/1.4 Arial,sans-serif;overflow-wrap:anywhere'; notice.textContent = 'A few stops worth the detour.';
      function button(label: string, make: () => CityLifeDestination) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.style.cssText = 'display:block;width:100%;min-height:44px;margin:7px 0';
        button.addEventListener('click', () => { const next = make(); if (options.onDestination?.(next) !== false) notice.textContent = next.description; else notice.textContent = 'This stop is outside the current road map.'; }); controls!.append(button);
      }
      if (flags.hazards && ferry) button('Find the coned robotaxi', () => destination(ferry, { x: 25, y: .18, z: 64 }, 'coned-robotaxi', 'Coned robotaxi · Ferry plaza', 'On the Ferry Building plaza. One cone. Several million lines of uncertainty.'));
      if (flags.hazards && ferry) button('Find the delivery robot', () => destination(ferry, { x: -58, y: .18, z: 60 }, 'delivery-robot', 'Delivery robot · Ferry plaza', 'A six-wheel courier is waiting further down the plaza. Scenery only — use a parked car to drive.'));
      if (flags.cityLife && pier) button('Visit the Pier 39 sea lions', () => destination(pier, { x: 0, y: 0, z: 178 }, 'pier39-sea-lions', 'Pier 39 · sea lions', 'Enter the pier, follow the outer west boardwalk to K Dock, and let the board meeting bark.'));
      if (flags.hazards && ferry) button('Find the Muni-late banner', () => destination(ferry, { x: -35, y: .18, z: 76 }, 'muni-late-banner', 'Muni: Eventually · Ferry plaza', 'A fictional arrival board by the Embarcadero. Real transit information is not shown.'));
      controls.append(notice); options.parent.append(controls);
    }
  } catch (error) { dispose(); throw error; }
  return { root, controls,
    update(player: Point, now: number) {
      if (disposed) return;
      if (now >= nextGround) {
        nextGround = now + 1000;
        for (const site of sites) { const position = at(site.source, site.local); site.root.position.set(position.x, position.y, position.z); site.root.rotation.y = site.source.rotation.y + site.yaw; }
      }
      for (const site of sites) {
        const distance = Math.hypot(player.x - site.root.position.x, player.z - site.root.position.z);
        site.root.visible = site.source.visible && distance < (options.low ? Math.min(100, site.radius) : site.radius);
        if (site.root.visible && distance < 30) site.animate?.(now / 1000);
        const nearby = distance < 8;
        if (nearby && !site.near && now >= nextNotice) { nextNotice = now + 15_000; options.onNotice?.(`${site.title} · ${site.text}`); }
        site.near = nearby;
      }
      if (flags.cityLife && pier) pier.userData.animateCityLife?.(now / 1000, Math.hypot(player.x - pier.position.x, player.z - pier.position.z) < 240, options.low ?? false);
    },
    dispose,
  };
}
