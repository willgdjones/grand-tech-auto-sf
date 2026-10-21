// Isolated native smoke entry only; production and the shared dev server keep their reviewed flags.
import { flags as base } from '../../../../shared/flags';
export const flags = Object.freeze({ ...base, worldCapacity: true, waitlist: true });
