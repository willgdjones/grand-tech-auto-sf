/**
 * GTASF in-game phone (docs/PLAN-gta-pivot.md LANE C — "an in-game phone: jobs list, GPS waypoint, quest-giver
 * calls"). A toggleable panel listing the available missions (title, blurb, valuation payout) with a Start
 * button, and — while a mission is active — the current objective at the top as the "live job" (its GPS waypoint
 * is drawn on the minimap by the marker layer; this panel is the jobs/brief surface). Headless of the 3D scene:
 * `deps.onStartMission` kicks the mission runner; `deps.getActive` reads the runner's current objective.
 * Self-contained DOM + CSS; main.ts mounts it behind flags.missions and binds the toggle key.
 */
import { formatFunding } from '@gtasf/shared/funding';
import { MISSIONS, missionEnabled, missionPayoutCents, type MissionObjective, type MissionSpec } from '@gtasf/shared/founder/missions';
import { flags } from '@gtasf/shared/flags';
import { pilgrimageBonusCents, pilgrimageSiteCents, type PilgrimageSite } from '@gtasf/shared/founder/pilgrimage';
import './missionPhone.css';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.className = className; if (text) node.textContent = text; return node;
}

export interface MissionPhoneDeps {
  parent?: HTMLElement;
  /** Start a mission (the runner POSTs mission-start; proximity to the marker is server-checked). */
  onStartMission(missionId: string): void;
  /** The runner's current objective, or null when no mission is active. */
  getActive(): { mission: MissionSpec; objective: MissionObjective; index: number } | null;
  /** The device's SF-pilgrimage stamp collection (collected place names + the total), for the collectibles
   *  section. Omit → no section; returns null (e.g. placeStamps off / offline) → the section stays hidden. */
  loadStamps?(): Promise<{ names: readonly string[]; total: number } | null>;
  /** Missions this device already did in their cooldown window (GET /api/funding/missions); null on failure. */
  loadDone?(): Promise<ReadonlySet<string> | null>;
  /** Founder Rank (flag founderRank): the full rank line at the top of the phone; null/omitted hides it. */
  loadRank?(): Promise<{ level: number; title: string; into: number; span: number } | null>;
  /** stuntBonus: the device's best car jump, shown under the rank; null/omitted hides it. */
  stuntBest?(): { distanceM: number; airMs: number; streets?: number } | null;
  /** Personal car (flag personalCar): where it is, GPS to it, and "Deliver my car" (the server picks the road). */
  personalCar?: {
    load(): Promise<{ kind: string; x: number; z: number; live: boolean; driving: boolean } | null>;
    distanceTo(x: number, z: number): number;
    onRoute(x: number, z: number): void;
    deliver(): Promise<string>;
  };
  /** Garage phase 1 (flag garageSlots, docs/PLAN-garage.md): saved-car slots 1+ under YOUR CAR. Omit → no section. */
  garage?: {
    load(): Promise<{ slots: number; cars: { slot: number; kind: string; source: string; hidden: boolean; giftLabel?: string }[] } | null>;
    deliver(slot: number): Promise<string>;
    keep(slot: number): Promise<string>;
    /** Driving a car right now (so 'Keep this car' applies). */
    driving(): boolean;
  };
  /** Time trials (flags.timeTrials): every route with mode, par and today's best, plus GPS routing. Omit → no section. */
  timeTrials?: {
    routes(): readonly { id: string; title: string; mode: 'drive' | 'foot'; parMs: number }[];
    loadBests(): Promise<ReadonlyMap<string, { name: string; ms: number }>>;
    onRoute(routeId: string): void;
  };
  /** Abandon the active job (shown as a button on the live-job banner). Omit → no button. */
  onAbandon?(): void;
  /** SF pilgrimage landmarks (flags.pilgrimage): the list with collected state, a reload, and GPS routing. Omit →
   *  no section. */
  pilgrimage?: {
    sites(): readonly { site: PilgrimageSite; collected: boolean }[];
    reload(): Promise<void>;
    onRoute(siteId: string): void;
  };
}

export interface MissionPhone {
  readonly element: HTMLElement;
  readonly isOpen: boolean;
  show(): void;
  hide(): void;
  toggle(): void;
  /** Re-render the live-job banner (call when the active objective changes). */
  refresh(): void;
  dispose(): void;
}

