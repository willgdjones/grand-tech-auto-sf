import { Box3, Vector3 } from 'three';
import { geodeticToWorld, worldToGeodetic } from '../../../tools/map/src/geo';
import { SF_FRAME } from '../../../tools/map/src/config';
import { DISTRICTS } from '../../../tools/map/src/districts';
import type { LombardWorld } from '../render/chunks/world';
import { referralShareUrl } from '../referrals/client';
import { flags } from '@gtasf/shared/flags';

export interface Place { slug: string; title: string; lat: number; lon: number; heading?: number; approx?: boolean; eventId?: string;
  /** Organiser link gtasf.com/e/<event-id> (flags.organiserLinks): face the venue and show the "is on the map" card. */
  organiser?: { venue?: string | null; start?: string | null } }
/** Source-checked plaza offset: the founder's approximate point is inside the Ferry footprint. */
export const FERRY = Object.freeze({ slug: 'ferry-building', title: 'Ferry Building', lat: 37.795229772, lon: -122.394210973, heading: 64.2977 });
export const PLACES: readonly Place[] = [
  FERRY,
  { slug: 'lombard', title: 'Lombard switchbacks', lat: 37.801995202, lon: -122.419630198, heading: 87.8 },
  { slug: 'coit-tower', title: 'Coit Tower', lat: 37.8024, lon: -122.4058 },
  { slug: 'pier-39', title: 'Pier 39', lat: 37.8087, lon: -122.4098 },
  { slug: 'transamerica', title: 'Transamerica Pyramid', lat: 37.7952, lon: -122.4028 },
  { slug: 'salesforce-tower', title: 'Salesforce Tower', lat: 37.7898, lon: -122.3966 },
  { slug: 'golden-gate-bridge', title: 'Golden Gate Bridge', lat: 37.8078, lon: -122.4750 },
  { slug: 'bay-bridge', title: 'Bay Bridge', lat: 37.7894, lon: -122.3883 },
  { slug: 'painted-ladies', title: 'Painted Ladies', lat: 37.7762, lon: -122.4328 },
  { slug: 'sutro-tower', title: 'Sutro Tower', lat: 37.7552, lon: -122.4528 },
  ...DISTRICTS.map(district => ({ slug: district.id, title: district.name, ...district.spawn })),
];
export const headingToYaw = (heading: number): number => Math.PI - heading * Math.PI / 180;
export const yawToHeading = (yaw: number): number => ((180 - yaw * 180 / Math.PI) % 360 + 360) % 360;
export const placePoint = (place: Pick<Place, 'lat' | 'lon'>) => {
  const [x, z] = geodeticToWorld(place.lat, place.lon, SF_FRAME); return { x, z };
};
export interface SpawnRequest { place: Place; explicit: boolean }

class PlaceLookupError extends Error {
  constructor(readonly status: number) { super('Place lookup unavailable'); }
}

