/**
 * GTA V pivot — LANE B (combat & police), step 2: aiming reticle + firing.
 *
 * Desktop aims with the camera (pointer lock + drag — the existing look controls) and fires with the left
 * mouse button; phone fires with an on-screen button (twin-stick: left stick moves; with flags.twinStick the FIRE
 * button is a right stick — hold to fire, drag it to aim). A shot raycasts from the camera through the crosshair against the rendered
 * scene (same approach as the paintball mayhem system) to find the impact, clamps to the weapon's range, and
 * draws a short-lived tracer + muzzle flash. Damage is NOT applied here — step 3 adds the server-validated
 * FIRE/HIT. `onShot` lets lane A replace the placeholder tracer/flash with real combat visuals.
 *
 * Weapon STATE (fire rate, ammo, reload) lives in createCombat; this module calls tryFire(now), which gates
 * and spends, and only draws/emits when it returns true.
 */
import * as THREE from 'three';
import { flags } from '@gtasf/shared/flags';
import type { WeaponSpec } from '@gtasf/shared/combat/weapons';
import { playGunshot } from './gunshot';
import { gridFor, gridStats, HEAVY_TRIANGLES, raycastGrid, triangleCount } from './rayGrid';
import { reportGunfire, reportImpact } from './alerts';
import { createAimAssist, type AimAssist, type AimTarget } from './aimAssist';
import { mouseAimReady, pointerLocked, setAimCapture } from '../input/aimCapture';

export interface ShotEvent {
  from: [number, number, number];
  to: [number, number, number];
  weapon: WeaponSpec;
  /** True when the ray struck a surface (vs. reaching max range). */
  hit: boolean;
  normal?: [number, number, number];
}

export interface FireDeps {
  scene: THREE.Scene;
  camera: THREE.Camera;
  canvas: HTMLElement;
  parent?: HTMLElement;
  /** The equipped weapon, or null when combat isn't ready to aim/fire. */
  currentSpec(): WeaponSpec | null;
  /** twinStick: turn the camera by a drag on the phone FIRE stick (pixels, like the look action). */
  aimLook?(dx: number, dy: number): void;
  /** Gate (rate + ammo + reload) and spend a round; true if a shot fires this instant. */
  tryFire(now: number): boolean;
  /** Show the crosshair (armed, on foot, alive, no modal open). */
  canAim(): boolean;
  /** Muzzle/gun origin in world space (tracer start). Written into `out` and returned. */
  muzzleOrigin(out: THREE.Vector3): THREE.Vector3;
  /** driveBy: an object (the player's own car) the aim ray passes through rather than hits. */
  ignoreRoot?(): THREE.Object3D | undefined;
  /** aimSkinnedCapsule: the local player's own avatar, never an aim target (the third-person ray passes over its shoulder). */
  selfRoot?(): THREE.Object3D | undefined;
  /** Lane A hook: real muzzle flash / tracer / blood. */
  onShot?(shot: ShotEvent): void;
  /** Report the shot's aim direction to the server (COMBAT_FIRE) when server hits are on. */
  sendFire?(dir: [number, number, number]): void;
  /** aimControls: this frame's aim-assist candidates (peds, cops, players) at chest height. */
  aimTargets?(out: AimTarget[]): void;
  /** aimControls lock-on: ease the camera so the crosshair converges on a world point. */
  aimAt?(x: number, y: number, z: number): void;
}

export interface FireSystem {
  readonly crosshair: HTMLElement;
  readonly fireButton: HTMLButtonElement;
  update(dt: number): void;
  /** Phone button / test hook. */
  triggerDown(): void;
  triggerUp(): void;
  /** aimControls: a target is locked (Z / RMB soft lock) — main.ts holds the aim pose + shoulder camera. */
  readonly aimLocked: boolean;
  destroy(): void;
}

interface Tracer { line: THREE.Line; pos: THREE.BufferAttribute; life: number }

