import type { C2SMessage, Pose, S2CMessage, VehicleEntry, VehicleKind } from '@gtasf/shared/protocol/types';
import { checkMovement, MOVE_BURST_CM, type MovementState } from './movement';
import { adoptedCar, parkedCarsForCell, validDrivenVehicleHandoff, zonedVehicleId, type DrivenVehicleHandoff } from './vehicleHandoff';
import { flags } from '@gtasf/shared/flags';
import { ferryParkingBays, type ParkingBay } from './ferryParking';
import { streetParkingBays, districtParkingBays } from './streetParking';
import type { LocalRoads } from './localRoads';
import { PERSONAL_KINDS } from './personalCar';

export interface VehicleHost {
  emit(message: S2CMessage, playerId?: number): void;
  pose(playerId: number, pose: Pose, now: number): void;
  /** personalCar: a player drove a road car and left it — it is now theirs (the host saves it per device). */
  personalCarLeft?(playerId: number, kind: VehicleKind, pose: Pose): void;
}
interface Car { entry: VehicleEntry; movement: MovementState }
export const DRIVER_FLAG = 0x40;
export const PASSENGER_FLAG = 0x80;

/** Local-play fleet. Driver movement is client-authored, ownership and speed are server-checked. */
/** kerbCarTheft review K-M1: live player-spawned kerb cars per world. */
export const KERB_CARS_MAX = 30;
/** openingDrive (review OD-M1): opening cars have their own small cap, so they never use up kerb-car theft's. */
export const OPENING_CARS_MAX = 8;

export class WorldVehicles {
  readonly cars = new Map<number, Car>();
  readonly occupants = new Map<number, number>();
  private zone?: number;
  private nextTaxiId = 1000;
  private allocateZonedTaxi?: () => number;
  private bays: (ParkingBay & { carId: number; vacantAt?: number })[] = [];
  private readonly retiredParked = new Map<number, number>();
  // kerbCarTheft review K-M1: the kerb car each player last spawned, and every live kerb car (world cap).
  private readonly kerbCarOf = new Map<number, number>();
  private readonly kerbCars = new Set<number>();
  private readonly openingCars = new Set<number>(); // openingDrive: idle opening cars, counted against OPENING_CARS_MAX
  // personalCar (critique #20): each online player's own car (player → car, car → player). Never swept while owned.
  private readonly personalOf = new Map<number, number>();
  private readonly personalOwner = new Map<number, number>();
  private nextParkingCheck = 0;
  private districtParkingReady = false;
  private readonly corridorBays: readonly ParkingBay[];
  constructor(private readonly host: VehicleHost) {
    // Ferry starter sits 4.9 m to the side of spawn: E reaches it without crowding the avatar/camera.
    // The other cars use real Lombard lane points.
    const parked: [VehicleEntry['kind'], number, number, number, number][] = [
      ['prius', 1199.77, 3.347, -1220.386, 96],
      ['tesla', -1052.761, 85.603, -1972.545, 69],
      ['subaru', -1067.275, 84.929, -1970.365, 70],
      ['prius', -1039.882, 85.926, -1975.278, 66],
    ];
    parked.forEach(([kind, x, y, z, yaw], i) => {
      const pose = { x: Math.round(x * 100), y: Math.round(y * 100), z: Math.round(z * 100), yaw, flags: 0 };
      this.cars.set(i + 1, { entry: { id: i + 1, ...pose, kind, driverId: 0, speedCmps: 0 },
        movement: { pose, seq: 0, accepted: false, carryCm: MOVE_BURST_CM, lastAt: 0 } });
    });
    if (flags.driving && flags.ferryParkedCars) {
      const first = this.cars.get(1)!;
      this.bays.push({ kind: first.entry.kind, pose: this.carPose(first), carId: 1 });
      for (const bay of ferryParkingBays()) {
        const carId = this.cars.size + 1;
        this.addParked(carId, bay);
        this.bays.push({ ...bay, carId });
      }
    }
    if (flags.driving && flags.graphicsV2) {
      for (const bay of streetParkingBays()) {
        const carId = this.cars.size + 1;
        this.addParked(carId, bay);
        this.bays.push({ ...bay, carId });
      }
    }
    this.corridorBays = this.bays.map(({ kind, pose }) => ({ kind, pose }));
  }

