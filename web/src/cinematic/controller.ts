import { PerspectiveCamera, Vector3, type Group, type Scene } from 'three';
import { flags } from '@gtasf/shared/flags';
import type { LombardWorld } from '../render/chunks/world';
import { LOMBARD_DESTINATION, LOMBARD_SPAWN } from '../render/chunks/world';
import { LANDMARKS, landmarkPosition } from '../render/landmarks/landmarks';
import { withLandmarkSurfaces } from '../render/landmarks/surfaces';
import { loadVehicleTemplate } from '../vehicles/models/vehicle';
import type { VehicleInstance, VehicleTemplate } from '../vehicles/models/vehicle';
import { createMapRouter, type MapRoute } from '../radar/routing';
import { projectLocation } from '../radar/projection';
import type { RadarEvent } from '../radar/radar';
import { createRouteGuidance } from '../navigation/guidance';
import { CINEMATIC_PATHS, landmarkRail, roadRail, type CinematicPath, type RailFrame } from './paths';
import { cinematicRoadGraph } from './roads';
import './cinematic.css';

const DEFAULT_DURATION: Record<CinematicPath, number> = { lombard: 42, ferry: 16, salesforce: 16, event: 20 };
const DEFAULT_EVENT = 'tech-week:22eb5208-ca3b-4daf-93e1-65b4689f038b';

