import { expect, test, vi } from 'vitest';
import { flags } from '@gtasf/shared/flags';
import type { RoadGraph } from '@gtasf/shared/roadgraph';
import { createRadar, radarMatrix, type RadarEvent } from './radar';

vi.mock('@gtasf/shared/flags', () => ({ flags: { radar: true, waypoints: true, fullMap: true } }));

/** Minimal DOM surface: the smoke exercises the real radar handlers and directed router. */
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
  replaceChildren(...nodes: Node[]) { this.children = []; this.append(...nodes); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
  setAttribute() {}
  removeAttribute() {}
  focus() { Object.assign(document, { activeElement: this }); }
  blur() { if (document.activeElement === this as unknown) Object.assign(document, { activeElement: null }); }
  get isConnected() { return Boolean(this.parent) || this.tag === 'body'; }
  getClientRects() { return this.hidden ? [] : [{}]; }
  scrollIntoView() {}
  matches() { return false; }
  contains(node: Node | null) { while (node) { if (node === this) return true; node = node.parent ?? null; } return false; }
  getContext() { return {}; }
  find(predicate: (node: Node) => boolean): Node | undefined {
    if (predicate(this)) return this;
    for (const child of this.children) { const found = child.find(predicate); if (found) return found; }
    return undefined;
  }
  querySelector(selector: string) { return this.find(node => node.className.split(' ').includes(selector.slice(1))) ?? null; }
  clickText(text: string) {
    const button = this.find(node => node.tag === 'button' && node.textContent === text);
    if (!button?.onclick) throw new Error(`Missing button: ${text}`);
    button.onclick();
  }
}