  /** Called once before admitting zone sockets. The single-world fleet never takes this path. */
  configureZone(cellIdx: number, allocateTaxi: () => number): void {
    if (this.zone !== undefined) return;
    this.zone = cellIdx;
    this.allocateZonedTaxi = allocateTaxi;
    const starters = [...this.cars.values()].filter(car => car.entry.id < 1000);
    for (const car of starters) this.cars.delete(car.entry.id);
    const local = parkedCarsForCell(starters.map(car => ({ car, x: car.entry.x / 100, z: car.entry.z / 100 })), cellIdx);
    const localIds = new Set(local.map(({ car }) => car.entry.id));
    this.bays = this.bays.filter(bay => localIds.has(bay.carId));
    for (const bay of this.bays) bay.carId = zonedVehicleId(cellIdx, bay.carId);
    for (const { car } of local) {
      car.entry.id = zonedVehicleId(cellIdx, car.entry.id);
      this.cars.set(car.entry.id, car);
    }
  }

  /** Whole-city stock joins the same authoritative enter/refill lifecycle after road loading.
   * Stable local IDs work whether a restored zone was configured before or after that load. */
  configureStreetParking(roads: LocalRoads): void {
    if (!flags.driving || !flags.graphicsV2 || this.districtParkingReady) return;
    this.districtParkingReady = true;
    const stock = districtParkingBays(roads).map((bay, i) => ({ bay, localId: 200 + i, x: bay.pose.x / 100, z: bay.pose.z / 100 }));
    const local = this.zone === undefined ? stock : parkedCarsForCell(stock, this.zone);
    for (const { bay, localId } of local) {
      // Keep this decision identical across zone-load ordering, including border bays.
      if (this.corridorBays.some(old => Math.hypot(old.pose.x - bay.pose.x, old.pose.z - bay.pose.z) < 3500)) continue;
      const carId = this.zone === undefined ? localId : zonedVehicleId(this.zone, localId);
      if (this.cars.has(carId)) continue;
      this.addParked(carId, bay); this.bays.push({ ...bay, carId });
    }
  }

  allocateTaxiId(): number {
    return this.zone === undefined ? this.nextTaxiId++ : zonedVehicleId(this.zone, this.allocateZonedTaxi!());
  }

  /** Server-owned stock. Never teleport a driven car back or spawn on a nearby player/vehicle. */
  replenishParked(now: number, peers: Iterable<{ pose: Pose }>): void {
    if (!flags.driving || (!flags.ferryParkedCars && !flags.graphicsV2) || now < this.nextParkingCheck) return;
    this.nextParkingCheck = now + 1000;
    const players = Array.from(peers, peer => peer.pose);
    const near = (a: Pose, b: Pose, metres: number) => Math.hypot(a.x - b.x, a.z - b.z) < metres * 100;
    for (const bay of this.bays) {
      const car = this.cars.get(bay.carId);
      if (car && near(car.entry, bay.pose, 7)) { delete bay.vacantAt; continue; }
      bay.vacantAt ??= now;
      if (now - bay.vacantAt < 45_000 || players.some(p => near(p, bay.pose, 15)) ||
        [...this.cars.values()].some(other => near(other.entry, bay.pose, 6))) continue;
      if (car) this.retiredParked.set(bay.carId, now);
      bay.carId = this.allocateTaxiId();
      this.addParked(bay.carId, bay);
      delete bay.vacantAt;
    }
    // Discard only our abandoned replacements, out of player range; keep occupied cars indefinitely.
    for (const [id, retiredAt] of this.retiredParked) {
      const car = this.cars.get(id);
      if (!car) { this.retiredParked.delete(id); continue; }
      if (car.entry.driverId || this.personalOwner.has(id) || now - retiredAt < 120_000 || players.some(p => near(p, car.entry, 50))) continue;
      this.cars.delete(id); this.retiredParked.delete(id); this.kerbCars.delete(id);
    }
  }

