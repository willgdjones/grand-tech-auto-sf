import { describe, expect, it, vi } from 'vitest';
import { timeTrialById } from '@gtasf/shared/founder/timeTrials';
import { runTimeTrialSubmit, type TimeTrialBoardDeps } from './timeTrialBoard';

const lombard = timeTrialById('lombard-switchbacks')!; // 1 checkpoint + finish => 2 splits, minMs 28_000 (~0.7× par)
const good = { totalMs: 30_000, splits: [12_000, 30_000] };

function deps(over: Partial<TimeTrialBoardDeps> = {}): TimeTrialBoardDeps & { readBest: ReturnType<typeof vi.fn>; writeBest: ReturnType<typeof vi.fn> } {
  const readBest = vi.fn(async () => null as number | null);
  const writeBest = vi.fn(async () => {});
  return { readBest, writeBest, ...over } as never;
}

describe('runTimeTrialSubmit', () => {
  it('rejects a submission the server could not place at the finish (anti-spoof)', async () => {
    const d = deps();
    expect(await runTimeTrialSubmit(lombard, good, false, d)).toEqual({ status: 'rejected', reason: 'not-at-finish' });
    expect(d.readBest).not.toHaveBeenCalled();
    expect(d.writeBest).not.toHaveBeenCalled();
  });

  it('rejects an implausible (teleport-speed) run without touching the board', async () => {
    const d = deps();
    const out = await runTimeTrialSubmit(lombard, { totalMs: 5_000, splits: [2_000, 5_000] }, true, d);
    expect(out).toEqual({ status: 'rejected', reason: 'implausible-time' });
    expect(d.writeBest).not.toHaveBeenCalled();
  });

  it('rejects a malformed splits list (wrong count) without touching the board', async () => {
    const d = deps();
    const out = await runTimeTrialSubmit(lombard, { totalMs: 30_000, splits: [30_000] }, true, d);
    expect(out).toEqual({ status: 'rejected', reason: 'split-count' });
    expect(d.writeBest).not.toHaveBeenCalled();
  });

  it('records a first run as a new best', async () => {
    const d = deps();
    const out = await runTimeTrialSubmit(lombard, good, true, d);
    expect(out).toEqual({ status: 'recorded', best: true, totalMs: 30_000, rank: null });
    expect(d.writeBest).toHaveBeenCalledWith(30_000);
  });

  it('replaces the stored best only when faster', async () => {
    const d = deps({ readBest: vi.fn(async () => 35_000) });
    const out = await runTimeTrialSubmit(lombard, good, true, d); // 30s beats 35s
    expect(out).toMatchObject({ status: 'recorded', best: true, totalMs: 30_000 });
    expect(d.writeBest).toHaveBeenCalledWith(30_000);
  });

  it('keeps the stored best (no write) for a slower run and reports the existing time', async () => {
    const d = deps({ readBest: vi.fn(async () => 25_000) });
    const out = await runTimeTrialSubmit(lombard, good, true, d); // 30s is slower than 25s
    expect(out).toMatchObject({ status: 'recorded', best: false, totalMs: 25_000 });
    expect(d.writeBest).not.toHaveBeenCalled();
  });

  it('passes the computed rank through when a ranker is provided', async () => {
    const d = deps({ rankOf: vi.fn(async () => 3) });
    const out = await runTimeTrialSubmit(lombard, good, true, d);
    expect(out).toEqual({ status: 'recorded', best: true, totalMs: 30_000, rank: 3 });
  });
});
