/**
 * GTA V pivot — LANE B (combat): desktop aim assist (flag aimControls).
 *
 * Founder playtest 2026-10-17: "very hard to aim and shoot on keyboard". GTA-style help, all client-side and visual —
 * the server still re-resolves every hit from its own poses + the aim direction it is sent:
 *   - bullet magnetism: a shot whose crosshair ray passes within a small cone of a ped / cop / player bends onto that
 *     target's chest (a wider cone for keyboard-only fire, when the mouse isn't captured);
 *   - hard lock (Z): lock the target nearest the crosshair, Z again cycles left-to-right; the camera tracks it;
 *   - soft lock (right mouse press): snaps onto a target near the crosshair and holds until the mouse moves away.
 *
 * The pure math below is unit-tested (aimAssist.test.ts); createAimAssist is the runtime that fire.ts drives.
 */
import { flags } from '@gtasf/shared/flags';

export interface Vec3 { x: number; y: number; z: number }
export type AimTargetKind = 'ped' | 'cop' | 'player';
/** A candidate aim point in world metres, at chest height. */
export interface AimTarget extends Vec3 { kind: AimTargetKind }
export interface ConeOptions {
  /** Half-angle (radians) of the assist cone, measured to the edge of the target's body. */
  coneRad: number;
  rangeM: number;
  /** Closer than this is ignored (the player's own body / point-blank). */
  minDistM?: number;
  /** Body radius used to widen the cone for near targets. */
  bodyRadiusM?: number;
}

/** Bullet magnetism: mouse aim gets a small cone; keyboard-only fire (no mouse capture) a generous one. */
export const MOUSE_CONE_RAD = 3 * Math.PI / 180;
export const KEYBOARD_CONE_RAD = 9 * Math.PI / 180;
/** Soft lock on aim start (RMB press) and hard-lock acquisition (Z). */
export const SOFT_LOCK_CONE_RAD = 8 * Math.PI / 180;
export const HARD_LOCK_CONE_RAD = 30 * Math.PI / 180;
/** Mouse travel (px, accumulated) that breaks a soft lock / a hard lock: flick away to free-aim again. */
export const SOFT_BREAK_PX = 30;
export const HARD_BREAK_PX = 140;
const BODY_RADIUS_M = 0.45, MIN_DIST_M = 1.5;

/** Angle (radians) between unit `dir` from `eye` and the target, plus the distance; null when behind / degenerate. */
export function angleTo(eye: Vec3, dir: Vec3, t: Vec3): { angle: number; dist: number } | null {
  const dx = t.x - eye.x, dy = t.y - eye.y, dz = t.z - eye.z, dist = Math.hypot(dx, dy, dz);
  if (!(dist > 1e-6)) return null;
  const cos = (dx * dir.x + dy * dir.y + dz * dir.z) / dist;
  if (cos <= 0) return null;
  return { angle: Math.acos(Math.min(1, cos)), dist };
}

/** Indices of the targets inside the cone, best first (smallest angle past the body edge, nearer breaking ties). */
export function rankTargets(eye: Vec3, dir: Vec3, targets: readonly Vec3[], o: ConeOptions): number[] {
  const scored: { i: number; s: number }[] = [];
  const minDist = o.minDistM ?? MIN_DIST_M, body = o.bodyRadiusM ?? BODY_RADIUS_M;
  for (let i = 0; i < targets.length; i++) {
    const a = angleTo(eye, dir, targets[i]!);
    if (!a || a.dist < minDist || a.dist > o.rangeM) continue;
    const edge = Math.max(0, a.angle - Math.atan(body / a.dist)); // 0 = the crosshair is already on the body
    if (edge > o.coneRad) continue;
    scored.push({ i, s: edge + a.dist * 0.0005 });
  }
  return scored.sort((p, q) => p.s - q.s).map(p => p.i);
}

/** The single best target in the cone, or -1. */
export function pickTarget(eye: Vec3, dir: Vec3, targets: readonly Vec3[], o: ConeOptions): number {
  return rankTargets(eye, dir, targets, o)[0] ?? -1;
}

