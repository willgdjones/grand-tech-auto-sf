import { expect, it, vi } from 'vitest';
import { Group, Mesh, MeshBasicMaterial } from 'three';
import { createCollectedEvents } from './collected';
import { createEventMarkers } from './markers';
import type { RadarEvent } from '../radar/radar';

vi.mock('@gtasf/shared/flags', () => ({ flags: { hud: true, events: true, venueGrouping: true,
  eventFocus24h: true, dimCollectedMarkers: true } }));

it('merges saved history and live awards, shares pending reloads and retains paid markers through failures', async () => {
  const now = Date.parse('2026-10-06T19:00:00Z');
  const event = (id: string): RadarEvent => ({ id, title: id, start: '2026-10-06T20:00:00Z',
    venue: 'Founders Hall', lat: 37.7955, lon: -122.3937, approx: false, url: `https://example.com/${id}` });
  const markers = createEventMarkers({ scene: new Group(), frame: { origin: { lat: 37.7955, lon: -122.3937 }, gridRotationDeg: 0 },
    surfaceHeightAt: () => 0, onEnter: vi.fn(), now: () => now })!;
  markers.setEvents([event('saved'), event('live'), event('batch-peer')]);
  const colors = () => {
    markers.update({ x: 0, y: 0, z: 0 }, .1, false);
    const result: number[] = [];
    markers.root.traverse(node => { if (node instanceof Mesh && node.material instanceof MeshBasicMaterial) result.push(node.material.color.getHex()); });
    return result;
  };
  let resolve!: (ids: readonly string[]) => void;
  const load = vi.fn(() => new Promise<readonly string[]>(done => { resolve = done; }));
  const changes: string[][] = [];
  const history = createCollectedEvents({ load, onChange(ids) { changes.push([...ids].sort()); markers.setCollected(ids); } });
  try {
    const first = history.refresh(); expect(history.refresh()).toBe(first);
    await Promise.resolve(); expect(load).toHaveBeenCalledTimes(1);
    history.add('live'); history.add('live'); // An award arrives while the older server snapshot is in flight.
    expect(changes).toEqual([['live']]);
    expect(colors()).not.toContain(0x8c8c86); // Another event at this venue still offers a cheque.
    resolve(['saved']); await first;
    expect(changes.at(-1)).toEqual(['live', 'saved']);
    expect(colors()).not.toContain(0x8c8c86);
    expect(load).toHaveBeenCalledTimes(2); // A fresh snapshot started without another caller.
    const reconciled = history.refresh(); // Shares the follow-up triggered by the in-flight award.
    await Promise.resolve(); expect(load).toHaveBeenCalledTimes(2);
    resolve(['saved', 'batch-peer']); await reconciled;
    expect(changes.at(-1)).toEqual(['batch-peer', 'live', 'saved']);
    expect(colors()).toEqual([0x8c8c86, 0x8c8c86]); // Bulk history updates the real marker materials.

    load.mockRejectedValueOnce(new Error('offline'));
    await history.refresh();
    expect(changes).toHaveLength(3); expect(colors()).toEqual([0x8c8c86, 0x8c8c86]);
    const reconnect = history.refresh(); expect(history.refresh()).toBe(reconnect);
    await Promise.resolve(); resolve(['other-session']); await reconnect;
    expect(changes.at(-1)).toEqual(['batch-peer', 'live', 'other-session', 'saved']);

    const last = history.refresh(); await Promise.resolve();
    history.add('last-live'); // Disposal must also suppress a now-needed follow-up request.
    history.destroy(); resolve(['too-late']); await last;
    history.add('after-dispose'); await history.refresh();
    expect(changes).toHaveLength(5); expect(load).toHaveBeenCalledTimes(5);
    const cancelledLoad = vi.fn(async () => ['never-requested']);
    const cancelled = createCollectedEvents({ load: cancelledLoad, onChange: vi.fn() });
    const queued = cancelled.refresh(); cancelled.destroy(); await queued;
    expect(cancelledLoad).not.toHaveBeenCalled();
  } finally { history.destroy(); markers.destroy(); }
});
