import { describe, expect, it } from 'vitest';
import { CONE_DRIVE_COPY, driveCopyOf, escapedCone, memeNpcById, memeNpcEnabled, MEME_NPCS, type DriveQuestParams } from './memeQuests';

describe('meme quests — drive-quest escape check (server-verifiable)', () => {
  const p: DriveQuestParams = { escapeM: 80, limitMs: 25_000 };
  it('succeeds only when IN a vehicle, far enough, and within the time limit', () => {
    expect(escapedCone({ distFromProtesterM: 80, elapsedMs: 10_000, inVehicle: true }, p)).toBe(true);
    expect(escapedCone({ distFromProtesterM: 200, elapsedMs: 0, inVehicle: true }, p)).toBe(true); // boundary: t=0 ok
    expect(escapedCone({ distFromProtesterM: 80, elapsedMs: 25_000, inVehicle: true }, p)).toBe(true); // boundary: at the limit
  });
  it('fails on foot, too close, too slow, or a bad clock/distance', () => {
    expect(escapedCone({ distFromProtesterM: 200, elapsedMs: 10_000, inVehicle: false }, p)).toBe(false); // on foot
    expect(escapedCone({ distFromProtesterM: 79.9, elapsedMs: 10_000, inVehicle: true }, p)).toBe(false); // too close
    expect(escapedCone({ distFromProtesterM: 200, elapsedMs: 25_001, inVehicle: true }, p)).toBe(false); // too slow
    expect(escapedCone({ distFromProtesterM: 200, elapsedMs: -1, inVehicle: true }, p)).toBe(false); // clock before start
    expect(escapedCone({ distFromProtesterM: NaN, elapsedMs: 10_000, inVehicle: true }, p)).toBe(false); // bad distance
    expect(escapedCone({ distFromProtesterM: 200, elapsedMs: NaN, inVehicle: true }, p)).toBe(false); // bad clock
  });
});

describe('meme quests — specs', () => {
  it('memeNpcById resolves a known pitch archetype and rejects unknown ids', () => {
    expect(memeNpcById('patagonia-vest-vc')?.questKind).toBe('pitch');
    expect(memeNpcById('no-such-npc')).toBeUndefined();
  });
  it('every spec has a stable unique id + fictional archetype; pitch NPCs have a persona, drive NPCs have drive params', () => {
    expect(MEME_NPCS.length).toBeGreaterThanOrEqual(3);
    const ids = new Set(MEME_NPCS.map(n => n.id));
    expect(ids.size).toBe(MEME_NPCS.length); // ids unique
    for (const n of MEME_NPCS) {
      expect(n.id).toMatch(/^[a-z0-9-]+$/);
      expect(n.archetype.length).toBeGreaterThan(0);
      // persona is the AI-judge voice — only pitch NPCs use it (drive/share never reach the judge).
      if (n.questKind === 'pitch') expect(n.persona.length).toBeGreaterThan(0);
      // a drive NPC must carry its escape tuning, or the server can't verify the quest.
      if (n.questKind === 'drive') { expect(n.drive).toBeDefined(); expect(n.drive!.escapeM).toBeGreaterThan(0); expect(n.drive!.limitMs).toBeGreaterThan(0); }
      // a share NPC must carry the fictional take it invites the player to repost.
      if (n.questKind === 'share') expect((n.take ?? '').length).toBeGreaterThan(0);
    }
  });
});

describe('per-NPC flag (memeNpcEnabled)', () => {
  it('the Dolores doomer is gated by doomerQuest; ungated NPCs are always on', () => {
    const doomer = memeNpcById('dolores-doomer')!;
    expect(doomer.questKind).toBe('pitch');
    expect(memeNpcEnabled(doomer, { doomerQuest: false })).toBe(false);
    expect(memeNpcEnabled(doomer, { doomerQuest: true })).toBe(true);
    expect(memeNpcEnabled(memeNpcById('patagonia-vest-vc')!, {})).toBe(true);
  });
});

describe('AI-pendant founder (drive quest variant)', () => {
  it('is a gated drive quest with its own copy and no cone; the protester keeps the cone copy', () => {
    const pendant = memeNpcById('ai-pendant-founder')!;
    expect(pendant.questKind).toBe('drive');
    expect(pendant.drive).toEqual({ escapeM: 300, limitMs: 90_000 });
    expect(memeNpcEnabled(pendant, { pendantQuest: false })).toBe(false);
    expect(driveCopyOf(pendant).cone).toBe(false);
    expect(driveCopyOf(memeNpcById('robotaxi-protester')!)).toBe(CONE_DRIVE_COPY);
  });
});
