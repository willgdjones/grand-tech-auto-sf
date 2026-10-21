/**
 * Place stamps client (flag placeStamps, living map item 7): walking or driving within STAMP_RADIUS_M of a real SF
 * place stamps it once per device via /api/places/stamps, with a toast "Stamped: OpenAI · place stamps 12/202".
 */
import { flags } from '@gtasf/shared/flags';
import { projectLocation, type MapFrame } from '../radar/projection';

export const STAMP_RADIUS_M = 25;
type Place = { id: string; name: string; x: number; z: number };

export function createPlaceStamps(options: { frame: MapFrame; notify(text: string): void }) {
  if (!flags.placeStamps) return null;
  let places: Place[] = [], stamped = new Set<string>(), total = 0, ready = false, pending = false, lastCheck = 0;
  void Promise.all([
    fetch('/data/places.json').then(r => r.ok ? r.json() : null) as Promise<{ places?: { id: string; name: string; lat: number | null; lon: number | null }[] } | null>,
    fetch('/api/places/stamps', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null) as Promise<{ stamps?: string[]; total?: number } | null>,
  ]).then(([data, mine]) => {
    places = (data?.places ?? []).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon))
      .map(p => { const at = projectLocation(p.lat!, p.lon!, options.frame); return { id: p.id, name: p.name, x: at.x, z: at.z }; });
    stamped = new Set(mine?.stamps ?? []); total = mine?.total ?? places.length; ready = !!mine;
  }).catch(() => undefined);
  return {
    update(at: { x: number; z: number }, now = performance.now()) {
      if (!ready || pending || now - lastCheck < 1000) return;
      lastCheck = now;
      const place = places.find(p => !stamped.has(p.id) && Math.hypot(p.x - at.x, p.z - at.z) <= STAMP_RADIUS_M);
      if (!place) return;
      pending = true;
      void fetch('/api/places/stamps', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ placeId: place.id }) })
        .then(r => r.json() as Promise<{ ok?: boolean; count?: number; total?: number; fresh?: boolean; error?: string }>)
        .then(result => {
          if (result.ok) { stamped.add(place.id); if (result.fresh) options.notify(`Stamped: ${place.name} · place stamps ${result.count}/${result.total ?? total}`); }
          else if (result.error === 'unknown-place') stamped.add(place.id);
        })
        .catch(() => undefined).finally(() => { pending = false; });
    },
    get count() { return stamped.size; },
  };
}
