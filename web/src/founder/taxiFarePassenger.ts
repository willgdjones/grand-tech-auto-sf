/**
 * "Drive a Fare" passenger (flag taxiFarePassenger, inside taxiFareJob; critic note 1, gtasf-l9j3r): the fare is a person, not
 * a radius on the pavement. A rigged NPC waits at the taxi stand, walks to the player's passenger door when the car pulls up,
 * rides in the front passenger seat (the car's glass goes translucent so they can be seen, as for traffic drivers), and at
 * Union Square steps out on the kerb side, walks a couple of metres back into the chase view and fades. Client-only presentation: the mission, its checks and the payout are
 * the reviewed server path and are untouched.
 */
import type { Object3D } from 'three';
import type { AvatarInstance, AvatarTemplate } from '../avatar/riggedAvatar';
import { applyCarGlass, removeCarGlass } from '../vehicles/carGlass';

/** The player's current car while driving (the fleet model's root and driver seat), or null on foot. */
export interface FareCar { readonly root: Object3D; readonly seat: Object3D }

export interface TaxiFarePassengerDeps {
  template: AvatarTemplate;
  /** The scene group the standing / walking passenger lives in (world coordinates). */
  root: Object3D;
  surfaceHeightAt(x: number, z: number): number | null;
  car(): FareCar | null;
  /** The player's car speed (m/s, absolute); the fare only steps out once it has (nearly) stopped. */
  speedMps(): number;
  /** Where the camera is (world x,z): the fare walks back toward it after stepping out, so the step-out lands in the chase
   *  view (lane D's phone review: it walked off-frame from the kerb-side door). */
  viewFrom?(): { x: number; z: number } | null;
  outfit?: number;
}

export interface TaxiFarePassenger {
  /** Stand at the taxi stand (world x,z), facing `face`. */
  wait(stand: { x: number; z: number }, face: { x: number; z: number }): void;
  /** The car has pulled up: walk to its passenger door and get in. */
  board(): void;
  /** The mission ended: step out at the kerb if riding (arrived), otherwise just leave. */
  end(): void;
  /** In (or getting into) the car: the MISSION PASSED band should wait for the step-out (lane D phone review). */
  readonly aboard: boolean;
  /** Run `cb` once the fare has stepped out (or at once if not aboard / removed). */
  whenOut(cb: () => void): void;
  update(dt: number): void;
  dispose(): void;
}

// The driver sits at seat.x = -0.38 (vehicle.ts); the front passenger mirrors it. Same per-model lift as traffic drivers.
const PASSENGER_X = 0.38;
const LIFT: Record<string, number> = { outback: .3, prius: .12, model3: .02, cab: .08 };
// Kerb side = the driver's exit side (exit node x = -1.55 in vehicle.ts; the server's exit step is the kerb side, as
// quickDropKerb's tests show). Lane D's phone frames: the +x door put the fare on the STREET side, into the minimap corner.
const KERB_DOOR_X = -1.55;
const WALK_MPS = 1.6, BOARD_MAX_S = 7, LEAVE_S = 3.6, LEAVE_WALK_S = 1.8, STOPPED_MPS = 1, BEHIND_M = 2.5, OUT_NOTIFY_S = 0.7;

type Phase = 'none' | 'waiting' | 'boarding' | 'riding' | 'arriving' | 'leaving';

