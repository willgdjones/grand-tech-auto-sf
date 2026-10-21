import type { Pose } from '@gtasf/shared/protocol/types';
import { cableCarIds, CABLE_BOARDING_RADIUS_M, isCableCar, sampleCableCar } from '@gtasf/shared/transit/cableCars';
import { isMuniBus, muniBusIds, MUNI_BOARDING_RADIUS_M, MUNI_CAPACITY, sampleMuniBus } from '@gtasf/shared/transit/muni';
import { flags } from '@gtasf/shared/flags';
import { PASSENGER_FLAG, type WorldVehicles } from './vehicles';

/** Server-driven scheduled transit: cable cars and (flag muni) the Muni 39 Coit buses (gtasf-4hsj). */
export const isScheduledTransit = (id: number) => isCableCar(id) || (flags.muni && isMuniBus(id));

/** Seating is authoritative; the time-derived cars do not need position snapshots. */
export class WorldCableCars {
  constructor(private readonly fleet: WorldVehicles) {}
  /** Only progress in an occupied server-driven cable car renews input activity. */
  renewPassengerActivity(playerId: number, before: Pose, after: Pose, now: number, activity: { lastInput: number }): void {
    const id = this.fleet.occupants.get(playerId);
    if (id === undefined || !isScheduledTransit(id)) return;
    const car = this.fleet.cars.get(id)?.entry;
    if (!car || (car.kind !== 'cable-car' && car.kind !== 'bus') || car.driverId !== 0 || car.speedCmps <= 0 ||
      before.flags !== PASSENGER_FLAG || after.flags !== PASSENGER_FLAG ||
      after.x !== car.x || after.y !== car.y || after.z !== car.z ||
      (before.x === after.x && before.y === after.y && before.z === after.z)) return;
    activity.lastInput = now;
  }
  step(now: number): void {
    for (const id of cableCarIds) {
      const state = sampleCableCar(id, now)!;
      this.fleet.updateCable(state.entry, now);
    }
    if (flags.muni) for (const id of muniBusIds) this.fleet.updateCable(sampleMuniBus(id, now)!.entry, now);
  }
  board(playerId: number, pose: Pose, vehicleId: number, now: number): boolean {
    if (!isScheduledTransit(vehicleId) || this.fleet.occupants.has(playerId)) return false;
    const bus = isMuniBus(vehicleId), state = bus ? sampleMuniBus(vehicleId, now)! : sampleCableCar(vehicleId, now)!;
    const radius = bus ? MUNI_BOARDING_RADIUS_M : CABLE_BOARDING_RADIUS_M, capacity = bus ? MUNI_CAPACITY : 12;
    // Only a stopped vehicle in reach with a free seat; moving/remote/full boarding is rejected.
    if (!state.boarding || Math.hypot(pose.x - state.entry.x, pose.y - state.entry.y, pose.z - state.entry.z) > radius * 100) return false;
    if ([...this.fleet.occupants.values()].filter(id => id === vehicleId).length >= capacity) return false;
    this.fleet.updateCable(state.entry, now);
    return this.fleet.boardPassenger(playerId, vehicleId, now);
  }
}
