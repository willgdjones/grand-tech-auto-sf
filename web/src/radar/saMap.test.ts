import { expect, test, vi } from 'vitest';
import type { RoadGraph } from '@gtasf/shared/roadgraph';
import { createRadar, type RadarEvent, type RadarDestination } from './radar';
import { projectLocation } from './projection';

// The SA map restyle and its venue browser/waypoints only light up with saMapStyle on.
vi.mock('@gtasf/shared/flags', () => ({ flags: { radar: true, waypoints: true, fullMap: true, saMapStyle: true, venueGrouping: true, eventFocus24h: true, fundingLoop: false } }));

/** DOM + 2D-canvas stand-in: enough for one draw pass so hit-testing and projection run for real. */
const noopCtx: unknown = new Proxy({}, {
  get: (target: Record<string, unknown>, key: string) => key in target ? target[key] : (key === 'createPattern' ? () => null : () => undefined),
  set: (target: Record<string, unknown>, key: string, value: unknown) => { target[key] = value; return true; },
});
class Node extends EventTarget {
  children: Node[] = [];
  parent?: Node;
  className = '';
  textContent = '';
  value = '';
  hidden = false;
  dataset: Record<string, string> = {};
  onclick?: () => void;
  constructor(readonly tag: string) { super(); }
  append(...nodes: Node[]) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes: Node[]) { for (const node of this.children) node.parent = undefined; this.children = []; this.append(...nodes); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
  setAttribute() {}
  removeAttribute() {}
  focus() { Object.assign(document, { activeElement: this }); }
  get isConnected() { return Boolean(this.parent) || this.tag === 'body'; }
  getClientRects() { return this.hidden ? [] : [{}]; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 600, height: 600, right: 600, bottom: 600 }; }
  scrollIntoView() {}
  matches(_selector?: string) { return false; }
  contains(node: Node | null) { while (node) { if (node === this) return true; node = node.parent ?? null; } return false; }
  getContext() { return noopCtx; }
  setPointerCapture() {}
  releasePointerCapture() {}
  find(predicate: (node: Node) => boolean): Node | undefined {
    if (predicate(this)) return this;
    for (const child of this.children) { const found = child.find(predicate); if (found) return found; }
    return undefined;
  }
  findAll(predicate: (node: Node) => boolean, into: Node[] = []): Node[] {
    if (predicate(this)) into.push(this);
    for (const child of this.children) child.findAll(predicate, into);
    return into;
  }
  querySelector(selector: string): Node | null {
    const [head, ...tail] = selector.split(' ');
    const found = this.find(node => head!.startsWith('.') ? node.className.split(' ').includes(head!.slice(1)) : node.tag === head);
    return found && tail.length ? found.querySelector(tail.join(' ')) : found ?? null;
  }
}

function makeDom() {
  const body = new Node('body');
  vi.stubGlobal('document', { body, activeElement: null, createElement: (tag: string) => new Node(tag) });
  vi.stubGlobal('HTMLElement', Node);
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('Path2D', class { moveTo() {} lineTo() {} });
  vi.stubGlobal('devicePixelRatio', 1);
  return body;
}

function clickAt(node: Node, x: number, y: number) {
  const event = new Event('click') as Event & { clientX: number; clientY: number };
  event.clientX = x; event.clientY = y; node.dispatchEvent(event);
}

// A single lane spanning the whole map keeps the waypoint snap robust to the fit-scale.
const graph: RoadGraph = {
  version: 1,
  nodes: [{ id: 'a', x: -5000, y: 0, z: 0 }, { id: 'b', x: 5000, y: 0, z: 0 }],
  edges: [{ id: 'lane:road', from: 'a', to: 'b', lengthM: 10000, speedMps: 10, lane: 1, points: [[-5000, 0, 0], [5000, 0, 0]] }],
};
const frame = { origin: { lat: 37.7955, lon: -122.3937 }, gridRotationDeg: 0 };
// Two parties at one venue (shared coords) so the browser must list both under one marker.
const soon = new Date(Date.now() + 2 * 3600_000).toISOString();
const later = new Date(Date.now() + 3 * 3600_000).toISOString();
const venueEvents: RadarEvent[] = [
  { id: 'e1', title: 'Opening Mixer', host: 'Acme', start: soon, venue: 'Moscone Center', lat: 37.7955, lon: -122.3937, approx: false, url: 'https://example.com/e1' },
  { id: 'e2', title: 'Closing Panel', host: 'Acme', start: later, venue: 'Moscone Center', lat: 37.7955, lon: -122.3937, approx: false, url: 'https://example.com/e2' },
];

