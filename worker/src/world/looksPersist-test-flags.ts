// Isolated smoke for appearance persistence + cross-zone observer looks (gtasf-apsync2). zonedWorld on
// (so observer sockets exist) + characterLooks on (so APPEARANCE is emitted); worldCapacity off so
// players/observers connect without a grant. Shared/dev/prod flags are untouched.
import { flags as base } from '../../../shared/flags';
export const flags = Object.freeze({ ...base, zonedWorld: true, characterLooks: true, worldCapacity: false });
