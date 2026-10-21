// Isolated native smoke entry for the zoned world. zonedWorld on; worldCapacity off so
// observers and players connect without the admission-grant flow (zoned capacity
// integration is a later phase). Production and the shared dev server keep reviewed flags.
import { flags as base } from '../../../shared/flags';
export const flags = Object.freeze({ ...base, zonedWorld: true, worldCapacity: false });
