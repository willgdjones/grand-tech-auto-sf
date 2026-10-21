// Narrow adaptation of WebStarter src/factory/core.js: clock, loop, markers and wall-frame sampling.
import type { Input } from '../input/input';

export interface FrameStats { count: number; meanMs: number; meanFps: number; p95Ms: number; maxMs: number }
export function frameStats(samples: readonly number[]): FrameStats {
  if (!samples.length || samples.some(n => !Number.isFinite(n) || n <= 0)) throw new Error('Frame samples must be positive wall intervals');
  const sorted = [...samples].sort((a, b) => a - b), meanMs = samples.reduce((sum, n) => sum + n, 0) / samples.length;
  return { count: samples.length, meanMs, meanFps: 1000 / meanMs, p95Ms: sorted[Math.ceil(sorted.length * .95) - 1]!, maxMs: sorted[sorted.length - 1]! };
}
export class FrameSampler {
  readonly samples: number[] = [];
  private last: number | undefined;
  constructor(private readyAt: number, readonly warmupMs = 2000) {}
  observe(now: number): void {
    // Both endpoints must be after warmup. Never clamp, trim or hide slow intervals.
    if (this.last !== undefined && this.last >= this.readyAt + this.warmupMs && now > this.last) this.samples.push(now - this.last);
    this.last = now;
  }
}
export interface HarnessState {
  ready: boolean; status: 'idle' | 'running' | 'passed' | 'failed'; name: string; detail: string;
  frame: number; seconds: number; capture: boolean; errors: string[];
  perf: { samples: number[]; warmupMs: number };
  input?: Input; world?: unknown;
  step(count?: number): Promise<number>;
}
declare global { interface Window { __gtasf?: HarnessState } }
export interface GameHooks {
  input?: Input; world?: unknown;
  /** Asset readiness may delay recording in wall time without advancing its fixed clock. */
  prepare?(dt: number, now: number): Promise<void>;
  update(dt: number, now: number): void;
  render(): void;
}
export interface ScenarioContext {
  state: HarnessState;
  assert(condition: unknown, detail: string): void;
  frames(count: number): Promise<void>;
  until(predicate: () => boolean, maxFrames?: number): Promise<void>;
}
export type Scenario = (context: ScenarioContext) => void | Promise<void>;

/** No alternate scene, saves, assets or production bypasses: scenarios exercise the mounted game. */
export function createHarness(params = new URLSearchParams(location.search)) {
  const capture = params.get('capture') === '1';
  const requested = Number(params.get('fps'));
  const fps = Number.isFinite(requested) && requested >= 1 ? Math.min(240, requested) : 20;
  const scenario = params.get('test');
  const state: HarnessState = {
    ready: false, status: scenario !== null ? 'running' : 'idle', name: scenario || 'Runtime', detail: '',
    frame: 0, seconds: 0, capture, errors: [], perf: { samples: [], warmupMs: 2000 },
    step: async () => { throw new Error('Harness has not started'); },
  };
  window.__gtasf = state;
  let game: GameHooks | undefined, raf = 0, disposed = false, started = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const originalError = console.error;
  const log = (line: string) => console.log(line);
  const fail = (detail: string) => {
    state.errors.push(detail);
    if (state.status !== 'failed') log(`TEST_FAILED:${state.name}`);
    state.status = 'failed'; state.detail = detail;
    if (timeout) clearTimeout(timeout);
  };
  const consoleError: typeof console.error = (...args: unknown[]) => {
    originalError.apply(console, args);
    fail(`console.error: ${args.map(value => value instanceof Error ? value.message : String(value)).join(' ')}`);
  };
  console.error = consoleError;
  const onError = (event: ErrorEvent) => fail(event.message || 'Uncaught browser error');
  const onRejection = (event: PromiseRejectionEvent) => fail(`Unhandled rejection: ${String(event.reason)}`);
  window.addEventListener('error', onError); window.addEventListener('unhandledrejection', onRejection);
  const draw = () => { try { game!.render(); } catch (error) { fail(String(error)); throw error; } };
  const tick = (dt: number, now: number) => {
    game!.update(dt, now); state.seconds += dt; state.frame++;
    draw(); for (const listener of [...listeners]) listener();
  };
  let stepping = false;
  state.step = async (count = 1) => {
    if (!capture) throw new Error('step() requires ?capture=1');
    if (!started || disposed) throw new Error('Harness is not running');
    if (!Number.isInteger(count) || count < 1 || count > 10_000) throw new Error('step count must be 1..10000');
    if (stepping) throw new Error('Concurrent capture steps are not allowed');
    stepping = true;
    try {
      for (let i = 0; i < count; i++) {
        const now = (state.seconds + 1 / fps) * 1000;
        await game!.prepare?.(1 / fps, now);
        tick(1 / fps, now);
      }
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      return state.frame;
    } catch (error) { fail(String(error)); throw error; }
    finally { stepping = false; }
  };
  const context: ScenarioContext = {
    state,
    assert(condition, detail) { if (!condition) throw new Error(detail); },
    async frames(count) {
      if (capture) { await state.step(count); return; }
      const target = state.frame + count;
      await new Promise<void>(resolve => { const listener = () => { if (state.frame >= target) { listeners.delete(listener); resolve(); } }; listeners.add(listener); });
    },
    async until(predicate, maxFrames = 1800) {
      for (let i = 0; i < maxFrames; i++) { if (predicate()) return; await context.frames(1); }
      throw new Error('Scenario frame limit exceeded');
    },
  };
  return {
    state,
    fail,
    run(hooks: GameHooks, scenarios: Readonly<Record<string, Scenario>> = {}): void {
      if (started) throw new Error('Harness already started');
      started = true; game = hooks; state.input = hooks.input; state.world = hooks.world;
      draw(); state.ready = true; log('READY');
      const sampler = new FrameSampler(performance.now()); state.perf.samples = sampler.samples;
      const record = params.has('perf') || scenario === 'phone-perf';
      if (!capture) {
        let last = performance.now();
        const loop = (now: number) => {
          if (disposed) return;
          if (record && state.status !== 'passed' && state.status !== 'failed') sampler.observe(now);
          const dt = Math.min(.1, Math.max(0, (now - last) / 1000)); last = now;
          try { tick(dt, now); } catch (error) { fail(String(error)); return; }
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      }
      if (scenario !== null) {
        timeout = setTimeout(() => fail('Scenario timed out after 30 seconds'), 30_000);
        // Readiness is always observable before a test result, including unknown scenarios.
        void Promise.resolve().then(async () => {
          const execute = scenarios[scenario];
          if (!execute) throw new Error(`Unknown scenario: ${scenario}`);
          await execute(context);
          if (!disposed && state.status !== 'failed') { state.status = 'passed'; log(`TEST_PASSED:${state.name}`); }
        }).catch(error => fail(String(error))).finally(() => { if (timeout) clearTimeout(timeout); });
      }
    },
    dispose(): void {
      disposed = true; cancelAnimationFrame(raf); if (timeout) clearTimeout(timeout); listeners.clear();
      window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection);
      if (console.error === consoleError) console.error = originalError;
      if (window.__gtasf === state) delete window.__gtasf;
    },
  };
}