  /** Kerb-car theft (kerbCarTheft): a validated kerb prop becomes a real car; abandoned ones are swept like retired
   *  replacements (out of player range for 2 min). Review K-M1 (kerb props aren't networked, so every claim spawns a real
   *  car): a player keeps ONE kerb car — stealing another discards their previous one unless someone is driving it — and a
   *  world holds at most KERB_CARS_MAX, so nobody can barricade a street or bloat everyone's snapshot. False when refused. */
  addKerbCar(id: number, pose: Pose, kind: VehicleKind, now: number, playerId: number): boolean {
    if (this.cars.has(id)) return false;
    const previous = this.kerbCarOf.get(playerId);
    if (previous !== undefined) {
      this.kerbCarOf.delete(playerId);
      if (this.cars.get(previous)?.entry.driverId) this.kerbCars.delete(previous); // someone drives it now: theirs, uncapped
      else if (!this.personalOwner.has(previous)) this.discard(previous); // a kerb car that became someone's own car stays
    }
    for (const kerb of this.kerbCars) if (!this.cars.has(kerb)) this.kerbCars.delete(kerb);
    if (this.kerbCars.size >= KERB_CARS_MAX) return false;
    const p = { ...pose, flags: 0 };
    this.cars.set(id, { entry: { id, ...p, kind, driverId: 0, speedCmps: 0 }, movement: { pose: p, seq: 0, accepted: false, carryCm: MOVE_BURST_CM, lastAt: 0 } });
    this.retiredParked.set(id, now);
    this.kerbCars.add(id); this.kerbCarOf.set(playerId, id);
    return true;
  }
  /** openingDrive (review OD-M1): a new player's opening car. Swept like a kerb car once abandoned out of range, but
   *  counted against its own OPENING_CARS_MAX (never the kerb-theft cap). A car someone drives or owns no longer
   *  counts. False when the cap is full or the id is taken. */
  addOpeningCar(id: number, pose: Pose, kind: VehicleKind, now: number): boolean {
    if (this.cars.has(id)) return false;
    for (const open of this.openingCars) {
      const car = this.cars.get(open);
      if (!car || car.entry.driverId || this.personalOwner.has(open)) this.openingCars.delete(open);
    }
    if (this.openingCars.size >= OPENING_CARS_MAX) return false;
    const p = { ...pose, flags: 0 };
    this.cars.set(id, { entry: { id, ...p, kind, driverId: 0, speedCmps: 0 }, movement: { pose: p, seq: 0, accepted: false, carryCm: MOVE_BURST_CM, lastAt: 0 } });
    this.retiredParked.set(id, now);
    this.openingCars.add(id);
    return true;
  }
  /** openingDrive: drop a device's previous opening car on a new ask — unless someone is driving it or it became
   *  someone's own car (personalCar), which keeps it. */
  discardIdleOpening(id: number): void {
    this.openingCars.delete(id);
    const car = this.cars.get(id);
    if (car && !car.entry.driverId && !this.personalOwner.has(id)) this.discard(id);
  }
  /** Any fleet car within `metres` (2-D) of a pose. */
  carNear(pose: Pose, metres: number): boolean {
    for (const car of this.cars.values()) if (Math.hypot(car.entry.x - pose.x, car.entry.z - pose.z) < metres * 100) return true;
    return false;
  }
  /** gtasf-b4wtu diagnostics: live kerb cars counted against KERB_CARS_MAX. */
  get kerbCarCount(): number { return this.kerbCars.size; }
  /** Drop a car that was never driven (a kerb theft whose seat failed). */
  discard(id: number): void { this.cars.delete(id); this.retiredParked.delete(id); this.kerbCars.delete(id); this.unown(id); }

