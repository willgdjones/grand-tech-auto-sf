import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// gtasf-bigk: force the flag on so the smoke test verifies the graph actually builds (not the disabled no-op).
vi.mock('@gtasf/shared/flags', async orig => {
  const actual = await orig<typeof import('@gtasf/shared/flags')>();
  return { ...actual, flags: { ...actual.flags, proceduralSfx: true } };
});

/**
 * Minimal headless Web Audio mock. Every node supports the param/method shapes the procedural voices use,
 * and `connect` returns its destination so `a.connect(b).connect(c)` chains work. Records how many nodes
 * were created so the test can assert a real graph was built (the AudioContext graph builds without errors).
 */
function installAudioMock() {
  const created = { gain: 0, osc: 0, source: 0, filter: 0, buffer: 0, connects: 0, starts: 0, contexts: 0 };
  const param = () => {
    const p: Record<string, unknown> = { value: 0 };
    for (const m of ['setValueAtTime', 'exponentialRampToValueAtTime', 'linearRampToValueAtTime', 'setTargetAtTime', 'cancelScheduledValues']) p[m] = () => p;
    return p;
  };
  const node = () => {
    const n: Record<string, unknown> = {
      connect: (dest: unknown) => { created.connects++; return dest ?? n; }, disconnect() {},
      start: () => { created.starts++; }, stop() {},
      gain: param(), frequency: param(), Q: param(), detune: param(), pan: param(), playbackRate: param(),
      type: 'sine', loop: false, buffer: null,
    };
    return n;
  };
  class MockAudioContext {
    state = 'running'; currentTime = 0; sampleRate = 48000; destination = node();
    constructor() { created.contexts++; }
    createGain() { created.gain++; return node(); }
    createOscillator() { created.osc++; return node(); }
    createBufferSource() { created.source++; return node(); }
    createBiquadFilter() { created.filter++; return node(); }
    createStereoPanner() { return node(); }
    createBuffer(_channels: number, length: number) { created.buffer++; return { getChannelData: () => new Float32Array(length) }; }
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
  }
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = MockAudioContext;
  return created;
}

describe('procedural SFX build headlessly without errors (gtasf-bigk)', () => {
  let created: ReturnType<typeof installAudioMock>;
  beforeEach(() => { vi.resetModules(); created = installAudioMock(); });
  afterEach(() => { delete (globalThis as unknown as { AudioContext?: unknown }).AudioContext; });

  it('footsteps + ambience + cha-ching graph builds and tears down cleanly', async () => {
    const { createProceduralSfx } = await import('./sfx');
    const sfx = createProceduralSfx({ enabled: true });
    expect(sfx).not.toBeNull();
    expect(() => {
      // First movement activates the context; drive a couple of seconds of frames for ambience + footsteps.
      for (let i = 0; i < 60; i++) sfx!.update({ x: 0, z: 0, speed: 2.6, mode: 'on-foot', dt: 1 / 30 });
      sfx!.footstep(.3);
      sfx!.chaChing();        // the new cheque voice
      sfx!.chaChing(.9);
      sfx!.update({ x: 0, z: 0, speed: 22, mode: 'driving', dt: 1 / 30 }); // vehicle: ambience ducks
      sfx!.destroy();
      sfx!.update({ x: 0, z: 0, speed: 3, mode: 'on-foot', dt: 1 / 30 }); // no-op after destroy
    }).not.toThrow();
    expect(created.contexts).toBe(1);        // one shared AudioContext
    expect(created.gain).toBeGreaterThan(0); // master + per-voice gains
    expect(created.osc).toBeGreaterThan(0);  // ambience drone + cha-ching dings
    expect(created.source).toBeGreaterThan(0); // footstep + ambience buffers
    expect(created.connects).toBeGreaterThan(0);
    expect(created.starts).toBeGreaterThan(0);
  });

  it('disabled (no flag/enabled:false) returns null and builds nothing', async () => {
    const { createProceduralSfx } = await import('./sfx');
    expect(createProceduralSfx({ enabled: false })).toBeNull();
    expect(created.contexts).toBe(0);
  });

  it('one-shot crunch and splat voices build without errors', async () => {
    const { playCrunch } = await import('./crunch');
    const { playSplat } = await import('./splat');
    expect(() => { playCrunch(.8); playCrunch(.1); playSplat(); playSplat(.9); }).not.toThrow();
    expect(created.gain).toBeGreaterThan(0);
    expect(created.osc).toBeGreaterThan(0);
    expect(created.connects).toBeGreaterThan(0);
  });
});