const TRACER_LIFE = 0.08; // seconds — a brief streak (placeholder for lane A's tracers)
const MELEE_REACH_M = 1.1; // pedMelee: where a fists/bat swing lands in front of the player
const TRACER_POOL_MAX = 32; // reuse Line objects instead of allocating a BufferGeometry per shot (GC churn)
const MUZZLE_FLASH_LIFE = 0.05;
// The client raycast is only for the VISUAL impact point (tracer end + impact VFX) — the server owns the
// authoritative hit. So the set of shootable meshes can be collected once and reused for a short window instead
// of walking the WHOLE scene graph on every shot: at the dense ferry an automatic weapon otherwise runs a full
// scene.traverseVisible + intersectObjects per shot, which dominates firefight frame time (gtasf-u9id).
const TARGETS_TTL_MS = 250; // rebuild the shootable-mesh list at most ~4x/sec, not per shot
// The per-shot scene raycast (a high-poly building/ground triangle test) is the firefight p95 spike, and an
// automatic weapon fires ~11x/s. Holding aim hits the SAME world point, so reuse the last impact while the aim
// stays within ~CAST_REUSE_DOT and the cache is younger than CAST_RESULT_TTL_MS. The server re-resolves every
// shot from the live aim, so only the VISUAL tracer/impact + the ped-waste point are ever reused.
const CAST_REUSE_DOT = 0.99985;   // ~1° of aim change forces a fresh cast
const CAST_RESULT_TTL_MS = 700;   // and refresh at least ~1.4x/s so moving targets/scene stay roughly current

