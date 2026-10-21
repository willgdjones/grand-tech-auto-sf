import { flags } from '@gtasf/shared/flags';
import { projectLocation, type MapFrame } from '../radar/projection';
import type { RoadGraph } from '@gtasf/shared/roadgraph';
import type { AvatarInstance, AvatarTemplate } from '../avatar/riggedAvatar';
import type { MovementWorld } from '../movement/world';
import { graphicsPreset } from './graphicsPreset';
import { PLAZA_UNIFORMS } from './plazas';
import { createCrowdPopulation } from './instancedCrowd';
import { loadPeopleTemplates } from '../avatar/people';
import { PEOPLE_BODIES, WARDROBE_BODIES } from '../avatar/peopleAssets';
import { loadCrowdVat } from './crowdVat';
import { consumeImpacts, gunfireThreat, localVehicle, reportPedPunch, reportPedWasted } from '../combat/alerts';
import { pedScream } from '../audio/screams';
import { FIGHT_BACK_CHANCE, FIGHT_BACK_RADIUS_M, FIGHTER_GIVE_UP_S, KNOCKOUT_GETUP_S, PED_PUNCH_INTERVAL_MS, PED_SWING_RANGE_M } from '@gtasf/shared/combat/pedMelee';
import { applyDeathPose, clearWastedPose } from '../combat/ragdoll';

// Combat ped reaction (flag combat): peds within FLEE_RADIUS of recent gunfire panic for PANIC_S seconds —
// they run (FLEE_PACE) toward the route end farther from the shot, then cower (stop) at that safe end.
// crowdPanic (critic N37): a shot or robbery EMPTIES the block. Walkers within 40 m sprint off their routes straight away from
// it and fade out past FLEE_FADE_M; a few rigged ones cower and 1 in 10 phones it in; no one respawns inside the zone until it
// calms (~20 s after the last shot). Off: 18 m, 2.2 s, a jog to the route end (the short spans made that a few metres).
const PANIC = flags.crowdPanic;
const FLEE_RADIUS = PANIC ? 40 : 18, PANIC_S = PANIC ? 20 : 2.2, FLEE_PACE = PANIC ? 4.6 : 2.4, FLEE_FADE_M = FLEE_RADIUS + 15;
/** crowdPanic roles: 1 bolts off-route, 2 cowers in place, 3 stops to call it in. */
const BOLT = 1, COWER = 2, CALLER = 3;
// Ragdoll-lite (flag ragdollAudio): a shot landing within KILL_RADIUS of a ped wastes it — it topples (ragdoll.ts)
// and lies for WASTED_LIE_S before being recycled into a fresh walker. Cosmetic + local only (no server state).
// meshyDeathClips: the dead stay down 30 s (GTA V critic #9) instead of recycling after 7 s.
const KILL_RADIUS = 1.4, WASTED_LIE_S = flags.meshyDeathClips ? 30 : 7, FLINCH_RADIUS = 3.5, FLINCH_S = .9;
// Run-over: a ped within ~half a car length of the local car's centre, at >= ~9 mph, is knocked down.
const RUN_OVER_RADIUS = 2.2, RUN_OVER_MIN_MPS = 4;
// Melee takedowns (flag pedMelee): a fists/bat swing KNOCKS a ped down (it gets back up); a bystander may fight back.
const MELEE_RADIUS = 1.2, FIGHTER_PACE = 3.6, FIGHTER_LEAVE_M = 30;
/** 2-D length without Math.hypot's per-call argument allocation (runs per walker per frame; gtasf-pooa). */
const hyp = (x: number, z: number) => Math.sqrt(x * x + z * z);

type Point = { x: number; y: number; z: number };
type Span = { id: number; x: number; y: number | null; z: number; tx: number; tz: number; half: number; plaza?: boolean; busy?: boolean; promenade?: boolean }
/** waterfrontWalkers: bay-side Embarcadero promenade, Howard St -> the Ferry Building (lat, lon). */
const WATERFRONT_PROMENADE: readonly (readonly [number, number])[][] = [
  [[37.79215, -122.39065], [37.79310, -122.39150], [37.79400, -122.39230], [37.79480, -122.39300]],
];;
// busyStreets (lane D): sidewalks of these arterials carry a third walker per route side (and the pool grows to match).
const BUSY_STREET = /^(Market|The Embarcadero|Embarcadero|Mission|Montgomery|Columbus|Kearny|Grant|Stockton|Powell|Post|Geary|Valencia|Castro|Haight|Polk|Fillmore|Broadway|Folsom|Howard|Van Ness)\b/;
type Route = { id: number; a: Point; b: Point; heights: number[] };
type Walker = { rigged: boolean; flinch?: number; habit: number; avatar: AvatarInstance; route?: Route; x: number; y: number; z: number; t: number; direction: number; yaw: number; pause: number; age: number; pace: number; slot: number; checkAt: number; blocked: number; scared: number; fleeX: number; fleeZ: number; wasted: number;
  /** pedMelee: the current downing is a knockout (gets back up); fighting until (s); walking off after a fight; next swing (s). */
  knockout?: boolean; fighter?: number; leaving?: boolean; swingAt?: number; lunge?: number;
  /** crowdPanic: BOLT / COWER / CALLER while panicking, 0 otherwise; a bolter's next ground probe (s) and its steer offset. */
  panicRole?: number; probeAt?: number; steer?: number };
