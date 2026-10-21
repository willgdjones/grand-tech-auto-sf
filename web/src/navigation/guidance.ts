import { BufferGeometry, ConeGeometry, CylinderGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, RingGeometry, type Scene } from 'three';
import { flags } from '@gtasf/shared/flags';
import { graphicsPreset } from '../render/graphicsPreset';
import type { RadarDestination, RadarEvent } from '../radar/radar';
import type { MapRoute } from '../radar/routing';
import { distanceLabel } from '../events/schedule';

type Position = { x: number; y: number; z: number };
export interface NavigationProgress { remainingM: number; offRouteM: number; etaSeconds: number }

/** Nearest point along the routed lanes, including road grade in remaining distance. */
export function routeProgress(route: MapRoute, position: Position, speedMps = 8): NavigationProgress {
  let travelled = 0, nearest = Infinity, remainingM = route.distanceM;
  for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1]!, b = route.points[i]!;
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], length = Math.hypot(dx, dy, dz), flat = dx * dx + dz * dz;
    if (!length) continue;
    const t = flat ? Math.max(0, Math.min(1, ((position.x - a[0]) * dx + (position.z - a[2]) * dz) / flat)) : 0;
    const offset = Math.hypot(position.x - a[0] - dx * t, position.z - a[2] - dz * t);
    // Height distinguishes nearby switchbacks and vertically separated lanes.
    const score = Math.hypot(offset, position.y - a[1] - dy * t);
    if (score < nearest) { nearest = score; remainingM = Math.max(0, route.distanceM - travelled - length * t); }
    travelled += length;
  }
  if (!Number.isFinite(nearest)) nearest = Math.hypot(position.x - route.approach.x, position.z - route.approach.z);
  return { remainingM, offRouteM: nearest, etaSeconds: (remainingM + nearest) / Math.max(1, speedMps) };
}

/** Cheap source-road ribbon: geometry changes only when the A* route reference changes. */
export function ribbonGeometry(route: MapRoute, raisedSurfaceAt?: (x: number, z: number) => number | null): BufferGeometry {
  const vertices: number[] = [];
  const vertex = (x: number, y: number, z: number) => [x, Math.max(y, raisedSurfaceAt?.(x, z) ?? y) + .18, z];
  for (let i = 1; i < route.points.length; i++) {
    const a = route.points[i - 1]!, b = route.points[i]!, dx = b[0] - a[0], dz = b[2] - a[2], length = Math.hypot(dx, dz);
    if (length < .01) continue;
    const x = -dz / length * .9, z = dx / length * .9;
    // Sample long road edges so a raised plaza between source vertices stays visible.
    // Preserve source bridge/lane height wherever an authored surface is lower.
    const steps = raisedSurfaceAt ? Math.min(128, Math.max(1, Math.ceil(length / 2))) : 1;
    for (let step = 0; step < steps; step++) {
      const t0 = step / steps, t1 = (step + 1) / steps;
      const ax = a[0] + dx * t0, ay = a[1] + (b[1] - a[1]) * t0, az = a[2] + dz * t0;
      const bx = a[0] + dx * t1, by = a[1] + (b[1] - a[1]) * t1, bz = a[2] + dz * t1;
      const leftA = vertex(ax + x, ay, az + z), rightA = vertex(ax - x, ay, az - z);
      const leftB = vertex(bx + x, by, bz + z), rightB = vertex(bx - x, by, bz - z);
      vertices.push(...leftA, ...rightA, ...leftB, ...rightA, ...rightB, ...leftB);
    }
  }
  const geometry = new BufferGeometry(); geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3)); geometry.computeBoundingSphere(); return geometry;
}

