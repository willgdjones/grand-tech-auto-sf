/**
 * Live street races — client (flag streetRaces; server: worker/src/world/streetRaces.ts). Shows a "Host a street race"
 * button at a time-trial 'T' marker, invite cards (Join), the lobby, a 3-2-1-GO countdown, a race HUD (gate n/N + clock)
 * with the next gate on the minimap, finish toasts and the results card. Every rule is server-side; this only renders the
 * server's QUEST events and POSTs host/join. Self-contained DOM + CSS.
 */
import { TIME_TRIALS, timeTrialById, type TimeTrialSpec } from '@gtasf/shared/founder/timeTrials';
import { parseQuestEvent, type QuestEvent } from '@gtasf/shared/founder/questEvents';
import { placePoint } from '../spawn/locations';
import { flags } from '@gtasf/shared/flags';
import './streetRaceClient.css';

export interface StreetRaceClientDeps {
  sid(): number | undefined;
  notify(title: string, detail?: string): void;
  /** Route the GPS to a race's start (an invitee too far to join). */
  routeTo(spec: TimeTrialSpec): void;
  /** Don't offer the host button while another job/trial/modal owns the player. */
  busy(): boolean;
  parent?: HTMLElement;
}
export interface StreetRaceClient {
  /** A raw S2C QUEST body (ignored unless it's a race event). */
  onQuest(json: string): void;
  /** Per frame: the host button near a 'T', the race clock. */
  update(player: { readonly x: number; readonly z: number }): void;
  /** The next gate while racing, for the minimap letter layer. */
  readonly marker: { x: number; z: number; letter: string } | null;
  /** raceRivals: the NPC rivals' positions along the route (red numbered pins), while racing. */
  readonly rivalMarkers: readonly { x: number; z: number; letter: string; fill: string }[];
  /** In a race (lobby / countdown / running): other E-interactions at the 'T' should stand down. */
  readonly racing: boolean;
  dispose(): void;
}

