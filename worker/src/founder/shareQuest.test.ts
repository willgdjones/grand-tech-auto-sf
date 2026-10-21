import { describe, expect, it, vi } from 'vitest';
import type { MemeNpcSpec } from '@gtasf/shared/founder/memeQuests';
import { SHARE_QUEST_PAYOUT_CENTS, shareQuestCredit, runShareQuest, type ShareQuestDeps } from './shareQuest';

const shareNpc: MemeNpcSpec = {
  id: 'thought-leader', archetype: 'A thought leader', persona: '',
  hook: '"REPOST MY TAKE"', questKind: 'share',
  target: { lat: 37.795, lon: -122.394 }, face: { lat: 37.795, lon: -122.394 },
  look: { sex: 'female', archetype: 'growth', outfit: 0, accessory: 0 },
};
const driveNpc: MemeNpcSpec = { ...shareNpc, id: 'not-a-share', questKind: 'drive' };

function deps(over: Partial<ShareQuestDeps> = {}): ShareQuestDeps & { credited: ReturnType<typeof vi.fn>; award: ReturnType<typeof vi.fn> } {
  const credited = vi.fn(async () => false);
  const award = vi.fn(async () => ({ credited: true }));
  return { credited, award, ...over } as never;
}

describe('runShareQuest', () => {
  it('pays a share claim once, with an ONCE-EVER (no-day) celebrity ref', async () => {
    const d = deps();
    const out = await runShareQuest(shareNpc, d);
    expect(out).toEqual({ status: 'completed', credited: true, amountCents: SHARE_QUEST_PAYOUT_CENTS.toString() });
    const { source, sourceRef } = shareQuestCredit(shareNpc.id);
    expect(source).toBe('celebrity');
    expect(sourceRef).toBe(`meme:share:${shareNpc.id}`);
    expect(sourceRef).not.toMatch(/:\d{4}-\d{2}-\d{2}$/); // no day component → once-ever, not per-day
    expect(d.award).toHaveBeenCalledOnce();
    expect(d.award.mock.calls[0]![0]).toMatchObject({ source, sourceRef, amountCents: SHARE_QUEST_PAYOUT_CENTS.toString() });
  });

  it('blocks a second claim of the same share NPC (once-ever) without awarding again', async () => {
    const d = deps({ credited: vi.fn(async () => true) });
    expect(await runShareQuest(shareNpc, d)).toEqual({ status: 'blocked', reason: 'already-claimed' });
    expect(d.award).not.toHaveBeenCalled();
  });

  it('never pays a non-share NPC through this route', async () => {
    const d = deps();
    expect(await runShareQuest(driveNpc, d)).toEqual({ status: 'ineligible' });
    expect(d.award).not.toHaveBeenCalled();
    expect(d.credited).not.toHaveBeenCalled();
  });

  it('reports credited:false if the ledger loses a write race (still completed, not double-counted)', async () => {
    const d = deps({ award: vi.fn(async () => ({ credited: false })) });
    expect(await runShareQuest(shareNpc, d)).toEqual({ status: 'completed', credited: false, amountCents: SHARE_QUEST_PAYOUT_CENTS.toString() });
  });

  it('pays a small positive cheque, below the server-verified drive quest', async () => {
    const { DRIVE_QUEST_PAYOUT_CENTS } = await import('./driveQuest');
    expect(SHARE_QUEST_PAYOUT_CENTS).toBeGreaterThan(0n);
    expect(SHARE_QUEST_PAYOUT_CENTS).toBeLessThan(DRIVE_QUEST_PAYOUT_CENTS);
  });
});