const angle = (value: number) => Math.atan2(Math.sin(value), Math.cos(value));

/** Local atmosphere, never a network player or funding identity. Low has 24 GPU-instanced people. */
export async function createStreetWalkers(options: {
  template: AvatarTemplate | null; graph: RoadGraph; ground: MovementWorld; low?: boolean;
  position: Point;
  isLoaded(x: number, z: number): boolean;
  roadHeightAt(x: number, z: number): number | null;
  /** waterfrontWalkers: projects the authored promenade lines (lat/lon) into this map. */
  frame?: MapFrame;
}) {
  if (!flags.graphicsV2 || !flags.pedestrians) return null;
  const low = options.low || graphicsPreset() !== 'hd';
  const cells = new Map<string, Span[]>(), seen = new Set<string>(), promenadeSpans = new Set<number>();
  let sequence = 0, started = performance.now(), scanned = 0;
  for (const edge of options.graph.edges) {
    if ((++scanned & 63) === 0 && performance.now() - started > 4) {
      await new Promise<void>(resolve => setTimeout(resolve, 0)); started = performance.now();
    }
    const meta = edge as typeof edge & { kind?: string; bridge?: boolean; tunnel?: boolean; layer?: number; name?: string };
    if (edge.lane !== 0 || meta.kind === 'connector' || meta.bridge || meta.tunnel || meta.layer || !meta.name || edge.speedMps > 18) continue;
    for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1]!, b = edge.points[i]!, dx = b[0] - a[0], dz = b[2] - a[2], length = hyp(dx, dz);
      if (length < 6 || Math.abs(b[1] - a[1]) / length > .28) continue;
      const steps = Math.max(1, Math.ceil(length / 12));
      for (let j = 0; j < steps; j++) {
        const t = (j + .5) / steps, x = a[0] + dx * t, z = a[2] + dz * t;
        const key = `${Math.round(x / 5)}:${Math.round(z / 5)}`;
        if (seen.has(key)) continue; seen.add(key);
        const span: Span = { id: ++sequence, x, y: a[1] + (b[1] - a[1]) * t, z, tx: dx / length, tz: dz / length, half: Math.max(2, Math.min(7, length / steps / 2 - 1)),
          busy: flags.busyStreets && BUSY_STREET.test(meta.name) };
        const cell = `${Math.floor(x / 128)}:${Math.floor(z / 128)}`, list = cells.get(cell) ?? [];
        list.push(span); cells.set(cell, list);
      }
    }
  }
  // waterfrontWalkers (lane C openingDrive critic #3): the Embarcadero is a wide boulevard, so its road spans' sidewalk search
  // (5-18 m off the centreline) never reaches the bay-side promenade, which the opening drive passes: it read empty.
  // Authored promenade lines (Howard St -> Ferry Building) add spans there, each searching +-8 m for valid paving.
  if (flags.waterfrontWalkers && options.frame) for (const line of WATERFRONT_PROMENADE) {
    const pts = line.map(([lat, lon]) => projectLocation(lat, lon, options.frame!));
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!, b = pts[i]!, dx = b.x - a.x, dz = b.z - a.z, length = hyp(dx, dz), steps = Math.max(1, Math.ceil(length / 16));
      for (let j = 0; j < steps; j++) {
        const t = (j + .5) / steps, x = a.x + dx * t, z = a.z + dz * t;
        const span: Span = { id: ++sequence, x, y: null, z, tx: dx / length, tz: dz / length, half: Math.min(7, length / steps / 2 - .5), promenade: true, busy: true };
        promenadeSpans.add(span.id);
        const cell = `${Math.floor(x / 128)}:${Math.floor(z / 128)}`, list = cells.get(cell) ?? [];
        list.push(span); cells.set(cell, list);
      }
    }
  }
  // Plaza strolls (gtasf-7moo): lines across each authored plaza; height unknown until it streams in.
  const plazas = PLAZA_UNIFORMS.uPlazas.value.slice(0, PLAZA_UNIFORMS.uPlazaCount.value);
  for (const r of plazas) for (let k = 1; k < 4; k++) for (const along of [true, false]) {
    const x = along ? (r.x + r.z) / 2 : r.x + (r.z - r.x) * k / 4, z = along ? r.y + (r.w - r.y) * k / 4 : (r.y + r.w) / 2;
    const half = Math.min(16, ((along ? r.z - r.x : r.w - r.y) / 2) - 4);
    if (half <= 0) continue;
    const span: Span = { id: ++sequence, x, y: null, z, tx: along ? 1 : 0, tz: along ? 0 : 1, half, plaza: true };
    const cell = `${Math.floor(x / 128)}:${Math.floor(z / 128)}`, list = cells.get(cell) ?? [];
    list.push(span); cells.set(cell, list);
  }
  // cc0People: real CC0 bodies for HD's 16 near rigged walkers; Low keeps no skeletons (per-frame mixers cost ~2x fps under
  // the phone throttle) — with crowdVat its people are the same bodies vertex-animated, otherwise the 6 nearest are rigged.
  // lowNearPeople: Low + VAT gets 3 rigged bodies (24-bone Meshy rigs, a subset — never the whole pool) for the people nearest
  // the camera, so faces don't melt at <3 m; everyone else stays VAT. Without it Low + VAT skips the rigged bodies entirely.
  const vat = await loadCrowdVat(), nearLow = low && vat && flags.lowNearPeople ? 3 : 0;
  const bodies = low && vat ? (nearLow ? await loadPeopleTemplates(PEOPLE_BODIES.slice(WARDROBE_BODIES, WARDROBE_BODIES + nearLow)) : []) : await loadPeopleTemplates();
  const rigged = low ? nearLow ? Math.min(nearLow, bodies.length) : bodies.length && !vat ? 6 : 0 : 16;
  const population = createCrowdPopulation(flags.busyStreets ? low ? 34 : 110 : low ? 24 : 88, options.template, rigged, bodies, vat);
  const root = population.root; root.name = low ? 'Low city sidewalk walkers' : 'HD city sidewalk walkers';
  const walkers: Walker[] = population.actors.map((avatar, i) => {
    avatar.root.name = `Street walker ${i + 1}`; avatar.root.visible = false;
    return { avatar, x: 0, y: 0, z: 0, t: 0, direction: 1, yaw: 0, pause: 0, age: 1, pace: .95 + (i % 5) * .13,
      slot: 0, checkAt: 0, blocked: 0, scared: 0, fleeX: 0, fleeZ: 0, wasted: 0, rigged: nearLow > 0 && i < rigged,
      // pedIdleVariety: 1 = texts while walking, 2 = stops for a phone call, 3 = stops to look around (Meshy clips; others plain).
      // Walkers 1-3 are the rigged ones on phone Low (lowNearPeople), so they carry all three habits there.
      habit: flags.pedIdleVariety ? [1, 2, 3, 0, 0][i % 5]! : 0 };
  });
  let elapsed = 0, nextRefresh = 0, disposed = false;
  const forward = { x: 0, z: -1 }, lastPlayer = { x: options.position.x, z: options.position.z }; // walkersInView
  const failedUntil = new Map<number, number>();
  // walkerRouteCache: reuse a span+side's found Route across refills (its a/b/heights are derived from the static
  // heightfield, so re-sampling terrain every 0.25s is pure waste). Cleared past a cap as the player roams.
  const routeCache = new Map<number, Route>();
  const PER_ROUTE = flags.busyStreets ? 3 : 2;
  const stats = { count: walkers.length, visible: 0, walking: 0, paths: sequence, fighters: 0, swings: 0, promenade: 0, panicking: 0, alarms: 0 }; // fighters/swings: pedMelee; promenade: waterfrontWalkers on the promenade; panicking/alarms: crowdPanic
  // crowdPanic: recent shot/robbery spots and when each calms; walkers panic inside them and none respawn there meanwhile.
  const alarms: { x: number; z: number; until: number }[] = [];
  function alarmNear(x: number, z: number) {
    for (const a of alarms) if (a.until > elapsed && hyp(x - a.x, z - a.z) < FLEE_RADIUS) return a;
    return null;
  }
  function safe(x: number, z: number): number | null {
    if (!options.isLoaded(x, z) || options.roadHeightAt(x, z) !== null || options.ground.collidesCircle?.(x, z, .35)) return null;
    const y = options.ground.heightAt(x, z);
    return y !== null && Number.isFinite(y) ? y : null;
  }
  function routeFor(span: Span, side: number): Route | null {
    // Plaza lines are already inside the authored paving. Only road spans need
    // the sideways search for a sidewalk; applying it here can leave the plaza.
    for (let offset = span.plaza ? 0 : span.promenade ? 0 : 5.2; offset <= (span.plaza ? 0 : span.promenade ? 8 : 18); offset += 1.4) {
      const x = span.x - span.tz * side * offset, z = span.z + span.tx * side * offset;
      const a = { x: x - span.tx * span.half, y: 0, z: z - span.tz * span.half };
      const b = { x: x + span.tx * span.half, y: 0, z: z + span.tz * span.half };
      let good = true, previous: number | null = null; const heights: number[] = [];
      const steps = Math.max(2, Math.ceil(span.half * 2));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps, y = safe(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
        if (y === null || span.y !== null && Math.abs(y - span.y) > 4 || previous !== null && Math.abs(y - previous) > .5) { good = false; break; }
        if (i === 0) a.y = y; if (i === steps) b.y = y; previous = y; heights.push(y);
      }
      if (good) return { id: span.id * 2 + (side > 0 ? 1 : 0), a, b, heights };
    }
    return null;
  }
  /** A downed walker is avoided where its BODY lies, not at its feet: the plank and the backward fall lie ~0.9 m behind the
   * feet, Meshy's forward fall ~0.9 m ahead (applyDeathPose picks forward for odd slots on bodies with clips). */
  function nearBody(other: Walker, x: number, z: number) {
    const ahead = flags.meshyDeathClips && other.slot % 2 === 1 && typeof other.avatar.pose === 'function' ? 1 : -1;
    const cx = other.x + Math.sin(other.yaw) * .9 * ahead, cz = other.z + Math.cos(other.yaw) * .9 * ahead;
    return hyp(x - cx, z - cz) < 1.05;
  }
  function heightOn(route: Route, t: number) {
    const f = Math.max(0, Math.min(1, t)) * (route.heights.length - 1), i = Math.min(route.heights.length - 2, Math.floor(f));
    return route.heights[i]! + (route.heights[i + 1]! - route.heights[i]!) * (f - i);
  }
  function refill(player: Point, budget = 2) {
    const active = new Set(walkers.flatMap(w => w.route ? [w.slot] : []));
    const nearby: Span[] = [];
    const cx = Math.floor(player.x / 128), cz = Math.floor(player.z / 128);
    for (let x = cx - 1; x <= cx + 1; x++) for (let z = cz - 1; z <= cz + 1; z++) nearby.push(...cells.get(`${x}:${z}`) ?? []);
    // walkersInView: rank spans ahead of the player's travel direction (the chase camera looks that way) before those behind,
    // so the limited walker pool lands where the player can see it. Off = nearest first.
    const score = (span: Span) => {
      const dx = span.x - player.x, dz = span.z - player.z, raw = hyp(dx, dz);
      // waterfrontWalkers: the promenade fills first when it's in reach (the opening drive's ~dozen walkers).
      const d = span.promenade ? raw * .4 : raw;
      if (!flags.walkersInView || d < 1) return d;
      const ahead = (dx * forward.x + dz * forward.z) / d; // -1 behind .. 1 ahead
      return d * (ahead > .2 ? .55 : ahead > -.3 ? 1 : 2.4);
    };
    nearby.sort((a, b) => score(a) - score(b));
    const started = performance.now();
    for (const span of nearby) {
      const distance = hyp(span.x - player.x, span.z - player.z);
      if (distance > (low ? 95 : 130) || performance.now() - started > budget) break;
      if (PANIC && alarmNear(span.x, span.z)) continue; // the block stays empty until it calms
      for (const side of [-1, 1]) {
        if (span.plaza && side < 0) continue;
        const routeId = span.id * 2 + (side > 0 ? 1 : 0);
        // Slot ids are routeId * PER_ROUTE + slot; busy arterial spans hold up to three walkers, others two (one if short).
        const slots = span.half < 4 ? 1 : span.busy ? 3 : 2;
        let full = true; for (let k = 0; k < slots; k++) if (!active.has(routeId * PER_ROUTE + k)) { full = false; break; }
        if (full || (failedUntil.get(routeId) ?? 0) > elapsed) continue;
        let route = flags.walkerRouteCache ? routeCache.get(routeId) : undefined;
        if (!route) {
          const built = routeFor(span, side);
          if (!built) { if (failedUntil.size > 2048) failedUntil.clear(); failedUntil.set(routeId, elapsed + 1); continue; }
          route = built;
          if (flags.walkerRouteCache) { if (routeCache.size > 4096) routeCache.clear(); routeCache.set(routeId, route); }
        }
        for (let slot = 0; slot < slots; slot++) {
          const id = routeId * PER_ROUTE + slot;
          if (active.has(id)) continue;
          // lowNearPeople: the few rigged walkers take the nearest spans; VAT walkers fill the rest.
          const walker = (nearLow && distance < 18 ? walkers.find(w => !w.route && w.rigged) : undefined) ?? walkers.find(w => !w.route && !w.rigged) ?? walkers.find(w => !w.route);
          if (!walker) return;
          const t = slots === 3 ? [.15, .5, .85][slot]! : slot ? .78 : .22;
          const x = route.a.x + (route.b.x - route.a.x) * t, z = route.a.z + (route.b.z - route.a.z) * t;
          if (hyp(x - player.x, z - player.z) < 3 || walkers.some(w => w.route && hyp(w.x - x, w.z - z) < 1.5)) continue;
          walker.route = route; walker.slot = id; active.add(id);
          walker.t = t; walker.direction = side; walker.x = x; walker.z = z; walker.y = heightOn(route, t);
          walker.yaw = Math.atan2((route.b.x - route.a.x) * walker.direction, (route.b.z - route.a.z) * walker.direction);
          walker.age = 1; walker.pause = 0; walker.checkAt = elapsed + (id % 6) / 10; walker.blocked = 0; walker.panicRole = 0; walker.scared = 0; walker.probeAt = 0;
        }
      }
    }
  }
  // Populate before the first rendered world frame, instead of a one-per-second warm-in.
  refill(options.position, 24);
  return { root, stats, update(player: Point, seconds: number) {
    if (disposed) return;
    const dt = Math.min(.1, Math.max(0, Number.isFinite(seconds) ? seconds : 0)); elapsed += dt;
    const nowMs = performance.now();
    // walkersInView: the player's facing (the chase camera looks along it) stands in for the view direction; without a yaw,
    // the smoothed travel direction does.
    if (flags.walkersInView) {
      const yaw = (player as Point & { yaw?: number }).yaw;
      if (typeof yaw === 'number' && Number.isFinite(yaw)) { forward.x = Math.sin(yaw); forward.z = Math.cos(yaw); }
      else {
        const mx = player.x - lastPlayer.x, mz = player.z - lastPlayer.z, moved = hyp(mx, mz);
        if (moved > .6 && moved < 30) { forward.x = forward.x * .7 + mx / moved * .3; forward.z = forward.z * .7 + mz / moved * .3;
          const n = hyp(forward.x, forward.z) || 1; forward.x /= n; forward.z /= n; }
        if (moved > .6) { lastPlayer.x = player.x; lastPlayer.z = player.z; }
      }
      // Recycle walkers left well behind the player so they respawn ahead (only once they're off-screen distances).
      for (const walker of walkers) if (walker.route && !walker.wasted) {
        const dx = walker.x - player.x, dz = walker.z - player.z, d = hyp(dx, dz);
        if (d > 40 && (dx * forward.x + dz * forward.z) / d < -.4) { delete walker.route; walker.avatar.root.visible = false; }
      }
    }
    // lowNearPeople: a rigged walker that drifts out of close range is released so it respawns near the camera.
    // crowdPanic: a rigged walker mid-flight keeps its body until it fades out (else it would pop out of sight at 22 m), but
    // only to 60 m: bolters fade by ~55 m from the shot, and a skinned body further out is wasted skinning + aim-ray cost.
    for (const walker of walkers) if (walker.route && (hyp(walker.x - player.x, walker.z - player.z) > (walker.rigged ? walker.panicRole ? 60 : 22 : 155) || !options.isLoaded(walker.x, walker.z))) {
      delete walker.route; walker.avatar.root.visible = false;
      if (walker.wasted) { walker.wasted = 0; clearWastedPose(walker.avatar.root, walker.y); } // culled mid-fall: un-tilt before reuse
    }
    if (PANIC && flags.combat) { // crowdPanic: track shot/robbery spots near the player (one lookup a frame)
      const shot = gunfireThreat(player.x, player.z, 160, nowMs);
      if (shot) {
        const known = alarms.find(a => hyp(a.x - shot.x, a.z - shot.z) < 12);
        if (known) known.until = elapsed + PANIC_S; else alarms.push({ x: shot.x, z: shot.z, until: elapsed + PANIC_S });
      }
      for (let i = alarms.length - 1; i >= 0; i--) if (alarms[i]!.until <= elapsed) alarms.splice(i, 1);
      stats.alarms = alarms.length;
    }
    if (elapsed >= nextRefresh) { nextRefresh = elapsed + .25; refill(player); }
    // Ragdoll-lite: a shot that lands on a ped wastes the nearest one (it topples + lies, then recycles). [ragdollAudio]
    if (flags.combat && flags.ragdollAudio) {
      for (const impact of consumeImpacts(nowMs)) {
        let victim: Walker | undefined, bestSq = KILL_RADIUS * KILL_RADIUS;
        for (const w of walkers) {
          if (!w.route || w.wasted || !w.avatar.root.visible) continue;
          const d = (w.x - impact.x) ** 2 + (w.z - impact.z) ** 2;
          if (d <= bestSq) { bestSq = d; victim = w; }
        }
        if (victim && impact.melee && flags.pedMelee) {
          // Takedown: knocked out, not killed — confessed as an assault; it gets back up after KNOCKOUT_GETUP_S.
          victim.wasted = elapsed; victim.scared = 0; victim.knockout = true; victim.leaving = Boolean(victim.fighter || victim.leaving); victim.fighter = 0; reportPedWasted(3); // a floored fighter walks off once up
          // Sometimes a bystander squares up to the player.
          if (Math.random() < FIGHT_BACK_CHANCE) {
            let fighter: Walker | undefined, fighterSq = FIGHT_BACK_RADIUS_M * FIGHT_BACK_RADIUS_M;
            for (const w of walkers) {
              if (w === victim || !w.route || w.wasted || w.fighter || !w.avatar.root.visible) continue;
              const d = (w.x - player.x) ** 2 + (w.z - player.z) ** 2;
              if (d <= fighterSq) { fighterSq = d; fighter = w; }
            }
            if (fighter) { fighter.fighter = elapsed + FIGHTER_GIVE_UP_S; fighter.swingAt = elapsed + .6; fighter.scared = 0; fighter.pause = 0; }
          }
        } else if (victim) { victim.wasted = elapsed; victim.scared = 0; victim.knockout = false; victim.fighter = 0; reportPedWasted(0); }
        // meshyDeathClips: bystanders a shot lands near flinch (Meshy 'Hit Reaction') before they run.
        if (flags.meshyDeathClips && !impact.melee) for (const w of walkers) {
          if (w === victim || !w.route || w.wasted || w.flinch || !w.avatar.root.visible) continue;
          if ((w.x - impact.x) ** 2 + (w.z - impact.z) ** 2 <= FLINCH_RADIUS * FLINCH_RADIUS) w.flinch = elapsed;
        }
      }
      // Run-over (flag streetCrimeWanted): the local player's car hitting a ped at speed knocks it down (same
      // topple) and confesses a ped kill. Below RUN_OVER_MIN_MPS a car just nudges through, like before.
      const car = flags.streetCrimeWanted ? localVehicle() : null;
      if (car && Math.abs(car.speed) >= RUN_OVER_MIN_MPS) {
        for (const w of walkers) {
          if (!w.route || w.wasted || !w.avatar.root.visible) continue;
          if ((w.x - car.x) ** 2 + (w.z - car.z) ** 2 > RUN_OVER_RADIUS * RUN_OVER_RADIUS) continue;
          w.wasted = elapsed; w.scared = 0; reportPedWasted(1);
        }
      }
    }
    stats.visible = 0; stats.walking = 0; stats.fighters = 0; stats.panicking = 0;
    if (promenadeSpans.size) { stats.promenade = 0; for (const w of walkers) if (w.route && promenadeSpans.has(w.route.id >> 1)) stats.promenade++; }
    for (const walker of walkers) {
      const route = walker.route; if (!route) continue;
      if (walker.wasted) { // downed: topple + freeze, then recycle into a fresh walker after lying a while
        const since = elapsed - walker.wasted;
        if (walker.knockout && since >= KNOCKOUT_GETUP_S) { // knocked out: gets back up and walks off (back on its route)
          walker.wasted = 0; walker.knockout = false; clearWastedPose(walker.avatar.root, walker.y);
        } else if (since >= WASTED_LIE_S) { walker.wasted = 0; walker.fighter = 0; walker.leaving = false; clearWastedPose(walker.avatar.root, walker.y); delete walker.route; walker.avatar.root.visible = false; continue; }
        walker.avatar.root.position.set(walker.x, walker.y, walker.z); walker.avatar.root.rotation.y = walker.yaw;
        if (walker.wasted) {
          // meshyDeathClips: Meshy bodies play a real fall (forward or backward by slot) instead of the plank topple.
          applyDeathPose(walker.avatar, walker.y, since, walker.slot % 2 ? 'dieforward' : 'diebackward');
          if (walker.avatar.root.visible) stats.visible++;
          continue;
        }
      }
      if (walker.flinch) { // meshyDeathClips: hold the hit flinch in place, then carry on (the gunfire threat makes them flee)
        const t = elapsed - walker.flinch;
        if (t < FLINCH_S && walker.avatar.pose?.('hit', t)) {
          walker.avatar.root.position.set(walker.x, walker.y, walker.z); walker.avatar.root.rotation.y = walker.yaw;
          if (walker.avatar.root.visible) stats.visible++;
          continue;
        }
        walker.flinch = 0;
      }
      // pedMelee fight-back: chase the player off-route and swing; then walk away and recycle out of sight.
      if (flags.pedMelee && (walker.fighter || walker.leaving)) {
        if (walker.fighter) stats.fighters++;
        const toX = player.x - walker.x, toZ = player.z - walker.z, dist = hyp(toX, toZ);
        if (walker.fighter && (elapsed >= walker.fighter || localVehicle())) { walker.fighter = 0; walker.leaving = true; } // gave up / player drove off
        let clip: 'run' | 'walk' | 'idle' = 'idle', step = 0;
        if (walker.fighter) {
          walker.yaw += angle(Math.atan2(toX, toZ) - walker.yaw) * (1 - Math.exp(-10 * dt));
          if (dist > PED_SWING_RANGE_M * .8) { clip = 'run'; step = Math.min(FIGHTER_PACE * dt, dist - PED_SWING_RANGE_M * .8); }
          else if (elapsed >= (walker.swingAt ?? 0)) { // in reach: swing (a quick lunge); a connect is server-applied
            walker.swingAt = elapsed + PED_PUNCH_INTERVAL_MS / 1000 + .3;
            walker.lunge = .25;
            reportPedPunch(); stats.swings++;
          }
        } else { // leaving: walk straight away from the player, recycle once well clear
          walker.yaw += angle(Math.atan2(-toX, -toZ) - walker.yaw) * (1 - Math.exp(-6 * dt));
          clip = 'walk'; step = walker.pace * dt;
          if (dist > FIGHTER_LEAVE_M) { walker.leaving = false; delete walker.route; walker.avatar.root.visible = false; continue; }
        }
        if (step > 0) {
          const nx = walker.x + Math.sin(walker.yaw) * step, nz = walker.z + Math.cos(walker.yaw) * step;
          if (options.ground.collidesCircle?.(nx, nz, .35)) { // a wall: give up the fight if it stays stuck
            walker.blocked += dt;
            if (walker.blocked > 1.5 && walker.fighter) { walker.fighter = 0; walker.leaving = true; walker.blocked = 0; }
          } else {
            walker.blocked = 0; walker.x = nx; walker.z = nz;
            const gy = options.ground.heightAt(nx, nz); // sidewalk, plaza or road
            if (gy !== null && Number.isFinite(gy) && Math.abs(gy - walker.y) < 1.5) walker.y = gy;
          }
        }
        const lunge = walker.lunge ? Math.sin((1 - walker.lunge / .25) * Math.PI) * .35 : 0; // forward lean of the swing
        if (walker.lunge) walker.lunge = Math.max(0, walker.lunge - dt);
        walker.avatar.root.position.set(walker.x + Math.sin(walker.yaw) * lunge * .4, walker.y, walker.z + Math.cos(walker.yaw) * lunge * .4);
        walker.avatar.root.rotation.set(lunge, walker.yaw, 0);
        walker.avatar.update(clip === 'run' ? dt * 1.2 : dt, clip, 1);
        if (walker.avatar.root.visible) { stats.visible++; if (step > 0) stats.walking++; }
        continue;
      }
      if (PANIC && flags.combat) {
        const alarm = alarmNear(walker.x, walker.z);
        if (alarm && !walker.panicRole) { // onset: scream, then bolt; some rigged walkers cower or call it in instead
          pedScream(walker.x, walker.z, player);
          const skeletal = typeof walker.avatar.pose === 'function';
          walker.panicRole = skeletal && walker.slot % 4 === 1 ? COWER : skeletal && walker.slot % 10 === 3 ? CALLER : BOLT;
          walker.fleeX = alarm.x; walker.fleeZ = alarm.z; walker.pause = 0; walker.blocked = 0; walker.flinch = 0;
        }
        if (alarm) walker.scared = alarm.until;
        // Calmed: back to the stroll, if still on its route (a bolter cornered into a crouch stays down until recycled).
        if (walker.panicRole && walker.panicRole !== BOLT && walker.scared <= elapsed &&
          hyp(walker.x - (route.a.x + (route.b.x - route.a.x) * walker.t), walker.z - (route.a.z + (route.b.z - route.a.z) * walker.t)) < 1) walker.panicRole = 0;
        if (walker.panicRole) {
          stats.panicking++;
          const awayX = walker.x - walker.fleeX, awayZ = walker.z - walker.fleeZ, fromAlarm = hyp(awayX, awayZ), away = Math.atan2(awayX, awayZ);
          let moving = false, posed = false;
          if (walker.panicRole === BOLT) { // away from it, sliding round walls; recycled once out past the fade
            // Scatter ~35 deg either side of straight-away (alternating): straight away from a gunman is straight DOWNRANGE, so
            // walkers ran along the line of fire, got shot and escalated the night firefight gate to 5 stars + SWAT (2 of 7 runs).
            walker.yaw += angle(away + (walker.slot % 2 ? .6 : -.6) - walker.yaw) * (1 - Math.exp(-10 * dt));
            // Ground probes (wall + height) at 5 Hz per bolter, staggered, ~1.2 m ahead; dead reckoning between. Per-frame
            // probes for every bolter cost ~2.6 fps in the night firefight ABBA (route walkers read precomputed heights).
            if (elapsed >= (walker.probeAt ?? 0)) {
              walker.probeAt = elapsed + .2 + (walker.slot % 5) * .01;
              const ahead = FLEE_PACE * .26; let found: number | null = null;
              for (const turn of [0, .8, -.8, 1.6, -1.6]) {
                const nx = walker.x + Math.sin(walker.yaw + turn) * ahead, nz = walker.z + Math.cos(walker.yaw + turn) * ahead;
                if (options.ground.collidesCircle?.(nx, nz, .35)) continue;
                const gy = options.ground.heightAt(nx, nz);
                if (gy === null || !Number.isFinite(gy) || Math.abs(gy - walker.y) > 1.5) continue;
                found = turn; walker.y = gy; break;
              }
              walker.steer = found ?? NaN;
              if (found !== null) walker.blocked = 0;
              else if ((walker.blocked += .2) > 1) walker.panicRole = COWER; // cornered: crouch where it stands
            }
            if (walker.panicRole === BOLT && Number.isFinite(walker.steer)) {
              walker.x += Math.sin(walker.yaw + walker.steer!) * FLEE_PACE * dt; walker.z += Math.cos(walker.yaw + walker.steer!) * FLEE_PACE * dt; moving = true;
            }
            if (fromAlarm > FLEE_FADE_M) { walker.panicRole = 0; delete walker.route; walker.avatar.root.visible = false; continue; }
          } else { // cower facing away, or face it with the phone up
            const want = walker.panicRole === CALLER ? away + Math.PI : away;
            walker.yaw += angle(want - walker.yaw) * (1 - Math.exp(-6 * dt));
          }
          walker.avatar.root.position.set(walker.x, walker.y, walker.z); walker.avatar.root.rotation.y = walker.yaw;
          const distance = hyp(walker.x - player.x, walker.z - player.z);
          const opacity = Math.max(0, Math.min(1, walker.age, (155 - distance) / 25, walker.panicRole === BOLT ? (FLEE_FADE_M - fromAlarm) / 10 : 1));
          if (walker.panicRole === COWER || walker.panicRole === CALLER)
            posed = Boolean(walker.avatar.pose?.(walker.panicRole === COWER ? 'cower' : 'phonecall', elapsed + walker.slot * .37, opacity, true));
          // A sprint: rigged bodies run; the VAT crowd has no run, so its walk cycle plays fast.
          if (!posed) walker.avatar.update(moving ? (typeof walker.avatar.pose === 'function' ? dt * 1.1 : dt * .7) : dt,
            moving ? (typeof walker.avatar.pose === 'function' ? 'run' : 'walk') : 'idle', opacity);
          if (walker.avatar.root.visible) { stats.visible++; if (moving) stats.walking++; }
          continue;
        }
      }
      if (elapsed >= walker.checkAt) {
        walker.checkAt = elapsed + .6;
        if (safe(walker.x, walker.z) === null) { delete walker.route; walker.avatar.root.visible = false; continue; }
      }
      const dx = route.b.x - route.a.x, dz = route.b.z - route.a.z, length = hyp(dx, dz);
      // Combat reaction: on nearby gunfire, panic for a few seconds — run toward the route end farther from the
      // shot, then cower there. Flag-gated so this is byte-inert (and zero gunfire events) when combat is off.
      let panicking = false;
      if (flags.combat && !PANIC) {
        const threat = gunfireThreat(walker.x, walker.z, FLEE_RADIUS, nowMs);
        if (threat) {
          if (walker.scared <= elapsed) pedScream(walker.x, walker.z, player); // panic onset (critique #8, sampledAudio)
          walker.scared = elapsed + PANIC_S; walker.fleeX = threat.x; walker.fleeZ = threat.z;
        }
        panicking = walker.scared > elapsed;
        if (panicking) {
          walker.pause = 0; // panic overrides a stroll pause
          walker.direction = hyp(route.b.x - walker.fleeX, route.b.z - walker.fleeZ) > hyp(route.a.x - walker.fleeX, route.a.z - walker.fleeZ) ? 1 : -1;
        }
      }
      const pace = panicking ? FLEE_PACE : walker.pace;
      const desired = Math.atan2(dx * walker.direction, dz * walker.direction);
      walker.yaw += angle(desired - walker.yaw) * (1 - Math.exp(-(panicking ? 10 : 6) * dt));
      walker.pause = Math.max(0, walker.pause - dt); walker.age += dt;
      let moving = false;
      if (walker.pause === 0 && Math.abs(angle(desired - walker.yaw)) < .2) {
        const t = Math.min(1, Math.max(0, walker.t + walker.direction * pace * (walker.habit === 1 ? .82 : 1) * dt / length)); // texting walkers dawdle
        const x = route.a.x + dx * t, z = route.a.z + dz * t, nextY = heightOn(route, t);
        const crowded = hyp(x - player.x, z - player.z) < 1.4 || walkers.some(other => other !== walker && other.route && (other.wasted ? nearBody(other, x, z) : hyp(x - other.x, z - other.z) < .85));
        if (!crowded) {
          walker.blocked = 0;
          walker.t = t; walker.x = x; walker.z = z; walker.y = nextY; moving = true;
          if (t === 0 || t === 1) {
            if (panicking) moving = false; // reached the safe end: cower, don't turn back toward the shot
            else { walker.direction *= -1; walker.pause = (walker.habit === 2 || walker.habit === 3 ? 6 : .8) + route.id % 4 * .25; }
          }
        } else { walker.blocked += dt; if (walker.blocked > 1.2) { walker.direction *= -1; walker.pause = .5; walker.blocked = 0; } }
      }
      walker.avatar.root.position.set(walker.x, walker.y, walker.z); walker.avatar.root.rotation.y = walker.yaw;
      const distance = hyp(walker.x - player.x, walker.z - player.z), opacity = Math.min(1, walker.age, Math.max(0, (155 - distance) / 25));
      // pedIdleVariety: habit clips (shared meshy-clips.glb, looped) on bodies that have them; VAT/CC0 fall back to walk/idle.
      const habitClip = walker.habit === 1 && moving ? 'phonewalk' : walker.habit === 2 && !moving ? 'phonecall' : walker.habit === 3 && !moving ? 'lookaround' : null;
      if (!(habitClip && walker.avatar.pose?.(habitClip, elapsed + walker.slot * .37, opacity, true)))
        walker.avatar.update(moving ? dt * pace / 3 : dt, moving ? 'walk' : 'idle', opacity);
      if (walker.avatar.root.visible) stats.visible++; if (moving) stats.walking++;
    }
    population.flush();
  },
  /** Live (visible, standing) walker positions in world metres (testing harness + aimControls aim assist). */
  positions() { return walkers.filter(w => w.route && !w.wasted && w.avatar.root.visible).map(w => ({ x: w.x, y: w.y, z: w.z })); },
  /** testingHarness only (death-clip evidence captures): waste the visible walker nearest (x, z), as a shot would. */
  wasteNearest(x: number, z: number): boolean {
    if (!flags.testingHarness) return false;
    let victim: Walker | undefined, best = Infinity;
    for (const w of walkers) { if (!w.route || w.wasted || !w.avatar.root.visible) continue; const d = (w.x - x) ** 2 + (w.z - z) ** 2; if (d < best) { best = d; victim = w; } }
    if (!victim) return false;
    victim.wasted = elapsed; victim.scared = 0; victim.knockout = false; victim.fighter = 0;
    return true;
  },
  dispose() { if (disposed) return; disposed = true; population.dispose(); } };
}
