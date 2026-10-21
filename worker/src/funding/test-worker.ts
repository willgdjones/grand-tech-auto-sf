import type { Env } from '../env';
import { handleFundingRequest } from './routes';
export { WorldDO } from '../world/WorldDO';
export default { async fetch(request: Request, env: Env) {
  const funding = await handleFundingRequest(request, env); if (funding) return funding;
  if (new URL(request.url).pathname === '/api/world') return env.WORLD.get(env.WORLD.idFromName('sf')).fetch(request);
  return new Response('Not found', { status: 404 });
} };
