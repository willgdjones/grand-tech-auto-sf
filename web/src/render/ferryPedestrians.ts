import { Group } from 'three';
import { flags } from '@gtasf/shared/flags';
import { graphicsPreset } from './graphicsPreset';
import type { AvatarInstance, AvatarTemplate } from '../avatar/riggedAvatar';
import type { MovementWorld } from '../movement/world';
import { createCrowdPopulation } from './instancedCrowd';
import { loadPeopleTemplates } from '../avatar/people';
import { loadCrowdVat } from './crowdVat';
import { gunfireThreat } from '../combat/alerts';

type Point = { x: number; y: number; z: number };
type Corner = readonly [number, number];
// Authored paving clear of the real SF driving lanes as well as the hall,
// palms, benches, central spawn axis, coned car and delivery-robot placement.
// The model's broad paving rectangle overlaps roads; contact height alone is
// not sufficient to place pedestrians. Validate the current registry matrix and
// source routes with tools/ferry-placement-clearance.mjs before acceptance.
export const FERRY_PEDESTRIAN_ROUTES: readonly (readonly Corner[])[] = [
  [[-28, 26], [-10, 26], [-10, 34], [-28, 34]],
  [[10, 26], [31, 26], [31, 34], [10, 34]],
  [[-82, 26], [-53, 26], [-53, 29], [-82, 29]],
  [[53, 26], [82, 26], [82, 29], [53, 29]],
];
const angle = (value: number) => Math.atan2(Math.sin(value), Math.cos(value));
// ferryPanic (critic N37 at the spawn plaza): these looping plaza walkers bolt from gunfire like crowdPanic's street walkers —
// within 40 m, sprint off ~35 deg either side of straight-away (not down the line of fire), fade out past 55 m, stay away until
// ~20 s after the last shot, then fade back in on their loop. World-space flight; ground probed at 5 Hz.
const PANIC = flags.crowdPanic && flags.ferryPanic && flags.combat;
const FLEE_RADIUS = 40, FLEE_FADE_M = 55, PANIC_S = 20, FLEE_PACE = 4.6;
type Walker = {
  avatar: AvatarInstance; path: readonly Corner[]; next: number;
  x: number; z: number; yaw: number; pause: number; speed: number; pace: number;
  /** ferryPanic: fleeing in world space (fx, fz, fy, heading), the alarm it flees, gone until (s), the fade-in age. */
  flee?: { x: number; z: number; y: number; yaw: number; fromX: number; fromZ: number; probeAt: number; steer: number };
  goneUntil?: number; age?: number;
};

