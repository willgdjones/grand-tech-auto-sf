import type { VehicleEntry } from '../protocol/types';
import { cableRoutes, type CableRoute } from './cableRoutes';

export const CABLE_ID_BASE = 2_000_000;
export const CABLE_BOARDING_RADIUS_M = 7;
export const CABLE_SPEED_MPS = 4.25;
export const CABLE_DWELL_MS = 8_000;
type XYZ = readonly [number, number, number];
interface Path { route: CableRoute; distances: number[] }
interface Phase { start: number; end: number; path: Path; from: number; to: number; stop?: CableRoute['stops'][number]; bridge?: { a: XYZ; b: XYZ } }
interface Line { id: CableRoute['line']; title: string; duration: number; phases: Phase[]; count: number }
const horizontal = (a: XYZ, b: XYZ) => Math.hypot(b[0] - a[0], b[2] - a[2]);
const lines: Line[] = (['PH', 'PM', 'C'] as const).map(id => {
  const routes = cableRoutes.filter(r => r.line === id), phases: Phase[] = [];
  let duration = 0;
  for (let ri = 0; ri < routes.length; ri++) {
    const route = routes[ri]!, distances = [0];
    for (let i = 1; i < route.points.length; i++) distances.push(distances[i - 1]! + horizontal(route.points[i - 1]!, route.points[i]!));
    const path = { route, distances }, length = distances.at(-1)!;
    let cursor = 0;
    const travel = (to: number) => {
      to = Math.min(length, to);
      if (to <= cursor) return;
      const end = duration + (to - cursor) / CABLE_SPEED_MPS * 1000;
      phases.push({ start: duration, end, path, from: cursor, to }); duration = end; cursor = to;
    };
    for (const stop of route.stops) {
      travel(stop.atM);
      phases.push({ start: duration, end: duration + CABLE_DWELL_MS, path, from: cursor, to: cursor, stop });
      duration += CABLE_DWELL_MS;
    }
    travel(length);
    const a = route.points.at(-1)!, b = routes[(ri + 1) % routes.length]!.points[0]!;
    // The actual terminals have separate arrival/departure tracks. Traverse the short turn,
    // rather than teleporting a car (or its passengers) to the next directional route.
    const end = duration + Math.max(8_000, horizontal(a, b) / 1.5 * 1000);
    phases.push({ start: duration, end, path, from: length, to: length, bridge: { a, b } }); duration = end;
  }
  return { id, title: routes[0]!.title, phases, duration, count: id === 'C' ? 6 : 8 };
});

export const cableCarIds: readonly number[] = lines.flatMap((line, index) => Array.from({ length: line.count }, (_, i) => CABLE_ID_BASE + index * 100 + i));
export function isCableCar(id: number): boolean { return cableCarIds.includes(id); }
function carLine(id: number): { line: Line; offset: number } | undefined {
  const index = Math.floor((id - CABLE_ID_BASE) / 100), number = (id - CABLE_ID_BASE) % 100, line = lines[index];
  return line && number >= 0 && number < line.count ? { line, offset: number * line.duration / line.count } : undefined;
}
const modulo = (value: number, limit: number) => ((value % limit) + limit) % limit;
function phaseAt(line: Line, at: number): Phase {
  let lo = 0, hi = line.phases.length - 1;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (line.phases[mid]!.end <= at) lo = mid + 1; else hi = mid; }
  return line.phases[lo]!;
}
function pointAt(path: Path, at: number): { a: XYZ; b: XYZ; t: number } {
  let lo = 1, hi = path.distances.length - 1;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (path.distances[mid]! < at) lo = mid + 1; else hi = mid; }
  return { a: path.route.points[lo - 1]!, b: path.route.points[lo]!,
    t: Math.max(0, Math.min(1, (at - path.distances[lo - 1]!) / (path.distances[lo]! - path.distances[lo - 1]! || 1))) };
}
export interface CablePose {
  entry: VehicleEntry; pitch: number; line: CableRoute['line']; title: string; destination: string;
  stop?: string; boarding: boolean;
}
/** Absolute server time determines the same car position for every observer, including late joins. */
export function sampleCableCar(id: number, serverNow: number): CablePose | undefined {
  const spec = carLine(id); if (!spec || !Number.isFinite(serverNow)) return;
  const at = modulo(serverNow + spec.offset, spec.line.duration), phase = phaseAt(spec.line, at);
  const fraction = (at - phase.start) / (phase.end - phase.start);
  const { a, b, t } = phase.bridge ? { ...phase.bridge, t: fraction } : pointAt(phase.path, phase.from + (phase.to - phase.from) * fraction);
  const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, z = a[2] + (b[2] - a[2]) * t;
  const yaw = Math.atan2(b[0] - a[0], b[2] - a[2]);
  const speed = phase.stop ? 0 : phase.bridge ? horizontal(a, b) / (phase.end - phase.start) * 1000 : CABLE_SPEED_MPS;
  return { entry: { id, kind: 'cable-car', driverId: 0, x: Math.round(x * 100), y: Math.round(y * 100), z: Math.round(z * 100),
    yaw: Math.round(modulo(yaw, Math.PI * 2) / (Math.PI * 2) * 256) % 256, flags: 0, speedCmps: Math.round(speed * 100) },
    pitch: -Math.atan2(b[1] - a[1], horizontal(a, b)), line: spec.line.id, title: spec.line.title,
    destination: phase.path.route.destination, stop: phase.stop?.name, boarding: !!phase.stop };
}

export interface CableStopChoice {
  id: string; title: string; stop: string; destination: string; x: number; y: number; z: number; distanceM: number; waitSeconds: number;
}
/** One nearest boarding stop per real line, with an ETA from the exact gameplay timetable. */
export function nearestCableStops(position: { x: number; z: number }, serverNow: number): CableStopChoice[] {
  return lines.map(line => {
    const phases = line.phases.filter((phase): phase is Phase & { stop: CableRoute['stops'][number] } => !!phase.stop);
    const phase = phases.reduce((best, next) => Math.hypot(next.stop.point[0] - position.x, next.stop.point[2] - position.z)
      < Math.hypot(best.stop.point[0] - position.x, best.stop.point[2] - position.z) ? next : best);
    let wait = Infinity;
    for (let i = 0; i < line.count; i++) {
      const at = modulo(serverNow + i * line.duration / line.count, line.duration);
      wait = Math.min(wait, at >= phase.start && at < phase.end ? 0 : modulo(phase.start - at, line.duration));
    }
    const [x, y, z] = phase.stop.point;
    return { id: `cable-${phase.path.route.id}-${phase.stop.id}`, title: line.title, stop: phase.stop.name, destination: phase.path.route.destination,
      x, y, z, distanceM: Math.hypot(x - position.x, z - position.z), waitSeconds: Math.ceil(wait / 1000) };
  });
}
