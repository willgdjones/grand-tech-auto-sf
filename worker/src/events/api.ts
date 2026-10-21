import { flags } from '@gtasf/shared/flags';
import type { Env } from '../env';
import snapshot from './data/sf-tech-week.json';
import { listEvents } from './store';

export async function eventsResponse(env: Pick<Env, 'ENVIRONMENT' | 'DB'>): Promise<Response> {
  const localSnapshot = env.ENVIRONMENT === 'local' && flags.localEventSnapshot;
  if (!flags.eventsApi && !flags.events && !localSnapshot) return Response.json({ events: [], enabled: false });
  try {
    const events = await listEvents(env.DB);
    if (events.length || !localSnapshot) return Response.json({ events, enabled: true, dataSource: 'd1' }, { headers: { 'cache-control': 'public, max-age=60' } });
  } catch {
    if (!localSnapshot) return Response.json({ error: 'Events temporarily unavailable', enabled: true }, { status: 503 });
  }
  // Explicit local playtest data, available before migrations and without any external secrets.
  return Response.json({ events: snapshot.events, enabled: true, dataSource: 'local-snapshot', capturedAt: snapshot.capturedAt,
    approximateLocations: true }, { headers: { 'cache-control': 'public, max-age=60' } });
}