export function createFireSystem(deps: FireDeps): FireSystem {
  const parent = deps.parent ?? document.body;

  const crosshair = document.createElement('div');
  crosshair.className = 'gt-combat-crosshair';
  crosshair.hidden = true;
  const fireButton = document.createElement('button');
  fireButton.type = 'button';
  fireButton.className = 'gt-combat-fire-btn';
  // twinStick (founder decision, phone): the FIRE button is a right stick — hold to fire, drag it to aim (the camera
  // turns with the thumb), so a phone player moves with the left stick and aims + shoots with the right one.
  const stick = flags.twinStick && !!deps.aimLook;
  const fireLabel = document.createElement('span'); fireLabel.className = 'gt-combat-fire-label'; fireLabel.textContent = 'FIRE';
  fireButton.append(fireLabel);
  if (stick) { fireButton.classList.add('gt-combat-fire-stick'); fireButton.setAttribute('aria-label', 'Fire — drag to aim'); }
  fireButton.hidden = true;
  parent.append(crosshair, fireButton);
  // aimControls: a bracket over the locked target (screen-projected each frame).
  const lockMark = document.createElement('div');
  lockMark.className = 'gt-combat-lock'; lockMark.hidden = true; lockMark.setAttribute('aria-hidden', 'true');
  if (flags.aimControls) parent.append(lockMark);

  const raycaster = new THREE.Raycaster();
  raycaster.params.Line = { threshold: 0 };
  raycaster.params.Points = { threshold: 0 };
  const centre = new THREE.Vector2(0, 0);
  const muzzle = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const targets: THREE.Object3D[] = [];
  let targetsBuiltMs = 0; // performance.now() of the last traversal; 0 = never built
  // Steady-aim cast cache (see CAST_* above).
  const camDir = new THREE.Vector3(), lastCamDir = new THREE.Vector3(), lastPoint = new THREE.Vector3(), lastNormalVec = new THREE.Vector3();
  let lastHit = false, lastNormalValid = false, haveLastCast = false, lastCastMs = 0;
  const fireable = (o: THREE.Object3D) => (o as THREE.Mesh).isMesh === true && !(o as { isLineSegments2?: boolean }).isLineSegments2 && o.visible;

  /** Rebuild the shootable-mesh list from the scene, but at most every TARGETS_TTL_MS (reused between shots). */
  function refreshTargets(now: number): void {
    if (targetsBuiltMs !== 0 && now - targetsBuiltMs < TARGETS_TTL_MS) return;
    targets.length = 0;
    deps.scene.traverseVisible(o => { if (fireable(o)) targets.push(o); });
    targetsBuiltMs = now;
    // aimRayGrid: queue grids for the heavy meshes near the player now, so the first shots near a landmark don't pay for it.
    if (flags.aimRayGrid) {
      deps.camera.getWorldPosition(eye);
      for (const o of targets) if (gridCandidate(o)) {
        const g = (o as THREE.Mesh).geometry; g.boundingSphere ?? g.computeBoundingSphere();
        sphere.copy(g.boundingSphere!).applyMatrix4(o.matrixWorld);
        if (sphere.distanceToPoint(eye) < GRID_PREWARM_M) gridFor(o as THREE.Mesh);
      }
    }
  }
  const eye = new THREE.Vector3(), sphere = new THREE.Sphere(), GRID_PREWARM_M = 150;
  if (flags.testingHarness && typeof window !== 'undefined') (window as unknown as { __gtasfRayGrid?: typeof gridStats }).__gtasfRayGrid = gridStats;
  const gridCandidate = (o: THREE.Object3D) => (o as THREE.Mesh).isMesh === true && !(o as THREE.InstancedMesh).isInstancedMesh
    && !(o as THREE.SkinnedMesh).isSkinnedMesh && triangleCount((o as THREE.Mesh).geometry) >= HEAVY_TRIANGLES;
  /** aimSkinnedCapsule (gtasf-zd91j): three's SkinnedMesh raycast CPU-skins every vertex per ray (applyBoneTransform), and
   *  avatarPoseBounds' generous 2.4 m sphere lets most aim rays near a character reach it: the aim-sweep firefight hitched
   *  to p95 ~130 ms. A character is hit-tested once as a vertical cylinder at its avatar root instead — the client hit is
   *  only the tracer/impact point; the server validates every hit. */
  const AVATAR_RADIUS_M = .35, AVATAR_HEIGHT_M = 1.8, avatarFeet = new THREE.Vector3(), cylinderHit = new THREE.Vector3();
  const avatarRootOf = (o: THREE.Object3D): THREE.Object3D => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.name === 'on-foot-avatar') return p; return o; };
  function hitAvatar(root: THREE.Object3D, mesh: THREE.Object3D, ray: THREE.Ray, out: THREE.Intersection[]): void {
    root.getWorldPosition(avatarFeet);
    const ox = ray.origin.x - avatarFeet.x, oz = ray.origin.z - avatarFeet.z, dx = ray.direction.x, dz = ray.direction.z;
    const a = dx * dx + dz * dz; if (a < 1e-8) return;
    const b = 2 * (ox * dx + oz * dz), c = ox * ox + oz * oz - AVATAR_RADIUS_M ** 2, disc = b * b - 4 * a * c;
    if (disc < 0) return;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    if (t <= 0 || t > raycaster.far) return;
    cylinderHit.copy(ray.origin).addScaledVector(ray.direction, t);
    if (cylinderHit.y < avatarFeet.y || cylinderHit.y > avatarFeet.y + AVATAR_HEIGHT_M) return;
    out.push({ distance: t, point: cylinderHit.clone(), object: mesh } as THREE.Intersection);
  }
  /** raycaster.intersectObjects(targets), but heavy static meshes go through their triangle grid once it's built. */
  function intersectTargets(): THREE.Intersection[] {
    if (!flags.aimRayGrid) return raycaster.intersectObjects(targets, false);
    const out: THREE.Intersection[] = [], ray = raycaster.ray;
    const self = flags.aimSkinnedCapsule ? deps.selfRoot?.() : undefined, avatarsDone = new Set<THREE.Object3D>();
    for (const o of targets) {
      if (flags.aimSkinnedCapsule && (o as THREE.SkinnedMesh).isSkinnedMesh) {
        const root = avatarRootOf(o);
        if (avatarsDone.has(root)) continue;
        avatarsDone.add(root);
        let mine = false; for (let p: THREE.Object3D | null = root; p && self; p = p.parent) if (p === self) { mine = true; break; }
        if (!mine) hitAvatar(root, o, ray, out);
        continue;
      }
      if (gridCandidate(o)) {
        const mesh = o as THREE.Mesh, g = mesh.geometry; g.boundingSphere ?? g.computeBoundingSphere();
        if (!ray.intersectsSphere(sphere.copy(g.boundingSphere!).applyMatrix4(mesh.matrixWorld))) continue;
        const grid = gridFor(mesh);
        if (grid) { const hit = raycastGrid(mesh, grid, ray.origin, ray.direction, raycaster.far); if (hit) out.push(hit); continue; }
      }
      raycaster.intersectObject(o, false, out);
    }
    return out.sort((x, y) => x.distance - y.distance);
  }

  const tracers: Tracer[] = []; // pool; grows lazily to TRACER_POOL_MAX, then reuses expired/oldest
  let tracerCursor = 0;
  const tracerMat = new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9, depthWrite: false });
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xfff2c0, transparent: true, opacity: 0, depthWrite: false }));
  flash.scale.setScalar(0.6);
  flash.visible = false;
  deps.scene.add(flash);
  let flashLife = 0;

  function castHit(spec: WeaponSpec): { point: THREE.Vector3; hit: boolean; normal?: THREE.Vector3 } {
    // gtasf-kd2rv: the render refreshes matrixWorld while shootingFeel's recoil is applied and only the quaternion is put
    // back afterwards, so without this the ray (and the reuse key below) carried last frame's kick: up to ~2°, past the 1°
    // reuse threshold, so every shot paid the full scene raycast (phone firefight p95 ~35 -> ~68 ms).
    deps.camera.updateMatrixWorld();
    raycaster.setFromCamera(centre, deps.camera);
    raycaster.far = spec.rangeM;
    // aimControls bullet magnetism / lock-on: bend the ray onto the target's chest before spread.
    const target = assist && !spec.melee ? assist.shotTarget(raycaster.ray.origin, raycaster.ray.direction, pointerLocked()) : null;
    let targetDist = 0;
    if (target) {
      targetDist = raycaster.ray.origin.distanceTo(assistPoint.set(target.x, target.y, target.z));
      raycaster.ray.direction.subVectors(assistPoint, raycaster.ray.origin).normalize();
    }
    camDir.copy(raycaster.ray.direction); // base aim (pre-spread) — the reuse key
    // Spread: nudge the ray direction within the weapon's cone (this is also the direction sent to the server).
    if (spec.spreadRad > 0) {
      raycaster.ray.direction
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), (Math.random() - 0.5) * 2 * spec.spreadRad)
        .applyAxisAngle(new THREE.Vector3(1, 0, 0), (Math.random() - 0.5) * 2 * spec.spreadRad)
        .normalize();
    }
    const now = performance.now();
    // Reuse the last impact while aim is steady (skips the expensive scene raycast — the firefight p95 spike).
    if (haveLastCast && now - lastCastMs < CAST_RESULT_TTL_MS && camDir.dot(lastCamDir) > CAST_REUSE_DOT) {
      if (target && !(lastHit && raycaster.ray.origin.distanceTo(lastPoint) < targetDist - 0.6)) return { point: assistPoint.clone(), hit: true };
      return { point: lastPoint.clone(), hit: lastHit, ...(lastNormalValid ? { normal: lastNormalVec.clone() } : {}) };
    }
    refreshTargets(now);
    let hits: THREE.Intersection[] = [];
    try { hits = intersectTargets(); } catch { hits = []; }
    const ignore = deps.ignoreRoot?.();
    const under = (o: THREE.Object3D | null): boolean => { for (let p = o; p; p = p.parent) if (p === ignore) return true; return false; };
    const struck = hits.find(h => h.distance >= 1 && !(ignore && under(h.object))); // skip point-blank self/gun + your own car; near→far
    let point: THREE.Vector3, hit: boolean, normal: THREE.Vector3 | undefined;
    if (struck) {
      point = struck.point.clone(); hit = true;
      normal = struck.face ? struck.face.normal.clone().transformDirection(struck.object.matrixWorld).normalize() : undefined;
    } else {
      point = raycaster.ray.origin.clone().addScaledVector(raycaster.ray.direction, spec.rangeM); hit = false;
    }
    lastCamDir.copy(camDir); lastPoint.copy(point); lastHit = hit;
    lastNormalValid = !!normal; if (normal) lastNormalVec.copy(normal); lastCastMs = now; haveLastCast = true;
    // An assisted shot lands on the target unless something solid is clearly in front of it (a wall keeps the bullet).
    if (target && !(struck && struck.distance < targetDist - 0.6)) return { point: assistPoint.clone(), hit: true };
    return { point, hit, ...(normal ? { normal } : {}) };
  }

  function makeTracer(): Tracer {
    const geom = new THREE.BufferGeometry();
    const pos = new THREE.BufferAttribute(new Float32Array(6), 3).setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute('position', pos);
    geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity); // never frustum-culled; skip recompute
    const line = new THREE.Line(geom, tracerMat);
    line.frustumCulled = false; line.visible = false;
    deps.scene.add(line);
    const t: Tracer = { line, pos, life: 0 };
    tracers.push(t);
    return t;
  }

  function spawnTracer(from: THREE.Vector3, to: THREE.Vector3): void {
    // Reuse an expired tracer; else grow the pool; else ring-reuse the oldest. No per-shot allocation.
    let t = tracers.find(x => x.life <= 0);
    if (!t) { t = tracers.length < TRACER_POOL_MAX ? makeTracer() : tracers[tracerCursor = (tracerCursor + 1) % tracers.length]!; }
    t.pos.setXYZ(0, from.x, from.y, from.z);
    t.pos.setXYZ(1, to.x, to.y, to.z);
    t.pos.needsUpdate = true;
    t.life = TRACER_LIFE;
    t.line.visible = true;
  }

  function fire(): void {
    const spec = deps.currentSpec();
    if (!spec) return;
    const now = performance.now();
    if (!deps.tryFire(now)) return;
    playGunshot({ melee: spec.melee, weapon: spec.id });
    const from = deps.muzzleOrigin(muzzle).clone();
    if (!spec.melee) reportGunfire(from.x, from.z); // peds nearby flee/cower (streetWalkers reads this)
    const { point, hit, normal } = castHit(spec);
    if (spec.melee && flags.pedMelee) {
      // pedMelee: the camera ray starts metres behind the player, so a melee swing lands just in FRONT of the player.
      const fx = raycaster.ray.direction.x, fz = raycaster.ray.direction.z, len = Math.hypot(fx, fz) || 1;
      reportImpact(from.x + fx / len * MELEE_REACH_M, from.z + fz / len * MELEE_REACH_M, performance.now(), true);
    } else reportImpact(point.x, point.z); // peds at the impact crumple (streetWalkers ragdoll-lite reads this)
    // Server-validated hit: the server re-resolves the target from its own poses + this aim direction.
    // aimControls: the server casts from the shooter's CHEST, but the crosshair ray starts at the over-the-shoulder camera
    // ~1 m to the side, so the parallel camera direction passed beside what the crosshair covered. Send chest→impact.
    if (flags.aimControls && !spec.melee && sendDir.subVectors(point, from).lengthSq() > 1 && sendDir.dot(raycaster.ray.direction) > 0) sendDir.normalize();
    else sendDir.copy(raycaster.ray.direction);
    deps.sendFire?.([sendDir.x, sendDir.y, sendDir.z]);
    if (!spec.melee) {
      spawnTracer(from, point);
      flash.position.copy(from);
      flashLife = MUZZLE_FLASH_LIFE;
      flash.visible = true;
      (flash.material as THREE.SpriteMaterial).opacity = 1;
    }
    deps.onShot?.({
      from: [from.x, from.y, from.z],
      to: [point.x, point.y, point.z],
      weapon: spec,
      hit,
      ...(normal ? { normal: [normal.x, normal.y, normal.z] as [number, number, number] } : {}),
    });
  }

  // ---- aimControls: aim assist + mouse capture ------------------------------------------------------------------
  const assistPoint = new THREE.Vector3(), sendDir = new THREE.Vector3(), losDir = new THREE.Vector3(), projected = new THREE.Vector3();
  function lineOfSight(eyeAt: { x: number; y: number; z: number }, t: { x: number; y: number; z: number }): boolean {
    raycaster.ray.origin.set(eyeAt.x, eyeAt.y, eyeAt.z);
    const dist = raycaster.ray.origin.distanceTo(losDir.set(t.x, t.y, t.z));
    raycaster.ray.direction.subVectors(losDir, raycaster.ray.origin).normalize();
    raycaster.far = Math.max(0, dist - 0.8); // stop short of the target's own body
    refreshTargets(performance.now());
    let hits: THREE.Intersection[] = [];
    try { hits = intersectTargets(); } catch { return true; }
    const ignore = deps.ignoreRoot?.(), self = deps.selfRoot?.();
    const mine = (o: THREE.Object3D | null): boolean => { for (let p = o; p; p = p.parent) if (p === ignore || p === self) return true; return false; };
    return !hits.some(h => h.distance >= 1 && !mine(h.object));
  }
  const assist: AimAssist | undefined = flags.aimControls && deps.aimTargets && deps.aimAt ? createAimAssist({
    targets: deps.aimTargets,
    aimAt: deps.aimAt,
    view(e, d) { deps.camera.updateMatrixWorld(); deps.camera.getWorldPosition(eye); e.x = eye.x; e.y = eye.y; e.z = eye.z; deps.camera.getWorldDirection(losDir); d.x = losDir.x; d.y = losDir.y; d.z = losDir.z; },
    rangeM() { const spec = deps.currentSpec(); return spec && !spec.melee ? spec.rangeM : 0; },
    visible: lineOfSight,
    canAim: deps.canAim,
  }) : undefined;
  // While armed, a click on the locked canvas is a shot: pointer.ts keeps the lock instead of releasing it.
  const offCapture = flags.aimControls ? setAimCapture(() => deps.canAim()) : undefined;

  let holding = false;
  function triggerDown(): void { if (deps.canAim()) { holding = true; fire(); } } // semi fires here; auto repeats in update
  function triggerUp(): void { holding = false; }

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    // aimControls: the first click only captures the mouse (pointer.ts) — no stray shot before you can aim.
    if (e.button === 0 && !(flags.aimControls && !mouseAimReady())) triggerDown();
    if (e.button === 2) assist?.softAcquire(); // RMB: aim + soft-lock a target near the crosshair
  };
  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    if (e.button === 0) triggerUp();
    if (e.button === 2) assist?.softRelease();
  };
  const onMouseMove = (e: MouseEvent) => { if (assist?.locked && pointerLocked()) assist.mouseMoved(Math.hypot(e.movementX || 0, e.movementY || 0)); };
  if (assist) document.addEventListener('mousemove', onMouseMove);
  deps.canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointerup', onPointerUp);
  // F shoots too (founder playtest: a click that also grabs pointer lock wasn't an obvious trigger).
  const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat || typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'KeyF') triggerDown();
    else if (e.code === 'KeyZ' && assist && deps.canAim()) { e.preventDefault(); assist.cycle(); } // Z: lock / cycle target
  };
  const onKeyUp = (e: KeyboardEvent) => { if (e.code === 'KeyF') triggerUp(); };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  let stickPointer: number | undefined, lastX = 0, lastY = 0, offX = 0, offY = 0;
  const STICK_GAIN = 1.6, STICK_TRAVEL_PX = 26; // a thumb on a 84 px stick covers few pixels: turn faster than a free drag
  const onBtnDown = (e: PointerEvent) => {
    e.preventDefault(); triggerDown();
    if (stick) { stickPointer = e.pointerId; lastX = e.clientX; lastY = e.clientY; offX = offY = 0; try { fireButton.setPointerCapture(e.pointerId); } catch { /* not capturable */ } }
  };
  const onBtnMove = (e: PointerEvent) => {
    if (e.pointerId !== stickPointer) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY;
    deps.aimLook?.(dx * STICK_GAIN, dy * STICK_GAIN);
    offX = Math.max(-STICK_TRAVEL_PX, Math.min(STICK_TRAVEL_PX, offX + dx)); offY = Math.max(-STICK_TRAVEL_PX, Math.min(STICK_TRAVEL_PX, offY + dy));
    fireLabel.style.transform = `translate(${offX}px, ${offY}px)`;
  };
  const onBtnUp = (e: PointerEvent) => {
    e.preventDefault();
    if (e.pointerId === stickPointer) { stickPointer = undefined; fireLabel.style.transform = ''; }
    triggerUp();
  };
  fireButton.addEventListener('pointerdown', onBtnDown);
  fireButton.addEventListener('pointermove', onBtnMove);
  fireButton.addEventListener('pointerup', onBtnUp);
  fireButton.addEventListener('pointercancel', onBtnUp);

  // dir unused outside fire; keep to avoid re-alloc churn should subclasses want it.
  void dir;

  return {
    crosshair,
    fireButton,
    update(dt: number) {
      const aim = deps.canAim();
      crosshair.hidden = !aim;
      if (assist) {
        assist.update(dt);
        const locked = aim ? assist.locked : null;
        crosshair.classList.toggle('gt-on-target', aim && assist.onTarget(pointerLocked()));
        document.body.classList.toggle('gt-aim-reticle', aim); // hide pointer.ts's '+' under the combat crosshair
        lockMark.hidden = !locked;
        if (locked) {
          projected.set(locked.x, locked.y, locked.z).project(deps.camera);
          const rect = deps.canvas.getBoundingClientRect();
          if (projected.z > 1) lockMark.hidden = true;
          else { lockMark.style.left = `${rect.left + (projected.x + 1) / 2 * rect.width}px`; lockMark.style.top = `${rect.top + (1 - projected.y) / 2 * rect.height}px`; }
          lockMark.classList.toggle('gt-lock-hard', assist.hard);
        }
      }
      // Phone fire button shows for coarse pointers while aiming.
      fireButton.hidden = !(aim && matchMedia('(pointer: coarse)').matches);
      if (holding && aim) {
        const spec = deps.currentSpec();
        if (spec && spec.automatic) fire(); // auto weapons keep firing while held (tryFire gates the rate)
      } else if (holding && !aim) {
        holding = false;
      }
      // Age the pooled tracers: hide the expired ones (no dispose) and fade the shared material by the
      // youngest still-alive tracer (they live only TRACER_LIFE, so a shared fade reads fine).
      let tracerFrac = 0;
      for (const t of tracers) {
        if (t.life <= 0) continue;
        t.life -= dt;
        if (t.life <= 0) { t.line.visible = false; continue; }
        if (t.life / TRACER_LIFE > tracerFrac) tracerFrac = t.life / TRACER_LIFE;
      }
      if (tracerFrac > 0) tracerMat.opacity = 0.9 * tracerFrac;
      if (flashLife > 0) {
        flashLife -= dt;
        (flash.material as THREE.SpriteMaterial).opacity = Math.max(0, flashLife / MUZZLE_FLASH_LIFE);
        if (flashLife <= 0) flash.visible = false;
      }
    },
    triggerDown,
    triggerUp,
    get aimLocked() { return !!assist?.locked && deps.canAim(); },
    destroy() {
      offCapture?.();
      document.removeEventListener('mousemove', onMouseMove);
      lockMark.remove();
      try { document.body.classList.remove('gt-aim-reticle'); } catch { /* non-DOM */ }
      deps.canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('pointerup', onPointerUp);
      fireButton.removeEventListener('pointerdown', onBtnDown);
      fireButton.removeEventListener('pointerup', onBtnUp);
      fireButton.removeEventListener('pointermove', onBtnMove);
      fireButton.removeEventListener('pointercancel', onBtnUp);
      for (const t of tracers) { deps.scene.remove(t.line); t.line.geometry.dispose(); }
      tracers.length = 0;
      deps.scene.remove(flash);
      (flash.material as THREE.SpriteMaterial).dispose();
      tracerMat.dispose();
      crosshair.remove();
      fireButton.remove();
    },
  };
}