  // ── personalCar (critique #20) ──
  /** The player's own car, if it is still in this world. */
  personalCarOf(playerId: number): VehicleEntry | undefined {
    const id = this.personalOf.get(playerId);
    if (id === undefined) return undefined;
    const car = this.cars.get(id);
    if (!car) { this.unown(id); return undefined; }
    return car.entry;
  }
  /** garageSlots [2]: the player who owns `carId` as their personal car, if any (another player's car can't be kept). */
  ownerOf(carId: number): number | undefined { return this.personalOwner.get(carId); }
  /** Make `carId` the player's own car (their previous one goes back to the ordinary abandoned-car sweep). */
  claimPersonal(playerId: number, carId: number, now: number): void {
    const previous = this.personalOf.get(playerId);
    if (previous !== undefined && previous !== carId) { this.unown(previous); if (this.cars.has(previous)) this.retiredParked.set(previous, now); }
    const other = this.personalOwner.get(carId);
    if (other !== undefined && other !== playerId) this.personalOf.delete(other); // they lost it (it was taken)
    this.personalOf.set(playerId, carId); this.personalOwner.set(carId, playerId);
    // Owned cars don't count against the kerb-car cap, and stealing another kerb car never discards this one.
    this.kerbCars.delete(carId);
    if (this.kerbCarOf.get(playerId) === carId) this.kerbCarOf.delete(playerId);
  }
  /** Park the player's saved car (a returning player, or a delivery). False when the id is taken. */
  spawnPersonal(id: number, pose: Pose, kind: VehicleKind, playerId: number, now: number): boolean {
    if (this.cars.has(id) || !PERSONAL_KINDS.has(kind)) return false;
    const p = { ...pose, flags: 0 };
    this.cars.set(id, { entry: { id, ...p, kind, driverId: 0, speedCmps: 0 }, movement: { pose: p, seq: 0, accepted: false, carryCm: MOVE_BURST_CM, lastAt: 0 } });
    this.claimPersonal(playerId, id, now);
    return true;
  }
  /** The owner left the world: their parked car goes (it is saved per device and comes back with them). A car someone
   *  else is driving stays theirs. */
  releasePersonal(playerId: number): void {
    const id = this.personalOf.get(playerId);
    if (id === undefined) return;
    this.unown(id);
    const car = this.cars.get(id);
    if (car && !car.entry.driverId) { this.cars.delete(id); this.retiredParked.delete(id); this.kerbCars.delete(id); }
  }
  /** Remove an owned car so a delivery can replace it (never one being driven). */
  removePersonal(playerId: number): boolean {
    const car = this.personalCarOf(playerId);
    if (!car) return true;
    if (car.driverId) return false;
    this.releasePersonal(playerId);
    return true;
  }
  private unown(carId: number): void {
    const owner = this.personalOwner.get(carId);
    if (owner === undefined) return;
    this.personalOwner.delete(carId);
    if (this.personalOf.get(owner) === carId) this.personalOf.delete(owner);
  }

  private addParked(id: number, bay: ParkingBay): void {
    const pose = { ...bay.pose };
    this.cars.set(id, { entry: { id, ...pose, kind: bay.kind, driverId: 0, speedCmps: 0 },
      movement: { pose, seq: 0, accepted: false, carryCm: MOVE_BURST_CM, lastAt: 0 } });
  }

  enter(playerId: number, pose: Pose, vehicleId: number, now: number, reachCm = 550): boolean {
    const car = this.cars.get(vehicleId);
    if (!car || car.entry.kind === 'robotaxi' || car.entry.kind === 'cable-car' || car.entry.driverId || this.occupants.has(playerId)) return false;
    if (Math.hypot(pose.x - car.entry.x, pose.y - car.entry.y, pose.z - car.entry.z) > reachCm) return false;
    car.entry.driverId = playerId;
    car.movement = { pose: this.carPose(car), seq: 0, accepted: false, carryCm: MOVE_BURST_CM, lastAt: now };
    this.occupants.set(playerId, vehicleId);
    this.host.pose(playerId, { ...car.movement.pose, flags: DRIVER_FLAG }, now);
    this.host.emit({ type: 'VEHICLE_STATE', vehicleId, playerId, mode: 'driver' });
    this.host.emit({ type: 'CORRECTION', pose: { ...car.movement.pose, flags: DRIVER_FLAG } }, playerId);
    return true;
  }

  /** Destination side of a driven-vehicle zone handoff (gtasf-zoned-vehicle-handoff, zonedWorld only):
   *  recreate the crossing player's car here from the validated transferred state and re-seat them as
   *  driver. `vehicleId` is the globally-unique handoff id so it can't collide with this cell's parked
   *  ids. Rejects a bad blob / an id or player already present. Pure build is in vehicleHandoff. */
  adoptCar(playerId: number, vehicleId: number, state: DrivenVehicleHandoff, now: number): boolean {
    if (!validDrivenVehicleHandoff(state) || this.cars.has(vehicleId) || this.occupants.has(playerId)) return false;
    this.cars.set(vehicleId, adoptedCar(state, vehicleId, playerId, now));
    this.occupants.set(playerId, vehicleId);
    this.host.pose(playerId, { ...state.pose, flags: DRIVER_FLAG }, now);
    this.host.emit({ type: 'VEHICLE_STATE', vehicleId, playerId, mode: 'driver' });
    return true;
  }