test('failed routing or rejected callbacks preserve active GPS; accepted choices commit and close', async () => {
  const graph: RoadGraph = {
    version: 1,
    nodes: [{ id: 'a', x: 0, y: 0, z: 0 }, { id: 'b', x: 500, y: 0, z: 0 }],
    edges: [{ id: 'lane:road', from: 'a', to: 'b', lengthM: 500, speedMps: 10, lane: 1, points: [[0, 0, 0], [500, 0, 0]] }],
  };
  const events: RadarEvent[] = [
    { id: 'near', title: 'Next event', start: '2026-10-05T18:00:00Z', lat: 37.7955, lon: -122.3907, approx: false, url: 'https://example.com/near' },
    { id: 'far', title: 'Unreachable event', start: '2026-10-05T18:00:00Z', lat: 37.75, lon: -122.45, approx: false, url: 'https://example.com/far' },
  ];
  let finishRoads!: (response: Response) => void;
  const roads = new Promise<Response>(resolve => { finishRoads = resolve; });
  const body = new Node('body');
  vi.stubGlobal('document', { body, activeElement: null, createElement: (tag: string) => new Node(tag) });
  vi.stubGlobal('HTMLElement', Node);
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('Path2D', class { moveTo() {} lineTo() {} });
  vi.stubGlobal('fetch', vi.fn((url: string) => url === '/api/events' ? Promise.resolve(Response.json({ events })) : roads));
  const onSelect = vi.fn(), onHail = vi.fn();
  const radar = createRadar({ graph, frame: { origin: { lat: 37.7955, lon: -122.3937 }, gridRotationDeg: 0 }, onSelect, onHail })!;
  try {
    await radar.ready;
    const initial = { title: 'Active destination', x: 100, y: 0, z: 0 };
    expect(radar.setDestination(initial)).toBeNull();
    const navigation = body.querySelector('.gt-radar-navigation')!;
    expect(navigation.textContent).toContain('loading roads');
    const pendingGuard = vi.fn(() => true);
    expect(radar.setDestination({ ...initial, title: 'Not yet accepted', x: 200 }, pendingGuard)).toBeNull();
    expect(pendingGuard).not.toHaveBeenCalled(); expect(navigation.textContent).toContain('Active destination');
    finishRoads(Response.json(graph)); await radar.routingReady;
    const active = radar.route;
    expect(active?.approach.x).toBe(100);
    const acceptedLabel = navigation.textContent;
    expect(radar.setDestination({ title: 'Rejected', x: 10_000, y: 0, z: 0 }, pendingGuard)).toBeNull();
    expect(pendingGuard).not.toHaveBeenCalled();
    expect(radar.route).toBe(active);
    expect(navigation.textContent).toBe(acceptedLabel);
    const veto = vi.fn(candidate => { expect(candidate.approach.x).toBe(200); expect(radar.route).toBe(active); return false; });
    expect(radar.setDestination({ ...initial, title: 'Client rejected', x: 200 }, veto)).toBeNull();
    expect(veto).toHaveBeenCalledOnce(); expect(radar.route).toBe(active); expect(navigation.textContent).toBe(acceptedLabel);

    radar.toggleMap(true); body.clickText('Unreachable event'); body.clickText('Set destination');
    expect(body.querySelector('.gt-radar-route-error')?.textContent).toContain('outside the drivable local map');
    expect(radar.route).toBe(active); expect(radar.isExpanded).toBe(true); expect(onSelect).not.toHaveBeenCalled();
    body.clickText('Hail robotaxi');
    expect(radar.route).toBe(active); expect(onHail).not.toHaveBeenCalled();

    body.clickText('Next event');
    onHail.mockReturnValueOnce(false); body.clickText('Hail robotaxi');
    expect(onHail).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'near' }));
    expect(radar.route).toBe(active); expect(navigation.textContent).toBe(acceptedLabel); expect(radar.isExpanded).toBe(true);
    expect(body.querySelector('.gt-radar-route-error')?.textContent).toContain('Robotaxi request was not accepted');
    onHail.mockReturnValueOnce('Connect to the city before hailing.'); body.clickText('Hail robotaxi');
    expect(body.querySelector('.gt-radar-route-error')?.textContent).toBe('Connect to the city before hailing.');
    expect(radar.route).toBe(active); expect(navigation.textContent).toBe(acceptedLabel); expect(radar.isExpanded).toBe(true);
    onSelect.mockReturnValueOnce(false); body.clickText('Set destination');
    expect(onSelect).toHaveBeenCalledOnce(); expect(radar.route).toBe(active); expect(radar.isExpanded).toBe(true);
    expect(navigation.textContent).toBe(acceptedLabel);

    onSelect.mockClear(); body.clickText('Set destination'); // Undefined preserves existing accepting callbacks.
    expect(radar.route).not.toBe(active); expect(radar.route!.approach.x).toBeGreaterThan(200);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'near', ...radar.route!.approach }));
    expect(navigation.textContent).toContain('Next event'); expect(radar.isExpanded).toBe(false);

    const beforeHail = radar.setDestination(initial);
    radar.toggleMap(true);
    onHail.mockImplementationOnce(destination => {
      expect(radar.route).toBe(beforeHail); // No premature GPS commit while the client decides.
      expect(destination.x).toBeGreaterThan(200); return true;
    });
    body.clickText('Hail robotaxi');
    expect(radar.route).not.toBe(beforeHail); expect(radar.route!.approach.x).toBeGreaterThan(200);
    expect(radar.isExpanded).toBe(false); expect(body.querySelector('.gt-radar-route-error')).toBeNull();
    const beforeGuard = radar.route;
    const accept = vi.fn(candidate => { expect(candidate.approach.x).toBe(100); expect(radar.route).toBe(beforeGuard); return true; });
    const accepted = radar.setDestination(initial, accept);
    expect(accept).toHaveBeenCalledOnce(); expect(accepted).toBe(accept.mock.calls[0]![0]); expect(radar.route).toBe(accepted);
    expect(navigation.textContent).toContain('Active destination');

    const remoteTaxi = { title: 'Remote taxi stop', x: 10_000, y: 0, z: 0 };
    radar.setTaxiDestination(remoteTaxi); // Flag-off rides still need a local road route.
    expect(radar.route).toBe(accepted);
    Object.assign(flags, { quickRobotaxi: true });
    radar.setTaxiDestination(remoteTaxi);
    expect(radar.route).toBeNull(); expect(navigation.textContent).toContain('Remote taxi stop');
    Object.assign(flags, { quickRobotaxi: false });
    radar.setDestination(initial);

    radar.toggleMap(true); body.clickText('Next event');
    const oldSelect = body.find(node => node.tag === 'button' && node.textContent === 'Set destination')!;
    const oldHail = body.find(node => node.tag === 'button' && node.textContent === 'Hail robotaxi')!;
    oldSelect.focus(); onSelect.mockClear(); onHail.mockClear();
    radar.setEvents([events[1]!]);
    expect(document.activeElement).toBe(body.querySelector('.gt-radar-search'));
    expect(body.find(node => node.textContent.includes('no longer in the current calendar'))).toBeDefined();
    oldSelect.onclick!(); oldHail.onclick!(); // Even retained stale handlers cannot dispatch a removed event.
    expect(onSelect).not.toHaveBeenCalled(); expect(onHail).not.toHaveBeenCalled();
    expect(radar.route?.approach.x).toBe(100); expect(navigation.textContent).toContain('Active destination');

    radar.setEvents(events); body.clickText('Next event');
    radar.setEvents([{ ...events[0]!, title: 'Moved event', lon: -122.3897 }]);
    body.clickText('Set destination');
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ title: 'Moved event',
      event: expect.objectContaining({ lon: -122.3897 }) }));
    expect(radar.route!.approach.x).toBeGreaterThan(300);
    expect(radar.setDestination(null)).toBeNull(); expect(radar.route).toBeNull(); expect(navigation.hidden).toBe(true);
  } finally { Object.assign(flags, { quickRobotaxi: false }); radar.destroy(); vi.unstubAllGlobals(); }
});

test('minimap is heading-up and not mirrored', () => {
  // World: +x east, -z north. Yaw π/2 faces east (forward = (sin, cos)).
  const at = (rot: number, x: number, z: number) => { const m = radarMatrix(rot, 1); return { x: m.a * x + m.c * z, y: m.b * x + m.d * z }; };
  const east = Math.PI / 2;
  const ahead = at(east, 10, 0), north = at(east, 0, -10), south = at(east, 0, 10);
  expect(ahead.y).toBeLessThan(-9.99); expect(Math.abs(ahead.x)).toBeLessThan(1e-9); // forward is up
  expect(north.x).toBeLessThan(-9.99); // facing east, north is on the left
  expect(south.x).toBeGreaterThan(9.99); // and south on the right
  for (const rot of [0, 0.7, Math.PI / 2, 2.4, Math.PI, -1.3]) { const m = radarMatrix(rot, 2); expect(m.a * m.d - m.b * m.c).toBeGreaterThan(0); } // a rotation, never a reflection
});
