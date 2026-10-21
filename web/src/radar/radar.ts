import type { TaxiQuote } from '../vehicles/robotaxi/client';
import { flags } from '@gtasf/shared/flags';
import { FUNDING_BASE_CENTS, fundingKind, formatFunding, isPreviewLull, quoteFunding } from '@gtasf/shared/funding';
/** Funding-marker size unit: half the community base (v2 $100k, v3 scales with it) so markers keep their size under economy v3. */
const MARKER_UNIT_CENTS = Number(FUNDING_BASE_CENTS.community) / 2;
import { classifyEventKind, eventKindStyle, EVENT_KINDS, type EventKind, type EventKindStyle } from '@gtasf/shared/content/eventKinds';
import type { RoadGraph, RoadNode } from '@gtasf/shared/roadgraph';
import { projectLocation, type MapFrame } from './projection';
import { claimHeavyFrame } from '../render/mountScheduler';
import { holdFreeCursor } from '../input/cursor';
import { createMapRouter, createMapRouterIncremental, assembleMapRouter, decodeRouterEdges, MAP_ROUTER_SLICE_MS, type MapRoute, type RouterEdgeView, type RouterStructures } from './routing';
import { groupVenues, representativeEvent, type VenueGroup } from '../events/venues';
import { venueCollected } from '../events/collected';
import { SF_DISTRICTS, cullOverlappingLabels, nearestDistrictIndex, type LabelCandidate } from './districts';
import { DISTRICTS } from '../../../tools/map/src/districts';
import type { DropRadarBlip } from '../drops/radarBlip';
import { angelSpots } from '@gtasf/shared/content/angels';
import './radar.css';

/** Lane B combat places on the radar; hideout/respray are the wantedEscape escape spots (gtasf-66lvh). */
export type CombatPlaceKind = 'store' | 'weapon' | 'hospital' | 'hideout' | 'respray';
export interface RadarEvent {
  id: string; title: string; host?: string | null; start: string; end?: string | null;
  venue?: string | null; address?: string | null; lat: number | null; lon: number | null;
  approx: boolean; url: string; source?: string; tags?: string[];
  /** True for a player-submitted "community" event (PLAN-v2 decision 9); the API omits it for official
   *  Tech Week events. Surfaced as a "community" tag on the map card, V panel and world marker. */
  community?: boolean;
}
export interface RadarDestination { id?: string; title: string; x: number; y: number; z: number; event?: RadarEvent; walkingStop?: boolean }
export interface RadarPeer { id: string | number; x: number; z: number; role?: 'friend' | 'top'; name?: string }
type Blip = RadarDestination & { event: RadarEvent; startMs: number; endMs: number; fundingBaseCents: number; kind: EventKind };
type Hit = { x: number; y: number; event: Blip };
type Cluster = Hit & { count: number; live: boolean; edge: boolean; fundingSize: number };
const SF_DATE = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node;
}
function button(text: string, action: () => void): HTMLButtonElement {
  const node = element('button', undefined, text); node.type = 'button'; node.onclick = action; return node;
}
const clamp = (value: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, value));

/** Rotating local radar and north-up event map; all source text is inserted as textContent. */
/**
 * Heading-up minimap transform (world x/z → canvas), as canvas `transform(a, b, c, d, …)` terms.
 * `rot` is the yaw that should point up (three.js convention: 0 faces +z/south, π/2 faces east,
 * forward = (sin, cos)). This is a pure rotation by rot + π: forward maps to canvas up and the
 * viewer's right maps to canvas right. The original matrix had determinant −scale² (a mirror image),
 * which swapped east/west and spun the map the wrong way when turning.
 */
export function radarMatrix(rot: number, scale: number): { a: number; b: number; c: number; d: number } {
  const cos = Math.cos(rot), sin = Math.sin(rot);
  return { a: -scale * cos, b: -scale * sin, c: scale * sin, d: -scale * cos };
}

