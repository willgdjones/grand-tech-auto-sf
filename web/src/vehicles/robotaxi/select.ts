import type { RadarDestination, RadarEvent } from '../../radar/radar';
import type { TaxiDestination } from './client';

/** Commit destination UI only after the hail is accepted by the client. */
export function selectTaxiDestination(target: TaxiDestination, options: {
  hail(target: TaxiDestination): boolean;
  events: readonly RadarEvent[];
  select(target: RadarDestination): void;
}): boolean {
  if (!options.hail(target)) return false;
  const event = target.event ? options.events.find(event => event.id === target.event!.id) : undefined;
  options.select({ ...target, event });
  return true;
}
