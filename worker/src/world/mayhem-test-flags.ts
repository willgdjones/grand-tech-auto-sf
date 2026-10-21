// Isolated native smoke entry for Playful Mayhem sync (gtasf-mayhem-sync-4fez). playfulMayhem on so
// the MAYHEM_FIRE relay is live; worldCapacity off so players connect without the admission-grant
// flow. Production and the shared dev server keep their reviewed flags.
import { flags as base } from '../../../shared/flags';
export const flags = Object.freeze({ ...base, playfulMayhem: true, worldCapacity: false });
