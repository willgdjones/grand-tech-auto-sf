import { flags } from '@gtasf/shared/flags';
import { launchMode, worldCapacity, type AdmissionConfig } from '@gtasf/shared/admission';
import type { Env } from '../../env';
import { admissionJson } from './http';
import { acceptInvite, launchAllowed } from './invite';
import { waitlistResponse } from '../../waitlist/routes';

export async function handleAdmissionRequest(request: Request, env: Env): Promise<Response | undefined> {
  const path = new URL(request.url).pathname;
  if (path === '/api/waitlist') return waitlistResponse(request, env);
  if (path === '/api/invite') return acceptInvite(request, env);
  if (path !== '/api/admission' && !['/api/admission/enter','/api/admission/poll','/api/admission/leave'].includes(path)) return undefined;
  const allowed = await launchAllowed(request, env);
  if (path === '/api/admission') {
    if (request.method !== 'GET') return admissionJson({ error: 'GET required' }, 405);
    return admissionJson({ launchMode: launchMode(env), allowed, capacity: worldCapacity(env), enabled: flags.worldCapacity,
      waitlist: flags.waitlist } satisfies AdmissionConfig);
  }
  if (request.method !== 'POST') return admissionJson({ error: 'POST required' }, 405);
  if (!allowed) return admissionJson({ status: 'waitlist', nextPollS: 15 });
  if (!flags.worldCapacity) return admissionJson({ status: 'admitted', expiresAt: null, nextPollS: 0 });
  return env.LOBBY.get(env.LOBBY.idFromName('sf')).fetch(request);
}
