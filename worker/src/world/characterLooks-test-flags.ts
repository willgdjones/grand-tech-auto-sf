// Isolated native smoke for appearance sync. characterLooks on so the worker emits/relays the new
// APPEARANCE opcode; worldCapacity off so players connect without the admission grant. Production and
// the shared dev server keep their reviewed flags (characterLooks stays out of the prod allowlist).
import { flags as base } from '../../../shared/flags';
export const flags = Object.freeze({ ...base, characterLooks: true, worldCapacity: false });
