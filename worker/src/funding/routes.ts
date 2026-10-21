import { flags } from '@gtasf/shared/flags';
import type { Env } from '../env';
import { ensureFundingDevice, fundingSameOrigin } from './identity';
import { getFundingProfile } from './store';

export function fundingJson(value: unknown, status = 200, cookie?: string): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', ...(cookie ? { 'Set-Cookie': cookie } : {}) } });
}
/** The world DO can throw (it restarted after a deploy / was reset / is overloaded) or answer 503 for a transient D1
 *  error — QA saw GET /api/funding/status 503 on 2 of ~8 boots. Idempotent GETs get ONE retry after 250 ms; POSTs are
 *  never retried (they may carry money). The cause is logged (error name + short message; no ids) for `wrangler tail`. */
async function forwardToWorld(request: Request, env: Env, path: string): Promise<Response> {
  const send = (req: Request) => env.WORLD.get(env.WORLD.idFromName('sf')).fetch(req);
  if (request.method !== 'GET') return send(request);
  let first: Response | undefined;
  try {
    first = await send(new Request(request));
    if (first.status !== 503) return first;
    console.warn('funding GET 503 from world, retrying', path);
  } catch (error) {
    console.warn('funding GET world fetch threw, retrying', path, error instanceof Error ? `${error.name}: ${error.message.slice(0, 120)}` : 'unknown');
  }
  await new Promise(resolve => setTimeout(resolve, 250));
  try { return await send(new Request(request)); }
  catch (error) { if (first) return first; throw error; }
}
export async function handleFundingRequest(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith('/api/funding/')) return null;
  if (!flags.fundingLoop) return fundingJson({ error: 'Funding gameplay is disabled' }, 503);
  if (!fundingSameOrigin(request)) return fundingJson({ error: 'Same-origin request required' }, 403);
  try {
    if (path !== '/api/funding/profile' || request.method === 'POST') {
      if (!['/api/funding/profile', '/api/funding/leaderboard', '/api/funding/event', '/api/funding/start', '/api/funding/status', '/api/funding/cancel', '/api/funding/parties', '/api/funding/captable', '/api/funding/pitch', '/api/funding/pitch-text', '/api/funding/summary', '/api/funding/collected', '/api/funding/drive-start', '/api/funding/drive-complete', '/api/funding/share-claim', '/api/funding/mission-start', '/api/funding/mission-complete', '/api/funding/rob-start', '/api/funding/rob-complete', '/api/funding/buy-armour', '/api/funding/pilgrimage', '/api/funding/pilgrimage-claim', '/api/funding/missions', '/api/funding/tt-start', '/api/funding/tt-submit', '/api/funding/mission-abandon', '/api/funding/race-host', '/api/funding/race-join', '/api/funding/heist-join', '/api/funding/rank', '/api/funding/personal-car', '/api/funding/personal-car-deliver', '/api/funding/garage', '/api/funding/garage-keep', '/api/funding/garage-deliver'].includes(path))
        return fundingJson({ error: 'Not found' }, 404);
      // Await inside the boundary: a transient DO connection loss must become an
      // HTTP response rather than an unhandled rejection in the local proxy.
      return await forwardToWorld(request, env, path);
    }
    if (request.method === 'GET') {
      const identity = await ensureFundingDevice(request, env.DB, Date.now());
      return fundingJson(await getFundingProfile(env.DB, identity.deviceId, Date.now()), 200, identity.cookie);
    }
    return fundingJson({ error: 'Method not allowed' }, 405);
  } catch (error) {
    const invalidProfile = path === '/api/funding/profile' && error instanceof RangeError;
    return fundingJson({ error: invalidProfile ? error.message : 'Funding is temporarily unavailable' }, invalidProfile ? 400 : 503);
  }
}
