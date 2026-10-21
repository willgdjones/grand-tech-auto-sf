import { PerspectiveCamera, Vector3 } from 'three';
import { sampleHeightM } from '@gtasf/shared/terrain';
import type { HeightSampler as Walkable } from '@gtasf/shared/terrain';
type Point3 = { x: number; y: number; z: number };
import { PLAYER_CAMERA_CONFIG as config } from './config';
import { vFovForAspect } from './cameraState';


export interface CameraCollision {
  sphereCast(origin: Point3, direction: Point3, radius: number, maxDistance: number): number;
}
const angle = (value: number) => Math.atan2(Math.sin(value), Math.cos(value));
/** Time-based chase damping; every rendered pose still passes the current collision corridor. */
const DRIVE_BOOM_M = 6, DRIVE_PITCH_RAD = -0.12, DRIVE_FOV_BOOST_DEG = 8;
// weaponPoses: GTA over-the-shoulder while aiming, so the raised gun isn't hidden behind the body.
const AIM_SHOULDER_M = 1.0, AIM_SHOULDER_UP_M = 0.12, AIM_BOOM_SHRINK = 0.45; // critic: 0.55 m / -30% read as too timid
export class ThirdPersonCamera {
  readonly camera = new PerspectiveCamera(60, 1, 0.05, 1500);
  private yawValue = 0;
  private pitchValue: number = config.pitchDefaultRad;
  private yawTarget = 0;
  private pitchTarget: number = config.pitchDefaultRad;
  private manualSeconds = 0;
  private following = false;
  private recentering = false;
  private speed = 0;
  private zoomValue: number = config.boomDefaultM;
  private length: number = config.boomDefaultM;
  private actualLength: number = config.boomDefaultM;
  private velocity = 0;
  private readonly head = new Vector3();
  private readonly desired = new Vector3();
  private readonly direction = new Vector3();
  private readonly candidate = new Vector3();
  private readonly previous = new Vector3();
  private readonly previousHead = new Vector3();
  private readonly unsmoothed = new Vector3();
  private readonly aim = new Vector3();
  private readonly feet = new Vector3();
  private readonly upward = new Vector3(0, 1, 0);
  private readonly alternative = new Vector3();
  private readonly probeHead = new Vector3();
  private readonly probeDirection = new Vector3();
  private readonly roofView = new Vector3();
  private hasPrevious = false;
  // drivingFeel (critique #10): a chase profile while in a car — shorter boom (6 m vs 8.5), flatter pitch, and the
  // FOV widens up to +8° at 30 m/s. Blended in/out so entering/leaving a car eases rather than snaps.
  private driveTarget = false;
  private driveBlend = 0;
  private fovBoostValue = 0;
  private aimShoulder = 0;
  // aimControls: while aiming, the orbit follows the mouse this many times faster (less floaty crosshair) and look
  // sensitivity drops by aimLookDrop (fine aim); both scale with the aim weight. 0 = the old behaviour.
  private aimResponseBoost = 0;
  private aimLookDrop = 0;
  /** False means no safe pose exists in the searched head-to-boom corridor; callers must not present it. */
  safe = false;
  /** Local-avatar coverage for this camera pose; apply before uploading the current frame's instances. */
  avatarOpacity = 1;
  constructor(
    private readonly options: {
      walkable: Walkable;
      occluders: CameraCollision;
      activity: { camera(): void };
      invertY?: () => boolean;
    },
  ) {}
  get yaw(): number {
    return this.yawValue;
  }
  get pitch(): number {
    return this.pitchValue;
  }
  get boom(): number {
    return this.zoomValue;
  }
  /** drivingFeel: degrees to ADD to the frame's FOV (0 on foot; up to +8° at 30 m/s in a car). */
  get fovBoost(): number {
    return this.fovBoostValue;
  }
  get renderedBoom(): number {
    return this.actualLength;
  }
  resize(width: number, height: number): void {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
      throw new RangeError('CAMERA_VIEWPORT');
    this.camera.aspect = width / height;
    this.camera.fov = vFovForAspect(this.camera.aspect);
    this.camera.updateProjectionMatrix();
  }
  /** Read-only: the clear boom (m, capped at the default) a chase camera behind `heading` would get at the default pitch
   *  from `feet`. Lets an arrival choose a facing that doesn't press the camera into a wall and fade the player. */
  clearBehind(feet: { x: number; y: number; z: number }, heading: number): number {
    if (!Number.isFinite(heading)) return 0;
    const yaw = angle(heading + Math.PI), pitch = this.defaultPitch();
    this.probeHead.set(feet.x, feet.y + config.targetHeightM, feet.z);
    this.probeDirection.set(Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    const hit = this.options.occluders.sphereCast(this.probeHead, this.probeDirection, config.cameraRadiusM, config.boomDefaultM);
    return Number.isFinite(hit) ? Math.max(0, hit - config.wallMarginM) : config.boomDefaultM;
  }
  setOrbit(yaw: number, pitch: number): void {
    if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) throw new RangeError('CAMERA_ORBIT');
    this.yawTarget = this.yawValue = angle(yaw);
    this.pitchTarget = this.pitchValue = Math.max(config.pitchMinRad, Math.min(config.pitchMaxRad, pitch));
  }
  private manual(): void {
    this.manualSeconds = config.manualHoldSeconds; this.following = false; this.recentering = false;
    this.options.activity.camera();
  }
  /** Keyboard axes: positive horizontal orbits right; positive vertical pitches up. */
  orbit(horizontal: number, vertical: number, dt: number): void {
    if (!Number.isFinite(horizontal) || !Number.isFinite(vertical) || !Number.isFinite(dt) || dt <= 0 || (!horizontal && !vertical)) return;
    this.yawTarget = angle(this.yawTarget - Math.max(-1, Math.min(1, horizontal)) * config.keyboardOrbitRadps * dt);
    this.pitchTarget = Math.max(config.pitchMinRad, Math.min(config.pitchMaxRad,
      this.pitchTarget + Math.max(-1, Math.min(1, vertical)) * config.keyboardPitchRadps * dt));
    this.manual();
  }
  /** weaponPoses: 0..1 aim weight; shifts the orbit target over the right shoulder and pulls the boom in. */
  setAimShoulder(weight: number): void {
    this.aimShoulder = Number.isFinite(weight) ? Math.max(0, Math.min(1, weight)) : 0;
  }
  /** aimControls: aim-camera feel (see the fields). */
  setAimTuning(responseBoost: number, lookDrop: number): void {
    this.aimResponseBoost = Number.isFinite(responseBoost) ? Math.max(0, responseBoost) : 0;
    this.aimLookDrop = Number.isFinite(lookDrop) ? Math.max(0, Math.min(0.9, lookDrop)) : 0;
  }
  /** aimControls lock-on: ease the orbit so the line camera→pivot runs through a world point (the crosshair lands on it). */
  aimToward(x: number, y: number, z: number): void {
    const dx = x - this.head.x, dy = y - this.head.y, dz = z - this.head.z, flat = Math.hypot(dx, dz);
    if (!Number.isFinite(dx + dy + dz) || flat < 0.5) return;
    this.yawTarget = angle(Math.atan2(-dx, -dz));
    this.pitchTarget = Math.max(config.pitchMinRad, Math.min(config.pitchMaxRad, Math.atan2(dy, flat)));
    this.manual();
  }
  /** drivingFeel: switch the chase-cam drive profile on (in a car) or off (on foot). */
  setDriveProfile(on: boolean): void {
    this.driveTarget = on;
  }
  private defaultPitch(): number {
    return config.pitchDefaultRad + (DRIVE_PITCH_RAD - config.pitchDefaultRad) * this.driveBlend;
  }
  /** C: quickly ease behind the +Z-forward heading, preserving safe collision pull-in. */
  recenter(heading: number): void {
    if (!Number.isFinite(heading)) return;
    this.yawTarget = angle(heading + Math.PI); this.pitchTarget = this.defaultPitch();
    this.manualSeconds = 0; this.following = true; this.recentering = true;
    this.options.activity.camera();
  }
  /** Call once before update. Manual look holds for 1.5s, then the chase eases behind heading. */
  follow(heading: number, speedMps: number, dt: number): void {
    if (!Number.isFinite(heading) || !Number.isFinite(speedMps) || !Number.isFinite(dt) || dt < 0) return;
    this.speed = Math.abs(speedMps);
    this.manualSeconds = Math.max(0, this.manualSeconds - dt);
    if (this.manualSeconds > 0) return;
    this.following = true; this.yawTarget = angle(heading + Math.PI); this.pitchTarget = this.defaultPitch();
  }
  look(dx: number, dy: number): void {
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || (!dx && !dy)) return;
    const perPixel = config.lookRadiansPerPixel * (1 - this.aimLookDrop * this.aimShoulder);
    this.yawTarget = angle(this.yawTarget - dx * perPixel);
    this.pitchTarget = Math.max(config.pitchMinRad, Math.min(config.pitchMaxRad,
      this.pitchTarget + dy * perPixel * ((this.options.invertY?.() ?? false) ? -1 : 1)));
    this.manual();
  }
  zoom(notches: number): void {
    if (!Number.isFinite(notches)) return;
    this.zoomValue = Math.max(
      config.boomMinM,
      Math.min(config.boomMaxM, this.zoomValue * config.wheelFactor ** notches),
    );
    if (notches !== 0) this.manual();
  }
  /** @hot Critically damped closed form for a stationary target, stable for long frames too. */
  private spring(dt: number, target: number): void {
    const error = this.length - target;
    const combined = this.velocity + config.springOmega * error;
    const decay = Math.exp(-config.springOmega * dt);
    this.length = target + (error + combined * dt) * decay;
    this.velocity = (this.velocity - config.springOmega * combined * dt) * decay;
  }
  /** @hot Ground adjustment can invalidate a previously clear ray; always test its final sphere/corridor. */
  private clear(position: Vector3): boolean {
    const ground = sampleHeightM(this.options.walkable, position.x, position.z);
    if (ground === null || position.y < ground + config.groundClearanceM - 1e-9) return false;
    this.direction.subVectors(position, this.head);
    const distance = this.direction.length();
    if (distance < config.collisionMinM - 1e-9 || distance > config.boomMaxM + 1e-9) return false;
    // Distance to the complete animated figure's conservative cylinder, expanded by the camera sphere.
    // Unlike a boom clamp, this remains valid after pitch and ground-height correction.
    const bodyHorizontal = Math.max(
      0,
      Math.hypot(position.x - this.feet.x, position.z - this.feet.z) - config.avatarClearanceRadiusM,
    );
    const bodyVertical = Math.max(
      0,
      this.feet.y - config.avatarClearanceBelowFeetM - position.y,
      position.y - this.feet.y - config.avatarClearanceHeightM,
    );
    if (Math.hypot(bodyHorizontal, bodyVertical) < config.cameraRadiusM) return false;
    if (distance > 0) this.direction.multiplyScalar(1 / distance);
    else this.direction.set(0, 0, 1);
    return (
      this.options.occluders.sphereCast(this.head, this.direction, config.cameraRadiusM, distance) ===
      Infinity
    );
  }
  /** Keep a readable chase view under a low roof without changing the requested orbit or zoom. */
  private fitUnderRoof(targetBoom: number, reach: number, safeLength: number): number {
    if (this.zoomValue < config.avatarFadeFarM || safeLength >= config.avatarFadeFarM || this.pitchValue >= config.pitchDefaultRad)
      return safeLength;
    // A nearby wall alone keeps the ordinary pull-in/fade behavior. Only a real
    // overhead obstruction enables this bounded pitch search.
    const overhead = this.options.occluders.sphereCast(this.head, this.upward, config.cameraRadiusM,
      targetBoom * -Math.sin(this.pitchValue) + config.cameraRadiusM);
    if (!Number.isFinite(overhead)) return safeLength;
    let bestLength = Math.min(targetBoom, safeLength), bestSafe = safeLength, found = false;
    for (let step = 1; step <= 4; step++) {
      const pitch = this.pitchValue + (config.pitchDefaultRad - this.pitchValue) * step / 4;
      this.alternative.set(Math.sin(this.yawValue) * Math.cos(pitch), -Math.sin(pitch), Math.cos(this.yawValue) * Math.cos(pitch));
      const hit = this.options.occluders.sphereCast(this.head, this.alternative, config.cameraRadiusM, reach);
      const available = Number.isFinite(hit) ? Math.max(0, hit - config.wallMarginM) : config.boomMaxM;
      const length = Math.min(targetBoom, available);
      if (length <= bestLength + .01) continue;
      this.candidate.copy(this.head).addScaledVector(this.alternative, length);
      const ground = sampleHeightM(this.options.walkable, this.candidate.x, this.candidate.z);
      if (ground !== null) this.candidate.y = Math.max(this.candidate.y, ground + config.groundClearanceM);
      if (!this.clear(this.candidate)) continue;
      bestLength = length; bestSafe = available; found = true; this.roofView.copy(this.alternative);
      if (length >= config.avatarFadeFarM) break;
    }
    if (found) this.desired.copy(this.roofView);
    return bestSafe;
  }
  /** @hot No vectors, arrays or result objects are allocated during an update. Positive pitch looks up. */
  update(dt: number, feet: Readonly<Point3>): boolean {
    if (
      !Number.isFinite(dt) ||
      dt < 0 ||
      !Number.isFinite(feet.x) ||
      !Number.isFinite(feet.y) ||
      !Number.isFinite(feet.z)
    )
      throw new RangeError('CAMERA_UPDATE');
    this.feet.copy(feet);
    this.head.set(feet.x, feet.y + config.targetHeightM, feet.z);
    if (this.aimShoulder > 0) { // screen-right is (cos yaw, 0, -sin yaw) for this orbit
      // Portrait phones are ~0.45 aspect: a full 1.0 m shift pushed the player under the minimap (gtasf-fni0u phone frames), and
      // a linear 0.45 m still put them at ~37 % width with the legs behind the radar (critic aim-camera phone nit). Squared,
      // portrait gets ~0.2 m (player ~44 %, clear of the radar and FIRE); landscape/desktop (aspect >= 1) keeps the full shift.
      const narrow = Math.min(1, this.camera.aspect), off = AIM_SHOULDER_M * narrow * narrow * this.aimShoulder;
      this.head.x += Math.cos(this.yawValue) * off; this.head.z -= Math.sin(this.yawValue) * off; this.head.y += AIM_SHOULDER_UP_M * this.aimShoulder;
    }
    const relocated = this.hasPrevious && this.head.distanceToSquared(this.previousHead) > config.teleportDistanceM ** 2;
    const response = this.recentering ? config.recenterResponse : this.following ? config.followResponse
      : config.manualResponse * (1 + this.aimResponseBoost * this.aimShoulder);
    const orbitBlend = 1 - Math.exp(-response * dt);
    this.yawValue = angle(this.yawValue + angle(this.yawTarget - this.yawValue) * orbitBlend);
    this.pitchValue += (this.pitchTarget - this.pitchValue) * orbitBlend;
    if (Math.abs(angle(this.yawTarget - this.yawValue)) < .01 && Math.abs(this.pitchTarget - this.pitchValue) < .01) this.recentering = false;
    const horizontal = Math.cos(this.pitchValue);
    this.desired.set(
      Math.sin(this.yawValue) * horizontal,
      -Math.sin(this.pitchValue),
      Math.cos(this.yawValue) * horizontal,
    );
    if (this.driveTarget || this.driveBlend > 0) {
      this.driveBlend = Math.max(0, Math.min(1, this.driveBlend + (this.driveTarget ? dt : -dt) * 2.5));
      // The owner sets the final FOV each frame (main.ts: followFov / arrival view), so expose the boost to add to it.
      this.fovBoostValue = this.driveBlend * DRIVE_FOV_BOOST_DEG * Math.min(1, this.speed / 30);
    }
    const zoom = this.zoomValue * (1 - this.driveBlend * (1 - DRIVE_BOOM_M / config.boomDefaultM)) * (1 - AIM_BOOM_SHRINK * this.aimShoulder);
    const targetBoom = Math.min(config.boomMaxM, zoom + this.speed * config.speedPullbackSeconds);
    const hit = this.options.occluders.sphereCast(
      this.head,
      this.desired,
      config.cameraRadiusM,
      Math.max(targetBoom, this.length),
    );
    const safeLength = this.fitUnderRoof(targetBoom, Math.max(targetBoom, this.length),
      Number.isFinite(hit) ? Math.max(0, hit - config.wallMarginM) : config.boomMaxM);
    this.spring(dt, targetBoom);
    if (this.length > safeLength) {
      this.length = safeLength;
      this.velocity = 0;
    }
    this.length = Math.max(0, this.length);
    this.candidate.copy(this.head).addScaledVector(this.desired, this.length);
    const ground = sampleHeightM(this.options.walkable, this.candidate.x, this.candidate.z);
    if (ground !== null) this.candidate.y = Math.max(this.candidate.y, ground + config.groundClearanceM);
    this.unsmoothed.copy(this.candidate);
    if (this.hasPrevious && !relocated) {
      this.candidate.lerpVectors(this.previous, this.unsmoothed, 1 - Math.exp(-config.positionResponse * dt));
      // Chase lag cannot extend beyond the shared camera offset budget.
      this.direction.subVectors(this.candidate, this.head);
      if (this.direction.lengthSq() > config.boomMaxM ** 2) {
        this.candidate.copy(this.head).addScaledVector(this.direction.normalize(), config.boomMaxM);
      }
    }
    this.safe = this.clear(this.candidate);
    // New walls/steep ground pull in immediately; only clear positions receive chase lag.
    if (!this.safe) { this.candidate.copy(this.unsmoothed); this.safe = this.clear(this.candidate); }
    if (!this.safe && this.hasPrevious && !relocated && this.clear(this.previous)) {
      this.candidate.copy(this.previous);
      this.safe = true;
    }
    // Raised ground beneath a low canopy may rule out the long boom and the previous pose.
    // Search bounded shorter candidates without entering the figure or ignoring either world constraint.
    if (!this.safe)
      for (let step = 1; step <= 16; step++) {
        this.candidate
          .copy(this.head)
          .addScaledVector(this.desired, Math.max(config.collisionMinM, this.length * (1 - step / 16)));
        const height = sampleHeightM(this.options.walkable, this.candidate.x, this.candidate.z);
        if (height !== null) this.candidate.y = Math.max(this.candidate.y, height + config.groundClearanceM);
        if (this.clear(this.candidate)) {
          this.safe = true;
          break;
        }
      }
    if (!this.safe) {
      this.avatarOpacity = 0;
      return false;
    }
    const actual = this.candidate.distanceTo(this.head);
    this.actualLength = actual;
    this.camera.position.copy(this.candidate);
    if (!this.hasPrevious || relocated) this.aim.copy(this.head);
    else this.aim.lerp(this.head, 1 - Math.exp(-config.aimResponse * dt));
    this.camera.lookAt(this.aim);
    this.camera.updateMatrixWorld();
    // Aim boom (weaponPoses): the shortened boom (~3.5 m) sat inside the 3-6 m fade band, so the player was a translucent
    // ghost while aiming (critic #6.25 'aim'). The shoulder offset keeps the body off the lens line, so shrink the band
    // with the aim weight (0.9-1.8 m at full aim); a wall pushing the camera into the body still fades it. (lane D)
    const band = 1 - 0.7 * this.aimShoulder, fadeNear = config.avatarFadeNearM * band, fadeFar = config.avatarFadeFarM * band;
    const fade = Math.max(0, Math.min(1, (actual - fadeNear) / (fadeFar - fadeNear)));
    this.avatarOpacity = fade * fade * (3 - 2 * fade);
    this.previous.copy(this.candidate);
    this.previousHead.copy(this.head);
    this.hasPrevious = true;
    return true;
  }
}
