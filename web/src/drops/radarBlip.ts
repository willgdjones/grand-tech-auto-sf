import type { LiveFundDrop } from '@gtasf/shared/drops';
import type { DropsClient } from './client';

/**
 * A ready adapter for the radar/map owners: turn the live fund drops into gold blips. World x/z
 * (metres, +x east / -z north) match the frame the radar already uses for peers; lat/lon are
 * provided too for the parchment map. `mine` dims a drop the player has already pitched; `out`
 * marks one with no cheques left. Draw a gold diamond and, optionally, an "N/50" tag.
 */
export interface DropRadarBlip {
  id: string;
  title: string;
  x: number; z: number;
  lat: number; lon: number;
  remaining: number;
  capacity: number;
  mine: boolean;
  out: boolean;
}

export function dropToRadarBlip(drop: LiveFundDrop): DropRadarBlip {
  const mine = Boolean(drop.yourClaim && drop.yourClaim.position > 0);
  return {
    id: drop.id, title: drop.fundName,
    x: drop.anchor.x, z: drop.anchor.z,
    lat: drop.location.lat, lon: drop.location.lon,
    remaining: drop.remaining, capacity: drop.capacity,
    mine, out: !mine && drop.remaining <= 0,
  };
}

/** All currently open drops as radar blips (usually one; the schedule keeps one live at a time). */
export function dropRadarBlips(client: Pick<DropsClient, 'active'>): DropRadarBlip[] {
  return client.active.map(dropToRadarBlip);
}