const HOST_RADIUS_M = 25; // a bit inside the server's 60 m so the server pose agrees
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = '') => { const n = document.createElement(tag); n.className = cls; if (text) n.textContent = text; return n; };
const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${(Math.floor(ms / 1000) % 60).toString().padStart(2, '0')}.${Math.floor((ms % 1000) / 100)}`;

export function createStreetRaceClient(deps: StreetRaceClientDeps): StreetRaceClient {
  const parent = deps.parent ?? document.body;
  const host = el('button', 'gt-race-host', '🏁 Host a street race'); host.type = 'button'; host.hidden = true;
  const card = el('section', 'gt-race-card'); card.hidden = true;
  const hud = el('div', 'gt-race-hud'); hud.hidden = true;
  const count = el('div', 'gt-race-count'); count.hidden = true;
  parent.append(host, card, hud, count);

  let nearSpec: TimeTrialSpec | null = null;
  let race: { id: string; spec: TimeTrialSpec; state: 'lobby' | 'countdown' | 'running'; goAt: number; reached: number; rivals?: { name: string; ms: number }[] } | null = null;
  // raceRivals: the route as a polyline (start → checkpoints → finish) with cumulative lengths, so a rival's progress
  // (elapsed / their finish time) and the player's (gates passed + the leg so far) compare on one scale for POS n/N.
  function routeLine(spec: TimeTrialSpec): { pts: { x: number; z: number }[]; cum: number[] } {
    const pts = [spec.start, ...spec.checkpoints.map(c => c.at), spec.finish.at].map(g => placePoint(g));
    const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z));
    return { pts, cum };
  }
  function pointAt(line: ReturnType<typeof routeLine>, d: number): { x: number; z: number } {
    const total = line.cum.at(-1)!; d = Math.max(0, Math.min(total, d));
    let i = 1; while (i < line.cum.length - 1 && line.cum[i]! < d) i++;
    const a = line.pts[i - 1]!, b = line.pts[i]!, seg = line.cum[i]! - line.cum[i - 1]! || 1, k = (d - line.cum[i - 1]!) / seg;
    return { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k };
  }
  function playerProgress(line: ReturnType<typeof routeLine>, reached: number, p: { x: number; z: number }): number {
    if (reached >= line.pts.length - 1) return line.cum.at(-1)!;
    const next = line.pts[reached + 1]!, legEnd = line.cum[reached + 1]!;
    return Math.max(line.cum[reached]!, legEnd - Math.hypot(p.x - next.x, p.z - next.z));
  }
  let cardTimer: ReturnType<typeof setTimeout> | undefined;

  async function post(path: string, body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    try {
      const r = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, sid: deps.sid() }) });
      return await r.json() as Record<string, unknown>;
    } catch { return null; }
  }
  function showCard(title: string, lines: string[], actions: { label: string; run(): void }[], ttlMs = 0): void {
    card.replaceChildren(el('div', 'gt-race-card-title', title), ...lines.map(l => el('div', 'gt-race-card-line', l)));
    const row = el('div', 'gt-race-card-actions');
    for (const a of actions) { const b = el('button', 'gt-race-card-btn', a.label); b.type = 'button'; b.addEventListener('click', () => { card.hidden = true; a.run(); }); row.append(b); }
    const close = el('button', 'gt-race-card-btn gt-race-card-close', actions.length ? 'Dismiss' : 'Close'); close.type = 'button';
    close.addEventListener('click', () => { card.hidden = true; }); row.append(close);
    card.append(row); card.hidden = false;
    if (cardTimer) clearTimeout(cardTimer);
    if (ttlMs) cardTimer = setTimeout(() => { card.hidden = true; }, ttlMs);
  }
  function countdown(startsInMs: number): void {
    const end = performance.now() + startsInMs;
    count.hidden = false;
    const tick = () => {
      const left = end - performance.now();
      if (!race || race.state === 'lobby') { count.hidden = true; return; }
      count.textContent = left > 0 ? String(Math.ceil(left / 1000)) : 'GO!';
      if (left > -800) requestAnimationFrame(tick); else count.hidden = true;
    };
    tick();
  }

  host.addEventListener('click', async () => {
    const spec = nearSpec; // capture: the per-frame update() can clear nearSpec while the POST is in flight
    if (!spec) return;
    const res = await post('/api/funding/race-host', { routeId: spec.id });
    if (res?.status !== 'hosting') { deps.notify('Can’t host a race here.', res?.status === 'busy' ? 'You’re already in a race.' : 'Stand at the T marker.'); return; }
    if (!race || race.id !== String(res.raceId)) race = { id: String(res.raceId), spec, state: 'lobby', goAt: 0, reached: 0 };
    deps.notify(`${spec.title}: race open`, 'Nearby founders have 30 s to join.');
  });

  function handle(event: QuestEvent): void {
    switch (event.kind) {
      case 'race-invite': {
        const spec = timeTrialById(event.routeId); if (!spec || race) return;
        showCard(`🏁 ${event.host} is racing ${spec.title}`, [`${spec.mode === 'drive' ? 'Bring a car.' : 'On foot.'} Join at the T within ${Math.round(event.joinInMs / 1000)} s.`],
          [{ label: 'Join', run: async () => {
            const res = await post('/api/funding/race-join', { raceId: event.raceId });
            if (res?.status === 'joined') { race = { id: event.raceId, spec, state: 'lobby', goAt: 0, reached: 0 }; return; }
            if (res?.status === 'too-far') { deps.routeTo(spec); deps.notify('Get to the T marker to join.', 'GPS set to the start.'); }
            else deps.notify('That race is closed.');
          } }], event.joinInMs);
        return;
      }
      case 'race-lobby': {
        const spec = timeTrialById(event.routeId); if (!spec) return;
        if (!race || race.id !== event.raceId) race = { id: event.raceId, spec, state: 'lobby', goAt: 0, reached: 0 };
        showCard(`🏁 ${spec.title} — lobby`, [`Racers: ${event.racers.join(', ')}`, `Starts in ${Math.round(event.closesInMs / 1000)} s.`,
          ...(flags.raceRivals && event.racers.length < 2 ? ['Nobody joins? You’ll race three rivals.'] : [])], [], event.closesInMs);
        return;
      }
      case 'race-countdown':
        if (race?.id !== event.raceId) return;
        race.state = 'countdown'; race.goAt = performance.now() + event.startsInMs; card.hidden = true; countdown(event.startsInMs);
        if (event.rivals?.length) { race.rivals = event.rivals; deps.notify(`🏁 Racing ${event.rivals.length} rivals`, event.rivals.map(r => r.name).join(' · ')); }
        return;
      case 'race-go':
        if (race?.id !== event.raceId) return;
        race.state = 'running'; race.goAt = Math.min(race.goAt || performance.now(), performance.now());
        return;
      case 'race-gate':
        if (race?.id === event.raceId) race.reached = event.reached;
        return;
      case 'race-finish':
        if (race?.id === event.raceId) deps.notify(`🏁 #${event.place} ${event.name}`, clock(event.ms));
        return;
      case 'race-results': {
        if (race?.id !== event.raceId) return;
        const spec = race.spec; race = null; hud.hidden = true;
        showCard(event.you ? `🏁 You finished #${event.you}` : '🏁 Race over — DNF', event.placings.map(p => `${p.place ? `#${p.place}` : 'DNF'} ${p.name}${p.ms !== null ? ` · ${clock(p.ms)}` : ''}`)
          .concat(event.you ? [`Your time is on today’s ${spec.title} board.`] : []), [], 15_000);
        return;
      }
      case 'race-cancelled':
        if (race?.id !== event.raceId) return;
        race = null; hud.hidden = true; count.hidden = true;
        deps.notify('Race cancelled.', event.reason === 'no-rivals' ? 'Nobody joined in time.' : 'Everyone left.');
        return;
    }
  }

  return {
    onQuest(json) { const e = parseQuestEvent(json); if (e && e.kind.startsWith('race-')) handle(e); },
    update(player) {
      nearSpec = null;
      if (!race && !deps.busy()) for (const t of TIME_TRIALS) { const p = placePoint(t.start); if (Math.hypot(player.x - p.x, player.z - p.z) <= HOST_RADIUS_M) { nearSpec = t; break; } }
      host.hidden = !nearSpec || !card.hidden; // an invite / lobby card is up: Join from it, don't also offer Host
      if (race?.state === 'running') {
        const gates = race.spec.checkpoints.length + 1, elapsed = performance.now() - race.goAt;
        let pos = '';
        if (race.rivals?.length) {
          const line = routeLine(race.spec), total = line.cum.at(-1)!, mine = playerProgress(line, race.reached, player);
          const ahead = race.rivals.filter(r => Math.min(1, elapsed / r.ms) * total > mine).length;
          pos = ` · POS ${ahead + 1}/${race.rivals.length + 1}`;
        }
        hud.hidden = false; hud.textContent = `🏁 ${race.spec.title} · gate ${Math.min(race.reached + 1, gates)}/${gates}${pos} · ${clock(elapsed)}`;
      }
    },
    get marker() {
      if (!race || race.state !== 'running') return null;
      const g = [...race.spec.checkpoints, race.spec.finish][race.reached]; if (!g) return null;
      const p = placePoint(g.at); return { x: p.x, z: p.z, letter: 'R' };
    },
    get rivalMarkers() {
      if (!race || race.state !== 'running' || !race.rivals?.length) return [];
      const line = routeLine(race.spec), total = line.cum.at(-1)!, elapsed = performance.now() - race.goAt;
      return race.rivals.map((r, i) => ({ ...pointAt(line, Math.min(1, elapsed / r.ms) * total), letter: String(i + 1), fill: '#d6453d' }));
    },
    get racing() { return race !== null; },
    dispose() { host.remove(); card.remove(); hud.remove(); count.remove(); if (cardTimer) clearTimeout(cardTimer); },
  };
}