export function createMissionPhone(deps: MissionPhoneDeps): MissionPhone {
  const parent = deps.parent ?? document.body;
  const root = el('section', 'gt-mission-phone'); root.hidden = true;
  root.setAttribute('aria-label', 'Phone — jobs');
  const screen = el('div', 'gt-mission-phone-screen');
  const rankLine = el('div', 'gt-mission-phone-rank'); rankLine.hidden = true;
  const stuntLine = el('div', 'gt-mission-phone-rank gt-mission-phone-stunt'); stuntLine.hidden = true;
  const carHeader = el('div', 'gt-mission-phone-header', 'YOUR CAR'); carHeader.hidden = !deps.personalCar;
  const carRow = el('div', 'gt-mission-phone-pilgrim gt-mission-phone-car'); carRow.hidden = !deps.personalCar;
  const carText = el('div', 'gt-mission-phone-pilgrim-text');
  const carName = el('div', 'gt-mission-phone-pilgrim-name'), carNote = el('div', 'gt-mission-phone-pilgrim-blurb');
  carText.append(carName, carNote);
  const carRoute = el('button', 'gt-mission-phone-pilgrim-route', 'Route'); carRoute.type = 'button';
  const carDeliver = el('button', 'gt-mission-phone-pilgrim-route gt-mission-phone-car-deliver', 'Deliver'); carDeliver.type = 'button';
  carRow.append(carText, carRoute, carDeliver);
  const garageHeader = el('div', 'gt-mission-phone-header', 'MY GARAGE'); garageHeader.hidden = !deps.garage;
  const garageList = el('div', 'gt-mission-phone-garage'); garageList.hidden = !deps.garage;
  const header = el('div', 'gt-mission-phone-header', 'JOBS');
  const live = el('div', 'gt-mission-phone-live'); live.hidden = true;
  const liveText = el('span', 'gt-mission-phone-live-text');
  const abandon = el('button', 'gt-mission-phone-abandon', 'Abandon job'); abandon.type = 'button'; abandon.hidden = !deps.onAbandon;
  abandon.addEventListener('click', () => { deps.onAbandon?.(); refresh(); });
  live.append(liveText, abandon);
  const list = el('ul', 'gt-mission-phone-list');
  // SF pilgrimage landmarks (LANE C task 6): paid once each, routed by GPS. Absent without deps.pilgrimage.
  // Time trials (no money): every route with par + today's best and a Route button. Absent without deps.timeTrials.
  const trialsHeader = el('div', 'gt-mission-phone-header gt-mission-phone-stamps-header', 'TIME TRIALS'); trialsHeader.hidden = !deps.timeTrials;
  const trialsList = el('ul', 'gt-mission-phone-pilgrims');
  const pilgrimHeader = el('div', 'gt-mission-phone-header gt-mission-phone-stamps-header', 'SF PILGRIMAGE'); pilgrimHeader.hidden = !deps.pilgrimage;
  const pilgrimCount = el('div', 'gt-mission-phone-stamps-count'); pilgrimCount.hidden = !deps.pilgrimage;
  const pilgrimList = el('ul', 'gt-mission-phone-pilgrims');
  // Collectibles: the place-stamp collection (cosmetic). Hidden until the first successful load.
  const stampsHeader = el('div', 'gt-mission-phone-header gt-mission-phone-stamps-header', 'PLACE STAMPS'); stampsHeader.hidden = true;
  const stampsCount = el('div', 'gt-mission-phone-stamps-count'); stampsCount.hidden = true;
  const stampsList = el('ul', 'gt-mission-phone-stamps');
  const close = el('button', 'gt-mission-phone-close', '×'); close.type = 'button'; close.setAttribute('aria-label', 'Close phone');
  screen.append(rankLine, stuntLine, carHeader, carRow, garageHeader, garageList, header, live, list, trialsHeader, trialsList, pilgrimHeader, pilgrimCount, pilgrimList, stampsHeader, stampsCount, stampsList);
  root.append(close, screen);
  // phoneFrame (critique #17): a handset around the same screen — status bar on top (live SF time), home bar below.
  let statusClock: HTMLElement | null = null;
  if (flags.phoneFrame) {
    root.classList.add('gt-mission-phone--framed');
    const status = el('div', 'gt-mission-phone-status');
    statusClock = el('span', 'gt-mission-phone-clock');
    const icons = el('span', 'gt-mission-phone-icons'); icons.setAttribute('aria-hidden', 'true');
    icons.append(el('span', 'gt-mission-phone-signal'), el('span', 'gt-mission-phone-battery'));
    status.append(el('span', 'gt-mission-phone-carrier', 'GTASF 5G'), statusClock, icons);
    root.insertBefore(status, screen);
    root.append(el('div', 'gt-mission-phone-homebar'));
  }
  const tickStatusClock = () => {
    if (!statusClock) return;
    try { statusClock.textContent = new Date().toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit' }); }
    catch { statusClock.textContent = ''; }
  };
  parent.append(root);

  // Per-mission rows, so refresh() can disable the Start buttons while a job is running (only one at a time).
  const rows: { id: string; item: HTMLLIElement; start: HTMLButtonElement }[] = [];
  for (const mission of MISSIONS.filter(m => missionEnabled(m, flags))) {
    const item = el('li', 'gt-mission-phone-item');
    const title = el('div', 'gt-mission-phone-item-title', mission.title);
    const blurb = el('p', 'gt-mission-phone-item-blurb', mission.phoneBlurb);
    const pay = el('div', 'gt-mission-phone-item-pay', mission.acquihire ? 'Costs 10% of your valuation · flip it for 1.5× back'
      : `Reward: ${formatFunding(missionPayoutCents(mission).toString())}`);
    const start = el('button', 'gt-mission-phone-start', 'Start job'); start.type = 'button';
    start.addEventListener('click', () => {
      // onStartMission routes the GPS to this job's start marker (it doesn't start the job — E there does). While
      // a job is active that re-route is backwards/premature, so the button is disabled; this just backs that up.
      if (deps.getActive()) return;
      deps.onStartMission(mission.id); hide();
    });
    item.append(title, blurb, pay, start);
    list.append(item);
    rows.push({ id: mission.id, item, start });
  }

  // ── personal car ──
  let car: { kind: string; x: number; z: number; live: boolean; driving: boolean } | null = null;
  const KIND_NAMES: Record<string, string> = { prius: 'Prius', tesla: 'Tesla', subaru: 'Subaru', supercar: 'Supercar' };
  function renderCar(note?: string): void {
    const pc = deps.personalCar; if (!pc) return;
    carRoute.hidden = !car || car.driving; carDeliver.hidden = !car || car.driving;
    if (!car) { carName.textContent = 'No car yet'; carNote.textContent = note ?? 'Drive any car and leave it: it’s yours, parked where you left it.'; return; }
    carName.textContent = `${KIND_NAMES[car.kind] ?? 'Car'}${car.driving ? ' · you’re in it' : ` · ${Math.round(pc.distanceTo(car.x, car.z)).toLocaleString('en-US')} m away`}`;
    carNote.textContent = note ?? (car.live ? 'Parked where you left it.' : 'Parked where you left it last time.');
  }
  async function loadCar(): Promise<void> { car = await deps.personalCar?.load().catch(() => null) ?? null; if (!root.hidden) renderCar(); }
  carRoute.addEventListener('click', () => { if (car) { deps.personalCar?.onRoute(car.x, car.z); hide(); } });
  carDeliver.addEventListener('click', async () => {
    const pc = deps.personalCar; if (!pc) return;
    carDeliver.disabled = true; carNote.textContent = 'Calling your car…';
    const message = await pc.deliver().catch(() => 'Couldn’t reach your car. Try again.');
    carDeliver.disabled = false; await loadCar(); renderCar(message);
  });

  // ── garage (flag garageSlots) ──
  let garage: Awaited<ReturnType<NonNullable<MissionPhoneDeps['garage']>['load']>> = null, garageNote = '';
  function renderGarage(): void {
    const g = deps.garage; if (!g) return;
    garageList.replaceChildren();
    if (!garage) { garageList.append(el('div', 'gt-mission-phone-pilgrim-blurb', 'Loading your garage…')); return; }
    garageHeader.textContent = `MY GARAGE · ${garage.slots} ${garage.slots === 1 ? 'slot' : 'slots'}`;
    if (garage.slots <= 1) garageList.append(el('div', 'gt-mission-phone-pilgrim-blurb', 'Raise your Seed round to unlock a second slot.'));
    const driving = g.driving();
    for (let slot = 1; slot < Math.max(garage.slots, 1 + Math.max(0, ...garage.cars.map(c => c.slot))); slot++) {
      const car = garage.cars.find(c => c.slot === slot), row = el('div', 'gt-mission-phone-pilgrim gt-mission-phone-car');
      const text = el('div', 'gt-mission-phone-pilgrim-text');
      const name = el('div', 'gt-mission-phone-pilgrim-name', car ? `${KIND_NAMES[car.kind] ?? 'Car'}${car.source === 'gift' ? ` · ${car.giftLabel ? `${car.giftLabel} gift` : 'gift'}` : ''}` : `Slot ${slot + 1} · empty`);
      const blurb = el('div', 'gt-mission-phone-pilgrim-blurb', car?.hidden ? 'Locked: raise your round again to use it.' : car ? (driving ? 'Replace it with the car you’re driving.' : 'Call it to the nearest road.') : driving ? 'Keep the car you’re driving here.' : 'Drive a car, then keep it here.');
      text.append(name, blurb); row.append(text);
      const button = (label: string, run: () => Promise<string>) => {
        const b = el('button', 'gt-mission-phone-pilgrim-route', label); b.type = 'button';
        b.addEventListener('click', async () => { b.disabled = true; garageNote = await run().catch(() => 'Couldn’t reach your garage. Try again.'); await Promise.all([loadGarage(), loadCar()]); }); // a delivered car becomes YOUR CAR
        row.append(b);
      };
      if (car && !car.hidden && !driving) button('Deliver', () => g.deliver(slot));
      if (driving && !car?.hidden) button(car ? 'Replace' : 'Keep', () => g.keep(slot));
      garageList.append(row);
    }
    if (garageNote) garageList.append(el('div', 'gt-mission-phone-pilgrim-blurb', garageNote));
  }
  async function loadGarage(): Promise<void> { garage = await deps.garage?.load().catch(() => null) ?? null; if (!root.hidden) renderGarage(); }

  let done: ReadonlySet<string> = new Set();
  function refresh(): void {
    const active = deps.getActive();
    if (!active) {
      live.hidden = true; liveText.textContent = '';
      for (const { id, item, start } of rows) {
        item.classList.remove('gt-mission-phone-item-current');
        const finished = done.has(id);
        start.disabled = finished; start.textContent = finished ? 'Done today ✓' : 'Start job';
        if (finished) start.title = 'Paid today — this job resets tomorrow (SF time).'; else start.removeAttribute('title');
      }
      return;
    }
    live.hidden = false;
    liveText.textContent = `CURRENT JOB — ${active.mission.title}: ${active.objective.label}`;
    // One job at a time: mark the active one "In progress" and disable every Start button. "Start job" routes the
    // GPS to a job's START to begin it there (not a direct start), which while a job is running is backwards for
    // the active one and premature for the others (E at a start no-ops until the current job clears) — so disable
    // them all rather than send the player on a dead-walk.
    for (const { id, item, start } of rows) {
      const current = id === active.mission.id;
      item.classList.toggle('gt-mission-phone-item-current', current);
      start.disabled = true;
      start.textContent = current ? 'In progress' : 'Start job';
      start.title = current ? 'This job is in progress.' : 'Finish your current job first.';
    }
  }
  let stampsLoading = false;
  async function renderStamps(): Promise<void> {
    if (!deps.loadStamps || stampsLoading) return;
    stampsLoading = true;
    try {
      const data = await deps.loadStamps();
      if (!data) return; // placeStamps off / offline — leave the section hidden
      stampsHeader.hidden = false; stampsCount.hidden = false;
      stampsCount.textContent = `${data.names.length} / ${data.total} collected`;
      stampsList.replaceChildren();
      if (data.names.length === 0) stampsList.append(el('li', 'gt-mission-phone-stamp gt-mission-phone-stamp-empty', 'Explore SF to collect stamps.'));
      else for (const name of data.names) stampsList.append(el('li', 'gt-mission-phone-stamp', `✦ ${name}`));
    } catch { /* keep the last render */ } finally { stampsLoading = false; }
  }
  function renderPilgrimage(): void {
    const p = deps.pilgrimage; if (!p) return;
    const sites = p.sites(), done = sites.filter(s => s.collected).length;
    pilgrimCount.textContent = `${done} / ${sites.length} landmarks · ${formatFunding(pilgrimageSiteCents().toString())} each, ${formatFunding(pilgrimageBonusCents().toString())} for all`;
    pilgrimList.replaceChildren();
    // Uncollected first (they're the actionable rows), each with a Route button; collected ones as a ✓ line.
    for (const { site, collected } of [...sites].sort((a, b) => Number(a.collected) - Number(b.collected))) {
      const item = el('li', collected ? 'gt-mission-phone-pilgrim gt-mission-phone-pilgrim-done' : 'gt-mission-phone-pilgrim');
      if (collected) { item.textContent = `✓ ${site.name}`; pilgrimList.append(item); continue; }
      const text = el('div', 'gt-mission-phone-pilgrim-text');
      text.append(el('div', 'gt-mission-phone-pilgrim-name', site.name), el('div', 'gt-mission-phone-pilgrim-blurb', site.blurb));
      const route = el('button', 'gt-mission-phone-pilgrim-route', 'Route'); route.type = 'button';
      route.addEventListener('click', () => { p.onRoute(site.id); hide(); });
      item.append(text, route); pilgrimList.append(item);
    }
  }
  const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
  function renderTrials(bests: ReadonlyMap<string, { name: string; ms: number }> = new Map()): void {
    const t = deps.timeTrials; if (!t) return;
    trialsList.replaceChildren();
    for (const route of t.routes()) {
      const item = el('li', 'gt-mission-phone-pilgrim');
      const text = el('div', 'gt-mission-phone-pilgrim-text');
      const best = bests.get(route.id);
      text.append(el('div', 'gt-mission-phone-pilgrim-name', `${route.mode === 'drive' ? '🚗' : '🏃'} ${route.title}`),
        el('div', 'gt-mission-phone-pilgrim-blurb', `Par ${clock(route.parMs)} · ${best ? `today's best ${clock(best.ms)} (${best.name})` : 'no times yet today'}`));
      const go = el('button', 'gt-mission-phone-pilgrim-route', 'Route'); go.type = 'button';
      go.addEventListener('click', () => { t.onRoute(route.id); hide(); });
      item.append(text, go); trialsList.append(item);
    }
  }
  function show(): void {
    if (!root.hidden) return;
    renderTrials();
    void deps.timeTrials?.loadBests().then(bests => { if (!root.hidden) renderTrials(bests); }).catch(() => {});
    refresh(); renderPilgrimage(); void renderStamps(); tickStatusClock(); root.hidden = false;
    void deps.loadDone?.().then(set => { if (set) { done = set; if (!root.hidden) refresh(); } });
    renderCar(); void loadCar();
    if (deps.garage) { garageNote = ''; renderGarage(); void loadGarage(); }
    const stunt = deps.stuntBest?.() ?? null;
    stuntLine.hidden = !stunt; if (stunt) stuntLine.textContent = `BEST STUNT · ${Math.round(stunt.distanceM)} M · ${(stunt.airMs / 1000).toFixed(1)} S AIR${stunt.streets ? ` · ${stunt.streets} UNIQUE` : ''}`;
    void deps.loadRank?.().then(r => { rankLine.hidden = !r; if (r) rankLine.textContent = `LV ${r.level} · ${r.title.toUpperCase()} · ${r.into.toLocaleString('en-US')} / ${r.span.toLocaleString('en-US')} XP`; });
    void deps.pilgrimage?.reload().then(() => { if (!root.hidden) renderPilgrimage(); });
  }
  function hide(): void { root.hidden = true; }

  close.addEventListener('click', hide);
  // Esc closes the phone (the pause menu stands down while it is open).
  const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape' && !root.hidden && !event.repeat) { event.preventDefault(); hide(); } };
  window.addEventListener('keydown', onKey);
  let disposed = false;
  return {
    element: root,
    get isOpen() { return !root.hidden; },
    show, hide,
    toggle() { if (root.hidden) show(); else hide(); },
    refresh() { refresh(); if (!root.hidden) renderPilgrimage(); },
    dispose() { if (disposed) return; disposed = true; window.removeEventListener('keydown', onKey); root.remove(); },
  };
}
