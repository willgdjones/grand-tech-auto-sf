import { expect, test, vi } from 'vitest';
import { CELEB_NPCS, celebChequeCents } from '@gtasf/shared/content/celebs';
import type { PitchResult } from '../render/angelInvestors';
import { createAngelPitch } from './angelPitch';

function pitchResult(index = 0): PitchResult {
  const npc = CELEB_NPCS[index]!;
  return { npc, firstTime: true, line: npc.line, chequeCents: celebChequeCents(npc.id) };
}
type Reply = { firstTime: boolean; pitchedIds: string[] };
function deferred() {
  let resolve!: (value: Reply) => void, reject!: (error: unknown) => void;
  const promise = new Promise<Reply>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup(pitchCelebrity: (id: string) => Promise<Reply>) {
  let ids: string[] = [];
  const persist = vi.fn(), onReply = vi.fn(), onError = vi.fn();
  const controller = createAngelPitch({
    angels: { pitchedIds: () => ids, setPitched: value => { ids = [...value]; } },
    funding: { pitchCelebrity }, persist, onReply, onError,
  });
  return { controller, persist, onReply, onError, ids: () => ids };
}

test('a failed pitch stays retryable; repeated E waits for one confirmed cheque', async () => {
  const result = pitchResult(), first = deferred(), retry = deferred();
  const request = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise);
  const view = setup(request);
  const a = view.controller.pitch(result), b = view.controller.pitch(result);
  await Promise.resolve();
  expect(request).toHaveBeenCalledTimes(1);
  expect(view.ids()).toEqual([]);
  expect(view.persist).not.toHaveBeenCalled();
  expect(view.onReply).not.toHaveBeenCalled();
  first.reject(new TypeError('Failed to fetch'));
  await Promise.all([a, b]);
  expect(view.ids()).toEqual([]);
  expect(view.onError).toHaveBeenCalledWith('Pitch could not connect. Press E to try again.');
  const c = view.controller.pitch(result);
  await Promise.resolve();
  expect(request).toHaveBeenCalledTimes(2);
  retry.resolve({ firstTime: true, pitchedIds: [result.npc.id] });
  await c;
  expect(view.ids()).toEqual([result.npc.id]);
  expect(view.persist).toHaveBeenCalledExactlyOnceWith([result.npc.id]);
  expect(view.onReply).toHaveBeenCalledExactlyOnceWith(result, true);
});

test('out-of-order confirmations keep both investors and replay adds no new award', async () => {
  const first = pitchResult(), second = pitchResult(1), a = deferred(), b = deferred();
  const view = setup(vi.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise));
  const requestA = view.controller.pitch(first), requestB = view.controller.pitch(second);
  await Promise.resolve();
  b.resolve({ firstTime: true, pitchedIds: [first.npc.id, second.npc.id] });
  await requestB;
  a.resolve({ firstTime: false, pitchedIds: [first.npc.id] });
  await requestA;
  expect(new Set(view.ids())).toEqual(new Set([first.npc.id, second.npc.id]));
  expect(view.onReply).toHaveBeenLastCalledWith(first, false);
  expect(view.onError).not.toHaveBeenCalled();
});

test('unconfirmed replies and closed sessions never persist a pitch', async () => {
  const result = pitchResult(), late = deferred();
  const view = setup(vi.fn().mockResolvedValueOnce({ firstTime: false, pitchedIds: [] }).mockReturnValueOnce(late.promise));
  await view.controller.pitch(result);
  expect(view.onError).toHaveBeenCalledWith('Pitch not confirmed. Press E to try again.');
  const pending = view.controller.pitch(result);
  await Promise.resolve();
  view.controller.dispose();
  late.resolve({ firstTime: true, pitchedIds: [result.npc.id] });
  await pending;
  expect(view.ids()).toEqual([]);
  expect(view.persist).not.toHaveBeenCalled();
  expect(view.onReply).not.toHaveBeenCalled();
});

test('blocked browser storage does not turn a confirmed cheque into a failed pitch', async () => {
  const result = pitchResult();
  const view = setup(vi.fn().mockResolvedValue({ firstTime: true, pitchedIds: [result.npc.id] }));
  view.persist.mockImplementation(() => { throw new DOMException('Storage blocked', 'SecurityError'); });
  await view.controller.pitch(result);
  expect(view.ids()).toEqual([result.npc.id]);
  expect(view.onReply).toHaveBeenCalledExactlyOnceWith(result, true);
  expect(view.onError).not.toHaveBeenCalled();
});
