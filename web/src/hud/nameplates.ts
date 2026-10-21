import { Vector3, type Camera } from 'three';
import { flags } from '@gtasf/shared/flags';
import { formatFunding, type FundingProfile } from '@gtasf/shared/funding';
import './nameplates.css';

/**
 * Overhead player nameplates (PLAN-v2 decision 6): "Startup · nick · Series F · $2.3B" in
 * SA-style text above each visible nearby player, below the proximity chat bubble. The module
 * owns no game loop; main.ts ticks `update` each frame with the same interpolated metre-space
 * roster the chat bubbles use, enriched with each peer's nickname (from PLAYER_JOIN), and feeds
 * the funding leaderboard via `setLeaders`. Clicking a plate calls `onSelect` (cap-table UI, 2r5r).
 *
 * Returns null when flagged off.
 */
export interface NameplatePeer { id: number; x: number; y: number; z: number; name?: string | null }

const PLATE_HEIGHT_M = 2.05;   // Anchor just above the head; chat bubbles float higher (2.2 m).
const MAX_DISTANCE_M = 80;     // Readable range for a persistent label.
const MAX_PLATES = 24;
const HUD_REFRESH_MS = 400;    // Re-read cached HUD rectangles at most this often.
// Peers outside the top-50 leaderboard have no leader entry, so their plate shows nick only. We
// batch-fetch a compact funding summary for them and merge it BEHIND the leaderboard (never over a
// crowned top-50 plate). Throttled + TTL-cached so the per-frame tick stays allocation-free.
const SUMMARY_TTL_MS = 30_000;     // Re-fetch a peer's summary at most this often.
const SUMMARY_BATCH_MS = 4_000;    // Hit the endpoint at most this often.
const SUMMARY_BATCH_MAX = 48;      // Defensive cap (server bound is 64; displayed peers ≤ MAX_PLATES).

interface SummaryEntry { profile: FundingProfile | null; at: number } // null = negative cache (no summary)

/**
 * Pure: nicknames of displayed peers that need a funding summary fetched — not in the leaderboard,
 * and with no fresh (within `ttlMs`) cached summary. De-duplicated and capped at `max`. Extracted so
 * the merge-selection is unit-testable without a DOM. (gtasf-nameplate-funding-beyond-top50-zqnk)
 */
export function summaryFetchBatch(
  named: readonly NameplatePeer[],
  leaders: { has(nick: string): boolean },
  summaries: { get(nick: string): { at: number } | undefined },
  now: number, ttlMs = SUMMARY_TTL_MS, max = SUMMARY_BATCH_MAX,
): string[] {
  const batch: string[] = [];
  const seen = new Set<string>();
  for (const peer of named) {
    const name = peer.name;
    if (typeof name !== 'string' || !name.trim() || seen.has(name)) continue;
    if (leaders.has(name)) continue; // the top-50 leaderboard (with its crown) always wins
    const cached = summaries.get(name);
    if (cached && now - cached.at < ttlMs) continue; // fresh enough (incl. a fresh negative cache)
    seen.add(name); batch.push(name);
    if (batch.length >= max) break;
  }
  return batch;
}
// `.gt-sa-hint--prompt` = the centre near-object key prompt ("E to get in the car", "T to chat"); the
// local/self plate shares that lower-centre band, so include it here and the plate lifts clear of it
// (only while the prompt is actually visible — refreshHudRects skips hidden elements). [#5.6 nameplate↔prompt]
const HUD_SELECTOR = '.gt-funding-room,.gt-gps-status,#app>footer,.gt-radar,.gt-sa-hint--prompt,.gtasf-touch .buttons,.gtasf-touch .stick,.gtasf-touch .ride-hint';

interface Plate { element: HTMLButtonElement; label: HTMLElement; mic: HTMLElement; signature: string; width: number; height: number; }

function compactName(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 22 ? trimmed.slice(0, 21) + '…' : trimmed;
}

/**
 * Pure selection: the named peers (not self) within `maxDistance` metres of self, nearest first,
 * capped at `maxPlates`. When self is absent from the roster, distance is not filtered (every named
 * peer is eligible) but order is still stable. Extracted so the crowd/cap logic is unit-testable.
 */
