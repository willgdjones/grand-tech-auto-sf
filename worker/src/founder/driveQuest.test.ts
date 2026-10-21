import { describe, expect, it, vi } from 'vitest';
import { fundingDay } from '@gtasf/shared/funding';
import type { DriveQuestParams, MemeNpcSpec } from '@gtasf/shared/founder/memeQuests';
import { DRIVE_QUEST_PAYOUT_CENTS, driveQuestCredit, driveQuestState, runDriveQuest, type DriveQuestDeps } from './driveQuest';

const driveNpc: MemeNpcSpec = {
  id: 'robotaxi-protester', archetype: 'A robotaxi protester', persona: '',
  hook: '"ESCAPE THE CONE"', questKind: 'drive',
  target: { lat: 37.795, lon: -122.394 }, face: { lat: 37.795, lon: -122.394 },
  look: { sex: 'male', archetype: 'hacker', outfit: 0, accessory: 0 },
};
const pitchNpc: MemeNpcSpec = { ...driveNpc, id: 'a-pitch-npc', questKind: 'pitch' };
const params: DriveQuestParams = { escapeM: 120, limitMs: 60_000 };
const NOW = 1_760_000_000_000;

const escaped = { distFromProtesterM: 150, elapsedMs: 30_000, inVehicle: true };

function deps(over: Partial<DriveQuestDeps> = {}): DriveQuestDeps & { credited: ReturnType<typeof vi.fn>; award: ReturnType<typeof vi.fn> } {
  const credited = vi.fn(async () => false);
  const award = vi.fn(async () => ({ credited: true }));
  return { credited, award, ...over } as never;
}

describe('runDriveQuest', () => {
  it('pays a server-verified escape once, with a per-SF-day celebrity ref', async () => {
    const d = deps();
    const out = await runDriveQuest(driveNpc, escaped, params, NOW, d);
    expect(out).toEqual({ status: 'completed', credited: true, amountCents: DRIVE_QUEST_PAYOUT_CENTS.toString() });
    const { source, sourceRef } = driveQuestCredit(driveNpc.id, NOW);
    expect(source).toBe('celebrity');
    expect(sourceRef).toBe(`meme:drive:${driveNpc.id}:${fundingDay(NOW)}`);
    expect(d.award).toHaveBeenCalledOnce();
    expect(d.award.mock.calls[0]![0]).toMatchObject({ source, sourceRef, amountCents: DRIVE_QUEST_PAYOUT_CENTS.toString() });
  });

  it('does not pay when the player has not escaped (too close, on foot, or timed out)', async () => {
    for (const state of [
      { distFromProtesterM: 50, elapsedMs: 30_000, inVehicle: true },   // still in cone
      { distFromProtesterM: 150, elapsedMs: 30_000, inVehicle: false }, // on foot never counts
      { distFromProtesterM: 150, elapsedMs: 90_000, inVehicle: true },  // over the time limit
      { distFromProtesterM: 150, elapsedMs: -1, inVehicle: true },      // bad clock
    ]) {
      const d = deps();
      expect(await runDriveQuest(driveNpc, state, params, NOW, d)).toEqual({ status: 'incomplete' });
      expect(d.award).not.toHaveBeenCalled();
      expect(d.credited).not.toHaveBeenCalled(); // short-circuits before the cooldown check
    }
  });

  it('never pays a non-drive NPC through this route (pitch NPC = incomplete, no award)', async () => {
    const d = deps();
    expect(await runDriveQuest(pitchNpc, escaped, params, NOW, d)).toEqual({ status: 'incomplete' });
    expect(d.award).not.toHaveBeenCalled();
  });

  it('blocks a repeat escape the same SF day (cooldown) without awarding again', async () => {
    const d = deps({ credited: vi.fn(async () => true) });
    expect(await runDriveQuest(driveNpc, escaped, params, NOW, d)).toEqual({ status: 'blocked', reason: 'cooldown' });
    expect(d.award).not.toHaveBeenCalled();
  });

  it('reports credited:false if the ledger loses a write race (still completed, not double-counted)', async () => {
    const d = deps({ award: vi.fn(async () => ({ credited: false })) });
    const out = await runDriveQuest(driveNpc, escaped, params, NOW, d);
    expect(out).toEqual({ status: 'completed', credited: false, amountCents: DRIVE_QUEST_PAYOUT_CENTS.toString() });
  });

  it('pays a positive cheque', () => {
    expect(DRIVE_QUEST_PAYOUT_CENTS).toBeGreaterThan(0n);
  });
});

describe('driveQuestState (wire cm → verified state)', () => {
  it('converts the peer pose from centimetres to metres before measuring the escape distance', () => {
    // player at (20000cm, -10000cm) = (200m, -100m); protester at (150m, -100m) → 50 m away.
    const state = driveQuestState({ x: 20_000, z: -10_000 }, true, { x: 150, z: -100 }, 1_000, 31_000);
    expect(state.distFromProtesterM).toBeCloseTo(50, 6);
    expect(state.elapsedMs).toBe(30_000);
    expect(state.inVehicle).toBe(true);
  });
  it('passes the on-foot flag straight through (on foot never escapes)', () => {
    expect(driveQuestState({ x: 0, z: 0 }, false, { x: 0, z: 0 }, 0, 0).inVehicle).toBe(false);
  });
});