/** Bound the whole lookup, including a stalled response body, before trying the next source. */
async function lookupPlace(url: string): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new Error('Place lookup timed out')); }, 4000);
  });
  async function attempt(): Promise<unknown> {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) void response.body?.cancel().catch(() => {});
    if (response.status === 404) return undefined;
    if (!response.ok) throw new PlaceLookupError(response.status);
    return response.json();
  }
  try {
    return await Promise.race([(async () => {
      try { return await attempt(); }
      catch (error) {
        const transient = error instanceof PlaceLookupError
          ? error.status === 408 || error.status === 429 || error.status >= 500
          : error instanceof TypeError || error instanceof DOMException && error.name === 'AbortError';
        if (controller.signal.aborted || !transient) throw error;
        // Retry only this GET, once. The original deadline includes the delay.
        await new Promise<void>((resolve, reject) => {
          const aborted = () => { clearTimeout(retryTimer); reject(controller.signal.reason); };
          const retryTimer = setTimeout(() => {
            controller.signal.removeEventListener('abort', aborted); resolve();
          }, 750);
          controller.signal.addEventListener('abort', aborted, { once: true });
        });
        controller.signal.throwIfAborted();
        return attempt();
      }
    })(), timeout]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

export async function resolveSpawn(url = new URL(location.href)): Promise<SpawnRequest> {
  if (url.searchParams.has('at')) {
    const parts = url.searchParams.get('at')!.split(',');
    if (parts.length < 2 || parts.length > 3 || parts.some(p => !p.trim())) throw new Error('Use ?at=latitude,longitude[,heading].');
    const values = parts.map(Number), [lat, lon, heading] = values;
    if (values.some(n => !Number.isFinite(n)) || Math.abs(lat!) > 90 || Math.abs(lon!) > 180) throw new Error('That location is not a valid latitude/longitude.');
    return { explicit: true, place: { slug: 'shared-location', title: 'Shared location', lat: lat!, lon: lon!, ...(heading === undefined ? {} : { heading }) } };
  }
  const organiser = /^\/e\/([^/]+)\/?$/.exec(url.pathname);
  if (organiser) {
    // Organiser links only ever resolve calendar events; anything else falls back to the normal spawn.
    if (!flags.organiserLinks) return { place: FERRY, explicit: false };
    const id = decodeURIComponent(organiser[1]!);
    try {
      const payload = await lookupPlace('/api/events') as { events?: { id: string; title: string; lat: number | null; lon: number | null; approx?: boolean; venue?: string | null; address?: string | null; start?: string }[] } | null;
      const event = payload?.events?.find(e => e && (e.id === id || e.id === `tech-week:${id}`) && typeof e.title === 'string' && Number.isFinite(e.lat) && Number.isFinite(e.lon));
      if (event) return { explicit: true, place: { slug: id, title: event.title, lat: event.lat!, lon: event.lon!, approx: event.approx, eventId: event.id,
        organiser: { venue: event.venue ?? event.address ?? null, start: event.start ?? null } } };
    } catch { /* unavailable: normal spawn */ }
    return { place: FERRY, explicit: false };
  }
  const match = /^\/go\/([^/]+)\/?$/.exec(url.pathname);
  if (!match) return { place: FERRY, explicit: false };
  const slug = decodeURIComponent(match[1]!).toLowerCase();
  const known = PLACES.find(p => p.slug === slug || slug === 'ferry' && p.slug === 'ferry-building');
  if (known) return { place: known, explicit: true };
  let unavailable = false;
  try {
    const payload = await lookupPlace('/api/events') as { events?: { id: string; title: string; lat: number | null; lon: number | null; url: string; approx?: boolean }[] } | null;
    if (!payload || !Array.isArray(payload.events)) throw new Error('Invalid event list');
    const events = payload.events.filter(event => event && typeof event.id === 'string' && typeof event.title === 'string'
      && Number.isFinite(event.lat) && Number.isFinite(event.lon));
    const event = events.find(event => event.id === slug) ?? events.find(event => {
      try { return new URL(event.url).pathname.split('/').filter(Boolean).at(-1)?.toLowerCase() === slug; } catch { return false; }
    });
    if (event) return { explicit: true, place: { slug, title: event.title, lat: event.lat!, lon: event.lon!, approx: event.approx, eventId: event.id } };
  } catch { unavailable = true; }
  try {
    const place = await lookupPlace(`/api/gtm/spawns/${encodeURIComponent(slug)}`) as Partial<Place> | null | undefined;
    if (place !== undefined) {
      if (!place || typeof place !== 'object' || place.slug !== slug || !Number.isFinite(place.lat) || !Number.isFinite(place.lon)
        || (place.heading !== undefined && !Number.isFinite(place.heading))
        || (place.title !== undefined && typeof place.title !== 'string')) throw new Error('Invalid office location');
      return { explicit: true, place: { ...place, slug, lat: place.lat!, lon: place.lon!, title: place.title ?? slug.replaceAll('-', ' ') } };
    }
  } catch { unavailable = true; }
  if (unavailable) throw new Error('Place lookup is temporarily unavailable. Reload to try again, or use /go/ferry-building or /go/lombard.');
  throw new Error(`Unknown place “${slug}”. Try /go/ferry-building or /go/lombard.`);
}

export function nearestBuilding(boxes: readonly Box3[], point: { x: number; y: number; z: number }): Vector3 | null {
  const here = new Vector3(point.x, point.y + 1, point.z), nearest = new Vector3();
  let best = 180 ** 2, target: Vector3 | null = null;
  for (const box of boxes) {
    // Do not aim at the buildings above a tunnel or below an elevated deck.
    if (box.max.y - box.min.y < 3 || box.min.y > point.y + 3 || box.max.y < here.y) continue;
    const distance = box.clampPoint(here, nearest).distanceToSquared(here);
    if (distance < best) {
      best = distance; target = box.getCenter(new Vector3());
      target.y = box.min.y + Math.min(32, (box.max.y - box.min.y) * .5);
    }
  }
  return target;
}

/** spawnClearOfLandmarks (critic N18): a landmark's solid footprint (the Vaillancourt Fountain basin, Pier 39's
 *  obstacles) lives in the landmark collision layer, not in `world.collides`, so a link at the fountain landed the
 *  player waist-deep in the pool. A blocked point moves to the nearest clear spot within ~20 m instead. */
function clearOf(world: LombardWorld, blocked: (x: number, z: number, radius: number) => boolean, point: { x: number; z: number; y?: number }) {
  if (!blocked(point.x, point.z, .4)) return point;
  for (let r = 1; r <= 20; r++) {
    for (let k = 0; k < 16; k++) {
      const a = k / 16 * Math.PI * 2, x = point.x + Math.sin(a) * r, z = point.z + Math.cos(a) * r;
      if (blocked(x, z, .4)) continue;
      const y = world.surfaceHeightAt(x, z, point.y);
      if (y !== null && !world.collides(x, y, z, .4)) return { ...point, x, z };
    }
  }
  return null;
}

/** Load before placement; prefer the plaza for the default and sourced road contact for links. */
export async function snapSpawn(world: LombardWorld, request: SpawnRequest, landmarkBlocked?: (x: number, z: number, radius: number) => boolean) {
  const target = placePoint(request.place);
  // The source graph is available before chunk streaming. Empty park/water
  // chunks may be deliberately omitted, so resolve a lane before loading.
  const road = world.nearestRoad(target.x, target.z, 500);
  const candidates = request.explicit && road ? [road, target] : [target, ...(road ? [road] : [])];
  let loadError: unknown;
  for (const original of candidates) {
    try { await world.ensureAround(original); }
    catch (error) { loadError = error; continue; }
    const candidate = flags.spawnClearOfLandmarks && landmarkBlocked ? clearOf(world, landmarkBlocked, original) : original;
    if (!candidate) continue;
    // A snapped source lane may be on a deck or inside a tunnel. Preserve its
    // level instead of resolving the same XZ back to the bare-earth DEM.
    const y = world.surfaceHeightAt(candidate.x, candidate.z, original === road ? road?.y : undefined);
    if (y === null || world.collides(candidate.x, y, candidate.z, .4)) continue;
    // A shared heading is the arrival view. Overriding it with a facade focus
    // can point away from the avatar, or through the ceiling of a tunnel.
    // Organiser links face the venue itself (the event point), not whichever facade happens to be nearest.
    const venueFocus = request.place.organiser && Math.hypot(target.x - candidate.x, target.z - candidate.z) > 2
      ? new Vector3(target.x, y + 8, target.z) : null;
    const focus = venueFocus ?? (request.place.heading === undefined ? nearestBuilding(world.cameraBoxes, { ...candidate, y }) : null);
    const yaw = venueFocus ? Math.atan2(venueFocus.x - candidate.x, venueFocus.z - candidate.z)
      : request.place.heading !== undefined ? headingToYaw(request.place.heading)
      : focus ? Math.atan2(focus.x - candidate.x, focus.z - candidate.z) : road?.yaw ?? 0;
    return { x: candidate.x, y, z: candidate.z, yaw, focus };
  }
  if (loadError) throw loadError;
  throw new Error('No clear road or sidewalk is available at that location.');
}

export function locationLink(pose: { x: number; z: number; yaw: number }): string {
  const geo = worldToGeodetic(pose.x, pose.z, SF_FRAME), url = new URL('/', location.href);
  url.searchParams.set('at', `${geo.lat.toFixed(7)},${geo.lon.toFixed(7)},${yawToHeading(pose.yaw).toFixed(1)}`);
  return url.href;
}
export async function copyGameLink(input: string | URL): Promise<string> {
  const link = await referralShareUrl(input);
  try { await navigator.clipboard.writeText(link); }
  catch {
    const field = document.createElement('textarea'); field.value = link; field.style.cssText = 'position:fixed;opacity:0';
    document.body.append(field); field.select(); const copied = document.execCommand('copy'); field.remove();
    if (!copied) throw new Error(`Copy this link: ${link}`);
  }
  return link;
}
export async function copyLocation(pose: { x: number; z: number; yaw: number }): Promise<string> {
  return copyGameLink(locationLink(pose));
}