  exit(playerId: number, vehicleId: number, now: number, groundedExit?: Pose, keepMoving = false): boolean {
    if (this.occupants.get(playerId) !== vehicleId) return false;
    const car = this.cars.get(vehicleId);
    this.occupants.delete(playerId);
    if (!car) return false;
    const wasDriver = car.entry.driverId === playerId;
    // Leaving a shared cable car never stops it or ejects its other passengers.
    if (!keepMoving && car.entry.kind !== 'cable-car') { car.entry.driverId = 0; car.entry.speedCmps = 0; }
    const pose = groundedExit ? { ...groundedExit, flags: 0 } : this.carPose(car), angle = pose.yaw / 256 * Math.PI * 2;
    // Step to the driver's side; the client applies its terrain/collision contact next frame.
    if (!groundedExit) { pose.x -= Math.round(Math.cos(angle) * 210); pose.z += Math.round(Math.sin(angle) * 210); }
    this.host.pose(playerId, pose, now);
    this.host.emit({ type: 'VEHICLE_STATE', vehicleId, playerId, mode: 'on-foot' });
    this.host.emit({ type: 'CORRECTION', pose }, playerId);
    // personalCar: the road car you drove and left is yours — kept out of the sweep and saved where it stands.
    if (flags.personalCar && wasDriver && !keepMoving && PERSONAL_KINDS.has(car.entry.kind)) {
      this.claimPersonal(playerId, vehicleId, now);
      this.host.personalCarLeft?.(playerId, car.entry.kind, this.carPose(car));
    }
    return true;
  }

  move(playerId: number, message: Extract<C2SMessage, { type: 'VEHICLE_MOVE' }>, now: number): boolean {
    const car = this.cars.get(message.vehicleId);
    if (!car || this.occupants.get(playerId) !== message.vehicleId || car.entry.driverId !== playerId) return false;
    const before = car.movement.pose, elapsed = Math.max(1, now - car.movement.lastAt);
    // 75 m/s (3D) for all driven vehicles: the shared client controller tops out at 48.
    // The extra headroom carries hill-jump vertical airtime
    // (gtasf-car-handling-air-steer) + drift/bump without rubber-banding legitimate driving.
    if (!checkMovement(car.movement, { ...message, type: 'MOVE', flags: 0 }, now, 75)) {
      this.host.emit({ type: 'CORRECTION', pose: { ...this.carPose(car), flags: DRIVER_FLAG } }, playerId);
      return false;
    }
    Object.assign(car.entry, car.movement.pose);
    car.entry.speedCmps = Math.min(6000, Math.round(Math.hypot(car.entry.x - before.x, car.entry.z - before.z) / elapsed * 1000));
    this.host.pose(playerId, { ...this.carPose(car), flags: DRIVER_FLAG }, now);
    return true;
  }

  has(vehicleId: number): boolean { return this.cars.has(vehicleId); }
  entry(vehicleId: number): VehicleEntry | undefined { const car = this.cars.get(vehicleId); return car ? { ...car.entry } : undefined; }
  /** Remove a car from the world (it exploded — vehicleDamage): eject whoever is inside first. */
  remove(vehicleId: number, now: number): boolean {
    if (!this.cars.has(vehicleId)) return false;
    for (const [playerId, id] of [...this.occupants]) if (id === vehicleId) this.exit(playerId, vehicleId, now);
    this.cars.delete(vehicleId);
    return true;
  }

