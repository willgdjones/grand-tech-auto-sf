/**
 * GTASF SF Pilgrimage — client tracker (docs/PLAN-gta-pivot.md LANE C task 6). Loads the device's collected
 * landmarks, and when the player walks/drives into an uncollected one POSTs /api/funding/pilgrimage-claim; the
 * WorldDO pays from the authoritative pose + travel anchor (worker/src/founder/pilgrimage.ts), so this side only
 * decides WHEN to ask. Headless of the 3D scene; main.ts mounts it behind flags.pilgrimage.
 */
import type { FundingProfile } from '@gtasf/shared/funding';
import { PILGRIMAGE_MIN_TRAVEL_M, PILGRIMAGE_RADIUS_M, PILGRIMAGE_SITES, type PilgrimageSite } from '@gtasf/shared/founder/pilgrimage';
import { placePoint } from '../spawn/locations';

export interface PilgrimageDeps {
  notify(title: string, detail?: string): void;
  onProfile(profile: FundingProfile): void;
  /** This tab's WELCOME session id, so the claim binds to this connection (two-tab fix). */
  sid?(): number;
  /** Collected-set changed (re-render the phone list). */
  onChange?(): void;
  /** Funnel hook: a landmark was credited (analytics; no game effect). */
  onCollect?(siteId: string, collected: number): void;
  fetcher?: typeof fetch;
}

export interface PilgrimageTracker {
  /** Fetch the collected list (call on mount and when the phone opens). */
  load(): Promise<void>;
  /** Per-frame: claim a site on entering its radius. */
  update(player: { readonly x: number; readonly z: number }): void;
  sites(): readonly { site: PilgrimageSite; collected: boolean }[];
  readonly collectedCount: number;
}

const RETRY_MS = 2500; // server pose lags the client by a tick or two at the radius edge

export function createPilgrimageTracker(deps: PilgrimageDeps): PilgrimageTracker {
  const fetcher = deps.fetcher ?? fetch;
  const points = new Map(PILGRIMAGE_SITES.map(site => [site.id, placePoint(site)]));
  const collected = new Set<string>();
  let loaded = false, pending = false, loadAt = 0;
  const nextTryAt = new Map<string, number>();
  const needExit = new Set<string>(); // told "no-travel": wait until the player leaves before asking again
  const toldNoTravel = new Set<string>(); // explain the teleport rule once per site per page load

  async function load(): Promise<void> {
    try {
      const r = await fetcher('/api/funding/pilgrimage', { credentials: 'same-origin' });
      if (!r.ok) return;
      const data = await r.json() as { collected?: string[] };
      for (const id of data.collected ?? []) collected.add(id);
      loaded = true; deps.onChange?.();
    } catch { /* offline: retried on the next phone open */ }
  }

  async function claim(site: PilgrimageSite): Promise<void> {
    pending = true;
    try {
      const r = await fetcher('/api/funding/pilgrimage-claim', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ siteId: site.id, sid: deps.sid?.() }) });
      const res = await r.json().catch(() => null) as { status?: string; profile?: FundingProfile; outcome?: { amountCents?: string; bonusCents?: string | null; collected?: number; total?: number } } | null;
      if (res?.status === 'completed') {
        collected.add(site.id); deps.onChange?.(); deps.onCollect?.(site.id, collected.size);
        // The profile update raises the funding cheque card (label "SF pilgrimage: <site> (n/12)", amount), so no
        // toast here — a second announcement stacked on top of it.
        if (res.profile) deps.onProfile(res.profile);
      } else if (res?.status === 'blocked') { collected.add(site.id); deps.onChange?.(); }
      else if (res?.status === 'no-travel') {
        needExit.add(site.id);
        if (!toldNoTravel.has(site.id)) deps.notify(`${site.name}: you teleported in`, `Walk ${PILGRIMAGE_MIN_TRAVEL_M} m+ away and come back to collect it.`);
        toldNoTravel.add(site.id);
      } else if (res?.status === 'unnamed') {
        needExit.add(site.id);
        deps.notify('Found your startup first.', `Then come back to ${site.name} to collect it.`);
      } else nextTryAt.set(site.id, Date.now() + RETRY_MS); // too-far (pose lag) / offline / 503
    } catch { nextTryAt.set(site.id, Date.now() + RETRY_MS); } finally { pending = false; }
  }

  return {
    load,
    update(player) {
      const now = Date.now();
      // The device cookie may not exist yet at mount (a brand-new player): keep retrying the list until it loads.
      if (!loaded) { if (now >= loadAt) { loadAt = now + 10_000; void load(); } return; }
      if (pending) return;
      for (const site of PILGRIMAGE_SITES) {
        if (collected.has(site.id)) continue;
        const p = points.get(site.id)!;
        // Ask a little inside the server radius so the server pose (one tick behind) is inside too.
        const inside = Math.hypot(player.x - p.x, player.z - p.z) <= PILGRIMAGE_RADIUS_M - 5;
        if (!inside) { needExit.delete(site.id); continue; }
        if (needExit.has(site.id) || now < (nextTryAt.get(site.id) ?? 0)) continue;
        void claim(site);
        return;
      }
    },
    sites: () => PILGRIMAGE_SITES.map(site => ({ site, collected: collected.has(site.id) })),
    get collectedCount() { return collected.size; },
  };
}
