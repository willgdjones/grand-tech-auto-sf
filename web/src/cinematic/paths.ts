import { Vector3 } from 'three';
import type { MapRoute } from '../radar/routing';

export const CINEMATIC_PATHS = ['lombard', 'ferry', 'salesforce', 'event'] as const;
export type CinematicPath = typeof CINEMATIC_PATHS[number];
export interface RailFrame {
  position: Vector3; target: Vector3; focus: Vector3;
  actor?: { position: Vector3; yaw: number; pitch: number; speed: number };
}

/** Distance sampling retains the source road polyline, including every Lombard bend. */
export function roadRail(route: MapRoute, duration: number) {
  const points = route.points.map(point => new Vector3(...point));
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1]! + points[i]!.distanceTo(points[i - 1]!));
  const length = lengths.at(-1) ?? 0;
  if (length < 1) throw new Error('Cinematic road route is too short');
  function at(distance: number): Vector3 {
    const d = Math.max(0, Math.min(length, distance));
    let i = 1;
    while (i < lengths.length - 1 && lengths[i]! < d) i++;
    const segment = lengths[i]! - lengths[i - 1]!;
    return points[i - 1]!.clone().lerp(points[i]!, segment ? (d - lengths[i - 1]!) / segment : 0);
  }
  return {
    length,
    sample(seconds: number): RailFrame {
      const travelSeconds = duration - Math.min(2, duration * .15);
      const distance = length * Math.max(0, Math.min(1, seconds / travelSeconds));
      const position = at(distance), before = at(distance - 1.5), after = at(distance + 1.5);
      const direction = after.clone().sub(before).normalize();
      // Follow the road behind the actor; using a delayed point avoids swinging across hairpin walls.
      const camera = distance > 10 ? at(distance - 10) : position.clone().addScaledVector(direction, -10);
      camera.y += 5.5;
      const target = position.clone().lerp(at(distance + 5), .35); target.y += 1.3;
      return { position: camera, target, focus: position.clone(), actor: {
        position, yaw: Math.atan2(direction.x, direction.z),
        pitch: -Math.atan2(direction.y, Math.hypot(direction.x, direction.z)),
        speed: seconds < travelSeconds ? length / travelSeconds : 0,
      } };
    },
  };
}

/** Landmark rails use their authored world anchors and dimensions, never screen-space guesses. */
export function landmarkRail(path: 'ferry' | 'salesforce', base: Vector3, height: number, duration: number) {
  return {
    sample(seconds: number): RailFrame {
      const t = Math.max(0, Math.min(1, seconds / duration)), u = t * t * (3 - 2 * t);
      const angle = path === 'ferry' ? -.75 + (u - .5) * 1.05 : -.6 + u * 1.15;
      const radius = path === 'ferry' ? 155 - 30 * u : 145 - 30 * u;
      const y = path === 'ferry' ? 35 + u * 78 : height * (.55 + .57 * u);
      const position = base.clone().add(new Vector3(Math.sin(angle) * radius, y, Math.cos(angle) * radius));
      const target = base.clone().add(new Vector3(0, path === 'ferry' ? height * .5 : height * (.76 + .19 * u), 0));
      return { position, target, focus: base.clone() };
    },
  };
}
