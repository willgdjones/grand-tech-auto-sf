import { AdditiveBlending, BufferGeometry, Float32BufferAttribute, Line, LineBasicMaterial, CanvasTexture, CylinderGeometry, Group, Mesh, MeshBasicMaterial, RingGeometry, DoubleSide, Sprite, SpriteMaterial, SRGBColorSpace, Vector3, type Camera } from 'three';
import { flags } from '@gtasf/shared/flags';
import { projectLocation } from '../radar/projection';
import type { MapFrame } from '../radar/projection';
import type { RadarEvent } from '../radar/radar';
import { classifyEventKind, eventKindStyle, type EventKind } from '@gtasf/shared/content/eventKinds';
import { focusVenues, groupVenues, representativeEvent, WEEK_WINDOW_MS, type VenueGroup } from './venues';
import { venueCollected } from './collected';
import { drawOutlinedText, SA_FONTS } from '../theme/saText';
import type { GraphicsPreset } from '../render/graphicsPreset';
import type { EventLinkTarget } from './worldEventLinks';
import { labelLimits, selectLabelCandidates, worldLabelText, layoutWorldLabels, smoothLabelPlacements,
  type WorldLabelText, type LabelPlacement, type LabelAnchor } from './worldLabels';

interface Marker {
  root: Group; event: RadarEvent; x: number; y: number; z: number;
  ring?: Mesh; glow?: Mesh; pillar?: Mesh;
}
interface LocatedEvent { event: RadarEvent; group: VenueGroup | null; x: number; z: number; distance: number }
export interface MarkerLabel { title: string; badge: string }
// Production enables floatingEventNames only after the orchestrator reviews the world-label look.
const labelsEnabled = (): boolean => flags.floatingEventNames;

/**
 * The text that floats above a marker. A venue hosting a single event in the focus window shows that
 * event's name (PLAN-v2 decision 1 — the event name floats, readable from the street); a venue with
 * several shows its venue name, with a "+N this week" badge for events beyond the window (decision 8).
 * Ungrouped markers always show the event name.
 */
export function markerLabel(event: RadarEvent, group: VenueGroup | null, collected = false): MarkerLabel {
  if (!group) return { title: event.title, badge: [collected ? 'Collected' : '', event.community ? 'Community' : ''].filter(Boolean).join(' · ') };
  const single = group.focus.length === 1;
  const rep = group.focus.find(v => v.live) ?? group.focus[0] ?? null;
  // "Labelled by day" (decision 8): Live now, else the day when it isn't Today (from Monday the whole
  // programme is effectively today, so the dayLabel is 'Today' and we drop it). Joined with the badge.
  const when = !rep ? '' : rep.live ? 'Live now' : rep.dayLabel && rep.dayLabel !== 'Today' ? rep.dayLabel : '';
  // Collected first (decision 1 once-ever): a paid venue reads "Collected" so the player skips it.
  // Preview fallback (decision 8): a venue shown only via the extended window is tagged "Preview".
  const parts = [collected ? 'Collected' : '', when, rep?.event.community ? 'Community' : '', group.preview ? 'Preview' : '', group.laterThisWeek > 0 ? `+${group.laterThisWeek} this week` : ''].filter(Boolean);
  return { title: single ? group.focus[0]!.event.title : group.title, badge: parts.join(' · ') };
}
/**
 * Whether a marker is fully collected (its drive-through cheque already paid, once-ever). An ungrouped
 * marker is collected when its own event id is; a venue marker only when EVERY focus event at the venue
 * is, so a venue that still has an unpaid event stays bright. Pure + headless-safe for unit tests.
 */
export function markerCollected(event: RadarEvent, group: VenueGroup | null, collected: ReadonlySet<string>): boolean {
  return group ? venueCollected(group, collected) : collected.has(event.id);
}

