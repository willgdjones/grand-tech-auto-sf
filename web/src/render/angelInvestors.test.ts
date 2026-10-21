import { expect, test } from 'vitest';
import { CELEB_NPCS, celebChequeCents, celebLabel } from '@gtasf/shared/content/celebs';
import type { GroundPose, MovementWorld } from '../movement/world';
import type { AvatarTemplate } from '../avatar/riggedAvatar';
import { createAngelInvestors } from './angelInvestors';

/**
 * Logic smoke for the hidden parody angel NPCs (gtasf-v2-angel-npcs-v4i6, PLAN-v2 decision 4).
 * Covers the flag/template gate, once-ever-per-NPC pitching, the pitch content (line + cheque as
 * bigint cents), rumour throttling, and the radar rumour zone — all without touching rendering
 * (update() is never called, so no three.js avatars/canvas are built).
 */
// Spread real SF spots far apart in world metres so each NPC is isolated for distance checks.
const geoToWorld = (lat: number, lon: number) => ({ x: (lat - 37.8) * 100_000, z: (lon + 122.4) * 100_000 });
const ground = { heightAt: () => 0 } as unknown as MovementWorld;
const template = {} as unknown as AvatarTemplate;

function make(overrides: Partial<Parameters<typeof createAngelInvestors>[0]> = {}) {
  return createAngelInvestors({
    enabled: true, template, ground,
    isLoaded: () => true, geoToWorld, ...overrides,
  });
}

const ron = CELEB_NPCS[0]!; // ron-conway, used as the deterministic nearest target
const ronFoot = (() => { const { x, z } = geoToWorld(ron.spot[0], ron.spot[1]); return { x, y: 0, z } as GroundPose; })();

test('is gated off without the flag or an avatar template', () => {
  expect(make({ enabled: false })).toBeNull();
  expect(make({ template: null })).toBeNull();
  expect(make()).not.toBeNull();
});

test('nearest/pitch report the NPC, its parody line and cheque as bigint cents', () => {
  const angels = make()!;
  const target = angels.nearest(ronFoot);
  expect(target?.npc.id).toBe(ron.id);
  expect(target?.alreadyPitched).toBe(false);

  const result = angels.pitch(ronFoot);
  expect(result?.npc.id).toBe(ron.id);
  expect(result?.firstTime).toBe(true);
  expect(result?.line).toBe(ron.line);
  expect(result?.chequeCents).toBe(celebChequeCents(ron.id));
  expect(typeof result?.chequeCents).toBe('bigint');
});

test('a pitch pays once ever: markPitched flips alreadyPitched and the prompt', () => {
  const angels = make()!;
  expect(angels.promptText(ronFoot)).toBe(`E · Pitch ${celebLabel(ron)}`);
  expect(angels.pitch(ronFoot)?.firstTime).toBe(true);
  angels.markPitched(ron.id); // host marks it paid only on server/local award success
  expect(angels.hasPitched(ron.id)).toBe(true);
  expect(angels.nearest(ronFoot)?.alreadyPitched).toBe(true);
  expect(angels.pitch(ronFoot)?.firstTime).toBe(false);
  expect(angels.promptText(ronFoot)).toBe(`${celebLabel(ron)} — already pitched`);
});

test('no NPC in reach → no target, no prompt, no pitch', () => {
  const angels = make()!;
  const away = { x: 9_999_999, y: 0, z: 9_999_999 } as GroundPose;
  expect(angels.nearest(away)).toBeNull();
  expect(angels.promptText(away)).toBeNull();
  expect(angels.pitch(away)).toBeNull();
});

test('setPitched / pitchedIds round-trip a seeded once-ever record', () => {
  const angels = make({ pitched: [ron.id] })!;
  expect(angels.hasPitched(ron.id)).toBe(true);
  angels.setPitched(['naval-ravikant', 'elad-gil']);
  expect(angels.hasPitched(ron.id)).toBe(false);
  expect(new Set(angels.pitchedIds())).toEqual(new Set(['naval-ravikant', 'elad-gil']));
});

test('rumours are throttled to the interval and point at a nearby neighbourhood', () => {
  const angels = make()!;
  expect(angels.takeRumour(ronFoot, 0)).toBeNull();            // too soon (now - 0 < interval)
  const first = angels.takeRumour(ronFoot, 100_000);
  expect(typeof first).toBe('string');
  expect((first ?? '').length).toBeGreaterThan(0);
  expect(angels.takeRumour(ronFoot, 100_000)).toBeNull();       // inside the interval → silent
  expect(typeof angels.takeRumour(ronFoot, 160_000)).toBe('string'); // interval elapsed → fires again
});

test('the radar hint shows a fixed coarse search area, then clears on pitch or expiry', () => {
  // Put the actor well away from a grid intersection so an exact-centre regression is visible.
  const offsetWorld = (lat: number, lon: number) => {
    const point = geoToWorld(lat, lon); return { x: point.x + 13, z: point.z + 19 };
  };
  const foot = { ...ronFoot, ...offsetWorld(ron.spot[0], ron.spot[1]) };
  const angels = make({ geoToWorld: offsetWorld })!;
  expect(angels.activeRumourZone(100_000)).toBeNull();          // nothing hinted yet
  angels.takeRumour(foot, 100_000);
  const zone = angels.activeRumourZone(100_000);
  expect(zone).not.toBeNull();
  expect(zone!.x / 50).toBe(Math.round(zone!.x / 50));
  expect(zone!.z / 50).toBe(Math.round(zone!.z / 50));
  const distance = Math.hypot(zone!.x - foot.x, zone!.z - foot.z);
  expect(distance).toBeGreaterThan(10); // never hand the radar this investor's exact coordinates
  expect(distance).toBeLessThan(zone!.radius);
  expect(zone!.radius).toBe(150);
  // Moving to another investor during the cooldown cannot move or replace the hinted area.
  const next = CELEB_NPCS[1]!, nextSpot = offsetWorld(next.spot[0], next.spot[1]);
  expect(angels.takeRumour({ ...ronFoot, ...nextSpot }, 120_000)).toBeNull();
  expect(angels.activeRumourZone(129_999)).toEqual(zone);
  expect(angels.activeRumourZone(130_000)).toBeNull(); // exactly thirty seconds, even before a new hint
  angels.takeRumour(foot, 200_000);
  angels.markPitched(ron.id);
  expect(angels.activeRumourZone(200_000)).toBeNull();          // pitched → the hinted NPC is done
});