  disconnect(playerId: number, now: number): void {
    const id = this.occupants.get(playerId);
    if (id !== undefined) this.exit(playerId, id, now);
  }
  /** Ownership moves to another zone. Do not dismount, stop the car or emit an exit. */
  detach(playerId: number): number | undefined {
    const id = this.occupants.get(playerId);
    if (id === undefined) return undefined;
    this.occupants.delete(playerId);
    if (this.cars.get(id)?.entry.kind !== 'cable-car') this.cars.delete(id);
    return id;
  }
  addTaxi(vehicleId: number, pose: Pose): void {
    this.cars.set(vehicleId, { entry: { id: vehicleId, ...pose, kind: 'robotaxi', driverId: 0, speedCmps: 0 },
      movement: { pose, seq: 0, accepted: false, carryCm: 0, lastAt: 0 } });
  }
  boardTaxi(playerId: number, vehicleId: number, now: number): boolean {
    const car = this.cars.get(vehicleId);
    if (!car || car.entry.kind !== 'robotaxi' || this.occupants.has(playerId)) return false;
    return this.boardPassenger(playerId, vehicleId, now);
  }
  boardPassenger(playerId: number, vehicleId: number, now: number): boolean {
    const car = this.cars.get(vehicleId);
    if (!car || !['robotaxi', 'cable-car', 'bus'].includes(car.entry.kind) || car.entry.driverId || this.occupants.has(playerId)) return false;
    this.occupants.set(playerId, vehicleId);
    const pose = { ...this.carPose(car), flags: PASSENGER_FLAG };
    this.host.pose(playerId, pose, now);
    this.host.emit({ type: 'VEHICLE_STATE', vehicleId, playerId, mode: 'passenger' });
    this.host.emit({ type: 'CORRECTION', pose }, playerId);
    return true;
  }
  updateCable(entry: VehicleEntry, now: number): void {
    const car = this.cars.get(entry.id);
    if (car) car.entry = entry;
    else this.cars.set(entry.id, { entry, movement: { pose: entry, seq: 0, accepted: false, carryCm: 0, lastAt: now } });
    for (const [playerId, vehicleId] of this.occupants) if (vehicleId === entry.id)
      this.host.pose(playerId, { x: entry.x, y: entry.y, z: entry.z, yaw: entry.yaw, flags: PASSENGER_FLAG }, now);
  }
  /** A validated NPC transfer reuses normal driver ownership and movement authority. */
  takeTraffic(playerId: number, pose: Pose, entry: VehicleEntry, now: number, reachCm = 400): boolean {
    if (this.cars.has(entry.id) || this.occupants.has(playerId) || entry.driverId ||
      !['prius', 'tesla', 'subaru', 'supercar'].includes(entry.kind) ||
      Math.hypot(pose.x - entry.x, pose.y - entry.y, pose.z - entry.z) > reachCm) return false;
    const owned = { ...entry, flags: entry.flags & ~0x20 };
    this.cars.set(entry.id, { entry: owned, movement: { pose: owned, seq: 0, accepted: false, carryCm: MOVE_BURST_CM, lastAt: now } });
    if (this.enter(playerId, pose, entry.id, now, Math.max(550, reachCm))) return true;
    this.cars.delete(entry.id); return false;
  }
  /** Only a server-selected road pose can reset an owned car. No destination comes from the client. */
  respawnDriver(playerId: number, pose: Pose, now: number): boolean {
    const id = this.occupants.get(playerId), car = id === undefined ? undefined : this.cars.get(id);
    if (!car || car.entry.driverId !== playerId) return false;
    Object.assign(car.entry, pose, { flags: 0, speedCmps: 0 });
    car.movement = { pose: { ...pose, flags: 0 }, seq: car.movement.seq, accepted: false, carryCm: 0, lastAt: now };
    this.host.pose(playerId, { ...pose, flags: DRIVER_FLAG }, now);
    this.host.emit({ type: 'CORRECTION', pose: { ...pose, flags: DRIVER_FLAG } }, playerId);
    return true;
  }
  moveTaxi(vehicleId: number, pose: Pose, speedCmps: number, now: number, playerId?: number): void {
    const car = this.cars.get(vehicleId);
    if (!car || car.entry.kind !== 'robotaxi') return;
    Object.assign(car.entry, pose, { speedCmps });
    if (playerId !== undefined && this.occupants.get(playerId) === vehicleId) this.host.pose(playerId, { ...pose, flags: PASSENGER_FLAG }, now);
  }
  snapshot(tick: number, serverT: number): Extract<S2CMessage, { type: 'VEHICLE_SNAPSHOT' }> {
    return { type: 'VEHICLE_SNAPSHOT', tick, serverT, entries: [...this.cars.values()].map(car => ({ ...car.entry })) };
  }
  states(): S2CMessage[] {
    return [...this.occupants].map(([playerId, vehicleId]) => ({ type: 'VEHICLE_STATE', vehicleId, playerId,
      mode: this.cars.get(vehicleId)?.entry.driverId === playerId ? 'driver' : 'passenger' }));
  }
  private carPose(car: Car): Pose {
    const { x, y, z, yaw } = car.entry;
    return { x, y, z, yaw, flags: 0 };
  }
}