interface WorldLabel {
  candidate: LocatedEvent; sprite: Sprite; canvas: HTMLCanvasElement; texture: CanvasTexture;
  leader: Line<BufferGeometry, LineBasicMaterial>; anchor: Vector3; text: WorldLabelText; key: string;
}
function fitLabelText(ctx: CanvasRenderingContext2D, value: string, width: number): string {
  if (ctx.measureText(value).width <= width) return value;
  const letters = [...value];
  while (letters.length && ctx.measureText(`${letters.join('')}…`).width > width) letters.pop();
  return `${letters.join('').trimEnd()}…`;
}
function paintLabel(label: WorldLabel, compact: boolean, width: number, height: number): void {
  const key = JSON.stringify([label.text, compact, width, height]);
  if (key === label.key) return;
  const ctx = label.canvas.getContext('2d'); if (!ctx) return;
  label.key = key;
  label.canvas.height = Math.max(1, Math.round(label.canvas.width * height / width));
  const w = label.canvas.width, h = label.canvas.height, scale = w / width;
  ctx.clearRect(0, 0, w, h);
  const line = (value: string, y: number, size: number, fill: string, display = false) => {
    const font = `900 ${size * scale}px ${display ? SA_FONTS.display : SA_FONTS.sans}`;
    ctx.font = font;
    drawOutlinedText(ctx, fitLabelText(ctx, value, w - 12 * scale), w / 2, y * scale, {
      font, fill, lineWidth: 3 * scale, align: 'center', baseline: 'middle',
    });
  };
  line(label.text.title, compact ? height / 2 : 15, compact ? Math.min(17, height - 7) : 23, '#f6efd8', true);
  if (!compact) {
    if (label.text.badge) line(label.text.badge, 38, 14, label.text.live ? '#ee4944' : '#f0b429');
    if (label.text.detail) line(label.text.detail, 58, 12, '#f6efd8');
  }
  label.texture.needsUpdate = true;
}
/** Reuse radar event data. Only loaded, nearby, walkable surfaces get a marker. */
export function createEventMarkers(options: {
  scene: Group | import('three').Scene;
  /** Current chase camera: nearer labels keep their screen space when streets line up. */
  camera?: Camera;
  graphicsPreset?: GraphicsPreset;
  frame: MapFrame;
  surfaceHeightAt(x: number, z: number): number | null;
  resolvePosition?(point: { x: number; z: number }): { x: number; y: number; z: number } | null;
  onEnter(event: RadarEvent): void;
  /** Reference clock for the venue focus window; defaults to Date.now. Injectable for tests. */
  now?: () => number;
  /** Override the venueGrouping flag (one marker per venue). Defaults to the flag. */
  groupByVenue?: boolean;
  /** Override the eventFocus24h flag (limit to the next 24h, else the whole week). Defaults to the flag. */
  focusNext24h?: boolean;
  /** Override the floatingEventNames flag (readable labels above markers). Defaults to the flag. */
  showLabels?: boolean;
  /** Override the checkpointPillars flag (GTA-style light column on each marker). Defaults to the flag. */
  checkpointPillars?: boolean;
}) {
  if (!flags.hud || !(flags.eventsApi || flags.events || flags.localEventSnapshot)) return null;
  const root = new Group(); root.name = 'Tech Week event markers'; options.scene.add(root);
  const geometry = new RingGeometry(2.15, 2.75, 32), halo = new RingGeometry(2, 3.4, 32);
  const material = new MeshBasicMaterial({ color: 0xf2c96d, transparent: true, opacity: .84, side: DoubleSide, depthWrite: false, blending: AdditiveBlending, forceSinglePass: true });
  const haloMaterial = new MeshBasicMaterial({ color: 0xffdc86, transparent: true, opacity: .16, side: DoubleSide, depthWrite: false, blending: AdditiveBlending, forceSinglePass: true });
  // Dimmer, paler variants for preview venues (shown now though days away, PLAN-v2 decision 8).
  const previewMaterial = new MeshBasicMaterial({ color: 0xcdbd90, transparent: true, opacity: .4, side: DoubleSide, depthWrite: false, blending: AdditiveBlending, forceSinglePass: true });
  const previewHalo = new MeshBasicMaterial({ color: 0xcdbd90, transparent: true, opacity: .07, side: DoubleSide, depthWrite: false, blending: AdditiveBlending, forceSinglePass: true });
  // Spent, desaturated grey for collected venues (drive-through already paid, once-ever) so the eye
  // skips them — dimmer than preview and drained of the gold invite. [gtasf-ykbb]
  const collectedMaterial = new MeshBasicMaterial({ color: 0x8c8c86, transparent: true, opacity: .28, side: DoubleSide, depthWrite: false, blending: AdditiveBlending, forceSinglePass: true });
  const collectedHalo = new MeshBasicMaterial({ color: 0x8c8c86, transparent: true, opacity: .05, side: DoubleSide, depthWrite: false, blending: AdditiveBlending, forceSinglePass: true });
  // GTA checkpoint light column (PLAN-v2 decision 1 "GTA checkpoint style", gtasf-c0kh): a subtle
  // additive open cylinder rising from the ring so events read as drive-through checkpoints from the
  // street. Built only when enabled (zero cost off); shared across the pooled markers; hidden on
  // collected ones. The per-kind ring colour still carries the type; the column is a consistent gold.
  const pillarsEnabled = options.checkpointPillars ?? flags.checkpointPillars;
  const pillarGeometry = pillarsEnabled ? new CylinderGeometry(2.4, 2.4, 7, 24, 1, true) : null;
  const pillarMaterial = pillarsEnabled ? new MeshBasicMaterial({ color: 0xffdc86, transparent: true, opacity: .12, side: DoubleSide, depthWrite: false, blending: AdditiveBlending, forceSinglePass: true }) : null;
  // Per-kind ring/halo materials so a world event reads its type at a glance, matching the radar legend
  // (gtasf-event-marker-kind-colors-66ct). Lazily built + cached + disposed; gated by flags.eventKindColors.
  const kindMats = new Map<EventKind, { ring: MeshBasicMaterial; halo: MeshBasicMaterial }>();
  function kindMaterial(kind: EventKind) {
    let m = kindMats.get(kind);
    if (!m) {
      const color = eventKindStyle(kind).color;
      m = {
        ring: new MeshBasicMaterial({ color, transparent: true, opacity: .84, side: DoubleSide, depthWrite: false, blending: AdditiveBlending, forceSinglePass: true }),
        halo: new MeshBasicMaterial({ color, transparent: true, opacity: .16, side: DoubleSide, depthWrite: false, blending: AdditiveBlending, forceSinglePass: true }),
      };
      kindMats.set(kind, m);
    }
    return m;
  }
  const abort = new AbortController();
  let events: LocatedEvent[] = [], elapsed = 0, rebuildAt = -Infinity, disposed = false;
  // The venue groups the markers currently represent (one per venue), or null when grouping is off.
  // Exposed read-only via `venues` so tooling/smoke can verify one-marker-per-venue. [gtasf-v2-markers-venues-accessor-nd29]
  let venueGroups: VenueGroup[] | null = null;
  // Event ids the player has already been paid for (once-ever); drives the collected dim. [gtasf-ykbb]
  let collected: ReadonlySet<string> = new Set<string>();
  const markers: Marker[] = [], pool: Marker[] = [], candidates: LocatedEvent[] = [];
  const labels: WorldLabel[] = [];
  let hoveredEvent: string | null = null;
  const labelPoint = new Vector3(), cameraPoint = new Vector3();
  let layoutAt = -Infinity;
  let placements: LabelPlacement[] = [];
  const displayed = new Map<string, LabelPlacement>();
  const inside = new Set<string>(), active = new Set<string>(), occupied = new Set<string>();
  // Cached: phone() runs per label per frame, and innerWidth + matchMedia can force a style/layout flush each call (121 ms
  // of self time in the first seconds after READY on a 4x phone, gtasf-ep30n). Recomputed after a resize.
  let phoneCache: boolean | undefined;
  const phone = () => typeof window !== 'undefined'
    && (phoneCache ??= window.innerWidth <= 820 || window.matchMedia?.('(pointer: coarse)').matches === true);
  if (typeof window !== 'undefined') window.addEventListener('resize', () => { phoneCache = undefined; }, { signal: abort.signal });
  function rebuildLabels(position: { x: number; y: number; z: number }) {
    if (typeof document === 'undefined') return;
    const selected = (options.showLabels ?? labelsEnabled())
      ? selectLabelCandidates(events, options.graphicsPreset ?? 'hd', phone()) : [];
    for (let i = 0; i < selected.length; i++) {
      const candidate = selected[i]!;
      let label = labels[i];
      if (!label) {
        const canvas = document.createElement('canvas'); canvas.width = labelLimits(options.graphicsPreset ?? 'hd', phone()).canvasWidth;
        const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace;
        const sprite = new Sprite(new SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false, toneMapped: false }));
        sprite.renderOrder = 1000;
        const geometry = new BufferGeometry(); geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(6), 3));
        const leader = new Line(geometry, new LineBasicMaterial({ color: 0xf6efd8, transparent: true, opacity: .35, depthWrite: false, depthTest: false, toneMapped: false }));
        leader.frustumCulled = false; leader.renderOrder = 999;
        label = { candidate, sprite, canvas, texture, leader, anchor: new Vector3(), text: worldLabelText(candidate.event, candidate.group, candidate.distance, (options.now ?? Date.now)()), key: '' };
        labels.push(label);
      }
      label.candidate = candidate;
      label.sprite.name = `Event title: ${candidate.event.title}`;
      // Labels are not restricted to mounted road chunks. Use terrain when present, with
      // player-height fallback until the distant venue streams in; rings still require a safe road.
      const point = options.resolvePosition?.(candidate);
      label.anchor.set(point?.x ?? candidate.x, (point?.y ?? options.surfaceHeightAt(candidate.x, candidate.z) ?? position.y) + 5.2, point?.z ?? candidate.z);
      if (label.sprite.parent !== root) root.add(label.sprite, label.leader);
    }
    for (let i = selected.length; i < labels.length; i++) { labels[i]!.sprite.removeFromParent(); labels[i]!.leader.removeFromParent(); }
    layoutAt = -Infinity;
  }
  function placeLabels(position: { x: number; z: number }, dt: number) {
    const camera = options.camera;
    if (!camera || typeof window === 'undefined') return;
    const width = window.innerWidth, height = window.innerHeight;
    camera.updateMatrixWorld();
    if (elapsed >= layoutAt) {
      const anchors: LabelAnchor[] = [];
      for (const label of labels) {
        label.sprite.visible = label.leader.visible = false;
        if (label.sprite.parent !== root || !(options.showLabels ?? labelsEnabled())) continue;
        const distance = Math.hypot(label.anchor.x - position.x, label.anchor.z - position.z);
        label.text = worldLabelText(label.candidate.event, label.candidate.group, distance, (options.now ?? Date.now)());
        cameraPoint.copy(label.anchor).applyMatrix4(camera.matrixWorldInverse);
        labelPoint.copy(label.anchor).project(camera);
        // Behind-camera/out-of-view venues have no on-screen anchor; never cull a chosen label for crowding.
        if (cameraPoint.z >= 0 || labelPoint.z < -1 || labelPoint.z > 1 || Math.abs(labelPoint.x) > 1 || Math.abs(labelPoint.y) > 1) continue;
        anchors.push({ id: label.candidate.event.id, distance, x: (labelPoint.x + 1) * width / 2, y: (1 - labelPoint.y) * height / 2,
          width: Math.min(phone() ? 250 : 300, width - 24), height: label.text.detail ? 72 : label.text.badge ? 50 : 32 });
      }
      placements = layoutWorldLabels(anchors, width, height);
      layoutAt = elapsed + .1;
    }
    const smooth = smoothLabelPlacements(displayed, placements, 1 - Math.exp(-Math.max(0, dt) * 16), width, height);
    displayed.clear(); for (const value of smooth) displayed.set(value.id, value); // reuse the map each frame (gtasf-j6zw)
    for (const label of labels) {
      const placement = displayed.get(label.candidate.event.id);
      label.sprite.visible = label.sprite.parent === root && Boolean(placement) && (options.showLabels ?? labelsEnabled());
      label.leader.visible = false;
      if (!label.sprite.visible || !placement) continue;
      labelPoint.copy(label.anchor).project(camera);
      cameraPoint.copy(label.anchor).applyMatrix4(camera.matrixWorldInverse);
      const depth = camera.projectionMatrix.elements[15] === 0 ? -cameraPoint.z : 1;
      if (depth <= 0) { label.sprite.visible = false; continue; }
      label.sprite.position.set(placement.x / width * 2 - 1, 1 - placement.y / height * 2, labelPoint.z).unproject(camera);
      label.sprite.scale.set(placement.width / width * 2 * depth / Math.abs(camera.projectionMatrix.elements[0]!),
        placement.height / height * 2 * depth / Math.abs(camera.projectionMatrix.elements[5]!), 1);
      const range = labelLimits(options.graphicsPreset ?? 'hd', phone()).range;
      const hovered = hoveredEvent === label.candidate.event.id;
      label.sprite.material.opacity = hovered ? 1 : Math.max(.45, 1 - placement.distance / range * .55);
      label.sprite.material.color.set(hovered ? 0xffffaa : 0xffffff);
      paintLabel(label, placement.compact, placement.width, placement.height);
      const dx = placement.x - (labelPoint.x + 1) * width / 2, dy = placement.y - (1 - labelPoint.y) * height / 2;
      label.leader.visible = Math.hypot(dx, dy) > 8;
      if (label.leader.visible) {
        const attribute = label.leader.geometry.getAttribute('position');
        attribute.setXYZ(0, label.anchor.x, label.anchor.y - 4.8, label.anchor.z);
        attribute.setXYZ(1, label.sprite.position.x, label.sprite.position.y, label.sprite.position.z);
        attribute.needsUpdate = true;
      }
    }
  }
  function rebuild(position: { x: number; y: number; z: number }) {
    candidates.length = 0;
    for (const value of events) {
      value.distance = Math.hypot(value.x-position.x, value.z-position.z);
      if (value.distance <= 220) candidates.push(value);
    }
    candidates.sort((a,b) => a.distance-b.distance || a.event.start.localeCompare(b.event.start));
    rebuildLabels(position);
    occupied.clear(); markers.length = 0;
    for (const candidate of candidates) {
      if (markers.length >= 12) break;
      const height = options.surfaceHeightAt(candidate.x,candidate.z);
      const point = options.resolvePosition ? options.resolvePosition(candidate)
        : height === null ? null : { x: candidate.x, y: height, z: candidate.z };
      if (!point || ![point.x, point.y, point.z].every(Number.isFinite)) continue;
      // Grouped venues are already unique by venue key, so skip the 5 m dedupe — it could otherwise
      // hide a distinct venue sharing a building. Only the ungrouped v1 per-event path needs it.
      if (!candidate.group) { const key = `${Math.round(point.x/5)},${Math.round(point.z/5)}`; if (occupied.has(key)) continue; occupied.add(key); }
      let marker = pool[markers.length];
      if (!marker) {
        const group = new Group(), ring = new Mesh(geometry,material), glow = new Mesh(halo,haloMaterial);
        ring.rotation.x = glow.rotation.x = -Math.PI/2; ring.position.y = .16; glow.position.y = .13;
        group.add(glow,ring);
        let pillar: Mesh | undefined;
        if (pillarGeometry && pillarMaterial) { pillar = new Mesh(pillarGeometry, pillarMaterial); pillar.position.y = 3.5; group.add(pillar); }
        marker = { root: group, event: candidate.event, ring, glow, pillar, ...point }; pool.push(marker);
      }
      marker.event = candidate.event; marker.x = point.x; marker.y = point.y; marker.z = point.z;
      // Collected (drive-through already paid, once-ever) outranks preview/kind tint: a spent ring
      // reads grey so the player skips it (PLAN-v2 decision 1). Gated by dimCollectedMarkers. [gtasf-ykbb]
      const isCollected = flags.dimCollectedMarkers && markerCollected(candidate.event, candidate.group, collected);
      // Dim preview venues (shown via the extended window) so current/live events read brighter.
      const previewVenue = Boolean(candidate.group?.preview);
      // Tint live/current venues by event kind (radar legend colours); preview venues stay pale gold.
      const kindMat = isCollected || previewVenue || !flags.eventKindColors ? null
        : kindMaterial(classifyEventKind(candidate.event.title, candidate.event.venue ?? ''));
      if (marker.ring) marker.ring.material = isCollected ? collectedMaterial : previewVenue ? previewMaterial : kindMat ? kindMat.ring : material;
      if (marker.glow) marker.glow.material = isCollected ? collectedHalo : previewVenue ? previewHalo : kindMat ? kindMat.halo : haloMaterial;
      // The checkpoint column invites you to an unpaid event; a collected (spent) venue hides it.
      if (marker.pillar) marker.pillar.visible = !isCollected;
      marker.root.name = `Event ${candidate.event.id}${candidate.event.approx ? ' (approximate)' : ''}`;
      marker.root.position.set(point.x,point.y,point.z);
      if (marker.root.parent !== root) root.add(marker.root);
      markers.push(marker);
    }
    // Keep unused slots detached until nearby loaded events need them again.
    for (let i = markers.length; i < pool.length; i++) pool[i]!.root.removeFromParent();
  }
  function setEvents(values: readonly RadarEvent[]) {
    const grouped = options.groupByVenue ?? flags.venueGrouping;
    if (grouped) {
      // One marker per venue (not per event), so events sharing a venue are never hidden by the
      // 5 m dedupe below. The representative live/soonest event drives onEnter and naming.
      const now = (options.now ?? Date.now)();
      const focus24 = options.focusNext24h ?? flags.eventFocus24h;
      const venues = focus24
        ? focusVenues(values, { now })
        : groupVenues(values, { now, focusWindowMs: WEEK_WINDOW_MS }).filter(group => group.week.length > 0);
      venueGroups = venues;
      events = [];
      for (const group of venues) {
        const event = representativeEvent(group);
        if (!event) continue;
        events.push({ event, group, ...projectLocation(group.lat, group.lon, options.frame), distance: 0 });
      }
    } else {
      venueGroups = null;
      events = values.filter(event => typeof event.lat === 'number' && typeof event.lon === 'number'
        && Number.isFinite(event.lat) && Number.isFinite(event.lon)
        && event.lat > 37.68 && event.lat < 37.86 && event.lon > -122.56 && event.lon < -122.33)
        .map(event => ({ event, group: null, ...projectLocation(event.lat!,event.lon!,options.frame), distance: 0 }));
    }
    rebuildAt = -Infinity;
  }
  // Pull the player's collected (already-paid) event ids so the next rebuild can grey those markers.
  // Self-contained + non-fatal: a failure just leaves markers bright. Gated so it costs nothing when off.
  async function loadCollected(url = '/api/funding/collected'): Promise<void> {
    if (!flags.dimCollectedMarkers) return;
    try {
      const response = await fetch(url, { signal: abort.signal });
      if (!response.ok) return;
      const payload = await response.json() as { collectedEventIds?: string[] };
      if (disposed) return;
      collected = new Set(payload.collectedEventIds ?? []);
      rebuildAt = -Infinity; // re-skin markers with the collected dim on the next update
    } catch { /* offline / aborted: markers simply stay bright */ }
  }
  return {
    root, setEvents,
    get linkTargets(): EventLinkTarget[] {
      return [
        ...labels.filter(label => label.sprite.parent === root).map(label => ({ object: label.sprite, event: label.candidate.event, kind: 'label' as const })),
        ...markers.filter(marker => marker.ring && marker.root.parent === root).map(marker => ({ object: marker.ring!, event: marker.event, kind: 'ring' as const })),
      ];
    },
    hoverEvent(id: string | null) { hoveredEvent = id; },
    /** The venue groups currently shown (one per venue), or null when grouping is off. Read-only. */
    get venues(): readonly VenueGroup[] | null { return venueGroups; },
    async load(url = '/api/events') { const response = await fetch(url,{signal:abort.signal}); if (!response.ok) throw new Error(`Events HTTP ${response.status}`); const payload = await response.json() as { events?: RadarEvent[] }; if (!disposed) { setEvents(payload.events ?? []); void loadCollected(); } },
    /** Refresh the collected (already-paid) set from the server (call after reconnect/identity change). */
    loadCollected,
    /** Share the history/award union with the radar without rebuilding a Set for every saved event. */
    setCollected(ids: ReadonlySet<string>) { if (!disposed) { collected = ids; rebuildAt = -Infinity; } },
    /** Locally mark an event collected the instant its drive-through cheque lands, before the next poll. */
    markCollected(id: string) { if (!collected.has(id)) { collected = new Set([...collected, id]); rebuildAt = -Infinity; } },
    update(position: { x: number; y: number; z: number }, dt: number, canEnter = true) {
      if (disposed) return;
      elapsed += Math.max(0,Math.min(dt,.1));
      if (elapsed >= rebuildAt) { rebuild(position); rebuildAt = elapsed + 1; }
      active.clear(); let entered: RadarEvent | undefined;
      for (const marker of markers) {
        const scale = 1 + Math.sin(elapsed*2.4)*.07; marker.root.scale.setScalar(scale);
        if (Math.hypot(marker.x-position.x,marker.z-position.z) <= 3.1 && Math.abs(marker.y-position.y) < 3) {
          active.add(marker.event.id); if (canEnter && !inside.has(marker.event.id)) entered ??= marker.event;
        }
      }
      placeLabels(position, dt);
      // A car or open panel must not consume an entry before it can activate.
      // Keep earlier entries consumed while still inside, and always record exits.
      for (const id of inside) if (!active.has(id)) inside.delete(id);
      if (canEnter) for (const id of active) inside.add(id);
      if (entered) options.onEnter(entered);
    },
    destroy() { if (disposed) return; disposed = true; abort.abort(); for (const label of labels) { label.texture.dispose(); label.sprite.material.dispose(); label.leader.geometry.dispose(); label.leader.material.dispose(); } labels.length = 0; displayed.clear(); placements = []; root.removeFromParent(); root.clear(); markers.length = pool.length = candidates.length = 0; events = []; venueGroups = null; inside.clear(); active.clear(); occupied.clear(); geometry.dispose(); halo.dispose(); material.dispose(); haloMaterial.dispose(); previewMaterial.dispose(); previewHalo.dispose(); collectedMaterial.dispose(); collectedHalo.dispose(); pillarGeometry?.dispose(); pillarMaterial?.dispose(); for (const m of kindMats.values()) { m.ring.dispose(); m.halo.dispose(); } kindMats.clear(); },
  };
}
