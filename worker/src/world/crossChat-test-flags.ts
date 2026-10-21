// Isolated native smoke for cross-border chat (gtasf-1xd4). zonedWorld on so /api/world routes per cell
// and the WorldChat relay fans out; chat/eventChat on so chat runs; worldCapacity off so bots connect
// without an admission grant. The shared/dev/prod flags are untouched (zonedWorld stays off there).
import { flags as base } from '../../../shared/flags';
export const flags = Object.freeze({ ...base, zonedWorld: true, chat: true, eventChat: true, worldCapacity: false });