/** Bounded local atmosphere. Reuses the player's asset; has no network or reward identity. */
export function createFerryPedestrians(options: {
  enabled: boolean; template: AvatarTemplate | null; landmarks: Group;
  ground: MovementWorld; isLoaded(x: number, z: number): boolean; low?: boolean;
}) {
  if (!options.enabled || !options.template) return null;
  const source = options.landmarks.children.find(object => object.userData.landmarkId === 'ferry-building');
  if (!source) return null;
  const ferry = source;
  const hdPolish = flags.graphicsV2 && !options.low && graphicsPreset() === 'hd';
  const walkers: Walker[] = [], limit = options.low ? 8 : hdPolish ? 36 : 16;
  let population = createCrowdPopulation(limit, options.template, options.low ? 0 : 8);
  const root = new Group(); root.name = 'Ferry plaza pedestrians'; root.add(population.root);
  for (let i = 0; i < limit; i++) {
    const path = FERRY_PEDESTRIAN_ROUTES[i % FERRY_PEDESTRIAN_ROUTES.length]!;
    const lengths = path.map((point, j) => Math.hypot(path[(j + 1) % path.length]![0] - point[0], path[(j + 1) % path.length]![1] - point[1]));
    let along = lengths.reduce((sum, n) => sum + n, 0) * (Math.floor(i / 4) + .35) / Math.ceil(limit / 4), start = 0;
    while (along >= lengths[start]! && start < path.length - 1) { along -= lengths[start]!; start++; }
    const from = path[start]!, target = path[(start + 1) % path.length]!, t = along / lengths[start]!;
    const x = from[0] + (target[0] - from[0]) * t, z = from[1] + (target[1] - from[1]) * t;
    const avatar = population.actors[i]!;
    avatar.root.name = `Ferry pedestrian ${i + 1}`; avatar.root.visible = false;
    walkers.push({ avatar, path, next: (start + 1) % path.length, x, z,
      yaw: Math.atan2(target[0] - x, target[1] - z), pause: (i % 4) * .35,
      speed: 0, pace: 1.2 + (i % 3) * .08 });
  }
  let disposed = false, elapsed = 0;
  const stats = { count: walkers.length, visible: 0, walking: 0, yielding: 0, panicking: 0 };
  const alarms: { x: number; z: number; until: number }[] = [];
  // cc0People / crowdVat: once the CC0 bodies and their VAT LOD have loaded (after READY), swap the plaza onto them —
  // rigged CC0 people (HD's 8, Low's 4) and VAT bodies for the rest. Walkers keep their routes; only actors change.
  void loadCrowdVat().then(async vat => [options.low && vat ? [] : await loadPeopleTemplates(), vat] as const).then(([bodies, vat]) => {
    if (disposed || (!bodies.length && !vat)) return;
    const next = createCrowdPopulation(limit, options.template, options.low ? (vat || !bodies.length ? 0 : 4) : 8, bodies, vat);
    root.remove(population.root); population.dispose(); population = next; root.add(next.root);
    walkers.forEach((walker, i) => { walker.avatar = next.actors[i]!; walker.avatar.root.name = `Ferry pedestrian ${i + 1}`; walker.avatar.root.visible = false; });
  });
  function update(player: Point, seconds: number) {
    if (disposed) return;
    const dt = Math.min(.1, Math.max(0, Number.isFinite(seconds) ? seconds : 0)); elapsed += dt;
    stats.visible = 0; stats.walking = 0; stats.yielding = 0; stats.panicking = 0;
    if (PANIC) {
      const shot = gunfireThreat(player.x, player.z, 160);
      if (shot) {
        const known = alarms.find(a => Math.hypot(a.x - shot.x, a.z - shot.z) < 12);
        if (known) known.until = elapsed + PANIC_S; else alarms.push({ x: shot.x, z: shot.z, until: elapsed + PANIC_S });
      }
      for (let i = alarms.length - 1; i >= 0; i--) if (alarms[i]!.until <= elapsed) alarms.splice(i, 1);
    }
    if (!ferry.visible || ferry.parent !== options.landmarks) { root.visible = false; return; }
    root.visible = true;
    const c = Math.cos(ferry.rotation.y), s = Math.sin(ferry.rotation.y);
    const radius = .5, range = options.low ? 90 : 150, fadeStart = range - 25;
    for (const walker of walkers) {
      const avatar = walker.avatar;
      let x = ferry.position.x + c * walker.x + s * walker.z;
      let z = ferry.position.z - s * walker.x + c * walker.z;
      if (PANIC) {
        if (walker.goneUntil !== undefined) { // fled: stays away until the plaza calms, then fades back in on its loop
          if (elapsed < walker.goneUntil) { avatar.root.visible = false; continue; }
          walker.goneUntil = undefined; walker.age = 0;
        }
        if (!walker.flee) {
          const alarm = alarms.find(a => Math.hypot(x - a.x, z - a.z) < FLEE_RADIUS);
          const y0 = alarm ? options.ground.heightAt(x, z) : null;
          if (alarm && y0 !== null && Number.isFinite(y0)) walker.flee = { x, z, y: y0, yaw: ferry.rotation.y + walker.yaw, fromX: alarm.x, fromZ: alarm.z, probeAt: 0, steer: 0 };
        }
        const flee = walker.flee;
        if (flee) {
          stats.panicking++;
          const ax = flee.x - flee.fromX, az = flee.z - flee.fromZ, fromAlarm = Math.hypot(ax, az);
          if (fromAlarm > FLEE_FADE_M) { // out of sight: gone until ~20 s after the last shot near it
            const alarm = alarms.find(a => Math.hypot(a.x - flee.fromX, a.z - flee.fromZ) < 12);
            walker.goneUntil = alarm ? alarm.until : elapsed; walker.flee = undefined; avatar.root.visible = false; continue;
          }
          flee.yaw += angle(Math.atan2(ax, az) + (walker.pace > 1.25 ? .6 : -.6) - flee.yaw) * (1 - Math.exp(-10 * dt));
          if (elapsed >= flee.probeAt) { // walls + height at 5 Hz, ~1.2 m ahead; dead reckoning between
            flee.probeAt = elapsed + .2; flee.steer = NaN;
            for (const turn of [0, .8, -.8, 1.6, -1.6]) {
              const nx = flee.x + Math.sin(flee.yaw + turn) * 1.2, nz = flee.z + Math.cos(flee.yaw + turn) * 1.2;
              if (!options.isLoaded(nx, nz) || options.ground.collidesCircle?.(nx, nz, radius)) continue;
              const gy = options.ground.heightAt(nx, nz);
              if (gy === null || !Number.isFinite(gy) || Math.abs(gy - flee.y) > 1.5) continue;
              flee.steer = turn; flee.y = gy; break;
            }
          }
          const moving = Number.isFinite(flee.steer);
          if (moving) { flee.x += Math.sin(flee.yaw + flee.steer) * FLEE_PACE * dt; flee.z += Math.cos(flee.yaw + flee.steer) * FLEE_PACE * dt; }
          avatar.root.position.set(flee.x, flee.y, flee.z); avatar.root.rotation.y = flee.yaw;
          const opacity = Math.max(0, Math.min(1, (range - Math.hypot(player.x - flee.x, player.z - flee.z)) / (range - fadeStart), (FLEE_FADE_M - fromAlarm) / 10));
          // A sprint: rigged bodies run; the VAT crowd has no run clip, so its walk plays fast.
          avatar.update(moving ? (typeof avatar.pose === 'function' ? dt * 1.1 : dt * .7) : dt, moving ? (typeof avatar.pose === 'function' ? 'run' : 'walk') : 'idle', opacity);
          if (avatar.root.visible) { stats.visible++; if (moving) stats.walking++; }
          continue;
        }
      }
      const distance = Math.hypot(player.x - x, player.z - z);
      if (distance >= range || !options.isLoaded(x, z)) { avatar.root.visible = false; continue; }
      let y = options.ground.heightAt(x, z);
      if (y === null || !Number.isFinite(y) || options.ground.collidesCircle?.(x, z, radius)) { avatar.root.visible = false; continue; }
      const target = walker.path[walker.next]!, dx = target[0] - walker.x, dz = target[1] - walker.z;
      const remaining = Math.hypot(dx, dz), desiredYaw = Math.atan2(dx, dz);
      walker.yaw += angle(desiredYaw - walker.yaw) * (1 - Math.exp(-7 * dt));
      walker.pause = Math.max(0, walker.pause - dt);
      const ready = walker.pause === 0 && Math.abs(angle(desiredYaw - walker.yaw)) < .18;
      walker.speed = ready ? Math.min(walker.pace, walker.speed + 2 * dt) : 0;
      const step = Math.min(remaining, walker.speed * dt);
      let moving = false;
      if (step > 0 && remaining > .001) {
        const localX = walker.x + dx / remaining * step, localZ = walker.z + dz / remaining * step;
        const nextX = ferry.position.x + c * localX + s * localZ, nextZ = ferry.position.z - s * localX + c * localZ;
        const nearPlayer = Math.abs(player.y - y) < 2.5 && Math.hypot(nextX - player.x, nextZ - player.z) < 1.35;
        const nearWalker = walkers.some(other => other !== walker && Math.hypot(localX - other.x, localZ - other.z) < 1.1);
        const nextY = options.isLoaded(nextX, nextZ) ? options.ground.heightAt(nextX, nextZ) : null;
        if (!nearPlayer && !nearWalker && nextY !== null && Number.isFinite(nextY)
          && Math.abs(nextY - y) <= .35 && !options.ground.collidesCircle?.(nextX, nextZ, radius)) {
          walker.x = localX; walker.z = localZ; x = nextX; z = nextZ; y = nextY; moving = true;
          if (remaining - step < .02) { walker.next = (walker.next + 1) % walker.path.length; walker.pause = .7; }
        } else { walker.speed = 0; stats.yielding++; }
      }
      avatar.root.position.set(x, y, z); avatar.root.rotation.y = ferry.rotation.y + walker.yaw;
      // ferryPanic: a walker back from fleeing fades in over a second.
      if (walker.age !== undefined) { walker.age += dt; if (walker.age >= 1) walker.age = undefined; }
      const opacity = Math.min(1, walker.age ?? 1, Math.max(0, (range - distance) / (range - fadeStart)));
      // The same in-place walk is used at 3m/s for players; scale its cadence to
      // the actual slower plaza pace instead of letting the feet run underneath.
      avatar.update(moving ? dt * walker.speed / 3 : dt, moving ? 'walk' : 'idle', opacity);
      if (avatar.root.visible) stats.visible++;
      if (moving) stats.walking++;
    }
    population.flush();
  }
  return { root, stats, update, dispose() {
    if (disposed) return; disposed = true;
    population.dispose(); stats.visible = 0; stats.walking = 0; stats.yielding = 0;
  } };
}
