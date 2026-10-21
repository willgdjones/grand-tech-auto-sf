import type { Env } from '../env';
import { handleAdmissionRequest } from './admission/routes';
export { WorldDO } from './WorldDO';
export { LobbyDO } from './LobbyDO';
export default { async fetch(request: Request, env: Env) {
  return await handleAdmissionRequest(request, env) ??
    (new URL(request.url).pathname === '/api/world' ? env.WORLD.get(env.WORLD.idFromName('sf')).fetch(request) : new Response('Not found', { status: 404 }));
} };