/** Signed horizontal angle of `t` relative to `dir` as seen from `eye` (positive = to the screen-right). */
export function sideAngle(eye: Vec3, dir: Vec3, t: Vec3): number {
  const a = Math.atan2(dir.x, dir.z), b = Math.atan2(t.x - eye.x, t.z - eye.z);
  // Screen-right of a view along +z (yaw 0) is -x in this frame (+x east, -z north, camera looks along dir).
  return -Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

/**
 * Z cycling: the in-range, in-cone target immediately to the right of `current` (wrapping to the leftmost).
 * `current` -1 = none yet (returns the best-ranked). Returns -1 when there's nothing else to lock.
 */
export function cycleTarget(eye: Vec3, dir: Vec3, targets: readonly Vec3[], current: number, o: ConeOptions): number {
  const ranked = rankTargets(eye, dir, targets, o);
  if (current < 0 || !targets[current]) return ranked[0] ?? -1;
  const from = sideAngle(eye, dir, targets[current]!);
  let next = -1, nextSide = Infinity, wrap = -1, wrapSide = Infinity;
  for (const i of ranked) {
    if (i === current) continue;
    const s = sideAngle(eye, dir, targets[i]!);
    if (s > from && s < nextSide) { next = i; nextSide = s; }
    if (s < wrapSide) { wrap = i; wrapSide = s; }
  }
  return next >= 0 ? next : wrap;
}

/** Re-find a tracked target this frame: the candidate nearest its last position, within `maxJumpM`. */
export function track(last: Vec3, targets: readonly Vec3[], maxJumpM: number): number {
  let best = -1, bestSq = maxJumpM * maxJumpM;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]!, d = (t.x - last.x) ** 2 + (t.y - last.y) ** 2 + (t.z - last.z) ** 2;
    if (d <= bestSq) { bestSq = d; best = i; }
  }
  return best;
}

/** Unit direction from `from` to `to` into `out` (returns false when they coincide). */
export function directionTo(from: Vec3, to: Vec3, out: Vec3): boolean {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, len = Math.hypot(dx, dy, dz);
  if (!(len > 1e-6)) return false;
  out.x = dx / len; out.y = dy / len; out.z = dz / len;
  return true;
}

export interface AimAssistDeps {
  /** Fill `out` with this frame's candidate targets (chest-height world points). */
  targets(out: AimTarget[]): void;
  /** Ease the camera so its crosshair converges on a world point (third-person orbit). */
  aimAt(x: number, y: number, z: number): void;
  /** Camera eye + unit forward this frame, written into the given vectors. */
  view(eye: Vec3, dir: Vec3): void;
  /** Current weapon range (m), or 0 when the equipped weapon can't be assisted (melee / unarmed). */
  rangeM(): number;
  /** True when a target is visible from the eye (one ray); used when acquiring a lock. */
  visible(eye: Vec3, t: Vec3): boolean;
  /** Assist is allowed this instant (armed, alive, on foot / drive-by, no modal). */
  canAim(): boolean;
}

export interface AimAssist {
  /** The locked target (hard or soft), or null. */
  readonly locked: Readonly<AimTarget> | null;
  readonly hard: boolean;
  /** Z: lock the nearest visible target, or cycle to the next one; releases when there's no other. */
  cycle(): void;
  /** RMB press: soft-lock a target near the crosshair, if any. */
  softAcquire(): void;
  /** RMB release / weapon change: drop a soft lock. */
  softRelease(): void;
  release(): void;
  /** Accumulated mouse look (pixels) since the last frame: breaks a lock past its threshold. */
  mouseMoved(px: number): void;
  /**
   * Where a shot should go: the locked target, else a target in the magnetism cone around `dir`, else null.
   * `captured` = the mouse is aiming (pointer lock); otherwise keyboard-only fire gets the wider cone.
   */
  shotTarget(eye: Vec3, dir: Vec3, captured: boolean): Readonly<AimTarget> | null;
  /** Is a target under the magnetism cone right now (red crosshair)? */
  onTarget(captured: boolean): boolean;
  update(dt: number): void;
}