test('clicking a venue marker opens the browser listing every event there', async () => {
  const body = makeDom();
  const fills: unknown[] = [];
  (noopCtx as { fill: unknown }).fill = () => { fills.push((noopCtx as { fillStyle: unknown }).fillStyle); };
  const radar = createRadar({ graph, frame, routeGraph: graph, autoLoad: false, onSelect: vi.fn(), onHail: vi.fn() })!;
  try {
    await radar.ready; await radar.routingReady;
    radar.setEvents(venueEvents);
    radar.toggleMap(true);
    radar.update({ x: 0, z: 0 }, 0); // One draw: sets the projection and the venue's hit at screen centre.
    // The side list is grouped by venue too: both parties collapse into one Moscone Center row.
    const rows = body.querySelector('.gt-radar-list')!.findAll(node => node.tag === 'button');
    expect(rows.filter(row => row.textContent === 'Moscone Center')).toHaveLength(1);
    expect(body.querySelector('.gt-radar-help')!.textContent).toContain('waypoint');
    const canvas = body.find(node => node.tag === 'canvas')!;
    clickAt(canvas, 300, 300);
    const card = body.querySelector('.gt-radar-card')!;
    const titles = card.findAll(node => node.tag === 'strong').map(node => node.textContent);
    expect(titles).toContain('Opening Mixer');
    expect(titles).toContain('Closing Panel');
    expect(card.find(node => node.textContent.includes('2 events at this venue'))).toBeDefined();
    expect(card.find(node => node.tag === 'button' && node.textContent === 'Set destination')).toBeDefined();
    radar.setCollected(new Set(['e1'])); fills.length = 0; radar.update({ x: 0, z: 0 }, 0);
    expect(fills).not.toContain('#8a8f86'); // Paying the representative does not spend the whole venue.
    radar.setCollected(new Set(['e1', 'e2'])); fills.length = 0; radar.update({ x: 0, z: 0 }, 0);
    expect(fills).toContain('#8a8f86');
    radar.setEvents([...venueEvents, { ...venueEvents[1]!, id: 'new-cheque' }]);
    fills.length = 0; radar.update({ x: 0, z: 0 }, 0);
    expect(fills).not.toContain('#8a8f86'); // A new unpaid event makes this venue worth visiting again.
  } finally { radar.destroy(); delete (noopCtx as { fill?: unknown }).fill; vi.unstubAllGlobals(); }
});

