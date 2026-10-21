import { frameStats } from './core';
import type { Scenario } from './core';

export const scenarios: Readonly<Record<string, Scenario>> = {
  async smoke(t) {
    await t.frames(2);
    t.assert(t.state.ready && t.state.frame >= 2, 'Game must render and advance after READY');
  },
  async input(t) {
    const input = t.state.input;
    if (!input) throw new Error('Unified input must be enabled');
    try {
      input.virtual = { move: { x: .5, y: 1 }, throttle: .75, actions: ['enter-exit', 'hail', 'map', 'horn', 'handbrake'] };
      await t.frames(1);
      t.assert(input.move.y > 0 && input.throttle === .75 && input.steer === .5, 'Virtual axes must reach the mounted input');
      t.assert(input.pressed('hail') && input.pressed('enter-exit') && input.held('handbrake'), 'Action rising edges must fire');
      await t.frames(1);
      t.assert(!input.pressed('hail') && input.held('hail'), 'Held actions must not retrigger');
      input.virtual = {};
      await t.frames(1);
      t.assert(!input.held('hail') && input.move.y === 0 && input.throttle === 0, 'Virtual neutral must release all controls');
    } finally { input.virtual = null; }
  },
  async 'phone-perf'(t) {
    t.assert(!t.state.capture, 'Performance must use the real clock');
    const input = t.state.input;
    if (!input) throw new Error('Performance scenario requires unified input');
    try {
      input.virtual = { move: { x: 0, y: 1 }, actions: ['run'] };
      await t.until(() => t.state.perf.samples.length >= 120);
      const stats = frameStats(t.state.perf.samples);
      t.state.detail = JSON.stringify(stats);
      t.assert(stats.count >= 60, `Need >=60 frame samples; got ${stats.count}`);
      t.assert(stats.meanFps >= 60 && stats.p95Ms <= 25, `Phone performance budget failed: ${JSON.stringify(stats)}`);
    } finally { input.virtual = null; }
  },
};