export function createAimAssist(deps: AimAssistDeps): AimAssist {
  const list: AimTarget[] = [];
  const eye: Vec3 = { x: 0, y: 0, z: 0 }, dir: Vec3 = { x: 0, y: 0, z: 1 };
  let locked: AimTarget | null = null, hard = false, moved = 0, listAge = Infinity;

  function refresh(): void { list.length = 0; deps.targets(list); listAge = 0; }
  function cone(coneRad: number): ConeOptions { return { coneRad, rangeM: deps.rangeM() }; }
  function lockFirstVisible(order: number[]): boolean {
    for (const i of order.slice(0, 4)) { // at most 4 LOS rays per acquisition
      const t = list[i]!;
      if (deps.visible(eye, t)) { locked = { ...t }; moved = 0; return true; }
    }
    return false;
  }

  return {
    get locked() { return locked; },
    get hard() { return hard && locked !== null; },
    cycle() {
      if (!deps.canAim() || deps.rangeM() <= 0) return;
      refresh(); deps.view(eye, dir);
      const opts = cone(HARD_LOCK_CONE_RAD);
      const current = locked ? track(locked, list, 2) : -1;
      if (current < 0) { hard = lockFirstVisible(rankTargets(eye, dir, list, opts)); if (!hard) locked = null; return; }
      const next = cycleTarget(eye, dir, list, current, opts);
      if (next < 0 || next === current || !deps.visible(eye, list[next]!)) { locked = null; hard = false; return; } // nothing else: Z releases
      locked = { ...list[next]! }; hard = true; moved = 0;
    },
    softAcquire() {
      if (hard || !deps.canAim() || deps.rangeM() <= 0) return;
      refresh(); deps.view(eye, dir);
      if (!lockFirstVisible(rankTargets(eye, dir, list, cone(SOFT_LOCK_CONE_RAD)))) locked = null;
      hard = false;
    },
    softRelease() { if (!hard) locked = null; },
    release() { locked = null; hard = false; },
    mouseMoved(px: number) {
      if (!locked || !(px > 0)) return;
      moved += px;
      if (moved > (hard ? HARD_BREAK_PX : SOFT_BREAK_PX)) { locked = null; hard = false; }
    },
    shotTarget(e: Vec3, d: Vec3, captured: boolean) {
      if (locked) return locked;
      if (deps.rangeM() <= 0) return null;
      if (listAge > 0.1) refresh();
      const i = pickTarget(e, d, list, cone(captured ? MOUSE_CONE_RAD : KEYBOARD_CONE_RAD));
      return i >= 0 ? list[i]! : null;
    },
    onTarget(captured: boolean) {
      if (locked) return true;
      if (deps.rangeM() <= 0) return false;
      if (listAge > 0.1) refresh();
      deps.view(eye, dir);
      return pickTarget(eye, dir, list, cone(captured ? MOUSE_CONE_RAD : KEYBOARD_CONE_RAD)) >= 0;
    },
    update(dt: number) {
      listAge += dt;
      if (!flags.aimControls || !locked) return;
      if (!deps.canAim() || deps.rangeM() <= 0) { locked = null; hard = false; return; }
      if (listAge > 0.05) refresh();
      // Follow the same body frame to frame (targets carry no ids): a walker moves < 2 m between refreshes.
      const i = track(locked, list, 2);
      deps.view(eye, dir);
      const t = i >= 0 ? list[i]! : null;
      const a = t ? angleTo(eye, dir, t) : null;
      if (!t || !a || a.dist > deps.rangeM()) { locked = null; hard = false; return; } // wasted / gone / out of range
      locked.x = t.x; locked.y = t.y; locked.z = t.z; locked.kind = t.kind;
      deps.aimAt(t.x, t.y, t.z);
      moved = Math.max(0, moved - dt * 60); // slow drift doesn't add up to a break
    },
  };
}
