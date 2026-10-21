import { describe, expect, it, vi } from 'vitest';
import { VoiceGrantHandoffs } from './grants';

const track = (name: string) => ({ sessionId: 'session', trackName: name });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe('voice grant handoffs', () => {
  it('persists before notifying and coalesces superseded writes without stale notifications', async () => {
    const first = deferred(), last = deferred();
    const persist = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(last.promise);
    const queue = new VoiceGrantHandoffs(persist), old = vi.fn(), skipped = vi.fn(), current = vi.fn();
    queue.replace('device', 1, [track('old')], old);
    const work = queue.flush();
    queue.replace('device', 1, [track('skipped')], skipped);
    queue.replace('device', 1, [track('current')], current);
    expect(queue.flush()).toHaveLength(0);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(old).not.toHaveBeenCalled();
    first.resolve();
    await Promise.resolve();
    expect(persist).toHaveBeenLastCalledWith('device', [track('current')]);
    expect(current).not.toHaveBeenCalled();
    last.resolve();
    await Promise.all(work);
    expect(old).not.toHaveBeenCalled();
    expect(skipped).not.toHaveBeenCalled();
    expect(current).toHaveBeenCalledOnce();
  });

  it('retries a failed unchanged set on a later tick without notifying early', async () => {
    const persist = vi.fn().mockRejectedValueOnce(new Error('D1 unavailable')).mockResolvedValue(undefined);
    const queue = new VoiceGrantHandoffs(persist), notify = vi.fn();
    queue.replace('device', 1, [track('a')], notify);
    await Promise.all(queue.flush());
    expect(notify).not.toHaveBeenCalled();
    expect(queue.flush(0)).toHaveLength(0);
    await Promise.all(queue.flush(Date.now() + 2_000));
    expect(persist).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledOnce();
  });

  it('unions same-device tabs and orders disconnect revocation after an in-flight grant', async () => {
    const first = deferred(), persist = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    const queue = new VoiceGrantHandoffs(persist), closed = vi.fn(), remaining = vi.fn();
    queue.replace('device', 1, [track('a')], closed);
    queue.replace('device', 2, [track('b')], remaining);
    const work = queue.flush();
    expect(persist).toHaveBeenCalledWith('device', [track('a'), track('b')]);
    queue.remove('device', 1);
    first.resolve();
    await Promise.all(work);
    expect(persist).toHaveBeenLastCalledWith('device', [track('b')]);
    expect(closed).not.toHaveBeenCalled();
    expect(remaining).toHaveBeenCalledOnce();
    queue.remove('device', 2);
    await Promise.all(queue.flush());
    expect(persist).toHaveBeenLastCalledWith('device', []);
  });
});