/** Explicit, offline directing mode. The caller gates it with flags.cinematicCapture. */
export async function createCinematic(options: {
  scene: Scene; world: LombardWorld; landmarks?: Group; enabled: boolean; params?: URLSearchParams;
}) {
  const params = options.params ?? new URLSearchParams(location.search), requested = params.get('cinematic');
  if (!options.enabled || !flags.testingHarness || !requested) return null;
  if (!CINEMATIC_PATHS.includes(requested as CinematicPath)) throw new Error(`Unknown cinematic. Choose ${CINEMATIC_PATHS.join(', ')}.`);
  const path = requested as CinematicPath, supplied = Number(params.get('duration'));
  const duration = supplied >= 2 && supplied <= 120 ? supplied : DEFAULT_DURATION[path];
  const { world, scene } = options;
  const surface = options.landmarks ? withLandmarkSurfaces({ heightAt: world.surfaceHeightAt }, options.landmarks) : { heightAt: world.surfaceHeightAt };
  const hasGround = (point: { x: number; z: number }) => world.manifest.chunks.some(chunk => chunk.x === Math.floor(point.x / 256) && chunk.z === Math.floor(point.z / 256));
  function streamFocus(point: Vector3): Vector3 {
    if (hasGround(point)) return point;
    if (path !== 'ferry' && path !== 'salesforce') throw new Error('Cinematic driving route leaves the available ground map');
    // Landmarks are placed city-wide; the current ground stream can cover only a corridor.
    const nearest = world.manifest.chunks.reduce((best, chunk) =>
      Math.hypot(chunk.x * 256 + 128 - point.x, chunk.z * 256 + 128 - point.z)
      < Math.hypot(best.x * 256 + 128 - point.x, best.z * 256 + 128 - point.z) ? chunk : best);
    return new Vector3(nearest.x * 256 + 128, point.y, nearest.z * 256 + 128);
  }
  const camera = new PerspectiveCamera(54, innerWidth / innerHeight, .15, 1400);
  let template: VehicleTemplate | undefined, actor: VehicleInstance | undefined;
  let route: MapRoute | undefined, event: RadarEvent | undefined;
  let rail: { sample(seconds: number): RailFrame };
  if (path === 'ferry' || path === 'salesforce') {
    const definition = LANDMARKS.find(item => item.id === (path === 'ferry' ? 'ferry-building' : 'salesforce-tower'))!;
    const point = landmarkPosition(definition, world.heightAt);
    await world.ensureAround(streamFocus(new Vector3(point.x, point.y, point.z)));
    const anchor = landmarkPosition(definition, world.heightAt);
    rail = landmarkRail(path, new Vector3(anchor.x, anchor.y, anchor.z), definition.heightM, duration);
  } else {
    const router = createMapRouter(await cinematicRoadGraph(world));
    if (path === 'lombard') route = router.route(LOMBARD_SPAWN, LOMBARD_DESTINATION) ?? undefined;
    else {
      const response = await fetch('/api/events');
      if (!response.ok) throw new Error(`Cinematic events HTTP ${response.status}`);
      const payload = await response.json() as { events?: RadarEvent[] };
      const eventId = params.get('event') ?? DEFAULT_EVENT;
      event = payload.events?.find(item => item.id === eventId && item.lat !== null && item.lon !== null);
      if (!event) throw new Error(`Cinematic event ${eventId} has no public location in the current calendar.`);
      const target = projectLocation(event.lat!, event.lon!, world.manifest.frame);
      const ferry = landmarkPosition(LANDMARKS.find(item => item.id === 'ferry-building')!, world.heightAt);
      route = router.route(ferry, target) ?? undefined;
    }
    if (!route) throw new Error('No source-road route exists for this cinematic');
    route = { ...route, points: route.points.map(([x, y, z]) => [x, surface.heightAt(x, z) ?? y, z]) };
    // Event clips show the final approach at normal city scale, never a teleport across the city.
    if (path === 'event' && route.distanceM > 220) route = tailRoute(route, 220);
    rail = roadRail(route, duration);
    template = await loadVehicleTemplate(path === 'lombard' ? 'robotaxi' : 'prius');
    if (!template) throw new Error('Enable the cinematic vehicle feature before recording');
    actor = template.createInstance(); scene.add(actor.root);
  }
  const guidance = path === 'event' ? createRouteGuidance({ scene, enabled: true, surfaceHeightAt: surface.heightAt, onArrive() {} }) : null;
  if (guidance && event && route) guidance.setDestination({ ...route.approach, id: event.id, title: event.title, event });
  document.body.classList.add('gt-cinematic');
  if (params.get('hud') === '0') document.body.classList.add('gt-cinematic-hide-hud');
  const label = document.createElement('div'); label.className = 'gt-cinematic-label';
  label.textContent = event ? `${event.title}${event.approx ? ' · approximate event area' : ''}` : `Cinematic · ${path}`;
  document.body.append(label);
  let disposed = false;
  const metadata = { path, duration, offline: true, event: event ? { id: event.id, title: event.title, url: event.url, approx: event.approx } : null,
    groundAtSubject: hasGround(rail.sample(0).focus),
    routeDistanceM: route?.distanceM ?? null, position: [0, 0, 0], target: [0, 0, 0], seconds: 0 };
  let preparedCell = '';
  async function prepare(seconds: number): Promise<void> {
    if (disposed) throw new Error('Cinematic disposed');
    const frame = rail.sample(seconds), focus = streamFocus(frame.focus);
    const cell = `${Math.floor(focus.x / 256)},${Math.floor(focus.z / 256)}`;
    if (cell === preparedCell && world.stats.loading === 0 && world.stats.queuedUploads === 0) return;
    // Fill the same 3x3 streaming neighbourhood used by gameplay, then reveal every queued mesh.
    for (let z = -1; z <= 1; z++) for (let x = -1; x <= 1; x++) {
      const point = { x: (Math.floor(focus.x / 256) + x) * 256 + 128, z: (Math.floor(focus.z / 256) + z) * 256 + 128 };
      if (world.manifest.chunks.some(chunk => chunk.x === Math.floor(point.x / 256) && chunk.z === Math.floor(point.z / 256))) await world.ensureAround(point);
    }
    world.update(focus);
    for (let count = 0; world.stats.loading || world.stats.queuedUploads; count++) {
      if (count > 1800) throw new Error('Cinematic map preparation timed out');
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); world.update(focus);
    }
    if (world.stats.errors.length) throw new Error(world.stats.errors.join('; '));
    preparedCell = cell;
  }
  function update(dt: number, seconds: number) {
    if (disposed) return;
    const frame = rail.sample(seconds);
    world.update(streamFocus(frame.focus));
    if (actor && frame.actor) {
      const pose = frame.actor;
      pose.position.y = surface.heightAt(pose.position.x, pose.position.z) ?? pose.position.y;
      actor.root.position.copy(pose.position);
      actor.root.rotation.set(pose.pitch, pose.yaw, 0, 'YXZ'); actor.update(dt, pose.speed);
      guidance?.update(pose.position, route ?? null, 'driver', false, seconds * 1000);
    }
    // Keep the chase rail's lens above terrain, and pull in before entering a source footprint.
    const ground = world.surfaceHeightAt(frame.position.x, frame.position.z, frame.position.y);
    if (ground !== null) frame.position.y = Math.max(frame.position.y, ground + .5);
    if (frame.actor) {
      for (let i = 1; i <= 24; i++) {
        const p = frame.target.clone().lerp(frame.position, i / 24);
        if (world.collides(p.x, p.y - .2, p.z, .25, .5)) {
          frame.position.lerpVectors(frame.target, frame.position, Math.max(0, (i - 2) / 24)); break;
        }
      }
    }
    camera.position.copy(frame.position); camera.lookAt(frame.target); camera.updateMatrixWorld();
    metadata.position = frame.position.toArray(); metadata.target = frame.target.toArray(); metadata.seconds = seconds;
  }
  function resize(width: number, height: number) {
    camera.aspect = width / height;
    // Preserve horizontal composition in portrait while keeping the actor/landmark comfortably framed.
    camera.fov = width < height ? 76 : 54; camera.updateProjectionMatrix();
  }
  resize(innerWidth, innerHeight);
  await prepare(0); update(0, 0);
  return { camera, metadata, prepare, update, resize,
    dispose() { disposed = true; actor?.dispose(); template?.dispose(); guidance?.destroy(); label.remove(); document.body.classList.remove('gt-cinematic', 'gt-cinematic-hide-hud'); },
  };
}

function tailRoute(route: MapRoute, limit: number): MapRoute {
  const points: MapRoute['points'] = [route.points.at(-1)!]; let distanceM = 0;
  for (let i = route.points.length - 2; i >= 0; i--) {
    const a = route.points[i]!, b = points[0]!, length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (distanceM + length >= limit) {
      const t = (limit - distanceM) / length;
      points.unshift([b[0] + (a[0] - b[0]) * t, b[1] + (a[1] - b[1]) * t, b[2] + (a[2] - b[2]) * t]); distanceM = limit; break;
    }
    points.unshift(a); distanceM += length;
  }
  return { ...route, points, distanceM };
}