export function selectNameplatePeers(
  peers: readonly NameplatePeer[], selfId: number,
  maxDistance = MAX_DISTANCE_M, maxPlates = MAX_PLATES, out: NameplatePeer[] = [],
): NameplatePeer[] {
  // Fills `out` in place (no intermediate arrays) so the per-frame caller can reuse one buffer and
  // keep the animation loop allocation-free; callers that omit `out` get a fresh array (tests).
  out.length = 0;
  let me: NameplatePeer | null = null;
  for (const p of peers) if (p.id === selfId) { me = p; break; }
  for (const p of peers) {
    if (p.id === selfId || typeof p.name !== 'string' || p.name.trim().length === 0) continue;
    if (me && Math.hypot(p.x - me.x, p.y - me.y, p.z - me.z) > maxDistance) continue;
    out.push(p);
  }
  const origin = me;
  const dist = (p: NameplatePeer) => origin ? Math.hypot(p.x - origin.x, p.y - origin.y, p.z - origin.z) : 0;
  out.sort((a, b) => dist(a) - dist(b) || a.id - b.id);
  if (out.length > maxPlates) out.length = maxPlates;
  return out;
}

export function createNameplates(options: {
  parent?: HTMLElement;
  onSelect?(peerId: number): void;
  /** Batched compact funding for peers outside the top-50 leaderboard (zqnk); null disables the merge. */
  fetchSummaries?(nicknames: string[]): Promise<FundingProfile[]>;
} = {}) {
  if (!flags.nameplates) return null;

  const layer = document.createElement('div');
  layer.className = 'gt-nameplates'; layer.setAttribute('aria-hidden', 'true');
  (options.parent ?? document.body).append(layer);

  const plates = new Map<number, Plate>();
  const speakers = new Set<number>();
  const plateElements = new WeakMap<Element, { id: number }>();
  const leaders = new Map<string, FundingProfile>();
  // Funding summaries for peers beyond the top-50 leaderboard, keyed by nickname (zqnk). Merged behind
  // `leaders` so a crowned top-50 plate is never overridden. A null entry is a negative cache.
  const summaries = new Map<string, SummaryEntry>();
  let summaryFetchAt = -Infinity, summaryInFlight = false;
  let localProfile: FundingProfile | null = null; // the local player's own funding profile, for their self plate
  const point = new Vector3();
  // Reused across frames so the animation-loop tick allocates nothing (phone 60 fps gate).
  const selected: NameplatePeer[] = [], keep = new Set<number>(), toRemove: number[] = [];
  let disposed = false, selfId = 0;
  // hudDeclutter: the self plate is a timed courtesy, not furniture: SELF_SPAWN_MS after the first tick, SELF_CHANGE_MS
  // after the local profile's name / round / total changes (a cheque landed, a round closed), hidden otherwise.
  const SELF_SPAWN_MS = 10_000, SELF_CHANGE_MS = 6_000;
  let selfShowUntil = -1, localSignature = '';

  // Cache HUD rectangles so plates avoid controls without forcing layout every frame.
  let hudRects: DOMRect[] = [], hudReadAt = 0;
  /** Screen rects of plates placed this frame (reused, no per-frame allocation). */
  const placed: { left: number; right: number; top: number; bottom: number }[] = [];
  let placedCount = 0;
  function refreshHudRects(now: number) {
    if (now - hudReadAt < HUD_REFRESH_MS) return;
    hudReadAt = now;
    hudRects = [];
    for (const element of document.querySelectorAll(HUD_SELECTOR)) {
      if (element.matches('.gt-radar[data-expanded=true]')) continue;
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility !== 'visible') continue;
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) hudRects.push(rect);
    }
  }

  const sizes = new ResizeObserver(entries => {
    for (const entry of entries) {
      const ref = plateElements.get(entry.target); const box = entry.borderBoxSize[0];
      const plate = ref && plates.get(ref.id);
      if (plate && box && box.inlineSize > 0) { plate.width = box.inlineSize; plate.height = box.blockSize; }
    }
  });

  const isTopRaiser = (leader: FundingProfile | undefined): boolean => Boolean(leader && leader.rank != null && leader.rank <= 10);
  const isVerified = (leader: FundingProfile | undefined): boolean => flags.emailCapture && leader?.verifiedFounder === true;

  function buildSignature(peer: NameplatePeer, leader: FundingProfile | undefined): string {
    if (!leader) return `n:${peer.name}`;
    // Rank and verification can change without the nickname, stage or funding changing.
    const top = isTopRaiser(leader) ? `T${leader.rank}` : '';
    return `${leader.startupName}\u0001${peer.name}\u0001${leader.round.label}\u0001${leader.totalCents}\u0001${top}\u0001${isVerified(leader)}`;
  }

  function render(plate: Plate, peer: NameplatePeer, leader: FundingProfile | undefined) {
    plate.label.replaceChildren();
    const nick = compactName(peer.name ?? 'Founder');
    // Top-10 raisers wear a gold crown + rank, matching the radar's gold top-10 dots (PLAN-v2.1 radar/map).
    const top = isTopRaiser(leader);
    plate.element.classList.toggle('gt-nameplate--top', top);
    if (leader) {
      const startup = document.createElement('strong'); startup.textContent = `${top ? '👑 ' : ''}${compactName(leader.startupName || 'Stealth startup')}`;
      if (isVerified(leader)) {
        const verified = document.createElement('span');
        verified.className = 'gt-nameplate-verified'; verified.textContent = '✓';
        verified.title = 'Verified Founder'; verified.setAttribute('aria-label', 'Verified Founder');
        startup.append(verified);
      }
      const meta = document.createElement('span'); meta.className = 'gt-nameplate-meta';
      meta.textContent = `${nick} · ${leader.round.label} · ${formatFunding(leader.totalCents)}${top ? ` · #${leader.rank}` : ''}`;
      plate.label.append(startup, meta);
    } else {
      const only = document.createElement('strong'); only.textContent = nick;
      plate.label.append(only);
    }
  }

  function ensurePlate(id: number): Plate {
    let plate = plates.get(id);
    if (plate) return plate;
    const element = document.createElement('button');
    element.type = 'button'; element.className = 'gt-nameplate'; element.tabIndex = -1;
    const label = document.createElement('span'); label.className = 'gt-nameplate-label';
    const mic = document.createElement('span'); mic.className = 'gt-nameplate-mic'; mic.textContent = '🎙';
    mic.title = 'Speaking'; mic.setAttribute('aria-label', 'Speaking'); mic.hidden = !speakers.has(id);
    element.append(label, mic);
    element.addEventListener('click', () => { if (!disposed) options.onSelect?.(id); });
    layer.append(element);
    plate = { element, label, mic, signature: '', width: 0, height: 0 };
    plates.set(id, plate); plateElements.set(element, { id }); sizes.observe(element);
    return plate;
  }

  function removePlate(id: number) {
    const plate = plates.get(id); if (!plate) return;
    sizes.unobserve(plate.element); plate.element.remove(); plates.delete(id);
  }

  /** Render + screen-position one plate (self or a peer), avoiding HUD rects. The leaderboard takes
   *  precedence over a beyond-top-50 summary, which fills in startup/stage/raised for far-rank peers. */
  function place(camera: Camera, peer: NameplatePeer, leader: FundingProfile | undefined =
    peer.name ? (leaders.get(peer.name) ?? summaries.get(peer.name)?.profile ?? undefined) : undefined) {
    const plate = ensurePlate(peer.id);
    if (flags.hudFocus) plate.element.classList.toggle('gt-nameplate--self', peer.id === selfId); // hudFocus.css hides it under big moments
    const signature = buildSignature(peer, leader);
    if (signature !== plate.signature) { plate.signature = signature; render(plate, peer, leader); }
    point.set(peer.x, peer.y + PLATE_HEIGHT_M, peer.z).project(camera);
    const offscreen = point.z < -1 || point.z > 1 || Math.abs(point.x) > 1 || Math.abs(point.y) > 1;
    plate.element.hidden = offscreen;
    if (offscreen) return;
    const x = (point.x * .5 + .5) * innerWidth, y = (-point.y * .5 + .5) * innerHeight;
    const center = Math.max(8 + plate.width / 2, Math.min(innerWidth - 8 - plate.width / 2, x));
    let bottom = Math.max(8 + plate.height, Math.min(innerHeight - 8, y));
    for (const rect of hudRects) {
      if (center + plate.width / 2 > rect.left - 8 && center - plate.width / 2 < rect.right + 8
        && bottom > rect.top - 8 && bottom - plate.height < rect.bottom + 8) bottom = rect.top - 8;
    }
    // Plates of players standing together overlapped into unreadable text at the Ferry spawn. Peers are placed
    // nearest-first, so the nearest keeps its anchor and each later overlapping plate stacks just above it.
    const half = plate.width / 2;
    for (let pass = 0, moved = true; moved && pass < 8; pass++) {
      moved = false;
      for (let i = 0; i < placedCount; i++) {
        const r = placed[i]!;
        if (center + half > r.left + 2 && center - half < r.right - 2 && bottom > r.top + 1 && bottom - plate.height < r.bottom - 1) {
          bottom = r.top - 2; moved = true;
        }
      }
    }
    if (plate.width > 0) {
      const r = placed[placedCount] ??= { left: 0, right: 0, top: 0, bottom: 0 };
      r.left = center - half; r.right = center + half; r.top = bottom - plate.height; r.bottom = bottom; placedCount++;
    }
    plate.element.style.left = `${center}px`;
    plate.element.style.top = `${bottom}px`;
    plate.element.style.visibility = plate.width > 0 && bottom - plate.height >= 8 ? '' : 'hidden';
  }

  return {
    element: layer,
    setSpeaking(id: number, active: boolean) {
      if (!flags.proximityVoice || disposed) return;
      if (active) speakers.add(id); else speakers.delete(id);
      const plate = plates.get(id); if (plate) plate.mic.hidden = !active;
    },
    /** Replace the funding leaderboard snapshot used to fill startup/stage/raised (by nickname). */
    setLeaders(list: readonly FundingProfile[]) {
      leaders.clear();
      for (const leader of list) if (leader.nickname) leaders.set(leader.nickname, leader);
    },
    /** The local player's own funding profile, used to fill their own plate directly (FB2 gtasf-azlg). */
    setLocal(profile: FundingProfile | null) {
      // A stale leaderboard/poll row without a name must not flip a named plate back to "Stealth startup".
      localProfile = profile && !profile.startupName && localProfile?.startupName && localProfile.deviceId === profile.deviceId
        ? { ...profile, startupName: localProfile.startupName } : profile;
      if (flags.hudDeclutter) {
        const signature = localProfile ? `${localProfile.startupName}\u0001${localProfile.round.label}\u0001${localProfile.totalCents}` : '';
        if (signature !== localSignature) {
          // The first profile arrives with the spawn window already open; later changes re-show the plate briefly.
          if (localSignature !== '') selfShowUntil = Math.max(selfShowUntil, performance.now() + SELF_CHANGE_MS);
          localSignature = signature;
        }
      }
    },
    /**
     * Per frame: project each named, in-range peer and position its plate; hide the rest. When
     * `showLocal` is set, also render the local player's own plate above their avatar (FB2
     * gtasf-azlg) — main.ts passes the local nick in the self roster entry and only sets showLocal
     * while the player's avatar is visible.
     */
    update(camera: Camera, localId: number, peers: Iterable<NameplatePeer>, now = performance.now(), showLocal = false) {
      if (disposed) return;
      selfId = localId || selfId;
      refreshHudRects(now);
      // Reuses the `selected` buffer; `peers` is already an array in the hot path, so no copy is made.
      const list = Array.isArray(peers) ? peers as readonly NameplatePeer[] : [...peers];
      keep.clear(); placedCount = 0;
      if (flags.hudDeclutter && selfShowUntil < 0) selfShowUntil = now + SELF_SPAWN_MS; // first tick = spawn
      if (showLocal && (!flags.hudDeclutter || now < selfShowUntil)) {
        const self = list.find(p => p.id === selfId && typeof p.name === 'string' && p.name.trim().length > 0);
        if (self) { keep.add(self.id); place(camera, self, localProfile ?? undefined); }
      }
      // Nearest-first, in-range, capped — keeps the closest plates when a crowd forms.
      const named = selectNameplatePeers(list, selfId, MAX_DISTANCE_M, MAX_PLATES, selected);
      // A stale/duplicate roster entry for yourself (reconnect ghost) must not draw a second local plate.
      // Only a same-named peer standing on top of you (<1.5 m) is a ghost; other same-named players still get plates.
      const self = list.find(p => p.id === selfId), selfName = self?.name?.trim();
      for (const peer of named) {
        if (self && selfName && peer.id !== selfId && peer.name?.trim() === selfName && Math.hypot(peer.x - self.x, peer.z - self.z) < 1.5) continue;
        keep.add(peer.id); place(camera, peer);
      }
      // Beyond-top-50 funding merge (zqnk): throttled so the batch array is built at most every few
      // seconds, not per frame. Resolved summaries render on the next tick via place()'s lookup.
      if (options.fetchSummaries && !summaryInFlight && now - summaryFetchAt >= SUMMARY_BATCH_MS) {
        if (summaries.size > 256) for (const [nick, entry] of summaries) if (now - entry.at >= SUMMARY_TTL_MS) summaries.delete(nick);
        const batch = summaryFetchBatch(named, leaders, summaries, now);
        if (batch.length) {
          summaryFetchAt = now; summaryInFlight = true;
          options.fetchSummaries(batch).then(result => {
            const found = new Set<string>();
            for (const profile of result) if (profile.nickname) { summaries.set(profile.nickname, { profile, at: now }); found.add(profile.nickname); }
            for (const nick of batch) if (!found.has(nick)) summaries.set(nick, { profile: null, at: now }); // negative cache
          }).catch(() => { /* transient: retry after the throttle window */ }).finally(() => { summaryInFlight = false; });
        }
      }
      toRemove.length = 0;
      for (const id of plates.keys()) if (!keep.has(id)) toRemove.push(id);
      for (const id of toRemove) removePlate(id);
    },
    destroy() {
      if (disposed) return; disposed = true;
      sizes.disconnect();
      for (const id of [...plates.keys()]) removePlate(id);
      layer.remove();
    },
  };
}