export function createRouteGuidance(options: {
  scene: Scene | Group; parent?: HTMLElement; enabled?: boolean;
  surfaceHeightAt(x: number, z: number): number | null;
  /** Only authored ground overrides; null preserves source road/bridge heights. */
  raisedSurfaceAt?(x: number, z: number): number | null;
  onArrive(event: RadarEvent): void;
}) {
  if (!(options.enabled ?? (flags.eventNavigation && flags.waypoints))) return null;
  const root = new Group(); root.name = 'GPS road ribbon and destination beam'; options.scene.add(root);
  // routeRibbonPaint: the unlit ribbon reads as a neon slab underfoot (worst on Low, no tonemap). Warm it toward road
  // paint, drop the base opacity (more on Low), and fade it out near the camera so it leads ahead instead of blocking.
  const ribbonLow = flags.routeRibbonPaint && graphicsPreset() === 'low';
  const ribbonMaterial = new MeshBasicMaterial({ color: flags.routeRibbonPaint ? 0xf2c24a : 0xffd45f, transparent: true,
    opacity: flags.routeRibbonPaint ? (ribbonLow ? .40 : .52) : .66, side: DoubleSide, depthWrite: false, forceSinglePass: true, polygonOffset: true, polygonOffsetFactor: -2 });
  if (flags.routeRibbonPaint) ribbonMaterial.onBeforeCompile = shader => {
    // World position from begin_vertex (always present); cameraPosition is a built-in fragment uniform. Fade the
    // alpha to zero within ~4-13 m of the camera so the near segment reads as a path ahead, not a slab underfoot.
    shader.vertexShader = 'varying vec3 vRibbonW;\n' + shader.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vRibbonW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = 'varying vec3 vRibbonW;\n' + shader.fragmentShader
      .replace('#include <fog_fragment>', '  gl_FragColor.a *= smoothstep(4.0, 13.0, distance(vRibbonW, cameraPosition));\n#include <fog_fragment>');
  };
  const ribbon = new Mesh(new BufferGeometry(), ribbonMaterial); ribbon.name = 'GPS route ribbon'; root.add(ribbon);
  const marker = new Group(); marker.name = 'GPS destination'; root.add(marker); marker.visible = false;
  const beamMaterial = new MeshBasicMaterial({ color: 0xffda72, transparent: true, opacity: .19, side: DoubleSide, depthWrite: false, forceSinglePass: true });
  const solidMaterial = new MeshBasicMaterial({ color: 0xffdf82, side: DoubleSide });
  const beam = new Mesh(new CylinderGeometry(1.6, 1.6, 20, 12, 1, true), beamMaterial); beam.position.y = 10;
  const arrow = new Mesh(new ConeGeometry(2.5, 4, 4), solidMaterial); arrow.position.y = 21; arrow.rotation.z = Math.PI;
  const ring = new Mesh(new RingGeometry(2.4, 3.3, 32), solidMaterial); ring.rotation.x = -Math.PI / 2; ring.position.y = .22;
  marker.add(beam, arrow, ring);
  const status = document.createElement('div'); status.className = 'gt-gps-status'; status.hidden = true; status.setAttribute('aria-label', 'Destination distance and estimated travel time');
  const title = document.createElement('strong'), details = document.createElement('span');
  Object.assign(title.style, { display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }); status.append(title, details);
  Object.assign(status.style, { position: 'fixed', padding: '8px 12px', borderRadius: '5px', border: '1px solid #b99b56', background: '#13251eec', color: '#ffe2a3', font: 'bold 12px/1.4 Arial', textAlign: 'center', pointerEvents: 'none', zIndex: '12' });
  const narrow = matchMedia('(max-width:700px)');
  const layout = () => Object.assign(status.style, narrow.matches
    ? { left: 'auto', right: '12px', bottom: '264px', transform: 'none', width: 'calc(100vw - 210px)', maxWidth: '220px' }
    : { left: '50%', right: 'auto', bottom: '145px', transform: 'translateX(-50%)', width: 'auto', maxWidth: 'min(420px, 45vw)' });
  layout(); narrow.addEventListener('change', layout);
  (options.parent ?? document.body).append(status);
  let destination: RadarDestination | null = null, activeRoute: MapRoute | null | undefined, arrived = false, disposed = false, lastSample = -Infinity;
  let progress: NavigationProgress | null = null, previousText = '';
  function setDestination(value: RadarDestination | null) {
    destination = value; arrived = false; lastSample = -Infinity;
    if (!value) { marker.visible = false; ribbon.visible = false; status.hidden = true; }
  }
  return {
    root, element: status, setDestination,
    get arrived() { return arrived; },
    get progress() { return progress; },
    update(position: Position, route: MapRoute | null, mode: 'on-foot' | 'driver' | 'passenger' = 'on-foot', canArrive = true, now = performance.now()) {
      if (disposed) return;
      if (route !== activeRoute) {
        activeRoute = route; ribbon.geometry.dispose(); ribbon.geometry = route ? ribbonGeometry(route, options.raisedSurfaceAt) : new BufferGeometry(); lastSample = -Infinity;
      }
      ribbon.visible = Boolean(destination && route && !arrived);
      if (!destination || !route) { marker.visible = false; status.hidden = true; progress = null; return; }
      arrow.position.y = 21 + Math.sin(now / 420) * .65;
      beamMaterial.opacity = .17 + Math.sin(now / 650) * .035;
      if (now - lastSample < 200) return;
      lastSample = now;
      const ground = options.surfaceHeightAt(route.approach.x, route.approach.z);
      marker.position.set(route.approach.x, ground ?? route.approach.y, route.approach.z);
      // Do not float a marker over a destination chunk that has not loaded yet.
      marker.visible = !arrived && ground !== null;
      progress = routeProgress(route, position, mode === 'on-foot' ? 3 : 8);
      const minutes = progress.etaSeconds < 60 ? '<1' : Math.ceil(progress.etaSeconds / 60);
      const detailText = `${distanceLabel(progress.remainingM)} · ~${minutes} min ${mode === 'on-foot' ? 'walk' : 'drive'}${destination.event?.approx ? ' · approximate area' : ''}`;
      const text = `${destination.title} · ${detailText}`;
      status.hidden = arrived;
      if (text !== previousText) { title.textContent = destination.title; details.textContent = detailText; previousText = text; }
      if (!arrived && canArrive) {
        const reachedApproach = ground !== null
          && Math.hypot(position.x - route.approach.x, position.z - route.approach.z) < 8
          && Math.abs(position.y - ground) < 4;
        // Authored plaza stops can be reached without following the road's final detour.
        const localGround = !destination.event && Math.hypot(position.x - destination.x, position.z - destination.z) < 8
          ? options.surfaceHeightAt(destination.x, destination.z) : null;
        const reachedLocalStop = localGround !== null
          && Math.abs(position.y - destination.y) < 4 && Math.abs(position.y - localGround) < 4;
        if (reachedApproach || reachedLocalStop) {
          arrived = true; marker.visible = ribbon.visible = false; status.hidden = true;
          if (destination.event) options.onArrive(destination.event);
        }
      }
    },
    destroy() {
      if (disposed) return; disposed = true; root.removeFromParent(); status.remove(); narrow.removeEventListener('change', layout);
      ribbon.geometry.dispose(); beam.geometry.dispose(); arrow.geometry.dispose(); ring.geometry.dispose(); ribbonMaterial.dispose(); beamMaterial.dispose(); solidMaterial.dispose();
    },
  };
}
