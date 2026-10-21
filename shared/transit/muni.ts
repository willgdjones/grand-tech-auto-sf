import type { VehicleEntry } from '../protocol/types';
import { muniRoutes, type MuniRoute } from './muniRoutes';

export const MUNI_ID_BASE = 3_000_000;
export const MUNI_BUS_COUNT = 6;
export const MUNI_BOARDING_RADIUS_M = 7;
export const MUNI_CAPACITY = 16;
export const MUNI_SPEED_MPS = 6;
export const MUNI_DWELL_MS = 10_000;
export const muniBusIds: readonly number[] = Array.from({ length: MUNI_BUS_COUNT }, (_, i) => MUNI_ID_BASE + i);
type XYZ = readonly [number, number, number];
interface Path { route: MuniRoute; distances: number[] }
interface Phase {
  start: number; end: number; path: Path; from: number; to: number;
  stop?: MuniRoute['stops'][number]; bridge?: { a: XYZ; b: XYZ };
}
interface Timetable { duration: number; phases: Phase[] }
const horizontal = (a: XYZ, b: XYZ) => Math.hypot(b[0] - a[0], b[2] - a[2]);
const modulo = (value: number, limit: number) => ((value % limit) + limit) % limit;
let timetable: Timetable | undefined;

/** Build only when the enabled feature first asks for a bus or stop. */
function schedule(): Timetable {
  if (timetable) return timetable;
  let duration = 0;
  const phases: Phase[] = [];
  for (const [index, route] of muniRoutes.entries()) {
    const distances = [0];
    for (let i = 1; i < route.points.length; i++) distances.push(distances[i - 1]! + horizontal(route.points[i - 1]!, route.points[i]!));
    const path: Path = { route, distances }, length = distances.at(-1)!;
    let cursor = 0;
    const travel = (to: number) => {
      to = Math.min(length, to);
      if (to <= cursor) return;
      const end = duration + (to - cursor) / MUNI_SPEED_MPS * 1000;
      phases.push({ start: duration, end, path, from: cursor, to }); duration = end; cursor = to;
    };
    for (const stop of route.stops) {
      travel(stop.atM);
      phases.push({ start: duration, end: duration + MUNI_DWELL_MS, path, from: cursor, to: cursor, stop });
      duration += MUNI_DWELL_MS;
    }
    travel(length);
    const a = route.points.at(-1)!, b = muniRoutes[(index + 1) % muniRoutes.length]!.points[0]!, turnM = horizontal(a, b);
    // The two directional terminal lanes can be a few metres apart. Traverse
    // that connection on the clock rather than teleporting seated passengers.
    if (turnM > .01) {
      const end = duration + Math.max(1000, turnM / 1.5 * 1000);
      phases.push({ start: duration, end, path, from: length, to: length, bridge: { a, b } }); duration = end;
    }
  }
  return timetable = { duration, phases };
}

export function isMuniBus(id: number): boolean {
  return Number.isInteger(id) && id >= MUNI_ID_BASE && id < MUNI_ID_BASE + MUNI_BUS_COUNT;
}
export interface MuniPose {
  entry: VehicleEntry; yaw: number; pitch: number; routeId: string; title: string;
  destination: string; stop?: string; stopId?: string; boarding: boolean;
}
/** Same absolute server time gives every observer the same bus. Optional output
 * is reused by the render/server loops, avoiding a fresh pose object per frame. */
export function sampleMuniBus(id: number, serverNow: number, output?: MuniPose): MuniPose | undefined {
  if (!isMuniBus(id) || !Number.isFinite(serverNow)) return;
  const line = schedule(), at = modulo(serverNow + (id - MUNI_ID_BASE) * line.duration / MUNI_BUS_COUNT, line.duration);
  let lo = 0, hi = line.phases.length - 1;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (line.phases[mid]!.end <= at) lo = mid + 1; else hi = mid; }
  const phase = line.phases[lo]!, fraction = (at - phase.start) / (phase.end - phase.start);
  let a: XYZ, b: XYZ, t: number;
  if (phase.bridge) { a = phase.bridge.a; b = phase.bridge.b; t = fraction; }
  else {
    const distance = phase.from + (phase.to - phase.from) * fraction, { distances, route } = phase.path;
    lo = 1; hi = distances.length - 1;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (distances[mid]! < distance) lo = mid + 1; else hi = mid; }
    a = route.points[lo - 1]!; b = route.points[lo]!;
    t = Math.max(0, Math.min(1, (distance - distances[lo - 1]!) / (distances[lo]! - distances[lo - 1]! || 1)));
  }
  const state: MuniPose = output ?? { entry: { id, kind: 'bus', driverId: 0, x: 0, y: 0, z: 0, yaw: 0, flags: 0, speedCmps: 0 },
    yaw: 0, pitch: 0, routeId: '', title: '', destination: '', boarding: false };
  const dx = b[0] - a[0], dz = b[2] - a[2], length = Math.hypot(dx, dz);
  state.yaw = Math.atan2(dx, dz); state.pitch = -Math.atan2(b[1] - a[1], length);
  state.entry.id = id; state.entry.kind = 'bus'; state.entry.driverId = 0; state.entry.flags = 0;
  state.entry.x = Math.round((a[0] + dx * t) * 100);
  state.entry.y = Math.round((a[1] + (b[1] - a[1]) * t) * 100);
  state.entry.z = Math.round((a[2] + dz * t) * 100);
  state.entry.yaw = Math.round(modulo(state.yaw, Math.PI * 2) / (Math.PI * 2) * 256) % 256;
  state.entry.speedCmps = phase.stop ? 0 : Math.round((phase.bridge ? length / (phase.end - phase.start) * 1000 : MUNI_SPEED_MPS) * 100);
  state.routeId = phase.path.route.id; state.title = phase.path.route.title; state.destination = phase.path.route.destination;
  state.stop = phase.stop?.name; state.stopId = phase.stop?.id; state.boarding = !!phase.stop;
  return state;
}

export interface MuniStopChoice {
  id: string; title: string; stop: string; destination: string; x: number; y: number; z: number; distanceM: number; waitSeconds: number;
}
/** Nearest stop in each direction, with an ETA for this game's accelerated service. */
export function nearestMuniStops(position: { x: number; z: number }, serverNow: number): MuniStopChoice[] {
  const line = schedule();
  return muniRoutes.map(route => {
    const phases = line.phases.filter((phase): phase is Phase & { stop: MuniRoute['stops'][number] } => phase.path.route === route && !!phase.stop);
    const phase = phases.reduce((best, next) => Math.hypot(next.stop.point[0] - position.x, next.stop.point[2] - position.z)
      < Math.hypot(best.stop.point[0] - position.x, best.stop.point[2] - position.z) ? next : best);
    let wait = Infinity;
    for (let i = 0; i < MUNI_BUS_COUNT; i++) {
      const at = modulo(serverNow + i * line.duration / MUNI_BUS_COUNT, line.duration);
      wait = Math.min(wait, at >= phase.start && at < phase.end ? 0 : modulo(phase.start - at, line.duration));
    }
    const [x, y, z] = phase.stop.point;
    return { id: `muni-${route.id}-${phase.stop.id}`, title: `Muni 39 to ${route.destination}`, stop: phase.stop.name,
      destination: route.destination, x, y, z, distanceM: Math.hypot(x - position.x, z - position.z), waitSeconds: Math.ceil(wait / 1000) };
  });
}