export function createTaxiFarePassenger(deps: TaxiFarePassengerDeps): TaxiFarePassenger {
  let avatar: AvatarInstance | null = null, phase: Phase = 'none', t = 0;
  let glassCar: Object3D | null = null, ridingCar: FareCar | null = null, viaRear = true, outCb: (() => void) | null = null;
  const fireOut = () => { const cb = outCb; outCb = null; cb?.(); };
  const pos = { x: 0, z: 0 }, dir = { x: 0, z: 1 };

  const ground = (x: number, z: number, fallback: number) => {
    const y = deps.surfaceHeightAt(x, z); return y != null && Number.isFinite(y) ? y : fallback;
  };
  function spawn(): AvatarInstance {
    const a = deps.template.createInstance(deps.outfit ?? 3, undefined, false);
    a.root.name = 'Taxi fare passenger';
    return a;
  }
  function place(x: number, z: number, faceX: number, faceZ: number): void {
    if (!avatar) return;
    if (avatar.root.parent !== deps.root) { avatar.root.removeFromParent(); deps.root.add(avatar.root); }
    pos.x = x; pos.z = z;
    avatar.root.position.set(x, ground(x, z, avatar.root.position.y), z);
    avatar.root.rotation.set(0, Math.atan2(faceX - x, faceZ - z), 0);
  }
  /** The kerb-side door of a car, in world x/z. */
  function doorOf(car: FareCar): { x: number; z: number } {
    const p = car.root.localToWorld(car.seat.position.clone().setX(KERB_DOOR_X));
    return { x: p.x, z: p.z };
  }
  function clearGlass(): void { if (glassCar) { removeCarGlass(glassCar); glassCar = null; } }
  function remove(): void {
    clearGlass(); ridingCar = null;
    if (avatar) { avatar.root.removeFromParent(); avatar.dispose(); avatar = null; }
    phase = 'none'; fireOut();
  }

  return {
    wait(stand, face) {
      if (phase !== 'none') remove();
      avatar = spawn(); phase = 'waiting'; t = 0;
      place(stand.x, stand.z, face.x, face.z);
    },
    board() {
      if (phase !== 'waiting' || !avatar) return;
      phase = 'boarding'; t = 0; viaRear = true;
    },
    end() {
      // Riding: the drop-off completes on ENTERING the 20 m zone, usually still rolling — stay seated until the car has
      // (nearly) stopped or the player gets out, then step out (update's 'arriving' phase). Otherwise just leave.
      if (phase === 'riding' && avatar && ridingCar) { phase = 'arriving'; t = 0; return; }
      if (phase !== 'arriving') remove();
    },
    update(dt) {
      if (!avatar || phase === 'none') return;
      t += dt;
      if (phase === 'waiting') { avatar.root.position.y = ground(pos.x, pos.z, avatar.root.position.y); avatar.update(dt, 'idle'); return; }
      if (phase === 'boarding') {
        const car = deps.car();
        if (!car) { avatar.update(dt, 'idle'); return; } // the player stepped out: wait where they are
        const door = doorOf(car);
        // Critic 01:4x: approach from BEHIND the car (the chase camera's side) so the walk-up reads on a phone — first to a
        // point ~2.5 m behind the kerb-side door, then up to the door.
        let goal = door;
        if (viaRear) {
          const cam = deps.viewFrom?.() ?? null;
          if (cam) {
            const bx = cam.x - door.x, bz = cam.z - door.z, bl = Math.hypot(bx, bz) || 1;
            const rear = { x: door.x + bx / bl * BEHIND_M, z: door.z + bz / bl * BEHIND_M };
            if (Math.hypot(rear.x - pos.x, rear.z - pos.z) < 0.5) viaRear = false; else goal = rear;
          } else viaRear = false;
        }
        const dx = goal.x - pos.x, dz = goal.z - pos.z, d = Math.hypot(dx, dz);
        if ((!viaRear && d < 0.35) || t > BOARD_MAX_S) {
          // In: sit in the front passenger seat, parented to the car so they ride with it.
          avatar.root.removeFromParent(); car.root.add(avatar.root);
          avatar.root.position.set(PASSENGER_X, car.seat.position.y + (LIFT[car.root.name] ?? .1), car.seat.position.z);
          avatar.root.rotation.set(0, 0, 0);
          if (applyCarGlass(car.root)) glassCar = car.root;
          ridingCar = car; phase = 'riding';
          avatar.update(0.016, 'sit'); avatar.update(0.1, 'sit'); avatar.update(0.1, 'sit'); // settle past the crossfade
          return;
        }
        const step = Math.min(d, WALK_MPS * dt);
        place(pos.x + dx / d * step, pos.z + dz / d * step, goal.x, goal.z);
        avatar.update(dt, 'walk');
        return;
      }
      if (phase === 'riding') { avatar.update(dt, 'sit'); return; }
      if (phase === 'arriving') {
        avatar.update(dt, 'sit');
        if (!ridingCar) { remove(); return; }
        if (deps.car() && deps.speedMps() > STOPPED_MPS) return; // still rolling: keep riding
        // Stopped (or the player got out): step out on the kerb side and walk away from the car.
        const door = doorOf(ridingCar), centre = ridingCar.root.getWorldPosition(avatar.root.position.clone());
        clearGlass();
        // Walk back toward a point ~3 m behind the car's CENTRE (camera side): back into the chase view and a little inboard of
        // the door line (critic 03:0x: the step-out was cropped at the screen edge).
        const cam = deps.viewFrom?.() ?? null;
        if (cam) {
          const bx = cam.x - centre.x, bz = cam.z - centre.z, bl = Math.hypot(bx, bz) || 1;
          dir.x = centre.x + bx / bl * 3 - door.x; dir.z = centre.z + bz / bl * 3 - door.z;
        } else { dir.x = door.x - centre.x; dir.z = door.z - centre.z; }
        const len = Math.hypot(dir.x, dir.z) || 1; dir.x /= len; dir.z /= len;
        place(door.x, door.z, door.x + dir.x, door.z + dir.z);
        ridingCar = null; phase = 'leaving'; t = 0;
        return;
      }
      if (phase === 'leaving') {
        if (t > LEAVE_S) { remove(); return; }
        if (t > OUT_NOTIFY_S) fireOut(); // out of the car: the MISSION PASSED band can land now
        const fade = Math.min(1, (LEAVE_S - t) / 0.8); // fade over the last 0.8 s
        if (t < LEAVE_WALK_S) { // a couple of metres back toward the camera, then stand in frame (not off into the HUD corner)
          place(pos.x + dir.x * WALK_MPS * dt, pos.z + dir.z * WALK_MPS * dt, pos.x + dir.x * 2, pos.z + dir.z * 2);
          avatar.update(dt, 'walk', fade);
        } else avatar.update(dt, 'idle', fade);
      }
    },
    get aboard() { return phase === 'boarding' || phase === 'riding' || phase === 'arriving'; },
    whenOut(cb) { if (phase === 'boarding' || phase === 'riding' || phase === 'arriving') outCb = cb; else cb(); },
    dispose() { remove(); },
  };
}
