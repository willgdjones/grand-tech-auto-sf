# Browser harness

This is a narrow adaptation of WebStarter's core loop/clock/marker pattern. It runs the actual mounted GTASF update and renderer. No alternate test scene, art, audio, storage, or network bypass is included.

When `flags.testingHarness` is enabled, `window.__gtasf` exposes readiness, status, frame/seconds, input, world inspection and `perf.samples`. The first rendered frame emits `READY`. `?test=smoke`, `?test=input`, and `?test=phone-perf` run registered scenarios and emit `TEST_PASSED:Name` or `TEST_FAILED:Name`. Unknown scenarios, console errors, uncaught exceptions and unhandled rejections fail. Register additional named scenarios in `scenarios.ts`.

`?capture=1` disables autonomous simulation ticks. `await window.__gtasf.step(n)` advances exactly n frames at `1/fps` seconds (default 20 fps, configurable with `?fps=60`), then waits for paint. Network state remains real; the fixed clock governs simulation updates, not a replacement server. Capture generates no synthetic performance samples.

`?perf=1` records real requestAnimationFrame intervals after two seconds of wall-clock warmup. The phone scenario holds forward/run input through 120 samples, then checks mean fps (`1000 / mean frame ms`) >=60 and nearest-rank p95 <=25 ms. No long-frame filtering, interval clamping or retries make a failed run pass.

Run against current one-shot web and Worker bundles (the existing `tools/preview.mjs` serves both without watchers):

```sh
nice -n 10 npm run build -w @gtasf/web
nice -n 10 npx playwright test --config web/playwright.config.ts web/tests/input-harness.spec.ts
nice -n 10 npx playwright test --config web/playwright.config.ts web/tests/phone-perf.spec.ts
```

The Worker bundle must already be current at `worker/.wrangler/bootstrap-worker/index.js`; coordinate with its owner before regenerating it. For an existing staging/preview deployment, set `GTASF_TEST_URL` instead. Each local run owns port 4173 and closes its preview afterward. Only one browser worker is used. The phone check explicitly sets a 1080x2400 **CSS viewport** at DPR 2.75 and applies 4x CPU throttling. It records raw timings and configuration in `phone-performance.json`, even on a budget failure. Saturated-host results remain failures, not real-device acceptance.