test('a venue card follows calendar changes without losing its identity, focus or active GPS', async () => {
  const body = makeDom(), onSelect = vi.fn(), onHail = vi.fn();
  const radar = createRadar({ graph, frame, routeGraph: graph, autoLoad: false, onSelect, onHail })!;
  try {
    await radar.ready; await radar.routingReady;
    radar.setEvents(venueEvents);
    const activeRoute = radar.setDestination({ title: 'Existing trip', x: 200, y: 0, z: 0 });
    radar.update({ x: 0, z: 0 }, 0);
    // A grouped marker must open its browser directly from the circular minimap too.
    clickAt(body.find(node => node.tag === 'canvas')!, 300, 300);
    expect(radar.isExpanded).toBe(true);
    const card = body.querySelector('.gt-radar-card')!;
    const heading = () => card.querySelector('h3')!.textContent;
    const row = (id: string) => card.find(node => node.dataset.venueEvent === id);
    const action = (name: string) => card.find(node => node.tag === 'button' && node.textContent === name)!;
    const titles = () => card.findAll(node => node.tag === 'strong').map(node => node.textContent);
    const retainedHail = action('Hail robotaxi');
    expect(document.activeElement).toBe(action('Set destination'));
    row('e2')!.focus();
    const changed = { ...venueEvents[1]!, title: 'Updated Closing Panel', lon: -122.3936 };
    const added = { ...venueEvents[1]!, id: 'e3', title: 'New Founder Dinner', start: new Date(Date.parse(later) + 3600_000).toISOString() };
    radar.setEvents([venueEvents[0]!, changed, added]);
    expect(heading()).toBe('Moscone Center');
    expect(titles()).toEqual(['Opening Mixer', 'Updated Closing Panel', 'New Founder Dinner']);
    expect(document.activeElement).toBe(row('e2'));
    expect(radar.route).toBe(activeRoute); expect(onSelect).not.toHaveBeenCalled();

    // Removing the old representative keeps the venue usable and updates every action's target.
    action('Hail robotaxi').focus();
    radar.setEvents([changed, added]);
    expect(heading()).toBe('Moscone Center');
    expect(titles()).toEqual(['Updated Closing Panel', 'New Founder Dinner']);
    expect(document.activeElement).toBe(action('Hail robotaxi'));
    onHail.mockReturnValueOnce('No robotaxis available.');
    retainedHail.onclick!(); // A retained action resolves the venue against the latest calendar.
    expect(onHail).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'e2', title: changed.title,
      event: expect.objectContaining({ lon: changed.lon }) }));
    expect(radar.isExpanded).toBe(true); expect(radar.route).toBe(activeRoute);

    // If the focused event disappears, focus falls back to the venue's primary action.
    row('e2')!.focus(); radar.setEvents([added]);
    expect(heading()).toBe('Moscone Center'); expect(titles()).toEqual(['New Founder Dinner']);
    expect(document.activeElement).toBe(action('Set destination'));
    action('Set destination').onclick!();
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'e3' }));
    expect(radar.isExpanded).toBe(false);
    const acceptedRoute = radar.route; expect(acceptedRoute).not.toBeNull();

    // Background refresh must not reopen the map or move focus away from the player's other control.
    body.focus(); radar.setEvents([added]);
    expect(document.activeElement).toBe(body); expect(radar.isExpanded).toBe(false);
    radar.toggleMap(true); action('Set destination').focus();
    const removedAction = action('Set destination');
    radar.setEvents([]);
    expect(heading()).toBe('Calendar updated');
    expect(card.find(node => node.textContent.includes('venue has no upcoming events'))).toBeDefined();
    expect(document.activeElement).toBe(body.querySelector('.gt-radar-search'));
    expect(card.find(node => node.tag === 'button')).toBeUndefined();
    removedAction.onclick!(); retainedHail.onclick!();
    expect(onSelect).toHaveBeenCalledTimes(1); expect(onHail).toHaveBeenCalledTimes(1);
    expect(radar.route).toBe(acceptedRoute);

    // Choosing one member leaves venue mode; later updates still refresh its individual details.
    radar.setEvents(venueEvents);
    body.querySelector('.gt-radar-list')!.find(node => node.tag === 'button' && node.textContent === 'Moscone Center')!.onclick!();
    row('e2')!.onclick!(); radar.setEvents([changed]);
    expect(heading()).toBe('Updated Closing Panel');
    expect(card.querySelector('.gt-radar-venue-events')).toBeNull();
    expect(radar.route).toBe(acceptedRoute);
  } finally { radar.destroy(); vi.unstubAllGlobals(); }
});

test('clicking empty map drops a road-snapped waypoint and routes to it', async () => {
  const body = makeDom();
  const onSelect = vi.fn((_destination: RadarDestination): boolean | string | void => undefined);
  const onClear = vi.fn();
  const radar = createRadar({ graph, frame, routeGraph: graph, autoLoad: false, onSelect, onClear })!;
  try {
    await radar.ready; await radar.routingReady;
    radar.setEvents(venueEvents);
    radar.toggleMap(true);
    radar.update({ x: 0, z: 0 }, 0);
    const canvas = body.find(node => node.tag === 'canvas')!;
    clickAt(canvas, 450, 300); // Off-centre: misses the venue blip, lands on the lane.
    expect(onSelect).toHaveBeenCalledOnce();
    const target = onSelect.mock.calls[0]![0];
    expect(target.title).toBe('Map waypoint');
    expect(target.event).toBeUndefined();
    expect(radar.route).not.toBeNull();
    expect(body.find(node => node.textContent.includes('Waypoint set'))).toBeDefined();
    // Clearing drops the map route and asks the host to clear the in-world GPS line too.
    body.find(node => node.tag === 'button' && node.textContent === 'Clear route')!.onclick!();
    expect(onClear).toHaveBeenCalledOnce();
    expect(radar.route).toBeNull();
  } finally { radar.destroy(); vi.unstubAllGlobals(); }
});

