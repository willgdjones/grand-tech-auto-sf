import { flags } from '@gtasf/shared/flags';
import type { Env } from '../env';

/** Public routing only. Ledger internals and review RPCs are never forwarded by URL. */
export async function handleOutbidRequest(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  const known = ['/api/outbid','/api/outbid/checkout','/api/outbid/credit-quote','/api/outbid/receipt','/api/outbid/logo','/api/outbid/webhook'].includes(path)
    || /^\/api\/media\/approved\/[a-f0-9]{32}$/.test(path);
  if (!known) return null;
  const visible = flags.outbidBanner || flags.outbidCrown || flags.outbidPlane;
  // Already-paid webhook/refund accounting continues when new sales/display are switched off.
  if (!visible && path !== '/api/outbid/webhook') return Response.json({ error: 'Outbid is not enabled' }, { status: 404 });
  return env.LEDGER.get(env.LEDGER.idFromName('outbid:test')).fetch(request);
}
