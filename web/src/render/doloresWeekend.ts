import { Group } from 'three';
import { NPC_CHATTER } from '@gtasf/shared/content/flavour';
import type { AvatarTemplate } from '../avatar/riggedAvatar';
import type { MovementWorld } from '../movement/world';
import type { CityLifeDestination } from './cityLife';
import { geodeticToWorld } from '../../../tools/map/src/geo';
import { SF_FRAME } from '../../../tools/map/src/config';
import { createDoloresPicnic } from './doloresWeekendModels';

// East lawn, south of the central promenade; 35.30 m from the nearest mapped lane.
export const DOLORES_PICNIC = Object.freeze({ lat: 37.7595, lon: -122.4264 });
const [anchorX, anchorZ] = geodeticToWorld(DOLORES_PICNIC.lat, DOLORES_PICNIC.lon, SF_FRAME);
export const DOLORES_FRIEND_POSITIONS = [[-2.9, -.5], [.4, -2.6], [2.9, .9], [-.6, 2.9]] as const;
const chatter = NPC_CHATTER.find(group => group.id === 'park-friend')!.lines;
type Point = { x: number; y: number; z: number };

/** Handles SF day boundaries and DST; repeated frames allocate no Intl parts or dates. */
export function createDoloresWeekendClock() {
  const format = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short' });
  let minute = NaN, weekend = false;
  return (epochMs: number) => {
    if (!Number.isFinite(epochMs) || Math.abs(epochMs) > 8.64e15) return false;
    const next = Math.floor(epochMs / 60_000);
    if (next !== minute) {
      minute = next; const day = format.format(epochMs); weekend = day === 'Sat' || day === 'Sun';
    }
    return weekend;
  };
}

/** Local atmosphere only: existing rigs, no player identities, rewards or server traffic. */
export function createDoloresWeekend(options: {
  enabled: boolean; template: AvatarTemplate | null; ground: MovementWorld;
  isLoaded(x: number, z: number): boolean; low?: boolean; parent?: HTMLElement; now?(): number;
  onDestination?(destination: CityLifeDestination): boolean | void; onNotice?(text: string): void;
}) {
  if (!options.enabled || !options.template) return null;
  const root = new Group(); root.name = 'Dolores weekend friends'; root.position.set(anchorX, 0, anchorZ); root.visible = false;
  const picnic = createDoloresPicnic(); root.add(picnic.root);
  const actors = DOLORES_FRIEND_POSITIONS.slice(0, options.low ? 2 : 4).map(([x, z], index) => {
    const avatar = options.template!.createInstance((index + 2) % 4);
    avatar.root.name = `Dolores park friend ${index + 1}`; avatar.root.position.set(x, 0, z);
    avatar.root.rotation.y = Math.atan2(-x, -z); root.add(avatar.root); return { avatar, x, z };
  });
  const now = options.now ?? Date.now, isWeekend = createDoloresWeekendClock();
  const controls = document.createElement('section'); controls.className = 'gt-dolores-controls';
  const heading = document.createElement('h3'); heading.textContent = 'Weekend at Dolores';
  const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Find the Dolores picnic';
  button.style.cssText = 'display:block;width:100%;min-height:44px;margin:7px 0';
  controls.append(heading, button); controls.hidden = !isWeekend(now()); options.parent?.append(controls);
  let disposed = false, elapsed = 0, nearby = false, noticeAt = 0, line = 0, nextGround = 0;
  const stats = { count: actors.length, visible: 0, weekend: !controls.hidden };
  const heightAt = (x: number, z: number) => {
    const wx = anchorX + x, wz = anchorZ + z;
    if (!options.isLoaded(wx, wz)) return null;
    const y = options.ground.heightAt(wx, wz);
    return y !== null && Number.isFinite(y) ? y : null;
  };
  function destination(): CityLifeDestination {
    return { ...DOLORES_PICNIC, x: anchorX, y: heightAt(0, 0) ?? 0, z: anchorZ,
      id: 'dolores-picnic', title: 'Dolores Park · weekend picnic',
      description: 'Friends on the east lawn, south of the central promenade. Leave your ride at Dolores Street and walk onto the grass.' };
  }
  const select = () => {
    if (!isWeekend(now())) { controls.hidden = true; return; }
    if (options.onDestination?.(destination()) === false) options.onNotice?.('This park is outside the current road map.');
  };
  button.addEventListener('click', select);
  return { root, controls, stats, destination,
    update(player: Point, seconds: number) {
      if (disposed) return;
      const dt = Math.max(0, Math.min(.1, Number.isFinite(seconds) ? seconds : 0)); elapsed += dt;
      const weekend = isWeekend(now());
      if (weekend !== stats.weekend) { stats.weekend = weekend; controls.hidden = !weekend; }
      stats.visible = 0;
      const distance = Math.hypot(player.x - anchorX, player.z - anchorZ), range = options.low ? 65 : 110;
      const centreY = stats.weekend && distance < range ? heightAt(0, 0) : null;
      if (!stats.weekend || !Number.isFinite(distance) || distance >= range || centreY === null) {
        root.visible = false; nearby = false; nextGround = 0; return;
      }
      if (elapsed >= nextGround) {
        root.visible = picnic.ground(heightAt); nextGround = root.visible ? elapsed + 2 : 0;
      }
      if (!root.visible) return;
      for (const actor of actors) {
        const y = heightAt(actor.x, actor.z);
        if (y === null || options.ground.collidesCircle?.(anchorX + actor.x, anchorZ + actor.z, .35)) {
          actor.avatar.root.visible = false; continue;
        }
        actor.avatar.root.position.y = y;
        actor.avatar.update(dt, 'idle', Math.min(1, Math.max(0, (range - distance) / 15)));
        if (actor.avatar.root.visible) stats.visible++;
      }
      const y = centreY;
      const inside = stats.visible > 0 && distance < 9 && Math.abs(player.y - y) < 3;
      if (inside && !nearby && elapsed >= noticeAt) {
        options.onNotice?.(`Dolores picnic · ${chatter[line++ % chatter.length]}`); noticeAt = elapsed + 20;
      }
      nearby = inside;
    },
    dispose() {
      if (disposed) return; disposed = true;
      for (const actor of actors) actor.avatar.dispose();
      picnic.dispose(); button.removeEventListener('click', select); controls.remove(); root.removeFromParent(); stats.visible = 0;
    },
  };
}