test('an optional coastline fills without breaking the map draw or hit-testing', async () => {
  const body = makeDom();
  const fill = vi.fn();
  (noopCtx as {fill:unknown}).fill = fill;
  // Outer water plus a land island; one even-odd fill must preserve the island cutout.
  const coastline: [number, number][][] = [[[-100, -100], [100, -100], [100, 100], [-100, 100]],
    [[-10,-10],[-10,10],[10,10],[10,-10]]];
  const radar = createRadar({ graph, frame, routeGraph: graph, autoLoad: false, onSelect: vi.fn(), onHail: vi.fn(), coastline })!;
  try {
    await radar.ready; await radar.routingReady;
    radar.setEvents(venueEvents);
    radar.toggleMap(true);
    radar.update({ x: 0, z: 0 }, 0); // One draw: water fill runs, then roads/blips, without throwing.
    expect(fill.mock.calls.some(call => call[1] === 'evenodd')).toBe(true);
    // The venue marker still hit-tests at centre despite the water fill underneath.
    const canvas = body.find(node => node.tag === 'canvas')!;
    clickAt(canvas, 300, 300);
    expect(body.querySelector('.gt-radar-card')!.find(node => node.textContent.includes('2 events at this venue'))).toBeDefined();
  } finally { radar.destroy(); delete (noopCtx as {fill?:unknown}).fill; vi.unstubAllGlobals(); }
});

test('district search reaches the source road, preserves rejected trips and clears back to venues', async () => {
  const body = makeDom();
  // Sunset's verified Irving Street approach; a raised road catches accidental y=0 dispatch.
  const sunset = projectLocation(37.7636222, -122.4769949, frame);
  const localRoad: RoadGraph = {
    version: 1,
    nodes: [{ id: 'a', x: sunset.x - 100, y: 68, z: sunset.z }, { id: 'b', x: sunset.x + 100, y: 68, z: sunset.z }],
    edges: [{ id: 'lane:irving', from: 'a', to: 'b', lengthM: 200, speedMps: 10, lane: 1,
      points: [[sunset.x - 100, 68, sunset.z], [sunset.x + 100, 68, sunset.z]] }],
  };
  const onSelect = vi.fn((_destination: RadarDestination): boolean | string | void => undefined);
  const onHail = vi.fn((_destination: RadarDestination): boolean | string | void => undefined);
  const radar = createRadar({ graph: localRoad, frame, routeGraph: localRoad, autoLoad: false, onSelect, onHail })!;
  try {
    await radar.ready; await radar.routingReady;
    radar.setEvents(venueEvents);
    radar.update({ x: sunset.x - 80, y: 68, z: sunset.z }, 0);
    radar.toggleMap(true);
    const search = body.querySelector('.gt-radar-search')!;
    const places = body.querySelector('.gt-radar-places')!;
    const card = body.querySelector('.gt-radar-card')!;
    const find = (query: string) => { search.value = query; search.dispatchEvent(new Event('input')); };
    const action = (title: string) => card.find(node => node.tag === 'button' && node.textContent === title)!;
    expect(places.hidden).toBe(true);
    for (const [query, title] of [['Richmond', 'Richmond'], [' SUNSET ', 'Sunset'], ['Golden Gate Park', 'Golden Gate Park'], ['ocean-beach', 'Ocean Beach'], ['twin peaks', 'Twin Peaks']]) {
      find(query!);
      expect(places.findAll(node => node.tag === 'button').map(node => node.textContent)).toEqual([title]);
    }
    // A district outside the loaded drivable graph cannot dispatch or claim a route.
    places.find(node => node.tag === 'button')!.onclick!(); action('Set destination').onclick!();
    expect(onSelect).not.toHaveBeenCalled(); expect(radar.isExpanded).toBe(true);
    expect(card.querySelector('.gt-radar-route-error')!.textContent).toContain('outside the drivable local map');
    expect(card.querySelector('.gt-radar-route-error')!.textContent).not.toContain('event page');
    find('Sunset'); places.find(node => node.tag === 'button')!.onclick!();
    expect(document.activeElement).toBe(action('Set destination'));
    action('Set destination').onclick!();
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'district:sunset', title: 'Sunset', x: sunset.x, y: 68, z: sunset.z }));
    expect(radar.isExpanded).toBe(false);
    const accepted = radar.route; expect(accepted).not.toBeNull();
    radar.toggleMap(true); places.find(node => node.tag === 'button')!.onclick!();
    onHail.mockReturnValueOnce('No robotaxis are available.'); action('Hail robotaxi').onclick!();
    expect(radar.route).toBe(accepted); expect(radar.isExpanded).toBe(true);
    expect(card.querySelector('.gt-radar-route-error')!.textContent).toBe('No robotaxis are available.');
    action('Hail robotaxi').onclick!();
    expect(onHail).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'district:sunset', y: 68 }));
    expect(radar.isExpanded).toBe(false);
    radar.toggleMap(true); find('');
    expect(places.hidden).toBe(true); expect(places.children).toHaveLength(0);
    expect(body.querySelector('.gt-radar-list')!.find(node => node.tag === 'button' && node.textContent === 'Moscone Center')).toBeDefined();
  } finally { radar.destroy(); vi.unstubAllGlobals(); }
});

