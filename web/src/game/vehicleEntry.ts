import { isMuniBus } from '@gtasf/shared/transit/muni';
import { flags } from '@gtasf/shared/flags';
import type { VehicleEntry } from '@gtasf/shared/protocol/types';

export function vehicleEntryMode(entry: VehicleEntry, atStop = true): 'driver' | 'passenger' | null {
  if (entry.driverId) return null;
  const moving = flags.rideAnyVehicle && !flags.zonedWorld;
  if (entry.flags & 0x20) return moving ? (['bus', 'robotaxi', 'cable-car'].includes(entry.kind) ? 'passenger' : 'driver') : null;
  if (entry.kind === 'robotaxi') return null; // Dispatched taxis belong to their hailing player.
  if (entry.kind === 'cable-car') return moving || entry.speedCmps === 0 ? 'passenger' : null;
  if (entry.kind === 'bus' && isMuniBus(entry.id) && moving) return 'passenger';
  return atStop ? 'driver' : null;
}
export function vehicleEntryRadius(entry: VehicleEntry): number {
  return flags.rideAnyVehicle && !flags.zonedWorld && ((entry.flags & 0x20) || entry.kind === 'cable-car' || entry.kind === 'bus' && isMuniBus(entry.id)) ? 4 : 5.5;
}
