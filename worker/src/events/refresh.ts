import { fetchOfficialEvents, type FeedOptions } from './official-feed';
import { storeEvents } from './store';

/** Only a complete successful import can retire an event removed from the official feed. */
export async function refreshOfficialEvents(db:D1Database,options:FeedOptions={}){
  const snapshot=await fetchOfficialEvents(options);
  const stored=await storeEvents(db,snapshot.events,snapshot.capturedAt);
  await db.prepare("DELETE FROM events WHERE source='tech-week' AND updated_at < ?").bind(snapshot.capturedAt).run();
  return {capturedAt:snapshot.capturedAt,sourceTotal:snapshot.sourceTotal,stored};
}