test('periodic refresh preserves an active district result until keyboard and pointer leave', async () => {
  const body = makeDom(), clock = vi.spyOn(performance, 'now').mockReturnValue(1000);
  const radar = createRadar({ graph, frame, routeGraph: graph, autoLoad: false, onSelect: vi.fn() })!;
  try {
    await radar.ready; await radar.routingReady;
    radar.setEvents(venueEvents); radar.toggleMap(true);
    const search = body.querySelector('.gt-radar-search')!, places = body.querySelector('.gt-radar-places')!;
    search.value = 'Sunset'; search.dispatchEvent(new Event('input'));
    const row = places.find(node => node.tag === 'button')!;
    row.focus(); radar.setEvents(venueEvents);
    expect(places.children).toContain(row); expect(document.activeElement).toBe(row);
    clock.mockReturnValue(6001); radar.update({ x: 0, z: 0 }, 0);
    expect(places.children).toContain(row); // The focused control must remain in the result group.
    expect(document.activeElement).toBe(row);
    body.focus(); places.matches = selector => selector === ':hover';
    radar.setEvents(venueEvents); expect(places.children).toContain(row);
    clock.mockReturnValue(12002); radar.update({ x: 0, z: 0 }, 0);
    expect(places.children).toContain(row); // Do not swap a hovered target before its click.
    places.matches = () => false;
    clock.mockReturnValue(18003); radar.update({ x: 0, z: 0 }, 0);
    const refreshed = places.find(node => node.tag === 'button')!;
    expect(refreshed).not.toBe(row); expect(refreshed.textContent).toBe('Sunset');
    refreshed.onclick!();
    const card = body.querySelector('.gt-radar-card')!;
    expect(card.find(node => node.tag === 'h3')!.textContent).toBe('Sunset');
    expect(document.activeElement).toBe(card.find(node => node.tag === 'button' && node.textContent === 'Set destination'));
    search.value = ''; search.dispatchEvent(new Event('input'));
    expect(places.hidden).toBe(true); expect(places.children).toHaveLength(0);
    expect(body.querySelector('.gt-radar-list')!.find(node => node.tag === 'button' && node.textContent === 'Moscone Center')).toBeDefined();
  } finally { radar.destroy(); clock.mockRestore(); vi.unstubAllGlobals(); }
});