export function createRadar(options: {
  graph: RoadGraph; frame: MapFrame; parent?: HTMLElement; enabled?: boolean; eventUrl?: string;
  /** A shared feed can supply setEvents() without a duplicate startup request. */
  autoLoad?:boolean;
  landmarks?: RadarDestination[]; routeGraphUrl?: string; routeGraph?:RoadGraph|Promise<RoadGraph>;
  /** routingWorkerPacked (gtasf-fddi): restored road-pack bytes of the same graph routeGraph resolves to; the router
   *  structures are built from them in a worker, in parallel with main's unpack. */
  routeGraphBytes?: Promise<ArrayBuffer>;
  /** gtasf-0k01: resolves when options.graph (read lazily) is upgraded from the spawn-area graph to the city graph. */
  graphUpgraded?: Promise<unknown>;
  /** nearRouterFirst: the spawn-area routing graph already loaded at boot; routes run on it until the city router lands. */
  nearRouteGraph?: RoadGraph;
  /** When to build the spawn-area router (default: right away). main.ts passes 'READY has painted' so its ~0.1 s build stays
   *  off the loading path on a phone. */
  nearRouterAt?: Promise<unknown>;
  /** Optional loaded authored-stop paths; road routing remains the fallback and every hail route. */
  walkingRoute?(from: { x: number; y?: number; z: number }, to: RadarDestination, mode: 'walk' | 'road'): MapRoute | null;
  travelMode?(): 'walk' | 'road';
  /** Optional sourced water rings in world [x,z] metres; even-odd fill preserves island holes.
   * Drawn behind roads/labels on the SA map. Old manifests may omit the overlay. */
  coastline?: readonly (readonly (readonly [number, number])[])[];
  /** False or a reason rejects the candidate without replacing the route or closing the map. */
  quoteFare?(destination: RadarDestination): Promise<TaxiQuote>;
  onSelect(destination: RadarDestination): boolean | string | void; onHail?(destination: RadarDestination): boolean | string | void;
  onExpandedChange?(expanded: boolean): void;
  /** Clear the active route/waypoint in the world too (e.g. guidance?.setDestination(null)). When
   *  provided, a "Clear route" button appears while a destination is set. Omit to hide it entirely. */
  onClear?(): void;
}) {
  if (!(options.enabled ?? flags.radar)) return null;
  const root = element('section', 'gt-radar'); root.setAttribute('aria-label', 'San Francisco event radar');
  root.tabIndex = -1;
  const header = element('div', 'gt-radar-head'), canvas = element('canvas'), panel = element('div', 'gt-radar-panel');
  canvas.setAttribute('aria-label', 'Road map. Gold events, blue players, white robotaxis.');
  // Data-driven legend (radar v2.1): one entry per event kind + players/top-10/friends/taxis/drops.
  // The compact minimap shows the coloured symbol + glyph; the expanded map reveals the full labels.
  const legend = element('div', 'gt-radar-legend');
  const legendItem = (symbolColor: string, symbol: string, label: string, glyph = '') => {
    const span = element('span', 'gt-radar-legend-item');
    const dot = element('b', undefined, symbol); dot.setAttribute('style', `color:${symbolColor}`); span.append(dot);
    if (glyph) span.append(element('span', 'gt-radar-legend-glyph', ` ${glyph}`));
    span.append(element('i', 'gt-radar-legend-label', ` ${label}`));
    return span;
  };
  for (const k of EVENT_KINDS) legend.append(legendItem(k.color, '●', k.label, k.glyph));
  legend.append(legendItem('#76d9f0', '●', 'Players'));
  legend.append(legendItem('#f6a81e', '●', 'Top-10 raiser'));
  legend.append(legendItem('#5fd07a', '●', 'Friend'));
  legend.append(legendItem('#fffdf3', '■', 'Robotaxi'));
  legend.append(legendItem('#f1d98a', '💼', 'VC drop · N/50'));
  if (flags.memeQuests) legend.append(legendItem('#f1d98a', '💬', 'Pitch a VC')); // founder-ladder meme quest-givers [gtasf-ldlm]
  if (flags.pilgrimage) legend.append(legendItem('#f0b429', '★', 'SF pilgrimage landmark')); // uncollected landmarks [gtasf-ldlm]
  legend.append(legendItem('#ffc440', '◍', 'Crowd (busy)'));
  legend.append(legendItem('#c89bf0', '◌', 'Angel rumour'));
  if (flags.angelNpcs && flags.minimapClues) legend.append(legendItem('#f5c542', '👼', 'Angel investor · pitch in person'));
  if (flags.fundingLoop) canvas.setAttribute('aria-label', 'Road map with event-type icons; brighter events pay more funding. Blue players, gold top-10 raisers, green friends, white robotaxis, briefcase VC drops.');
  const search = element('input', 'gt-radar-search'); search.type = 'search';
  search.placeholder = flags.waypoints ? 'Find an event or district' : 'Find an event';
  search.setAttribute('aria-label', flags.waypoints ? 'Find a Tech Week event or San Francisco district' : 'Find a Tech Week event');
  const status = element('div', 'gt-radar-status', 'Loading real Tech Week events…'); status.setAttribute('role', 'status');
  const note = element('p', 'gt-radar-note', 'Approximate pins show the public neighborhood. Check the event page for venue access.');
  // A controls hint so the expanded map's new interactions are discoverable; only lists what is flagged on.
  const mapHelp = element('p', 'gt-radar-help');
  {
    const hints: string[] = [];
    if (flags.waypoints) hints.push('Click the map to set a waypoint', 'search for a district');
    if (flags.venueGrouping) hints.push('click a venue for its events');
    if (flags.saMapStyle) hints.push('scroll or pinch to zoom, drag to pan');
    if (hints.length) { const text = hints.join(' · '); mapHelp.textContent = `${text.charAt(0).toUpperCase()}${text.slice(1)}.`; }
    else mapHelp.hidden = true;
  }
  const card = element('article', 'gt-radar-card'); card.hidden = true;
  const navigation = element('div', 'gt-radar-navigation'); navigation.hidden = true;
  const landmarks = element('div', 'gt-radar-landmarks');
  const places = element('div', 'gt-radar-places'); places.hidden = true;
  places.setAttribute('role', 'group'); places.setAttribute('aria-label', 'District destinations');
  const list = element('div', 'gt-radar-list');
  // SA pause-menu zoom + a transient waypoint/route status line; both expanded-only.
  const zoomControls = element('div', 'gt-radar-zoom'); zoomControls.hidden = !flags.saMapStyle;
  // minimapClues (gtasf-stc2): one line under the minimap cycling the 2-3 nearest live events.
  const ticker = element('button', 'gt-radar-ticker'); ticker.type = 'button'; ticker.hidden = true; ticker.setAttribute('aria-live', 'polite');
  const mapStatus = element('div', 'gt-radar-map-status'); mapStatus.hidden = true; mapStatus.setAttribute('role', 'status');
  let expanded = false, disposed = false, selected: Blip | undefined, events: Blip[] = [], lastDraw = -Infinity, lastList = -Infinity;
  let selectedVenueKey: string | null = null;
  let position: { x: number; y?: number; z: number } = { x: 0, z: 0 }, yaw = 0, viewYaw: number | undefined, peers: RadarPeer[] = [], taxis: RadarPeer[] = [];
  let drops: readonly DropRadarBlip[] = [];
  let policeSearch: { x: number; z: number; r: number } | null = null; // GTA search area: last-seen spot while the cops can't see you
  // Founder-ladder meme quest-givers (pitch NPCs): world x/z of each, plotted as a gold mic blip so the
  // quest-givers are findable on the map. Naturally empty when memeQuests is off (no mounted NPCs). [gtasf-ldlm]
  let questGivers: readonly { x: number; z: number }[] = [];
  // GTA-pivot mission markers (LANE C): a gold lettered pin per available/active mission, GTA-style. [gtasf-ldlm]
  let missionMarkers: readonly { x: number; z: number; letter: string; fill?: string }[] = [];
  let personalCar: { x: number; z: number } | null = null; // personalCar (critique #20): the player's own car
  let pilgrimSites: readonly { x: number; z: number }[] = []; // uncollected SF-pilgrimage landmarks
  // Lane B combat places (flag combatRadarBlips): robbable stores ('$'), free weapon pickups (crosshair) and respawn
  // hospitals (red cross, nearestHospitalRespawn).
  let combatPlaces: readonly { x: number; z: number; kind: CombatPlaceKind }[] = [];
  // GTA-pivot SFPD pursuit units (LANE B): world x/z of each active police car, drawn as a flashing red/blue
  // blip so the wanted-level chase reads on the minimap. Naturally empty until combat+wanted enable. [gtasf-combat]
  let police: readonly { x: number; z: number }[] = [];
  // Radar v2.1 (gtasf-radar-overhaul-v21-wivr): event ids the player has already collected (dimmed),
  // the active angel-rumour zone (faint ring, angels stay hidden), and a smoothed speed for zoom-out-at-speed.
  let collected: ReadonlySet<string> = new Set();
  let rumourZone: { x: number; z: number; radius: number } | null = null;
  let speed = 0, lastSpeedPos: { x: number; z: number } | null = null, lastSpeedAt = 0;
  const CROWD_RADIUS_M = 55; // world metres around an event counted as "at" it for crowd heat
  function crowdAt(wx: number, wz: number): number {
    let n = 0;
    for (const peer of peers) if ((peer.x - wx) ** 2 + (peer.z - wz) ** 2 <= CROWD_RADIUS_M * CROWD_RADIUS_M) n++;
    return n;
  }
  const abort = new AbortController();
  const title = button('Tech Week · loading', () => toggleMap());
  const expandButton = button('M', () => toggleMap()); expandButton.setAttribute('aria-label', 'Open event map');
  expandButton.setAttribute('aria-expanded', 'false'); expandButton.setAttribute('aria-haspopup', 'dialog');
  header.append(title, expandButton); panel.append(landmarks, search, status, card, note, mapHelp, places, list); root.append(header, canvas, ticker, navigation, panel, legend, zoomControls, mapStatus);
  (options.parent ?? document.body).append(root);
  const context = canvas.getContext('2d')!;
  const districts = SF_DISTRICTS.map(place => ({ name: place.name.toUpperCase(), priority: place.priority, ...projectLocation(place.lat, place.lon, options.frame) }));
  // Use verified street approaches, never the decorative district-label centroids.
  // The router supplies road height when the player accepts a destination.
  const districtDestinations = flags.waypoints ? DISTRICTS.map(place => ({
    id: `district:${place.id}`, title: place.name, y: 0,
    ...projectLocation(place.spawn.lat, place.spawn.lon, options.frame),
    search: `${place.name} ${place.id}`.toLocaleLowerCase(),
  })) : [];
  // Cache geometry once in world space. Reprojecting every road vertex in JS each draw
  // dominated the radar CPU profile; a canvas transform preserves the same geometry.
  // Built on first draw, not at setup: walking every city road vertex was ~1-3 s of phone CPU before READY. [gtasf-ce5s]
  type RoadTiles = Map<string, { path: Path2D; minX: number; maxX: number; minZ: number; maxZ: number }>;
  let roadTiles: RoadTiles = new Map();
  let roadTilesBuilt = false;
  // One per-edge tile accumulation shared by the sync and sliced builds so the Path2D geometry they produce is
  // byte-identical — only WHEN the work runs differs (gtasf-347x).
  const addRoadEdge = (edge: (typeof options.graph.edges)[number], into: RoadTiles = roadTiles) => {
    const first = edge.points[0]; if (!first) return;
    const key = `${Math.floor(first[0] / 256)}_${Math.floor(first[2] / 256)}`;
    const tile = into.get(key) ?? { path: new Path2D(), minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    edge.points.forEach((point, index) => {
      if (index) tile.path.lineTo(point[0], point[2]); else tile.path.moveTo(point[0], point[2]);
      tile.minX = Math.min(tile.minX, point[0]); tile.maxX = Math.max(tile.maxX, point[0]);
      tile.minZ = Math.min(tile.minZ, point[2]); tile.maxZ = Math.max(tile.maxZ, point[2]);
    });
    into.set(key, tile);
  };
  // Flag-off path: build the whole road-tile index in one synchronous pass on first draw (byte-identical to before).
  const buildRoadTiles = () => { roadTilesBuilt = true; const into: RoadTiles = new Map(); for (const edge of options.graph.edges) addRoadEdge(edge, into); roadTiles = into; };
  // gtasf-347x: the SAME build expressed as a self-timed generator so an idle driver can spread the ~400 ms
  // (4x-throttled phone) whole-city Path2D build across frames instead of blocking one. Reads edges when first
  // advanced; checks the clock every 256 edges and yields once a slice has used its ~4 ms budget (so a slice
  // overruns by at most one short edge batch).
  const ROAD_TILE_SLICE_MS = 4;
  // Hard cap on the MEASURED wall time one idle callback may spend. The pump loops slices while the idle deadline
  // reports REAL idle, but this elapsed-wall cap (not the deadline's PREDICTED timeRemaining(), which mispredicted
  // a large idle window and let one callback drain the whole build back-to-back into a single frame — a measured
  // 293 ms mount frame + a 130 ms frame one into the steady window) bounds every callback to ~one or two slices
  // (~8-12 ms). When idle is genuinely available (the light Ferry scene) that clears the whole build inside the
  // 2 s warmup, so nothing dribbles into the sampled window (one-slice-per-callback left a slice leaking there,
  // 60.09 -> 59.98 fps); when idle is starved (the Haight mount burst) the pump falls back to ONE slice per
  // timeout-fired callback, so the build never bursts a heavy cluster into the steady window.
  const ROAD_TILE_CALLBACK_MS = 8;
  let roadTileBuild: Generator<void, void, void> | null = null;
  function* roadTileGen(): Generator<void, void, void> {
    let sliceStart = performance.now();
    const edges = options.graph.edges;
    // gtasf-ep30n: a REBUILD (full-graph upgrade) fills a fresh map and swaps it in when done, so the minimap keeps the
    // spawn-area roads instead of going blank and refilling a slice per idle timeout (a minute+ on a busy phone).
    // The first build still fills progressively.
    const into: RoadTiles = flags.minimapTileSwap && roadTiles.size ? new Map() : roadTiles;
    for (let i = 0; i < edges.length; i++) {
      addRoadEdge(edges[i]!, into);
      if ((i & 255) === 255 && performance.now() - sliceStart >= ROAD_TILE_SLICE_MS) { yield; sliceStart = performance.now(); }
    }
    roadTiles = into; roadTilesBuilt = true;
  }
  // Drive the sliced build off real idle time (requestIdleCallback). A mount burst that starves idle still
  // progresses via the 400 ms timeout. A generation token (identity of roadTileBuild) retires a stale pump after a
  // graph upgrade or disposal. The minimap redraws on its own 60-100 ms cadence, so roads fill in as slices land;
  // one final invalidate on completion paints the finished network promptly.
  function startRoadTileBuild() {
    const build = roadTileGen();
    roadTileBuild = build;
    const schedule = () => { if (typeof requestIdleCallback === 'function') requestIdleCallback(pump, { timeout: 400 }); else setTimeout(() => pump(), 0); };
    function pump(deadline?: IdleDeadline) {
      if (disposed || roadTileBuild !== build) return; // superseded by a graph upgrade or disposed
      const callbackStart = performance.now();
      do {
        const step = build.next(); // one self-timed ~4 ms slice
        if (step.done) { roadTileBuild = null; lastDraw = -Infinity; return; }
        // Keep draining only while the browser reports REAL idle (rich-idle scenes finish inside the warmup);
        // a timeout-fired callback (starved mount) does exactly one slice. The measured-wall cap backstops a
        // mispredicted deadline so no callback ever drains a heavy cluster into a frame.
      } while (deadline && !deadline.didTimeout && deadline.timeRemaining() > ROAD_TILE_SLICE_MS
        && performance.now() - callbackStart < ROAD_TILE_CALLBACK_MS);
      schedule();
    }
    schedule();
  }
  // One reusable even-odd path preserves land islands inside the sourced water area.
  const waterPath = new Path2D();
  let hasWater = false;
  /** Bounds of the sourced water data: beyond them the full map paints open water, not empty paper. */
  const waterBox = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
  for (const ring of options.coastline ?? []) {
    if (ring.length < 3) continue;
    for (const [x, z] of ring) { waterBox.minX = Math.min(waterBox.minX, x); waterBox.maxX = Math.max(waterBox.maxX, x); waterBox.minZ = Math.min(waterBox.minZ, z); waterBox.maxZ = Math.max(waterBox.maxZ, z); }
    ring.forEach(([x, z], index) => { if (index) waterPath.lineTo(x, z); else waterPath.moveTo(x, z); });
    waterPath.lineTo(ring[0]![0], ring[0]![1]);
    hasWater = true;
  }
  let mapCentre = { x: 0, z: 0 }, mapRange = 2200;
  const hits: Hit[] = [], hitPool: Hit[] = [], clusterPool: Cluster[] = [];
  // Reused per-draw scratch for the district-label de-overlap pass (gtasf-i801); never re-allocated.
  const districtCandidates: (LabelCandidate & { name: string; current: boolean })[] = [];
  // Reused projection scratch for the per-venue draw loop so it allocates no points per frame
  // (gtasf-2zmc L7, production path). Only drawVenueBlips touches it, so no other project() clobbers it.
  const venueScratch = { x: 0, y: 0 };
  const clusters = new Map<string, Cluster>();
  // One-marker-per-venue source (PLAN-v2 decision 8): rebuilt whenever the feed changes, not per frame.
  type VenuePoint = { group: VenueGroup; rep: Blip; x: number; z: number; fundingBaseCents: number; fullyCollected: boolean };
  let venueGroups: VenueGroup[] = [], venuePoints: VenuePoint[] = [];
  let blipById = new Map<string, Blip>();
  let width = 228, height = 228;
  let projection = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  // The canvas CSS box only changes on viewport resize or when the map expands/collapses, so measure it
  // then (via a resize listener + ResizeObserver) instead of calling getBoundingClientRect() every draw,
  // which forced a synchronous reflow ~16x/second on the hot path (gtasf-2zmc L6).
  let viewportMeasured = false;
  function measureViewport() { const rect = canvas.getBoundingClientRect(); width = rect.width; height = rect.height; viewportMeasured = true; }
  const invalidateViewport = () => { viewportMeasured = false; lastDraw = -Infinity; };
  // SA pause-menu zoom/pan state (expanded map only). zoom 1 = fit, pan is a world-space offset.
  let zoom = 1, panX = 0, panZ = 0;
  let parchment: CanvasPattern | null = null, parchmentTried = false;
  let mapStatusTimer: ReturnType<typeof setTimeout> | undefined;
  const pointers = new Map<number, { x: number; y: number }>();
  let dragStart: { x: number; y: number; px: number; pz: number } | null = null, dragged = false, pinchDist = 0;
  function releasePointer(id: number) {
    if (canvas.hasPointerCapture?.(id)) canvas.releasePointerCapture(id);
  }
  function cancelPointers() {
    // Clear first: releasing capture can synchronously dispatch lostpointercapture.
    const ids = [...pointers.keys()];
    if (ids.length) dragged = true;
    pointers.clear(); dragStart = null; pinchDist = 0;
    ids.forEach(releasePointer);
  }
  let releaseCursor: (() => void) | undefined;
  function parchmentPattern(): CanvasPattern | null {
    if (parchmentTried) return parchment; parchmentTried = true;
    try {
      const tile = document.createElement('canvas'); tile.width = tile.height = 96;
      const paper = tile.getContext('2d'); if (!paper) return parchment;
      paper.fillStyle = '#e7d8b4'; paper.fillRect(0, 0, 96, 96);
      for (let i = 0; i < 24; i++) { const r = 6 + Math.random() * 20; paper.fillStyle = `rgba(150,120,70,${0.02 + Math.random() * 0.03})`; paper.beginPath(); paper.arc(Math.random() * 96, Math.random() * 96, r, 0, Math.PI * 2); paper.fill(); }
      for (let i = 0; i < 1300; i++) { paper.fillStyle = `rgba(110,88,50,${Math.random() * 0.06})`; paper.beginPath(); paper.arc(Math.random() * 96, Math.random() * 96, Math.random() * 1.2, 0, Math.PI * 2); paper.fill(); }
      parchment = context.createPattern(tile, 'repeat');
    } catch { parchment = null; }
    return parchment;
  }
  function showMapStatus(text: string) {
    mapStatus.textContent = text; mapStatus.hidden = false;
    clearTimeout(mapStatusTimer); mapStatusTimer = setTimeout(() => { if (!disposed) mapStatus.hidden = true; }, 3600);
  }
  function unproject(sx: number, sy: number): { x: number; z: number } | null {
    const p = projection, det = p.a * p.d - p.b * p.c; if (!det) return null;
    return { x: (p.d * (sx - p.tx) - p.c * (sy - p.ty)) / det, z: (-p.b * (sx - p.tx) + p.a * (sy - p.ty)) / det };
  }
  function applyZoom(factor: number, sx: number, sy: number) {
    if (!expanded || !flags.saMapStyle) return;
    const next = clamp(zoom * factor, 1, 8); if (next === zoom) return;
    const world = unproject(sx, sy); zoom = next;
    if (zoom === 1) { panX = 0; panZ = 0; }
    else if (world) {
      const newScale = (Math.min(width, height) / 2 - 12) / mapRange * zoom;
      panX = clamp(world.x - (sx - width / 2) / newScale - mapCentre.x, -mapRange, mapRange);
      panZ = clamp(world.z - (sy - height / 2) / newScale - mapCentre.z, -mapRange, mapRange);
    }
    lastDraw = -Infinity;
  }
  const zoomIn = button('+', () => applyZoom(1.5, width / 2, height / 2)); zoomIn.setAttribute('aria-label', 'Zoom in');
  const zoomOut = button('−', () => applyZoom(1 / 1.5, width / 2, height / 2)); zoomOut.setAttribute('aria-label', 'Zoom out');
  zoomControls.append(zoomIn, zoomOut);
  let previousFocus: HTMLElement | null = null;
  let router: ReturnType<typeof createMapRouter> | undefined;
  let destination: RadarDestination | null = null, route: MapRoute | null = null, routeStart = { x: Infinity, z: Infinity }, routeAt = -Infinity;
  let navigationComplete = false;
  let routePath = new Path2D();
  const canRoute = () => Boolean(flags.waypoints);
  let travelMode = options.travelMode?.() ?? 'road';
  // nearRouterFirst (critic 09:3x, gtasf-7vt00): the city router waits on the 8.6 MB full graph (~20 s after READY on a 9 Mbps
  // phone). The spawn-area graph is already decoded at boot, so a router over it answers the opening's routes within a second;
  // the city router replaces it when it lands (its planRoute() replans). A destination the near graph can't reach stays
  // 'loading roads…' and is never rejected as unreachable.
  let nearRouter: ReturnType<typeof createMapRouter> | undefined;
  function routeFor(target: RadarDestination, roadOnly = false): MapRoute | null {
    const active = router ?? nearRouter;
    if (!active) return null;
    return (!roadOnly && options.walkingRoute?.(position, target, options.travelMode?.() ?? 'road'))
      || active.route(position, target);
  }
  const clearButton = button('Clear route', () => {
    if (!destination) return;
    showMapStatus('Route cleared.'); setDestination(null); options.onClear?.();
  });
  clearButton.className = 'gt-radar-clear'; clearButton.setAttribute('aria-label', 'Clear the current route');
  // nearRouterFirst (critic 13:5x): when the city router lands mid-drive it must not visibly re-path a route the near router
  // drew. Keep the near route's line unless the city route is clearly shorter (> 25 m better than what's left of it); the
  // ordinary moving replan (every >35 m / 2 s) then hands over to city routes without a separate jump.
  let routeFromNear: RadarDestination | null = null; // the destination a near-router route was drawn for
  // QA ring buffer (job stale-route repro, 10-20): every destination change and route plan, read via radar.qaLog.
  const qaLog: string[] = [];
  const qa = (line: string) => { qaLog.push(`${Math.round(performance.now())} ${line}`); if (qaLog.length > 40) qaLog.shift(); };
  const qaRoute = (r: MapRoute | null | undefined) => r ? `${r.points.length}pt/${Math.round(r.distanceM)}m->${Math.round(r.points.at(-1)![0])},${Math.round(r.points.at(-1)![2])}` : 'null';
  function navigationText(r: MapRoute, distanceM: number): string {
    return `${destination?.title ?? ''} · ${distanceM < 1000 ? `${Math.round(distanceM)} m` : `${(distanceM / 1000).toFixed(1)} km`} ${r.mode === 'walk' ? 'on foot' : 'by road'}${r.destinationDistanceM > 20 ? ` · last ${Math.round(r.destinationDistanceM)} m on foot` : ''}`;
  }
  /** routeReplanOffRoute: how far the player is from the drawn route (2D), and how much of it is left past that point. */
  function alongRoute(r: MapRoute, x: number, z: number): { offM: number; remainingM: number } {
    const p = r.points; let best = Infinity, bestI = 0, bestT = 0;
    for (let i = 1; i < p.length; i++) {
      const ax = p[i - 1]![0], az = p[i - 1]![2], dx = p[i]![0] - ax, dz = p[i]![2] - az, l2 = dx * dx + dz * dz;
      const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
      const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t)); if (d < best) { best = d; bestI = i; bestT = t; }
    }
    let remainingM = 0;
    for (let i = bestI; i < p.length; i++) remainingM += Math.hypot(p[i]![0] - p[i - 1]![0], p[i]![2] - p[i - 1]![2]) * (i === bestI ? 1 - bestT : 1);
    return { offM: best, remainingM };
  }
  function planRoute(nextRoute = destination ? routeFor(destination) : null) {
    qa(`plan dest=${destination?.id ?? destination?.title ?? 'none'} next=${qaRoute(nextRoute)} cur=${qaRoute(route)}`);
    if (routeFromNear && router && route && nextRoute && destination === routeFromNear) { // same destination only (a new pick re-plans)
      routeFromNear = null;
      const left = route.distanceM - Math.hypot(position.x - routeStart.x, position.z - routeStart.z);
      if (nextRoute.distanceM > left - 25) { lastDraw = -Infinity; return; } // same corridor: keep the line
    }
    routeFromNear = !router && nearRouter && nextRoute ? destination : null;
    route = nextRoute;
    routePath = new Path2D();
    route?.points.forEach((point, index) => { if (index) routePath.lineTo(point[0], point[2]); else routePath.moveTo(point[0], point[2]); });
    routeStart = { ...position }; routeAt = performance.now();
    navigation.hidden = !destination || navigationComplete;
    if (!destination) return;
    if (!router && !route) navigation.textContent = `${destination.title} · loading roads…`;
    else if (!route) navigation.textContent = `${destination.title} · outside the drivable local area`;
    else navigation.textContent = navigationText(route, route.distanceM);
    // Setting textContent wiped any prior button; re-attach the clear control when the host wired it.
    if (options.onClear && !navigationComplete) navigation.append(clearButton);
    lastDraw = -Infinity;
  }
  function setDestination(target: RadarDestination | null, acceptRoute?: (candidate: MapRoute) => boolean): MapRoute | null {
    if (!canRoute()) return null;
    const candidate = target ? routeFor(target) : null;
    // Reject an unreachable choice without changing the route the player is following.
    // Before roads load, retain the initial destination so routingReady can resolve it.
    // Guarded requests must wait for a candidate; never queue an unaccepted destination.
    if (target && (router || acceptRoute) && !candidate) { qa(`set ${target.id ?? target.title} REFUSED router=${Boolean(router)} near=${Boolean(nearRouter)}`); return null; }
    if (candidate && acceptRoute?.(candidate) === false) return null;
    qa(`set ${target ? target.id ?? target.title : 'null'} candidate=${qaRoute(candidate)}`);
    destination = target ? { ...target } : null; navigationComplete = false; planRoute(candidate); return route;
  }
  /** An accepted quick ride can cross gaps in the client's route graph. Keep its pin, never the old route. */
  function setTaxiDestination(target: RadarDestination): MapRoute | null {
    if (!flags.quickRobotaxi) return setDestination(target);
    if (!canRoute()) return null;
    destination = { ...target }; navigationComplete = false;
    planRoute(routeFor(target)); return route;
  }
  function rideButton(target: RadarDestination, action: () => void) {
    const ride = button('Hail robotaxi', action);
    if (options.quoteFare) {
      ride.textContent = 'Ride here · Checking fare…'; ride.disabled = true;
      void options.quoteFare(target).then(fare => { if (!ride.isConnected) return; ride.textContent = `Ride here · ${fare.label}`; ride.disabled = !fare.affordable; });
    }
    return ride;
  }
  function choose(target: RadarDestination, hail = false) {
    if (target.event) {
      const current = events.find(event => event.id === target.event!.id);
      if (!current) { unavailableEvent(); return; }
      target = current;
    }
    card.querySelector('.gt-radar-route-error')?.remove();
    let selectedRoute: MapRoute | null = null;
    if (canRoute()) {
      selectedRoute = routeFor(target, hail);
      if (!selectedRoute && !(hail && flags.quickRobotaxi)) { card.append(element('p', 'gt-radar-note gt-radar-route-error', router ? `This destination is outside the drivable local map.${target.event ? ' Its public event page is still available.' : ' Choose another destination.'}` : 'Road directions are loading. Try again in a moment.')); return; }
    }
    const approach = selectedRoute && !(hail && flags.quickRobotaxi) ? { ...target, ...selectedRoute.approach } : target;
    const accepted = hail ? options.onHail?.(approach) : options.onSelect(approach);
    if (accepted === false || typeof accepted === 'string') {
      const fallback = hail
        ? 'Robotaxi request was not accepted. Check the trip status and try again.'
        : 'This destination was not accepted. Try another destination.';
      const error = element('p', 'gt-radar-note gt-radar-route-error', typeof accepted === 'string' && accepted ? accepted : fallback);
      error.setAttribute('role', 'status'); card.append(error); return;
    }
    if (canRoute()) { destination = { ...target }; navigationComplete = false; planRoute(selectedRoute); }
    toggleMap(false);
  }
  const blipFor = (event: RadarEvent | null | undefined): Blip | undefined => event ? events.find(value => value.id === event.id) : undefined;
  /** Fold the feed into one marker per venue (focus window when eventFocus24h is on). Feed-change only. */
  function rebuildVenues() {
    if (!flags.venueGrouping && !flags.saMapStyle) { venueGroups = []; venuePoints = []; return; }
    venueGroups = groupVenues(events.map(blip => blip.event));
    venuePoints = [];
    if (!flags.venueGrouping) return;
    const byId = new Map(events.map(blip => [blip.id ?? blip.event.id, blip] as const)); blipById = byId;
    for (const group of venueGroups) {
      if (flags.eventFocus24h && !group.focus.length) continue;
      const rep = byId.get(representativeEvent(group)?.id ?? ''); if (!rep) continue;
      const point = projectLocation(group.lat, group.lon, options.frame);
      let fundingBaseCents = 0;
      for (const member of group.events) { const blip = byId.get(member.event.id); if (blip && blip.fundingBaseCents > fundingBaseCents) fundingBaseCents = blip.fundingBaseCents; }
      venuePoints.push({ group, rep, x: point.x, z: point.z, fundingBaseCents, fullyCollected: venueCollected(group, collected) });
    }
    // Declutter priority (gtasf-crwk): live, then busier, then better-funded venues claim crowded map spots first.
    const weight = (v: typeof venuePoints[number]) => (v.group.live ? 1e6 : 0) + (v.group.focus.length || v.group.week.length) * 1e3 + Math.min(999, v.fundingBaseCents / 1e4);
    venuePoints.sort((a, b) => weight(b) - weight(a));
    if (flags.placesLayer) linkPlaces();
  }
  /** SA venue browser: one card per physical venue listing every event it hosts this week. */
  function openVenue(anchor: Blip) {
    const groups = venueGroups.length ? venueGroups : groupVenues(events.map(value => value.event));
    const group = groups.find(value => value.events.some(view => view.event.id === anchor.event.id));
    if (!group || group.week.length <= 1) { select(anchor); return; }
    renderVenueCard(group);
  }
  function chooseVenue(key: string, hail = false) {
    const group = venueGroups.find(value => value.key === key);
    const representative = group && blipFor(representativeEvent(group));
    if (!representative) { unavailableEvent(true); return; }
    choose(representative, hail);
  }
  function renderVenueCard(group: VenueGroup, reveal = true) {
    if (reveal && !expanded) toggleMap(true);
    // A background refresh may replace rows, but must keep keyboard focus on the same action/event.
    const active = !reveal && expanded && card.contains(document.activeElement)
      ? document.activeElement as HTMLElement : null;
    const representative = blipFor(representativeEvent(group));
    selectedVenueKey = group.key; selected = representative; card.hidden = false; card.replaceChildren();
    card.append(element('h3', undefined, group.title));
    const sample = group.week[0] ?? group.events[0];
    card.append(element('p', 'gt-radar-event-place', `${sample?.event.address || group.title}${group.approx ? ' · approximate location' : ''}`));
    const shown = group.week.length ? group.week : group.events;
    card.append(element('p', 'gt-radar-note', `${shown.length} event${shown.length === 1 ? '' : 's'} at this venue${group.laterThisWeek > 0 ? ` · +${group.laterThisWeek} more this week` : ''}`));
    let primary: HTMLButtonElement | undefined, focus: HTMLButtonElement | undefined;
    if (representative) {
      const actions = element('nav');
      primary = button('Set destination', () => chooseVenue(group.key)); primary.dataset.venueAction = 'destination'; actions.append(primary);
      if (active?.dataset.venueAction === 'destination') focus = primary;
      if (options.onHail) {
        const hail = rideButton(representative, () => chooseVenue(group.key, true)); hail.dataset.venueAction = 'hail'; actions.append(hail);
        if (active?.dataset.venueAction === 'hail') focus = hail;
      }
      card.append(actions);
    }
    const venueList = element('div', 'gt-radar-venue-events');
    for (const view of shown) {
      const target = blipFor(view.event); if (!target) continue;
      const row = button('', () => select(target));
      row.dataset.venueEvent = view.event.id;
      if (active?.dataset.venueEvent === view.event.id) focus = row;
      row.append(element('strong', undefined, view.event.title));
      row.append(element('small', undefined, `${view.dayLabel} ${view.timeLabel}${view.live ? ' · live now' : ''}${view.event.community ? ' · community' : ''}${view.event.approx ? ' · approx' : ''}`));
      venueList.append(row);
    }
    card.append(venueList);
    if (reveal && primary) revealCard(primary);
    else if (active) (focus ?? primary)?.focus({ preventScroll: true });
    lastDraw = -Infinity;
  }
  /** Click-anywhere SA waypoint: snap the clicked map point to the road graph and route to it. */
  function setWaypointAt(sx: number, sy: number) {
    if (!canRoute()) { showMapStatus('Waypoints are turned off.'); return; }
    const world = unproject(sx, sy); if (!world) return;
    if (!router) { showMapStatus('Road directions are still loading — try again in a moment.'); return; }
    const target: RadarDestination = { title: 'Map waypoint', x: world.x, y: 0, z: world.z };
    const selectedRoute = router.route(position, target);
    if (!selectedRoute) { showMapStatus('No road near there. Click closer to a street.'); return; }
    const approach: RadarDestination = { ...target, ...selectedRoute.approach };
    const accepted = options.onSelect(approach);
    if (accepted === false || typeof accepted === 'string') { showMapStatus(typeof accepted === 'string' && accepted ? accepted : 'That waypoint was not accepted.'); return; }
    selected = undefined; selectedVenueKey = null; card.hidden = true; destination = { ...target }; navigationComplete = false; planRoute(selectedRoute);
    if (options.onHail && flags.quickRobotaxi) {
      card.hidden = false; card.replaceChildren(element('h3', undefined, target.title), rideButton(approach, () => choose(approach, true)));
    }
    const distance = selectedRoute.distanceM;
    showMapStatus(`Waypoint set · ${distance < 1000 ? `${Math.round(distance)} m` : `${(distance / 1000).toFixed(1)} km`} by road. Close the map to drive.`);
  }
  function setMapBounds() {
    let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
    const include=(point:{x:number;z:number})=>{minX=Math.min(minX,point.x);maxX=Math.max(maxX,point.x);minZ=Math.min(minZ,point.z);maxZ=Math.max(maxZ,point.z);};
    for(const point of options.graph.nodes)include(point);
    for(const event of events)include(event);
    if (!Number.isFinite(minX)) return;
    mapCentre = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
    mapRange = Math.max(500, (maxX - minX) / 2, (maxZ - minZ) / 2) * 1.1;
  }
  function projectInto(x: number, z: number, out: { x: number; y: number }) {
    const p = projection;
    out.x = p.a * x + p.c * z + p.tx; out.y = p.b * x + p.d * z + p.ty;
    return out;
  }
  function project(x: number, z: number) { return projectInto(x, z, { x: 0, y: 0 }); }
  /** Per-entity draw loops reuse one point (gtasf-2zmc L7): each iteration copies what it keeps. */
  const drawScratch = { x: 0, y: 0 };
  function updateEventDetails(event:Blip){
    const heading=card.querySelector('h3');if(heading)heading.textContent=event.title;
    const when = Number.isFinite(event.startMs) ? SF_DATE.format(event.startMs) : 'Time on event page';
    const time=card.querySelector('.gt-radar-event-time');if(time)time.textContent=`${when} PT`;
    const host=card.querySelector<HTMLElement>('.gt-radar-event-host');if(host){host.textContent=event.event.host??'';host.hidden=!event.event.host;}
    const funding=card.querySelector('.gt-radar-event-funding');if(funding){
      const now = Date.now();
      // Preview events (pre-Tech-Week fallback) quote at the upcoming rate, matching the drive-through payout.
      const quote = quoteFunding(event.event, now, 0, 1, isPreviewLull(events.map(blip => blip.event), now));
      funding.textContent=`Raise ~${formatFunding(quote.amountCents)} · ${quote.timing} ×${quote.timeMultiplier} · ${flags.driveThroughFunding?'drive through to collect':'20 seconds in the marker'}`;
    }
    const place=card.querySelector('.gt-radar-event-place');if(place)place.textContent=`${event.event.venue || event.event.address || 'Public neighborhood'}${event.event.community ? ' · community event' : ''}${event.event.approx ? ' · approximate location' : ''}`;
    const link=card.querySelector<HTMLAnchorElement>('a');if(link){try{const url=new URL(event.event.url);link.hidden=!['https:','http:'].includes(url.protocol);if(!link.hidden)link.href=url.href;}catch{link.hidden=true;}}
  }
  function unavailableEvent(venue = false) {
    const restoreFocus = card.contains(document.activeElement);
    selected = undefined; selectedVenueKey = null; card.hidden = false;
    const message = element('p', 'gt-radar-note', venue
      ? 'This venue has no upcoming events in the current calendar. Choose another venue.'
      : 'This event is no longer in the current calendar. Choose another event.');
    message.setAttribute('role', 'status');
    card.replaceChildren(element('h3', undefined, 'Calendar updated'), message);
    if (expanded && restoreFocus) search.focus({ preventScroll: true });
    lastDraw = -Infinity;
  }
  function revealCard(primary: HTMLButtonElement) {
    // Card actions precede the result list: make the explicit selection usable
    // immediately instead of requiring a trip through the remaining results.
    card.scrollIntoView({ block: 'nearest' });
    primary.focus(); // A card taller than the phone panel must still expose its action.
  }
  function select(event: Blip) {
    const latest=events.find(value=>value.id===event.id);if(!latest){unavailableEvent();return;}event=latest;
    selected = event; selectedVenueKey = null; if (!expanded) toggleMap(true);
    card.replaceChildren(); card.hidden = false;
    card.append(element('h3'),element('p','gt-radar-event-time'),element('p','gt-radar-event-host'));
    if(flags.fundingLoop)card.append(element('p','gt-radar-event-funding'));
    card.append(element('p','gt-radar-event-place'));
    const actions = element('nav');
    const primary = button('Set destination', () => choose(event)); actions.append(primary);
    if (options.onHail) actions.append(rideButton(event, () => choose(event, true)));
    try {
      const url = new URL(event.event.url);
      if (url.protocol === 'https:' || url.protocol === 'http:') {
        const link = element('a', undefined, 'Event page ↗'); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; actions.append(link);
      }
    } catch { /* Source link unavailable; other event fields remain useful. */ }
    card.append(actions);updateEventDetails(event); revealCard(primary); lastDraw = -Infinity;
  }
  function selectPlace(place: RadarDestination) {
    selected = undefined; selectedVenueKey = null; card.hidden = false; card.replaceChildren(element('h3', undefined, place.title));
    card.append(element('p', undefined, 'Drive to the nearest mapped road approach.'));
    const actions = element('nav'), primary = button('Set destination', () => choose(place)); actions.append(primary);
    if (options.onHail) actions.append(rideButton(place, () => choose(place, true)));
    card.append(actions); revealCard(primary); lastDraw = -Infinity;
  }
  for (const place of options.landmarks ?? []) {
    landmarks.append(button(place.title, () => selectPlace(place)));
  }
  function renderVenueList(query: string) {
    const matches = venuePoints.filter(venue =>
      `${venue.group.title} ${venue.group.events.map(view => `${view.event.title} ${view.event.host ?? ''}`).join(' ')}`.toLocaleLowerCase().includes(query));
    matches.sort((a, b) => Math.hypot(a.x - position.x, a.z - position.z) - Math.hypot(b.x - position.x, b.z - position.z));
    list.replaceChildren();
    for (const venue of matches.slice(0, 60)) {
      const distance = Math.hypot(venue.x - position.x, venue.z - position.z);
      const count = venue.group.week.length || venue.group.focus.length || venue.group.events.length;
      const next = venue.group.focus[0] ?? venue.group.week[0] ?? venue.group.events[0];
      const row = button(venue.group.title, () => openVenue(venue.rep));
      row.append(element('small', undefined, `${distance < 1000 ? `${Math.round(distance)} m` : `${(distance / 1000).toFixed(1)} km`}${venue.group.approx ? ' · approx' : ''} · ${count} event${count === 1 ? '' : 's'} · next ${next ? `${next.dayLabel} ${next.timeLabel}` : 'see event page'}`));
      list.append(row);
    }
    status.textContent = flags.eventPinsV2 && !query ? livingSummary() : matches.length ? `${matches.length} venue${matches.length === 1 ? '' : 's'} · nearest ${Math.min(matches.length, 60)} shown` : venuePoints.length ? 'No matching venues' : 'No located events available';
  }
  /** eventPinsV2 side panel: live events, starting-soon events and nearby real places (title, place, distance). */
  function renderLivingList(query: string) {
    const now = Date.now(), metres = (d: number) => d < 1000 ? `${Math.round(d / 10) * 10} m` : `${(d / 1000).toFixed(1)} km`;
    const live: { blip: Blip; d: number }[] = [], soon: { blip: Blip; d: number; start: number }[] = [];
    for (const venue of venuePoints) {
      const pin = venuePinEvent(venue.group, now); if (!pin) continue;
      const blip = blipById.get(pin.view.event.id); if (!blip) continue;
      if (query && !`${blip.event.title} ${blip.event.host ?? ''} ${blip.event.venue ?? ''}`.toLocaleLowerCase().includes(query)) continue;
      const d = Math.hypot(venue.x - position.x, venue.z - position.z);
      if (pin.live) live.push({ blip, d }); else soon.push({ blip, d, start: pin.view.start });
    }
    live.sort((a, b) => a.d - b.d); soon.sort((a, b) => a.start - b.start || a.d - b.d);
    const near = placePoints.filter(p => !query || `${p.name} ${PLACE_KIND[p.kind] ?? ''}`.toLocaleLowerCase().includes(query))
      .map(p => ({ p, d: Math.hypot(p.x - position.x, p.z - position.z) })).sort((a, b) => a.d - b.d).slice(0, 12);
    list.replaceChildren();
    const section = (title: string) => list.append(element('h4', 'gt-radar-list-head', title));
    const eventRow = (blip: Blip, meta: string) => {
      const row = button(`${eventKindStyle(blip.kind).glyph} ${blip.event.title}`, () => select(blip));
      row.append(element('small', undefined, meta)); list.append(row);
    };
    if (live.length) { section(`Live now · ${live.length}`); for (const { blip, d } of live.slice(0, 20)) eventRow(blip, `${blip.event.venue ?? 'Public location'} · ${metres(d)}`); }
    if (soon.length) { section('Starting soon'); for (const { blip, d, start } of soon.slice(0, 10)) eventRow(blip, `${pinTime(start)} · ${blip.event.venue ?? 'Public location'} · ${metres(d)}`); }
    if (near.length) {
      section('Nearby places');
      for (const { p, d } of near) {
        const row = button(p.name, () => { const s = projectInto(p.x, p.z, { x: 0, y: 0 }); openPlace(p, s.x, s.y); });
        row.append(element('small', undefined, `${PLACE_KIND[p.kind] ?? 'Place'} · ${metres(d)}`)); list.append(row);
      }
    }
    status.textContent = live.length || soon.length || near.length ? livingSummary() : 'Nothing matches';
  }
  function renderEventList(query: string) {
    const filtered = events.filter(event => `${event.title} ${event.event.host ?? ''} ${event.event.venue ?? ''}`.toLocaleLowerCase().includes(query));
    filtered.sort((a, b) => Math.hypot(a.x - position.x, a.z - position.z) - Math.hypot(b.x - position.x, b.z - position.z));
    list.replaceChildren();
    for (const event of filtered.slice(0, 50)) {
      const row = button(event.title, () => select(event)), distance = Math.hypot(event.x - position.x, event.z - position.z);
      row.append(element('small', undefined, `${distance < 1000 ? `${Math.round(distance)} m` : `${(distance / 1000).toFixed(1)} km`}${event.event.approx ? ' · approx' : ''} · ${Number.isFinite(event.startMs) ? SF_DATE.format(event.startMs) : 'See event page'}`));
      list.append(row);
    }
    status.textContent = filtered.length ? `${filtered.length} real events · nearest 50 shown` : events.length ? 'No matching events' : 'No located events available';
  }
  function renderList() {
    const query = search.value.trim().toLocaleLowerCase();
    if (flags.eventPinsV2 && flags.venueGrouping) renderLivingList(query); else if (flags.venueGrouping) renderVenueList(query); else renderEventList(query);
    const matches = query ? districtDestinations.filter(place => place.search.includes(query)) : [];
    matches.sort((a, b) => Math.hypot(a.x - position.x, a.z - position.z) - Math.hypot(b.x - position.x, b.z - position.z));
    places.replaceChildren(); places.hidden = matches.length === 0;
    for (const place of matches) {
      const row = button(place.title, () => selectPlace(place));
      const distance = Math.hypot(place.x - position.x, place.z - position.z);
      row.append(element('small', undefined, `District · ${distance < 1000 ? `${Math.round(distance)} m` : `${(distance / 1000).toFixed(1)} km`}`));
      places.append(row);
    }
    if (matches.length) status.textContent = `${matches.length} district${matches.length === 1 ? '' : 's'} · ${status.textContent}`;
  }
  search.addEventListener('input', renderList);
  function toggleMap(force?: boolean) {
    if (disposed) return;
    if (!flags.fullMap && (force ?? !expanded)) return;
    const next = force ?? !expanded;
    if (next === expanded) return;
    const restoreFocus = root.contains(document.activeElement);
    expanded = next; root.dataset.expanded = String(expanded); expandButton.textContent = expanded ? 'Close ×' : 'M';
    expandButton.setAttribute('aria-label', expanded ? 'Close event map' : 'Open event map');
    expandButton.setAttribute('aria-expanded', String(expanded));
    if (expanded) {
      previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true');
      releaseCursor = holdFreeCursor(); if (document.pointerLockElement) document.exitPointerLock();
    } else {
      cancelPointers();
      releaseCursor?.(); releaseCursor = undefined;
      root.removeAttribute('role'); root.removeAttribute('aria-modal');
    }
    options.onExpandedChange?.(expanded);
    // Other panels may restore their own focus while the integration callback closes them.
    if (expanded) { renderList(); search.focus({ preventScroll: true }); }
    else {
      // Do not steal focus if a different HUD/dialog already took ownership before closing us.
      if (restoreFocus) {
        const target = previousFocus?.isConnected && previousFocus.getClientRects().length && !previousFocus.matches(':disabled')
          ? previousFocus : expandButton;
        target.focus({ preventScroll: true });
      }
      previousFocus = null;
    }
    // Expanding/collapsing changes the canvas CSS box, so re-measure on the next draw.
    viewportMeasured = false; lastDraw = -Infinity;
  }
  function keyboard(event: KeyboardEvent) {
    if (!expanded) return;
    if (event.code === 'Escape') { event.preventDefault(); toggleMap(false); return; }
    if (event.code !== 'Tab' || event.ctrlKey || event.metaKey || event.altKey) return;
    const controls = [...root.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]')]
      .filter(node => node.tabIndex >= 0 && node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden');
    const first = controls[0], last = controls.at(-1), active = document.activeElement;
    if (!first) { event.preventDefault(); root.focus(); }
    else if (!root.contains(active) || active === root || (event.shiftKey ? active === first : active === last)) {
      event.preventDefault(); (event.shiftKey ? last : first)?.focus();
    }
  }
  window.addEventListener('keydown', keyboard);
  window.addEventListener('resize', invalidateViewport);
  const viewportObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(invalidateViewport) : null;
  viewportObserver?.observe(canvas);
  /** Radar v2.1 shared event-blip paint: per-kind colour + glyph, crowd-heat glow + count, dimmed when collected. */
  function paintEventBlip(x: number, y: number, size: number, style: EventKindStyle, o: {
    baseAlpha: number; live: boolean; approx: boolean; collected: boolean; selected: boolean;
    crowd: number; now: number; saStyle: boolean; detail: boolean;
  }) {
    if (o.crowd > 0) { // Crowd heat: a soft glow under busy events, growing with the nearby player count.
      const glowR = size + 6 + Math.min(14, o.crowd * 2.2);
      const grad = context.createRadialGradient(x, y, size * 0.5, x, y, glowR);
      grad.addColorStop(0, 'rgba(255,196,64,0.5)'); grad.addColorStop(1, 'rgba(255,196,64,0)');
      context.globalAlpha = o.baseAlpha * (o.collected ? 0.5 : 1); context.fillStyle = grad;
      context.beginPath(); context.arc(x, y, glowR, 0, Math.PI * 2); context.fill();
    }
    context.globalAlpha = o.baseAlpha * (o.collected ? 0.4 : 1);
    context.fillStyle = o.collected ? '#8a8f86' : style.color;
    context.strokeStyle = o.saStyle ? '#2a1e0c' : '#17211d'; context.lineWidth = o.selected ? 2.4 : 1.5;
    context.beginPath(); context.arc(x, y, size, 0, Math.PI * 2); context.fill(); context.stroke();
    if (o.approx) { context.strokeStyle = o.saStyle ? '#8a6d2f' : '#f9e5ad'; context.setLineDash([2, 2]); context.beginPath(); context.arc(x, y, size + 2, 0, Math.PI * 2); context.stroke(); context.setLineDash([]); }
    if (o.detail) {
      const gpx = Math.max(11, Math.round(size * 1.8));
      context.font = `${gpx}px "Apple Color Emoji","Segoe UI Emoji",Arial,sans-serif`; context.textAlign = 'center'; context.textBaseline = 'middle';
      context.globalAlpha = o.collected ? 0.55 : 1; context.fillText(style.glyph, x, y + 0.5); context.textBaseline = 'alphabetic';
      if (o.crowd > 1) {
        context.font = 'bold 10px Arial'; context.lineJoin = 'round'; context.lineWidth = 3;
        context.strokeStyle = 'rgba(8,16,12,0.9)'; context.fillStyle = '#ffe9a8';
        context.strokeText(String(o.crowd), x + size + 6, y - size); context.fillText(String(o.crowd), x + size + 6, y - size);
      }
    }
    context.globalAlpha = 1;
  }
  // Same Low test as the render foundation (?preset=low or a coarse pointer); see flags.lowRadarBudget.
  const lowBudget = flags.lowRadarBudget && (new URLSearchParams(location.search).get('preset') === 'low'
    || (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches));
  // Low minimap skips emoji glyphs and crowd-glow gradients (text/gradient raster dominated its cost).
  const lowMini = () => lowBudget && !expanded;
  /** One decluttered marker per venue, sized by funding, with a focus count and a +N-this-week badge. */
  // Expanded-map declutter (gtasf-crwk): screen positions of blips/badges already drawn this frame.
  const drawnBlips: number[] = [], drawnBadges: number[] = [];
  /** eventPinsV2 (gtasf-stc2): title label rects drawn this frame (x0, y0, x1, y1, ...), for collision-free titles. */
  const drawnTitles: number[] = [];
  const SOON_MS = 2 * 60 * 60 * 1000;
  const pinTime = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' }).replace(':00', '').replace(' ', '').toLowerCase();
  /** The event a venue pin shows now: live first, else the soonest starting within 2 h; null = hide the venue. */
  function venuePinEvent(group: VenueGroup, now: number) {
    let pick: VenueGroup['focus'][number] | undefined, sameDay = 0;
    for (const v of group.focus) {
      const ended = Number.isFinite(v.end) ? v.end <= now : v.start + 3 * 60 * 60 * 1000 <= now;
      if (ended) continue;
      sameDay++;
      const live = v.start <= now, soon = v.start - now <= SOON_MS;
      if (!live && !soon) continue;
      if (!pick || (live && pick.start > now) || (live === (pick.start <= now) && v.start < pick.start)) pick = v;
    }
    return pick ? { view: pick, live: pick.start <= now, others: sameDay - 1 } : null;
  }
  const blipOptions = { baseAlpha: 1, live: false, approx: false, collected: false, selected: false, crowd: 0, now: 0, saStyle: false, detail: false };
  const crowded = (list: number[], x: number, y: number, gap: number) => {
    for (let i = 0; i < list.length; i += 2) if (Math.abs(list[i]! - x) < gap && Math.abs(list[i + 1]! - y) < gap) return true;
    return false;
  };
  function drawVenueBlips(now: number, saStyle: boolean) {
    drawnBlips.length = 0; drawnBadges.length = 0;
    const radius = expanded ? Math.min(width, height) / 2 - 8 : Math.min(width, height) / 2 - 12;
    if (flags.eventPinsV2) { drawEventPins(now, saStyle, radius); return; }
    for (const venue of venuePoints) {
      const p = projectInto(venue.x, venue.z, venueScratch);
      let dx = p.x - width / 2, dy = p.y - height / 2, distance = Math.sqrt(dx * dx + dy * dy), edge = false;
      if (!expanded && distance > radius) { dx *= radius / distance; dy *= radius / distance; p.x = width / 2 + dx; p.y = height / 2 + dy; edge = true; }
      if (p.x < 0 || p.y < 0 || p.x > width || p.y > height) continue;
      const live = venue.group.live, focusCount = venue.group.focus.length || venue.group.week.length;
      const timeFactor = live ? 3 : 1.5; // Focus-window venues are near-term by construction.
      const fundingSize = flags.fundingLoop ? Math.min(5.5, Math.max(0, Math.log2(venue.fundingBaseCents * timeFactor / MARKER_UNIT_CENTS) * 1.15)) : 0;
      const selFlag = selected?.id === venue.rep.id;
      const size = (focusCount > 1 ? 7 : selFlag ? 6 : 4) + fundingSize + (live ? 2 * (1 + Math.sin(now / 220)) : 0);
      // Whole-city zoom piles downtown venues on top of each other: the first venue drawn in a spot wins
      // (selected always draws); zooming in spreads them apart so the others reappear.
      if (expanded && !selFlag && crowded(drawnBlips, p.x, p.y, 12)) continue;
      if (expanded) drawnBlips.push(p.x, p.y);
      // One reused options object (paintEventBlip only reads it): no literal per venue per frame (gtasf-pooa).
      const o = blipOptions;
      o.baseAlpha = edge ? .72 : 1; o.live = live; o.approx = venue.group.approx; o.collected = venue.fullyCollected;
      o.selected = selFlag; o.crowd = lowMini() ? 0 : crowdAt(venue.x, venue.z); o.now = now; o.saStyle = saStyle;
      o.detail = !lowMini() && focusCount === 1 && (expanded || size >= 7 || selFlag);
      paintEventBlip(p.x, p.y, size, eventKindStyle(venue.rep.kind), o);
      if (focusCount > 1) { context.fillStyle = saStyle ? '#2a1e0c' : '#17211d'; context.font = 'bold 9px Arial'; context.textAlign = 'center'; context.textBaseline = 'alphabetic'; context.fillText(focusCount > 99 ? '99+' : String(focusCount), p.x, p.y + 3); }
      if (expanded && venue.group.laterThisWeek > 0 && !crowded(drawnBadges, p.x, p.y, 34)) {
        drawnBadges.push(p.x, p.y);
        const label = `+${venue.group.laterThisWeek}`;
        context.font = 'bold 11px Arial'; context.textAlign = 'left'; context.textBaseline = 'middle'; context.lineJoin = 'round';
        context.lineWidth = 3; context.strokeStyle = saStyle ? 'rgba(231,216,180,0.9)' : 'rgba(10,23,21,0.9)'; context.fillStyle = saStyle ? '#5a3a12' : '#f0c56b';
        context.strokeText(label, p.x + size + 3, p.y - size - 1); context.fillText(label, p.x + size + 3, p.y - size - 1);
      }
      let hit = hitPool[hits.length];
      if (!hit) { hit = { x: p.x, y: p.y, event: venue.rep }; hitPool[hits.length] = hit; }
      else { hit.x = p.x; hit.y = p.y; hit.event = venue.rep; }
      hits.push(hit);
    }
    context.globalAlpha = 1; context.textBaseline = 'alphabetic'; // Restore the shared baseline for the compass label.
  }
  /** placesLayer (living map phase 2, gtasf-stc2): real SF tech places from /data/places.json as the map's base
   *  layer. Kind icon on a dark disc; startups only on the full map from zoom 3; names from zoom 3 (shared
   *  collision list with event titles); a place within 80 m of a venue with a live event glows. */
  type PlacePoint = { id: string; name: string; kind: string; blurb: string; website: string; x: number; z: number; venue?: VenuePoint };
  const placeHits: { x: number; y: number; place: PlacePoint }[] = [];
  const PLACE_KIND: Record<string, string> = { lab: 'AI lab', bigtech: 'Big tech HQ', hackerhouse: 'Hacker house', vc: 'VC firm', accelerator: 'Accelerator', startup: 'Startup' };
  const PLACE_COLOUR: Record<string, string> = { lab: '#8b5cf6', bigtech: '#2f7fe0', hackerhouse: '#f07a1a', vc: '#16a34a', accelerator: '#e11d48', startup: '#5b6b7a' };
  let placeAtlas: { tile: number; logos: Record<string, { page: number; x: number; y: number; kind?: string }> } | null = null, placePages: HTMLImageElement[] = [];
  if (flags.placesLayer) void fetch('/data/place-logos/index.json').then(r => r.ok ? r.json() : null).then((index: { tile: number; pages: number; logos: Record<string, { page: number; x: number; y: number; kind?: string }> } | null) => {
    if (!index) return; placeAtlas = index;
    placePages = Array.from({ length: index.pages }, (_, i) => { const img = new Image(); img.src = `/data/place-logos/page-${i}.webp`; img.onload = () => { lastDraw = -Infinity; }; return img; });
  }).catch(() => undefined);
  const PLACE_GLYPH: Record<string, string> = { lab: '🔬', bigtech: '🏢', hackerhouse: '🏠', vc: '💰', accelerator: '🚀', startup: '•' };
  let placePoints: PlacePoint[] = [];
  if (flags.placesLayer) void fetch('/data/places.json').then(r => r.ok ? r.json() : null).then((data: { places?: { id: string; name: string; kind: string; blurb?: string; website?: string; lat: number | null; lon: number | null }[] } | null) => {
    placePoints = (data?.places ?? []).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon)).map(p => {
      const point = projectLocation(p.lat!, p.lon!, options.frame);
      return { id: p.id, name: p.name, kind: p.kind, blurb: p.blurb ?? '', website: p.website ?? '', x: point.x, z: point.z };
    });
    // Declutter priority: rarer, more interesting kinds claim crowded map spots first.
    const rank: Record<string, number> = { lab: 0, vc: 1, accelerator: 2, hackerhouse: 3, bigtech: 4, startup: 5 };
    placePoints.sort((a, b) => (rank[a.kind] ?? 4) - (rank[b.kind] ?? 4));
    linkPlaces();
  }).catch(() => undefined);
  const drawnPlaces: number[] = [];
  /** Place names wait until event pins have claimed their title space (events win): name, x, top-y triples. */
  const placeLabels: (string | number)[] = [];
  function drawPlaceNames(saStyle: boolean) {
    context.font = '600 10px Arial'; context.textAlign = 'center'; context.textBaseline = 'top'; context.lineJoin = 'round'; context.lineWidth = 3;
    context.strokeStyle = saStyle ? 'rgba(231,216,180,0.9)' : 'rgba(10,23,21,0.9)'; context.fillStyle = saStyle ? '#2a1e0c' : '#cfe7df';
    for (let i = 0; i < placeLabels.length; i += 3) {
      const name = placeLabels[i] as string, x = placeLabels[i + 1] as number, y0 = placeLabels[i + 2] as number;
      const w = context.measureText(name).width, x0 = x - w / 2, x1 = x0 + w, y1 = y0 + 12;
      let clear = true;
      for (let j = 0; j < drawnTitles.length; j += 4) if (x0 < drawnTitles[j + 2]! && x1 > drawnTitles[j]! && y0 < drawnTitles[j + 3]! && y1 > drawnTitles[j + 1]!) { clear = false; break; }
      if (!clear) continue;
      drawnTitles.push(x0, y0, x1, y1); context.strokeText(name, x, y0); context.fillText(name, x, y0);
    }
    context.textBaseline = 'alphabetic';
  }
  function linkPlaces() {
    for (const place of placePoints) {
      place.venue = undefined; let best = 80;
      for (const venue of venuePoints) { const d = Math.hypot(venue.x - place.x, venue.z - place.z); if (d < best) { best = d; place.venue = venue; } }
    }
  }
  const placeScratch = { x: 0, y: 0 }, pinHeads: number[] = [];
  /** Place card: kind, blurb, website, events here today, GO (route), and a visible removal-request path. */
  function openPlace(place: PlacePoint, sx: number, sy: number) {
    selected = undefined; selectedVenueKey = null; card.hidden = false; card.replaceChildren();
    card.append(element('h3', undefined, place.name), element('p', 'gt-place-kind', PLACE_KIND[place.kind] ?? 'Place'));
    if (place.blurb) card.append(element('p', undefined, place.blurb));
    const today = place.venue ? place.venue.group.focus.filter(v => v.start <= Date.now() + 24 * 3600e3).length : 0;
    if (today) card.append(element('p', undefined, `${today} event${today === 1 ? '' : 's'} here today`));
    const actions = element('div', 'gt-place-actions');
    if (place.venue) { const events = button('Events here', () => renderVenueCard(place.venue!.group)); actions.append(events); }
    if (canRoute()) actions.append(button('GO', () => setWaypointAt(sx, sy)));
    if (/^https:\/\//.test(place.website)) { const link = element('a', undefined, 'Website'); link.href = place.website; link.target = '_blank'; link.rel = 'noopener noreferrer'; actions.append(link); }
    const report = button('Report / request removal', () => {
      report.disabled = true;
      void fetch('/api/feedback', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `Takedown request: place ${place.id} (${place.name}). Please remove this name/logo from the map.` }) })
        .then(r => { report.textContent = r.ok ? 'Removal requested - thank you' : 'Could not send - try the feedback form'; })
        .catch(() => { report.textContent = 'Could not send - try the feedback form'; });
    });
    report.className = 'gt-place-report'; actions.append(report);
    card.append(actions);
  }
  function drawPlaces(now: number, saStyle: boolean) {
    drawnTitles.length = 0; placeHits.length = 0; drawnPlaces.length = 0; placeLabels.length = 0;
    // Event markers win crowded spots: reserve each live/soon pin's head so places do not sit under it.
    pinHeads.length = 0;
    if (expanded && flags.eventPinsV2) {
      const now0 = Date.now();
      for (const venue of venuePoints) { if (!venuePinEvent(venue.group, now0)) continue; const h = projectInto(venue.x, venue.z, placeScratch); pinHeads.push(h.x, h.y - 18); }
    }
    const radius = Math.min(width, height) / 2 - 10;
    for (const place of placePoints) {
      const startup = place.kind === 'startup';
      if (startup && !(expanded && zoom >= 3)) continue;
      const p = projectInto(place.x, place.z, placeScratch);
      if (!expanded && Math.hypot(p.x - width / 2, p.y - height / 2) > radius) continue;
      if (p.x < 0 || p.y < 0 || p.x > width || p.y > height) continue;
      const live = !!place.venue && !!venuePinEvent(place.venue.group, Date.now())?.live;
      // Phone-width maps get a wider gap: rarer kinds (sorted first) keep their spot, the long tail drops out.
      if (!live && (crowded(drawnPlaces, p.x, p.y, expanded ? (width < 500 ? 20 : 15) : 16) || (expanded && crowded(pinHeads, p.x, p.y, 16)))) continue;
      drawnPlaces.push(p.x, p.y);
      if (expanded) placeHits.push({ x: p.x, y: p.y, place });
      const big = expanded && zoom >= 2, r = startup ? (big ? 6 : 3.5) : big ? 11 : expanded ? 7.5 : 6.5;
      if (live) { context.globalAlpha = .5 + .3 * Math.sin(now / 260); context.fillStyle = '#ffd36b'; context.beginPath(); context.arc(p.x, p.y, r + 5, 0, Math.PI * 2); context.fill(); }
      context.globalAlpha = 1; context.fillStyle = PLACE_COLOUR[place.kind] ?? '#2f7fe0';
      context.beginPath(); context.arc(p.x, p.y, r, 0, Math.PI * 2); context.fill();
      context.lineWidth = 1.5; context.strokeStyle = '#ffffff'; context.stroke();
      const logo = placeAtlas?.logos[place.id], img = logo && logo.kind === 'logo' ? placePages[logo.page] : undefined;
      if (r >= 7 && img?.complete && img.naturalWidth && logo) {
        context.save(); context.beginPath(); context.arc(p.x, p.y, r - 1.5, 0, Math.PI * 2); context.clip();
        context.fillStyle = '#ffffff'; context.fill();
        context.drawImage(img, logo.x, logo.y, placeAtlas!.tile, placeAtlas!.tile, p.x - (r - 1.5), p.y - (r - 1.5), (r - 1.5) * 2, (r - 1.5) * 2);
        context.restore();
      } else if (!startup) { context.fillStyle = '#ffffff'; context.font = `bold ${Math.round(r * 1.1)}px Arial`; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(place.name.slice(0, 1).toUpperCase(), p.x, p.y + .5); }
      if (expanded && zoom >= (startup ? 3 : 2)) placeLabels.push(place.name, p.x, p.y + r + 2);
    }
    context.textBaseline = 'alphabetic';
  }
  /** eventPinsV2: one pin per venue for its live / next-2h event (kind icon), '+N today' badge, start time when
   *  soon, titles on the full map from zoom 3 (collision-free). Venues with nothing live or soon are hidden. */
  /** Roaming angels (gtasf-y5vc, flag angelNpcs): a 👼 where each angel is this time slot (shared schedule, no
   *  protocol); name on the full map from zoom 2. Pitch them in person (hold V). */
  const angelScratch = { x: 0, y: 0 };
  function drawAngels(saStyle: boolean, now: number) {
    const radius = Math.min(width, height) / 2 - 10;
    const spots = angelSpots(Date.now());
    // The minimap pins the nearest angel to its rim when none is in range, so there is always one to head for.
    const nearest = expanded ? null : spots.reduce<typeof spots[number] | null>((best, s) => !best || Math.hypot(s.stop.x - position.x, s.stop.z - position.z) < Math.hypot(best.stop.x - position.x, best.stop.z - position.z) ? s : best, null);
    for (const spot of spots) {
      const p = projectInto(spot.stop.x, spot.stop.z, angelScratch);
      const d = Math.hypot(p.x - width / 2, p.y - height / 2);
      if (!expanded && d > radius) {
        if (spot !== nearest) continue;
        p.x = width / 2 + (p.x - width / 2) * radius / d; p.y = height / 2 + (p.y - height / 2) * radius / d;
      }
      if (p.x < 0 || p.y < 0 || p.x > width || p.y > height) continue;
      const r = expanded ? 11 : 9;
      context.globalAlpha = .35 + .2 * Math.sin(now / 300); context.fillStyle = '#ffe58a';
      context.beginPath(); context.arc(p.x, p.y, r + 5, 0, Math.PI * 2); context.fill();
      context.globalAlpha = 1; context.fillStyle = '#f5c542'; context.strokeStyle = '#ffffff'; context.lineWidth = 2.5;
      context.beginPath(); context.arc(p.x, p.y, r, 0, Math.PI * 2); context.fill(); context.stroke();
      context.font = `${Math.round(r * 1.35)}px sans-serif`; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText('👼', p.x, p.y + .5);
      if (expanded && zoom >= 2) {
        context.font = 'bold 10px Arial'; context.textBaseline = 'top'; context.lineJoin = 'round'; context.lineWidth = 3;
        context.strokeStyle = saStyle ? 'rgba(231,216,180,0.9)' : 'rgba(10,23,21,0.9)'; context.fillStyle = saStyle ? '#5a3a12' : '#f0c56b';
        context.strokeText(spot.angel.name, p.x, p.y + r + 6); context.fillText(spot.angel.name, p.x, p.y + r + 6);
      }
    }
    context.textBaseline = 'alphabetic';
  }
  /** Full-map event marker: teardrop pin in the kind colour with its glyph; live = red pulse ring + LIVE chip. */
  function drawMarker(x: number, y: number, style: EventKindStyle, live: boolean, selectedPin: boolean, now: number) {
    const r = selectedPin ? 11 : live ? 10 : 8, top = y - r * 2.1;
    if (live) {
      const t = (now % 1400) / 1400;
      context.globalAlpha = .55 * (1 - t); context.strokeStyle = '#ff3b30'; context.lineWidth = 3;
      context.beginPath(); context.arc(x, y, 4 + t * 16, 0, Math.PI * 2); context.stroke(); context.globalAlpha = 1;
    }
    context.globalAlpha = live ? 1 : .82;
    context.fillStyle = 'rgba(0,0,0,0.35)'; context.beginPath(); context.ellipse(x, y, 4, 1.6, 0, 0, Math.PI * 2); context.fill();
    context.fillStyle = style.color; context.strokeStyle = live ? '#ff3b30' : '#ffffff'; context.lineWidth = 2;
    context.beginPath(); context.moveTo(x, y); context.arc(x, top, r, Math.PI * .72, Math.PI * .28); context.closePath(); context.fill(); context.stroke();
    context.fillStyle = '#ffffff'; context.font = `bold ${Math.round(r * 1.05)}px Arial`; context.textAlign = 'center'; context.textBaseline = 'middle';
    context.fillText(style.glyph, x, top + .5);
    if (live) {
      context.font = 'bold 8px Arial'; const w = context.measureText('LIVE').width + 6;
      context.fillStyle = '#ff3b30'; context.fillRect(x - w / 2, top - r - 10, w, 10);
      context.fillStyle = '#ffffff'; context.fillText('LIVE', x, top - r - 4.5);
    }
    context.globalAlpha = 1;
  }
  /** Side panel summary with living map pins: what is on now / soon, and how many real places are mapped. */
  function livingSummary(): string {
    const now = Date.now(); let live = 0, soon = 0;
    for (const v of venuePoints) { const pin = venuePinEvent(v.group, now); if (pin?.live) live++; else if (pin) soon++; }
    return `${live} live now · ${soon} starting within 2 h${flags.placesLayer && placePoints.length ? ` · ${placePoints.length} tech places` : ''}`;
  }
  function drawEventPins(now: number, saStyle: boolean, radius: number) {
    if (!flags.placesLayer) drawnTitles.length = 0;
    // Minimap: at most 8 off-screen events pinned to the rim (venues are sorted live-first, then busiest), so the
    // rim reads as a few directions to head in rather than a ring of discs (prod #5.43 phone check).
    let rimPins = 0;
    for (const venue of venuePoints) {
      const pin = venuePinEvent(venue.group, now); if (!pin) continue;
      const blip = blipById.get(pin.view.event.id); if (!blip) continue;
      const p = projectInto(venue.x, venue.z, venueScratch);
      let dx = p.x - width / 2, dy = p.y - height / 2, edge = false;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (!expanded && distance > radius) {
        if (++rimPins > 8 && selected?.id !== blip.id) continue;
        dx *= radius / distance; dy *= radius / distance; p.x = width / 2 + dx; p.y = height / 2 + dy; edge = true;
      }
      if (p.x < 0 || p.y < 0 || p.x > width || p.y > height) continue;
      const selFlag = selected?.id === blip.id;
      const size = (selFlag ? 7 : 5.5) + (pin.live ? 1.5 * (1 + Math.sin(now / 220)) : 0);
      if (expanded && !selFlag && crowded(drawnBlips, p.x, p.y, 16)) continue; // markers are ~20 px tall
      if (expanded) drawnBlips.push(p.x, p.y);
      const o = blipOptions;
      o.baseAlpha = (edge ? .72 : 1) * (pin.live ? 1 : .7); o.live = pin.live; o.approx = venue.group.approx; o.collected = venue.fullyCollected;
      o.selected = selFlag; o.crowd = lowMini() ? 0 : crowdAt(venue.x, venue.z); o.now = now; o.saStyle = saStyle; o.detail = !lowMini();
      if (expanded) drawMarker(p.x, p.y, eventKindStyle(blip.kind), pin.live, selFlag, now);
      else paintEventBlip(p.x, p.y, size, eventKindStyle(blip.kind), o);
      context.globalAlpha = 1;
      const small = (text: string, x: number, y: number, align: CanvasTextAlign, colour: string) => {
        context.font = 'bold 10px Arial'; context.textAlign = align; context.textBaseline = 'middle'; context.lineJoin = 'round';
        context.lineWidth = 3; context.strokeStyle = saStyle ? 'rgba(231,216,180,0.92)' : 'rgba(10,23,21,0.92)'; context.fillStyle = colour;
        context.strokeText(text, x, y); context.fillText(text, x, y);
      };
      const headY = expanded ? p.y - (selFlag ? 11 : pin.live ? 10 : 8) * 2.1 : p.y;
      // No "+N today" badge on the maps (orchestrator look-check): the venue card lists the other events.
      if (!pin.live && expanded && zoom >= 2) small(pinTime(pin.view.start), p.x, p.y + size + 8, 'center', saStyle ? '#3a2a10' : '#d9e6e0');
      if (expanded && zoom >= 2.9) { // titles from zoom 3 (wheel steps of 1.2 land at 2.99)
        const title = blip.event.title.length > 34 ? blip.event.title.slice(0, 33) + '…' : blip.event.title;
        context.font = 'bold 12px Arial';
        const w = context.measureText(title).width, x0 = p.x + 13, y0 = headY - 7, x1 = x0 + w, y1 = y0 + 14;
        let clear = true;
        for (let i = 0; i < drawnTitles.length; i += 4) if (x0 < drawnTitles[i + 2]! && x1 > drawnTitles[i]! && y0 < drawnTitles[i + 3]! && y1 > drawnTitles[i + 1]!) { clear = false; break; }
        if (clear && x1 < width - 4) {
          drawnTitles.push(x0, y0, x1, y1);
          context.textAlign = 'left'; context.textBaseline = 'middle'; context.lineJoin = 'round'; context.lineWidth = 3.5;
          context.strokeStyle = saStyle ? 'rgba(231,216,180,0.95)' : 'rgba(10,23,21,0.95)'; context.fillStyle = saStyle ? '#1d1408' : '#f4f1e8';
          context.strokeText(title, x0, headY); context.fillText(title, x0, headY);
        }
      }
      let hit = hitPool[hits.length];
      if (!hit) { hit = { x: p.x, y: p.y, event: blip }; hitPool[hits.length] = hit; }
      else { hit.x = p.x; hit.y = p.y; hit.event = blip; }
      hits.push(hit);
    }
    context.globalAlpha = 1; context.textBaseline = 'alphabetic';
  }
  /** minimapClues ticker: refresh the nearest live events every 1.5 s, rotate the shown one every 4 s. */
  let tickerAt = -1e9, tickerIndex = 0, tickerItems: { blip: Blip; x: number; z: number; d: number }[] = [];
  const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
  function updateTicker(nowPerf: number) {
    if (expanded) { ticker.hidden = true; return; }
    if (nowPerf - tickerAt < 1500) return;
    const rotate = Math.floor(nowPerf / 4000) !== Math.floor(tickerAt / 4000);
    tickerAt = nowPerf;
    const now = Date.now(), found: typeof tickerItems = [];
    for (const venue of venuePoints) {
      const pin = venuePinEvent(venue.group, now); if (!pin?.live) continue;
      const blip = blipById.get(pin.view.event.id); if (!blip) continue;
      found.push({ blip, x: venue.x, z: venue.z, d: Math.hypot(venue.x - position.x, venue.z - position.z) });
    }
    found.sort((a, b) => a.d - b.d); tickerItems = found.slice(0, 3);
    if (!tickerItems.length) { ticker.hidden = true; return; }
    if (rotate) tickerIndex++;
    const item = tickerItems[tickerIndex % tickerItems.length]!;
    const p = projectInto(item.x, item.z, venueScratch), c = Math.min(width, height) / 2;
    const arrow = ARROWS[(Math.round(Math.atan2(p.x - c, c - p.y) / (Math.PI / 4)) + 8) % 8]!;
    const distance = item.d < 1000 ? `${Math.max(10, Math.round(item.d / 10) * 10)} m` : `${(item.d / 1000).toFixed(1)} km`;
    const title = item.blip.event.title.length > 30 ? item.blip.event.title.slice(0, 29) + '…' : item.blip.event.title;
    const venue = item.blip.event.venue ? ` · ${item.blip.event.venue.slice(0, 22)}` : '';
    ticker.textContent = `${eventKindStyle(item.blip.kind).glyph} ${title}${venue} · ${distance} ${arrow}`;
    ticker.dataset.eventId = item.blip.id ?? item.blip.event.id;
    ticker.hidden = false;
  }
  ticker.addEventListener('click', () => { const blip = blipById.get(ticker.dataset.eventId ?? ''); if (blip) select(blip); });
  function draw(now: number) {
    if (!viewportMeasured) measureViewport();
    const dpr = lowBudget && !expanded ? 1 : Math.min(devicePixelRatio, 2);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) { canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); }
    context.setTransform(dpr, 0, 0, dpr, 0, 0); context.clearRect(0, 0, width, height); context.save();
    if (!expanded) { context.beginPath(); context.arc(width / 2, height / 2, Math.min(width, height) / 2, 0, Math.PI * 2); context.clip(); }
    const saStyle = expanded && flags.saMapStyle;
    const pattern = saStyle ? parchmentPattern() : null;
    context.fillStyle = saStyle ? '#e7d8b4' : '#223735'; context.fillRect(0, 0, width, height);
    if (pattern) { context.fillStyle = pattern; context.fillRect(0, 0, width, height); }
    const mag = saStyle ? zoom : 1;
    const centre = expanded ? { x: mapCentre.x + (saStyle ? panX : 0), z: mapCentre.z + (saStyle ? panZ : 0) } : position;
    // SA zoom-out at speed (radar v2.1): the round minimap widens its span as the player moves fast,
    // so you see more road ahead while driving/riding. The expanded map keeps user-controlled zoom.
    const minimapSpan = 420 + clamp((speed - 5) * 10, 0, 280);
    const scale = (Math.min(width, height) / 2 - 12) / (expanded ? mapRange : minimapSpan) * mag;
    if (expanded && saStyle && zoom > 1) {
      // Keep the visible frame inside the map: never pan past the city's edge into empty paper.
      const spareX = Math.max(0, mapRange - width / 2 / scale), spareZ = Math.max(0, mapRange - height / 2 / scale);
      panX = clamp(panX, -spareX, spareX); panZ = clamp(panZ, -spareZ, spareZ);
      centre.x = mapCentre.x + panX; centre.z = mapCentre.z + panZ;
    }
    const range = expanded ? Math.hypot(width, height) / 2 / scale + 120 : minimapSpan * 1.5;
    const rot = viewYaw ?? yaw;
    const { a, b, c, d } = expanded ? { a: scale, b: 0, c: 0, d: scale } : radarMatrix(rot, scale);
    const tx = width / 2 - a * centre.x - c * centre.z, ty = height / 2 - b * centre.x - d * centre.z;
    projection = { a, b, c, d, tx, ty };
    context.save(); context.transform(a, b, c, d, tx, ty);
    // Water and shoreline under the roads; island rings remain parchment through even-odd fill.
    if (hasWater && saStyle) {
      if (flags.eventPinsV2 && expanded) {
        // Sea beyond the data bounds (Pacific / Bay) so SF sits in water instead of an empty paper frame.
        const inv = 1 / scale, x0 = -tx * inv, z0 = -ty * inv;
        context.fillStyle = '#8ea9bd'; context.fillRect(x0, z0, width * inv, height * inv);
        context.fillStyle = '#e7d8b4'; context.fillRect(waterBox.minX, waterBox.minZ, waterBox.maxX - waterBox.minX, waterBox.maxZ - waterBox.minZ);
      }
      context.fillStyle = '#8ea9bd';
      context.fill(waterPath, 'evenodd');
      context.strokeStyle = '#607f91'; context.lineWidth = .8 / scale;
      context.stroke(waterPath);
    }
    context.strokeStyle = saStyle ? '#9c8450' : '#a8ad8b'; context.lineWidth = (saStyle ? 2.1 : expanded ? 1.5 : 3) / scale; context.lineCap = 'round';
    if (!roadTilesBuilt) { if (!flags.slicedRoadTiles) buildRoadTiles(); else if (!roadTileBuild) startRoadTileBuild(); }
    for (const { path, minX, maxX, minZ, maxZ } of roadTiles.values()) {
      if (maxX < centre.x - range || minX > centre.x + range || maxZ < centre.z - range || minZ > centre.z + range) continue;
      context.stroke(path);
    }
    if (route && canRoute() && !navigationComplete) {
      context.strokeStyle = '#f7d55b'; context.lineWidth = (expanded ? 4 : 5) / scale; context.lineJoin = 'round'; context.stroke(routePath);
    }
    context.restore();
    if (saStyle) {
      context.textAlign = 'center'; context.textBaseline = 'middle'; context.lineJoin = 'round';
      const fontPx = clamp(8.5 * Math.sqrt(mag), 10, 21);
      context.font = `600 ${fontPx}px Georgia, 'Times New Roman', serif`;
      // Project + cull off-screen, then greedily drop overlaps by priority so the zoomed-out whole-city
      // map stays legible. Each label is a centred box (width ~ name length) so long names are protected
      // horizontally; zooming in spreads the boxes apart, so more labels reappear. The district the
      // player is standing in is the "you are here" cue: forced to the top priority so it is never
      // culled, and drawn in SA gold.
      districtCandidates.length = 0;
      const charW = fontPx * 0.52; // approximate uppercase serif advance; enough for de-overlap boxing
      const currentDistrict = nearestDistrictIndex(districts, position.x, position.z);
      for (let i = 0; i < districts.length; i++) {
        const place = districts[i]!;
        const p = projectInto(place.x, place.z, drawScratch);
        if (p.x < 8 || p.y < 8 || p.x > width - 8 || p.y > height - 8) continue;
        const current = i === currentDistrict;
        districtCandidates.push({ x: p.x, y: p.y, halfW: (place.name.length * charW) / 2, halfH: fontPx * 0.6, priority: current ? Infinity : place.priority, name: place.name, current });
      }
      for (const index of cullOverlappingLabels(districtCandidates, 5)) {
        const label = districtCandidates[index]!;
        context.lineWidth = 3.5;
        if (label.current) { context.strokeStyle = 'rgba(40,28,10,0.92)'; context.fillStyle = '#d8a32a'; }
        else { context.strokeStyle = 'rgba(231,216,180,0.9)'; context.fillStyle = 'rgba(70,53,30,0.8)'; }
        context.strokeText(label.name, label.x, label.y); context.fillText(label.name, label.x, label.y);
      }
      context.textBaseline = 'alphabetic';
    }
    if (route && canRoute() && !navigationComplete) {
      const end = project(route.approach.x, route.approach.z); context.fillStyle = '#f7d55b'; context.strokeStyle = '#162622'; context.lineWidth = 2;
      context.beginPath(); context.moveTo(end.x, end.y - 9); context.lineTo(end.x + 7, end.y); context.lineTo(end.x, end.y + 9); context.lineTo(end.x - 7, end.y); context.closePath(); context.fill(); context.stroke();
    }
    for (const landmark of options.landmarks ?? []) {
      const p = projectInto(landmark.x, landmark.z, drawScratch);
      if (p.x < 10 || p.y < 10 || p.x > width - 10 || p.y > height - 10) continue;
      context.fillStyle = '#cbe3d0'; context.strokeStyle = '#162622'; context.lineWidth = 2;
      context.fillRect(p.x - 5, p.y - 5, 10, 10); context.strokeRect(p.x - 5, p.y - 5, 10, 10);
      if (expanded) { context.font = '11px Arial'; context.textAlign = 'center'; context.strokeText(landmark.title, p.x, p.y - 10); context.fillText(landmark.title, p.x, p.y - 10); }
    }
    // Faint angel-rumour zone while a hint is active (radar v2.1): angels themselves stay hidden.
    if (rumourZone) {
      const c = project(rumourZone.x, rumourZone.z), rr = Math.max(14, rumourZone.radius * scale);
      context.save(); context.fillStyle = 'rgba(200,155,240,0.14)'; context.strokeStyle = 'rgba(200,155,240,0.5)';
      context.lineWidth = 2; context.setLineDash([5, 4]);
      context.beginPath(); context.arc(c.x, c.y, rr, 0, Math.PI * 2); context.fill(); context.stroke();
      context.setLineDash([]); context.restore();
    }
    hits.length = 0;
    if (flags.placesLayer) drawPlaces(now, saStyle);
    // Place names go after the event pins so event titles win label space (keep the else below on venueGrouping).
    // NOTE: the legacy cluster path below is this if's else - add new layers INSIDE these braces (twice regressed).
    if (flags.venueGrouping) {
      drawVenueBlips(now, saStyle);
      if (flags.placesLayer && expanded) drawPlaceNames(saStyle);
      // Angels go on top: they stand at busy places, under event pins they vanished (1.2's check).
      if (flags.angelNpcs && flags.minimapClues) drawAngels(saStyle, now);
    }
    else {
    clusters.clear(); let clusterCount = 0;
    for (const event of events) {
      const p = projectInto(event.x, event.z, drawScratch), radius = expanded ? Math.min(width, height) / 2 - 8 : Math.min(width, height) / 2 - 12;
      let dx = p.x - width / 2, dy = p.y - height / 2, distance = Math.hypot(dx, dy), edge = false;
      if (!expanded && distance > radius) { dx *= radius / distance; dy *= radius / distance; p.x = width / 2 + dx; p.y = height / 2 + dy; edge = true; }
      if (p.x < 0 || p.y < 0 || p.x > width || p.y > height) continue;
      const live = now >= event.startMs && now < event.endMs, key = event === selected ? 'selected' : `${Math.round(p.x / 22)}_${Math.round(p.y / 22)}`;
      const cluster = clusters.get(key);
      const timeFactor = live ? 3 : now < event.startMs && event.startMs - now <= 2 * 3600_000 ? 1.5 : .5;
      const fundingSize = flags.fundingLoop ? Math.min(5.5, Math.max(0, Math.log2(event.fundingBaseCents * timeFactor / MARKER_UNIT_CENTS) * 1.15)) : 0;
      if (cluster) { cluster.x = (cluster.x * cluster.count + p.x) / (cluster.count + 1); cluster.y = (cluster.y * cluster.count + p.y) / (cluster.count + 1); cluster.count++; cluster.live ||= live; cluster.fundingSize = Math.max(cluster.fundingSize, fundingSize); }
      else {
        let next = clusterPool[clusterCount];
        if (!next) { next = { ...p, count: 1, event, live, edge, fundingSize }; clusterPool[clusterCount] = next; }
        else { next.x = p.x; next.y = p.y; next.count = 1; next.event = event; next.live = live; next.edge = edge; next.fundingSize = fundingSize; }
        clusterCount++; clusters.set(key, next);
      }
    }
    for (const { x, y, count, event, live, edge, fundingSize } of clusters.values()) {
      const selFlag = selected === event;
      const size = (count > 1 ? 8 : selFlag ? 6 : 3.5) + fundingSize + (live ? 2 * (1 + Math.sin(now / 220)) : 0);
      paintEventBlip(x, y, size, eventKindStyle(event.kind), {
        baseAlpha: edge ? .72 : 1, live, approx: event.event.approx, collected: collected.has(event.id ?? ''),
        selected: selFlag, crowd: crowdAt(event.x, event.z), now, saStyle, detail: count === 1 && (expanded || size >= 7 || selFlag),
      });
      if (count > 1) { context.globalAlpha = edge ? .72 : 1; context.fillStyle = '#17211d'; context.font = 'bold 9px Arial'; context.textAlign = 'center'; context.fillText(count > 99 ? '99+' : String(count), x, y + 3); context.globalAlpha = 1; }
      let hit = hitPool[hits.length];
      if (!hit) { hit = { x, y, event }; hitPool[hits.length] = hit; }
      else { hit.x = x; hit.y = y; hit.event = event; }
      hits.push(hit);
    }
    }
    context.globalAlpha = 1;
    // Players, coloured by role (radar v2.1): friends green, top-10 raisers gold, everyone else blue.
    for (const peer of peers) {
      const p = projectInto(peer.x, peer.z, drawScratch), r = peer.role ? 5 : 4;
      // Keep an off-screen FRIEND on the radar: pin them to the ring edge (SA-style) instead of letting
      // the clip hide them, so you can always see which way a friend is. (gtasf-radar-friends-feed-d7br;
      // dormant until pane 13 feeds role:'friend' peers through main.ts.)
      let edge = false;
      if (!expanded && peer.role === 'friend') {
        const radius = Math.min(width, height) / 2 - 12;
        let dx = p.x - width / 2, dy = p.y - height / 2; const distance = Math.hypot(dx, dy);
        if (distance > radius) { dx *= radius / distance; dy *= radius / distance; p.x = width / 2 + dx; p.y = height / 2 + dy; edge = true; }
      }
      context.fillStyle = peer.role === 'top' ? '#f6a81e' : peer.role === 'friend' ? '#5fd07a' : (saStyle ? '#2563c9' : '#76d9f0');
      context.beginPath(); context.arc(p.x, p.y, r, 0, Math.PI * 2); context.fill();
      if (peer.role) { context.strokeStyle = '#0a1715'; context.lineWidth = 1.5; context.stroke(); }
      // A friend's name tag, shown on the edge pin and on the expanded map (outlined SA text).
      if (peer.role === 'friend' && peer.name && (edge || expanded)) {
        const label = peer.name.length > 12 ? `${peer.name.slice(0, 11)}…` : peer.name;
        context.font = 'bold 9px Arial'; context.textAlign = 'center'; context.textBaseline = 'alphabetic';
        context.lineJoin = 'round'; context.lineWidth = 3; context.strokeStyle = 'rgba(8,16,12,0.92)'; context.fillStyle = '#9ff0b4';
        context.strokeText(label, p.x, p.y - r - 3); context.fillText(label, p.x, p.y - r - 3);
      }
    }
    for (const taxi of taxis) { const p = projectInto(taxi.x, taxi.z, drawScratch); context.fillStyle = saStyle ? '#2b2b2b' : '#fffdf3'; context.fillRect(p.x - 3, p.y - 4, 6, 8); }
    // SFPD pursuit cars: a car-shaped blip flashing red/blue in sync with the in-world light bar (~240ms). [gtasf-combat]
    if (police.length) {
      const red = Math.floor(now / 240) % 2 === 0;
      for (const unit of police) {
        const p = projectInto(unit.x, unit.z, drawScratch);
        context.fillStyle = red ? '#ff2a2a' : '#2a5aff';
        context.fillRect(p.x - 3, p.y - 4, 6, 8);
        context.strokeStyle = 'rgba(8,16,12,0.9)'; context.lineWidth = 1; context.strokeRect(p.x - 3, p.y - 4, 6, 8);
      }
    }
    // Police search area (GTA): flashes red/blue round the last-seen spot while the cops can't see you.
    if (policeSearch) {
      const c = projectInto(policeSearch.x, policeSearch.z, drawScratch), rr = policeSearch.r * scale, red = Math.floor(now / 450) % 2 === 0;
      context.save(); context.beginPath(); context.arc(c.x, c.y, rr, 0, Math.PI * 2);
      context.fillStyle = red ? 'rgba(235,35,35,0.32)' : 'rgba(35,95,250,0.32)'; context.fill();
      context.lineWidth = 3; context.strokeStyle = red ? 'rgb(255,60,60)' : 'rgb(70,130,255)'; context.stroke(); context.restore();
    }
    // VC fund drops: a pulsing briefcase with the live N/50 counter (radar v2.1). A state ring shows
    // gold=open, green=you claimed, grey=sold out; the counter now also shows on the round minimap.
    for (const drop of drops) {
      const p = projectInto(drop.x, drop.z, drawScratch);
      const pulse = drop.mine || drop.out ? 0 : Math.sin(now / 260) + 1; // 0..2
      const gpx = 15 + pulse * 2;
      context.save(); context.textAlign = 'center'; context.textBaseline = 'middle'; context.globalAlpha = drop.out ? 0.5 : 1;
      context.beginPath(); context.arc(p.x, p.y, gpx * 0.72, 0, Math.PI * 2);
      context.strokeStyle = drop.mine ? '#5fd07a' : drop.out ? '#9a8a5a' : '#f1d98a'; context.lineWidth = 2; context.stroke();
      context.font = `${gpx}px "Apple Color Emoji","Segoe UI Emoji",Arial,sans-serif`; context.fillText('💼', p.x, p.y);
      if (!drop.mine && !drop.out) {
        const tag = `${drop.remaining}/${drop.capacity}`;
        context.font = 'bold 10px Arial'; context.textBaseline = 'alphabetic'; context.lineJoin = 'round'; context.lineWidth = 3;
        context.strokeStyle = 'rgba(8,16,12,0.92)'; context.fillStyle = '#ffe9a8';
        context.strokeText(tag, p.x, p.y - gpx * 0.72 - 3); context.fillText(tag, p.x, p.y - gpx * 0.72 - 3);
      }
      context.restore();
    }
    // Founder-ladder meme quest-givers: a static gold ring + speech glyph ("pitch me") so the roaming VC
    // quest-givers are findable. No pulse/counter — they don't deplete like drops. 💬 (not the 🎤 that the
    // event legend already uses for Demo/pitch events). [gtasf-ldlm phase-5.1]
    for (const giver of questGivers) {
      const p = projectInto(giver.x, giver.z, drawScratch);
      context.save(); context.textAlign = 'center'; context.textBaseline = 'middle';
      context.beginPath(); context.arc(p.x, p.y, 10, 0, Math.PI * 2);
      context.strokeStyle = '#f1d98a'; context.lineWidth = 2; context.stroke();
      context.font = '13px "Apple Color Emoji","Segoe UI Emoji",Arial,sans-serif'; context.fillText('💬', p.x, p.y);
      context.restore();
    }
    // SF pilgrimage: a small dark disc with a gold star per uncollected landmark (quieter than the mission pins).
    for (const l of pilgrimSites) {
      const p = projectInto(l.x, l.z, drawScratch);
      context.save(); context.textAlign = 'center'; context.textBaseline = 'middle';
      context.beginPath(); context.arc(p.x, p.y, 8, 0, Math.PI * 2);
      context.fillStyle = '#0c1813'; context.fill(); context.strokeStyle = '#f0b429'; context.lineWidth = 1.5; context.stroke();
      context.fillStyle = '#f0b429'; context.font = 'bold 11px Arial'; context.fillText('★', p.x, p.y + 0.5);
      context.restore();
    }
    // Lane B combat places: a green '$' pin per robbable store, a red crosshair pin per weapon pickup.
    for (const c of combatPlaces) {
      const p = projectInto(c.x, c.z, drawScratch);
      context.save(); context.textAlign = 'center'; context.textBaseline = 'middle';
      context.beginPath(); context.arc(p.x, p.y, 8, 0, Math.PI * 2);
      context.fillStyle = '#0c1813'; context.fill();
      context.strokeStyle = c.kind === 'store' ? '#3ddc84' : c.kind === 'hospital' ? '#f4f4f4' : c.kind === 'hideout' ? '#5aa9ff' : c.kind === 'respray' ? '#f0b429' : '#ff4d4d'; context.lineWidth = 1.5; context.stroke();
      if (c.kind === 'hideout' || c.kind === 'respray') { // wantedEscape (gtasf-66lvh): garage 'P' / respray spray-can 'R'
        context.fillStyle = c.kind === 'hideout' ? '#5aa9ff' : '#f0b429'; context.font = 'bold 11px Arial'; context.fillText(c.kind === 'hideout' ? 'P' : 'R', p.x, p.y + 0.5);
      } else if (c.kind === 'hospital') { // nearestHospitalRespawn (critic N20): where a WASTED/BUSTED player wakes
        context.fillStyle = '#e53935'; context.fillRect(p.x - 1.6, p.y - 5, 3.2, 10); context.fillRect(p.x - 5, p.y - 1.6, 10, 3.2);
      } else if (c.kind === 'store') { context.fillStyle = '#3ddc84'; context.font = 'bold 11px Arial'; context.fillText('$', p.x, p.y + 0.5); }
      else {
        context.beginPath(); context.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
        context.moveTo(p.x - 6, p.y); context.lineTo(p.x + 6, p.y); context.moveTo(p.x, p.y - 6); context.lineTo(p.x, p.y + 6);
        context.strokeStyle = '#ff4d4d'; context.lineWidth = 1.4; context.stroke();
      }
      context.restore();
    }
    // GTA-pivot mission markers: a filled gold pin with the mission letter (e.g. 'H' for the heist), GTA-style.
    for (const m of missionMarkers) {
      const p = projectInto(m.x, m.z, drawScratch);
      context.save(); context.textAlign = 'center'; context.textBaseline = 'middle';
      context.beginPath(); context.arc(p.x, p.y, 11, 0, Math.PI * 2);
      context.fillStyle = m.fill ?? '#f0b429'; context.fill(); // fill: e.g. the red Most Wanted bounty pin
      context.strokeStyle = '#0a1715'; context.lineWidth = 2; context.stroke();
      context.fillStyle = m.fill ? '#fff' : '#0c1813'; context.font = 'bold 13px Arial'; context.fillText(m.letter, p.x, p.y + 0.5);
      context.restore();
    }
    if (personalCar) { // GTA's personal-vehicle blip: a blue disc with a white car
      const p = projectInto(personalCar.x, personalCar.z, drawScratch);
      context.save(); context.translate(p.x, p.y);
      context.beginPath(); context.arc(0, 0, 10, 0, Math.PI * 2); context.fillStyle = '#2f7de1'; context.fill();
      context.strokeStyle = '#0a1715'; context.lineWidth = 2; context.stroke();
      context.fillStyle = '#fff'; context.beginPath(); context.roundRect(-6, -1.5, 12, 4.5, 1.5); context.fill(); // body
      context.beginPath(); context.roundRect(-3.5, -4.5, 7, 3.5, 1.2); context.fill(); // cabin
      context.fillStyle = '#0a1715'; context.beginPath(); context.arc(-3.5, 3.4, 1.5, 0, Math.PI * 2); context.arc(3.5, 3.4, 1.5, 0, Math.PI * 2); context.fill();
      context.restore();
    }
    const player = project(position.x, position.z); context.save(); context.translate(player.x, player.y); context.rotate(expanded ? Math.PI - yaw : (viewYaw ?? yaw) - yaw);
    context.fillStyle = '#fff'; context.strokeStyle = '#0a1715'; context.lineWidth = 2; context.beginPath(); context.moveTo(0, -9); context.lineTo(6, 7); context.lineTo(0, 4); context.lineTo(-6, 7); context.closePath(); context.fill(); context.stroke(); context.restore();
    const north = expanded ? { x: 16, y: 20 } : project(position.x, position.z - 350);
    context.font = 'bold 12px Arial'; context.textAlign = 'center'; context.fillStyle = '#fff'; context.strokeStyle = '#112321'; context.lineWidth = 3; context.strokeText('N', north.x, north.y + 4); context.fillText('N', north.x, north.y + 4);
    context.restore();
  }
  canvas.addEventListener('click', event => {
    // A pan or pinch leaves a trailing click; ignore it so dragging never drops a waypoint.
    if (dragged) { dragged = false; return; }
    const rect = canvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
    const hit = [...hits].sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
    if (hit && Math.hypot(hit.x - x, hit.y - y) < 18) { if (flags.venueGrouping || (expanded && flags.saMapStyle)) openVenue(hit.event); else select(hit.event); return; }
    if (!expanded) { toggleMap(true); return; }
    if (flags.placesLayer) {
      const place = placeHits.reduce<typeof placeHits[number] | undefined>((best, h) => Math.hypot(h.x - x, h.y - y) < 14 && (!best || Math.hypot(h.x - x, h.y - y) < Math.hypot(best.x - x, best.y - y)) ? h : best, undefined);
      if (place) { openPlace(place.place, place.x, place.y); return; }
    }
    if (flags.saMapStyle && canRoute()) setWaypointAt(x, y);
  });
  // SA pause-menu zoom + pan: wheel and pinch zoom toward the cursor, one-finger/left-drag pans.
  const pointerXY = (event: PointerEvent) => { const rect = canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
  canvas.addEventListener('wheel', event => {
    if (!expanded || !flags.saMapStyle) return;
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    applyZoom(event.deltaY < 0 ? 1.2 : 1 / 1.2, event.clientX - rect.left, event.clientY - rect.top);
  }, { passive: false });
  canvas.addEventListener('pointerdown', event => {
    if (!expanded || !flags.saMapStyle || event.button !== 0) return;
    const point = pointerXY(event); pointers.set(event.pointerId, point);
    canvas.setPointerCapture?.(event.pointerId);
    if (pointers.size === 1) { dragStart = { x: point.x, y: point.y, px: panX, pz: panZ }; dragged = false; }
    else if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinchDist = Math.hypot(a!.x - b!.x, a!.y - b!.y); dragStart = null; dragged = true; }
  });
  canvas.addEventListener('pointermove', event => {
    if (!pointers.has(event.pointerId)) return;
    const point = pointerXY(event); pointers.set(event.pointerId, point);
    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()], distance = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (pinchDist > 0 && distance > 0) applyZoom(distance / pinchDist, (a!.x + b!.x) / 2, (a!.y + b!.y) / 2);
      pinchDist = distance; dragged = true;
    } else if (dragStart) {
      // Movement cancels a tap even at fit zoom, where panning is unavailable.
      if (Math.hypot(point.x - dragStart.x, point.y - dragStart.y) > 4) dragged = true;
      if (zoom > 1) {
        const scale = (Math.min(width, height) / 2 - 12) / mapRange * zoom;
        panX = clamp(dragStart.px - (point.x - dragStart.x) / scale, -mapRange, mapRange);
        panZ = clamp(dragStart.pz - (point.y - dragStart.y) / scale, -mapRange, mapRange);
        lastDraw = -Infinity;
      }
    }
  });
  function endPointer(event: PointerEvent) {
    if (!pointers.has(event.pointerId)) return;
    if (event.type !== 'pointerup') dragged = true;
    pointers.delete(event.pointerId); releasePointer(event.pointerId);
    if (pointers.size < 2) pinchDist = 0;
    const remaining = pointers.values().next().value;
    dragStart = pointers.size === 1 && remaining ? { ...remaining, px: panX, pz: panZ } : null;
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('lostpointercapture', endPointer);
  function setEvents(values:readonly RadarEvent[]){
      if(disposed)return;
      // Reuse draw records within this feed only; never retain older calendars.
      clusters.clear(); clusterPool.length = 0; hitPool.length = 0;
      events = values.filter(event => typeof event.lat === 'number' && typeof event.lon === 'number' && Number.isFinite(event.lat) && Number.isFinite(event.lon) && Number.isFinite(Date.parse(event.start)) && event.lat > 37.68 && event.lat < 37.86 && event.lon > -122.56 && event.lon < -122.33).map(event => {
        const point = projectLocation(event.lat!, event.lon!, options.frame), startMs = Date.parse(event.start);
        const kind = fundingKind(event);
        const blip={ id: event.id, title: event.title, ...point, y: 0, event, startMs, endMs: event.end ? Date.parse(event.end) : startMs,
          fundingBaseCents: Number(FUNDING_BASE_CENTS[kind]), kind: classifyEventKind(event.title, event.venue ?? '') };
        // Reuse the selected object so its action handlers and highlight stay current.
        return selected?.id===event.id?Object.assign(selected,blip):blip;
      });
      rebuildVenues();
      if (selectedVenueKey) {
        const group = venueGroups.find(value => value.key === selectedVenueKey);
        if (group) renderVenueCard(group, false); else unavailableEvent(true);
      } else if(selected){if(events.includes(selected))updateEventDetails(selected);else unavailableEvent();}
      title.textContent = `Tech Week · ${events.length}`;setMapBounds();lastDraw=-Infinity;
      if(!list.matches(':hover')&&!list.contains(document.activeElement)
        && !places.matches(':hover') && !places.contains(document.activeElement))renderList();
      else lastList=-Infinity;
  }
  async function reload() {
    try {
      const response = await fetch(options.eventUrl ?? '/api/events', { signal: abort.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as { events?: RadarEvent[] };setEvents(data.events??[]);
    } catch (error) {
      if (!disposed) { title.textContent = 'Tech Week · retry'; status.textContent = 'Events could not load. Tap Tech Week to retry.'; title.onclick = () => { title.onclick = () => toggleMap(); void reload(); toggleMap(true); }; }
    }
  }
  setMapBounds();
  // Rebuild cached road paths and map bounds from the full city graph once it replaces the near graph.
  void options.graphUpgraded?.then(() => { if (disposed) return; if (!flags.minimapTileSwap) roadTiles.clear(); roadTilesBuilt = false; roadTileBuild = null; setMapBounds(); }, () => {}); // minimapTileSwap: tiles kept until the rebuild swaps
  const ready = options.autoLoad===false?Promise.resolve():reload();
  // gtasf-fddi: build the routing index in routing.worker.ts (off the main thread) and collect its streamed
  // structures. Mirrors the layout worker driver: batched Maps + transferred typed arrays, resolve on `done`,
  // reject on `error`/unknown, terminate in finally. The worker re-fetches the same URL (HTTP-cached); the
  // caller assembles the router over the main thread's own graph copy, whose edge order matches.
  function buildRouterInWorker(source: string | ArrayBuffer): Promise<{ structures: RouterStructures; edges?: RouterEdgeView }> {
    let worker: Worker | undefined;
    let edgeView: RouterEdgeView | undefined;
    return new Promise<{ structures: RouterStructures; edges?: RouterEdgeView }>((resolve, reject) => {
      worker = new Worker(new URL('./routing.worker.ts', import.meta.url), { type: 'module', name: 'GTASF routing index' });
      const nodes = new Map<string, RoadNode>(), outgoing = new Map<string, number>(), cells = new Map<string, Uint32Array>();
      worker.onmessage = event => {
        const data = event.data as { nodes?: [string, RoadNode][]; outgoing?: [string, number][]; cells?: [string, Uint32Array][];
          done?: boolean; nextEdge?: Uint32Array; laneEdges?: Uint32Array; bounds?: Float64Array; laneStamps?: Float64Array;
          cellSize?: number; minCellX?: number; maxCellX?: number; minCellZ?: number; maxCellZ?: number; error?: string; edges?: RouterEdgeView };
        if (data.error) { reject(new Error(data.error)); return; }
        if (data.edges) { edgeView = data.edges; return; }
        if (data.nodes) { for (const [id, node] of data.nodes) nodes.set(id, node); return; }
        if (data.outgoing) { for (const [id, entry] of data.outgoing) outgoing.set(id, entry); return; }
        if (data.cells) { for (const [key, cell] of data.cells) cells.set(key, cell); return; }
        if (data.done) {
          resolve({ structures: { nodes, outgoing, cells, nextEdge: data.nextEdge!, laneEdges: data.laneEdges!, bounds: data.bounds!,
            laneStamps: data.laneStamps!, cellSize: data.cellSize!, minCellX: data.minCellX!, maxCellX: data.maxCellX!,
            minCellZ: data.minCellZ!, maxCellZ: data.maxCellZ! }, edges: edgeView });
          return;
        }
        reject(new Error('Routing worker sent an unexpected message'));
      };
      worker.onerror = event => reject(new Error(event.message || 'routing worker failed'));
      if (typeof source === 'string') worker.postMessage({ url: source }); else worker.postMessage({ bytes: source }, [source]);
    }).finally(() => worker?.terminate());
  }
  // routingWorkerPacked: start building the router structures as soon as the bytes arrive, while main is still unpacking.
  const packedStructures = flags.routingWorkerPacked && options.routeGraphBytes && typeof Worker !== 'undefined'
    ? options.routeGraphBytes.then(bytes => Promise.race([buildRouterInWorker(bytes),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('routing worker timed out')), 20_000))])) : undefined;
  packedStructures?.catch(() => {}); // a failure falls back to the on-main build below
  // The source-contact graph also contains covered/private lanes. Routing uses the pipeline's
  // collision-audited connected component, never a straight-line fallback through buildings.
  const mainRouting = (): Promise<void> => !canRoute() ? Promise.resolve() : (options.routeGraph ? Promise.resolve(options.routeGraph) : fetch(options.routeGraphUrl ?? '/map/lombard/roadgraph-playable.json', { signal: abort.signal })
    .then(async response => { if (!response.ok) throw new Error('Road directions unavailable'); return response.json() as Promise<RoadGraph>; }))
    // Build the city router when the main thread is idle (normally after READY), not during boot. [gtasf-ce5s] Capped at
    // 250 ms (was 8 s, then 2 s): a busy phone never goes idle, so the cap was pure delay (~2 s measured) once the full
    // graph had landed, and the build itself is sliced (gtasf-ep30n).
    .then(graph => new Promise<RoadGraph>(resolve => typeof requestIdleCallback === 'function'
      ? requestIdleCallback(() => resolve(graph), { timeout: 250 }) : setTimeout(() => resolve(graph), 0)))
    // gtasf-a989: the sync createMapRouter build is a single ~412 ms (4x-throttled phone) blocking frame. With
    // asyncMapRouter on, drive the SAME build as a generator sliced ~MAP_ROUTER_SLICE_MS (6 ms) per step across
    // IDLE callbacks, so no one frame absorbs the whole index. requestIdleCallback (not rAF) is deliberate: it
    // only spends genuine idle time, so it never steals from a steady 60 fps scene's frame budget (an rAF driver
    // that pumps every frame measurably depressed the Ferry gate); a mount burst that starves idle still makes
    // progress via the timeout, one ~6 ms slice at a time. router stays undefined until the build finishes —
    // identical availability to the sync path (requests show "loading roads…" and replan via planRoute() on
    // completion). The initial idle callback above still defers the START off the boot path.
    .then(graph => { if (disposed) return;
      // gtasf-a989 idle-sliced on-main driver (unchanged); also the worker-path fallback below.
      const driveIncrementalBuild = () => new Promise<void>((resolve, reject) => {
        const build = createMapRouterIncremental(graph);
        // Frame headroom while the build runs (gtasf-ep30n): a 100 ms starved cadence of ~12 ms bursts finished routing
        // ~15 s sooner but cost the phone firefight gate ~4.5 fps (lane B bisect of bb9841aa) — the build tail overlaps
        // the gate window. So burst only when the last frame left headroom (<= 33 ms); on a frame-bound phone keep the
        // old floor of one slice per ~400 ms, so the build always completes and is never slower than before.
        let lastFrameMs = 0, prevFrame = performance.now(), frameWatch = 0, lastProgress = performance.now();
        const watch = (t: number) => { lastFrameMs = t - prevFrame; prevFrame = t; frameWatch = requestAnimationFrame(watch); };
        if (flags.routerHeadroomBursts && typeof requestAnimationFrame === 'function') frameWatch = requestAnimationFrame(watch);
        const stopWatch = () => { if (frameWatch && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frameWatch); frameWatch = 0; };
        const bursts = flags.routerHeadroomBursts; // off: the 5623b89a cadence (400 ms timeout, one slice per starved callback)
        // routerTaskSlices (gtasf-ep30n N16): drive the build like the city-index runner — one ~12 ms task per turn of the event
        // loop (roughly one per frame) instead of idle callbacks, which a busy phone never grants (8-11 s of build measured).
        const taskSlices = flags.routerTaskSlices;
        const framePaced = taskSlices && flags.slicesFramePaced && typeof requestAnimationFrame === 'function'; // see world.ts nextTask
        const schedule = () => { if (framePaced) { let done = false; const go = () => { if (done) return; done = true; setTimeout(() => pump(), 0); }; requestAnimationFrame(go); setTimeout(go, 100); }
          else if (taskSlices) setTimeout(() => pump(), 0); else if (typeof requestIdleCallback === 'function') requestIdleCallback(pump, { timeout: bursts ? 100 : 400 }); else setTimeout(() => pump(), 0); };
        function pump(deadline?: IdleDeadline) {
          if (disposed) { stopWatch(); resolve(); return; }
          const starved = !deadline || deadline.didTimeout, frameBound = taskSlices ? false : !bursts || lastFrameMs > 33;
          if (!taskSlices && bursts && starved && frameBound && performance.now() - lastProgress < 400) { schedule(); return; } // no headroom: wait for the floor
          const pumpStart = performance.now();
          try {
            for (;;) {
              const step = build.next(); // one self-timed ~MAP_ROUTER_SLICE_MS slice
              if (step.done) { stopWatch(); router = step.value; planRoute(); resolve(); return; }
              // Real idle: keep pumping while it lasts. Starved: ~12 ms burst with frame headroom, else one slice.
              if (starved ? frameBound || performance.now() - pumpStart >= 12 : deadline.timeRemaining() <= MAP_ROUTER_SLICE_MS) break;
            }
          } catch (error) { stopWatch(); reject(error); return; }
          lastProgress = performance.now();
          schedule();
        }
        schedule();
      });
      // The on-main build: synchronous when asyncMapRouter is off, else the idle-sliced generator above.
      const buildOnMain = (): void | Promise<void> => { if (!flags.asyncMapRouter) { router = createMapRouter(graph); planRoute(); return; } return driveIncrementalBuild(); };
      // gtasf-fddi: with routingWorker on, build the whole-city index in routing.worker.ts (off the main
      // thread) and assemble it on main over this graph — removing the ~261 ms index build from main entirely.
      // Needs a real Worker and a fetch URL: options.routeGraph bypasses the URL, and the worker re-fetches the
      // URL, so it could build a DIFFERENT graph — fall through to the main path in that case. Any worker failure
      // (spawn, fetch, parse, onerror) falls back to buildOnMain, so routing is never left dead.
      if (packedStructures) {
        return packedStructures
          .then(({ structures }) => { if (disposed) return; router = assembleMapRouter(graph, structures); planRoute(); })
          .catch(error => { if (disposed) return; console.warn('Packed routing worker failed; building the index on the main thread.', error); return buildOnMain(); });
      }
      const routeUrl = options.routeGraph ? undefined : (options.routeGraphUrl ?? '/map/lombard/roadgraph-playable.json');
      if (flags.routingWorker && typeof Worker !== 'undefined' && routeUrl) {
        return buildRouterInWorker(routeUrl)
          .then(({ structures }) => { if (disposed) return; router = assembleMapRouter(graph, structures); planRoute(); })
          .catch(error => { if (disposed) return; console.warn('Routing worker failed; building the index on the main thread.', error); return buildOnMain(); });
      }
      return buildOnMain();
    })
    .catch(() => { if (!disposed && destination) navigation.textContent = 'Road directions unavailable. Try again after the local map is ready.'; });
  // routerLightEdges (gtasf-fddi / N16): assemble the router from the worker's structures AND its light edge view the moment
  // the worker finishes — no wait on main's full-graph unpack. Any failure (no view, worker error/timeout) falls back to the
  // chain above, which still uses the worker's structures over main's graph or builds on main.
  const routingReady: Promise<void> = canRoute() && flags.routerLightEdges && packedStructures
    ? packedStructures.then(({ structures, edges }) => {
      if (!edges) throw new Error('routing worker sent no edge view');
      if (disposed) return;
      router = assembleMapRouter(decodeRouterEdges(edges), structures); planRoute();
    }).catch(error => { if (disposed) return; console.warn('Light-edge router unavailable; using the main-graph path.', error); return mainRouting(); })
    : mainRouting();
  void routingReady.then(() => performance.mark('gtasf:routing-ready'), () => {}); // cold-load trace: READY -> routes available
  if (flags.nearRouterFirst && canRoute() && options.nearRouteGraph?.edges.length) {
    const near = options.nearRouteGraph;
    // ~85-136 ms on a 4x phone: after READY (nearRouterAt), in its own task, so it never lengthens the loading card.
    void (options.nearRouterAt ?? Promise.resolve()).then(() => setTimeout(() => {
      if (disposed || router) return;
      try { const t = performance.now(); nearRouter = createMapRouter(near); performance.measure('gtasf:near-router-build', { start: t }); performance.mark('gtasf:near-routing-ready'); if (destination) planRoute(); }
      catch (error) { console.warn('Spawn-area router failed; waiting for the city router.', error); }
    }, 0), () => {});
  }
  return {
    element: root, ready, routingReady, toggleMap, setDestination, setTaxiDestination, setEvents,
    /** VC fund drops to plot as gold blips (empty to clear). Call each frame with dropRadarBlips(client). */
    setDrops(value: readonly DropRadarBlip[]) { if (!disposed) drops = value; },
    /** Wanted + out of police sight: a flashing red/blue circle (world metres) where they're searching; null clears. */
    setPoliceSearch(value: { x: number; z: number; r: number } | null) { if (!disposed) policeSearch = value; },
    /** Founder-ladder meme quest-giver NPC positions (world x/z) to plot as gold mic blips; empty to clear. [gtasf-ldlm] */
    setQuestGivers(value: readonly { x: number; z: number }[]) { if (!disposed) questGivers = value; },
    setMissionMarkers(value: readonly { x: number; z: number; letter: string; fill?: string }[]) { if (!disposed) missionMarkers = value; },
    /** personalCar: where the player's own car is parked (null hides the blip). */
    setPersonalCar(value: { x: number; z: number } | null) { if (!disposed) personalCar = value; },
    setLandmarks(value: readonly { x: number; z: number }[]) { if (!disposed) pilgrimSites = value; },
    setCombatPlaces(value: readonly { x: number; z: number; kind: CombatPlaceKind }[]) { if (!disposed) combatPlaces = value; },
    setPolice(value: readonly { x: number; z: number }[]) { if (!disposed) police = value; },
    /** Once-ever collected event ids; a venue dims only when all its focus events are collected. */
    setCollected(ids: ReadonlySet<string>) {
      if (disposed) return;
      collected = ids;
      for (const venue of venuePoints) venue.fullyCollected = venueCollected(venue.group, ids);
      lastDraw = -Infinity;
    },
    /** Active angel-rumour zone (world x/z + radius m) to show as a faint ring, or null to clear (radar v2.1). */
    setRumourZone(zone: { x: number; z: number; radius: number } | null) {
      if (disposed || (!zone && !rumourZone) || (zone && rumourZone &&
        zone.x === rumourZone.x && zone.z === rumourZone.z && zone.radius === rumourZone.radius)) return;
      // The host supplies this every frame. Invalidate only a changed ring, preserving the radar's
      // redraw budget; retain scalars so an in-place mutation by the caller is still detected.
      rumourZone = zone ? { x: zone.x, z: zone.z, radius: zone.radius } : null;
      lastDraw = -Infinity;
    },
    /** Guidance owns arrival rules; retain the selected route for later actions. */
    setNavigationComplete(complete: boolean) {
      if (disposed || navigationComplete === complete) return;
      navigationComplete = complete; navigation.hidden = !destination || complete; lastDraw = -Infinity;
    },
    get route() { return route; },
    get qaLog(): readonly string[] { return qaLog; },
    get eventCount() { return events.length; },
    get events(): RadarEvent[] { return events.map(blip => blip.event); },
    get isExpanded() { return expanded; },
    update(at: { x: number; y?: number; z: number }, heading: number, otherPlayers: RadarPeer[] = [], robotaxis: RadarPeer[] = [], view?: number) {
      if (disposed) return;
      // Smooth the player's ground speed from frame-to-frame movement for zoom-out-at-speed (radar v2.1).
      const nowPerf = performance.now();
      if (lastSpeedPos) { const dt = Math.max(16, nowPerf - lastSpeedAt) / 1000; const inst = Math.hypot(at.x - lastSpeedPos.x, at.z - lastSpeedPos.z) / dt; speed += (inst - speed) * 0.25; }
      lastSpeedPos = { x: at.x, z: at.z }; lastSpeedAt = nowPerf;
      position = at; yaw = heading; viewYaw = view; peers = otherPlayers; taxis = robotaxis;
      if (flags.minimapClues) updateTicker(nowPerf);
      const nextMode = options.travelMode?.() ?? 'road';
      if (nextMode !== travelMode) { travelMode = nextMode; if (destination && router && canRoute()) planRoute(); }
      if (destination && !navigationComplete && (router ?? nearRouter) && canRoute() && performance.now() - routeAt > 2000 && Math.hypot(at.x - routeStart.x, at.z - routeStart.z) > 35) {
        // routeReplanOffRoute (gtasf-fddi): a 5-7 km plan is 130-290 ms of main thread on a 4x phone (10-20), and this re-planned the
        // whole route every 35 m walked. Still on the drawn line (< 20 m off): keep it, just refresh the distance; re-plan only off it.
        const on = flags.routeReplanOffRoute && route && router ? alongRoute(route, at.x, at.z) : null;
        if (on && on.offM < 20) {
          routeStart = { ...at }; routeAt = performance.now();
          const text = navigationText(route!, on.remainingM); if (!navigation.hidden && navigation.firstChild?.textContent !== text) { navigation.firstChild!.textContent = text; }
        } else planRoute();
      }
      const tick = performance.now(); if (tick - lastDraw < (lowBudget && !expanded ? 100 : 60)) return;
      // gtasf-3k35 (sequencedMount): defer the canvas redraw if another heavy mount stage already owns this
      // frame (lastDraw unchanged, so it redraws on the next free frame). No-op when the flag is off.
      if (!claimHeavyFrame('radar')) return; lastDraw = tick; draw(Date.now());
      if (expanded && tick - lastList > 5000 && !search.matches(':focus')
        && !list.matches(':hover') && !list.contains(document.activeElement)
        && !places.matches(':hover') && !places.contains(document.activeElement)) { lastList = tick; renderList(); }
    },
    destroy() { if (disposed) return; toggleMap(false); disposed = true; abort.abort(); releaseCursor?.(); window.removeEventListener('keydown', keyboard); window.removeEventListener('resize', invalidateViewport); viewportObserver?.disconnect(); clusters.clear(); clusterPool.length = 0; hitPool.length = 0; hits.length = 0; root.remove(); },
  };
}
export type Radar = NonNullable<ReturnType<typeof createRadar>>;
