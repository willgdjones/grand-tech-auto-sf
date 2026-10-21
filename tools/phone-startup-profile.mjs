/** Diagnostic only: profiles frozen phone startup. Never a phone FPS/device acceptance run. */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { platform } from 'node:os';
import { chromium } from '@playwright/test';
import { preview } from 'vite';
import { startLocalPool } from './local-pool/pool.mjs';

const app = resolve(process.env.GTASF_PHONE_APP ?? 'artifacts/phone-d6/phone-c8sj-after/app');
const out = resolve(process.env.GTASF_STARTUP_OUT ?? 'docs/perf/phone-c8sj-startup');
const readyTimeoutMs = Number(process.env.GTASF_STARTUP_TIMEOUT_MS ?? 45000);
if (!Number.isFinite(readyTimeoutMs) || readyTimeoutMs < 1000 || readyTimeoutMs > 180000) throw Error('Invalid diagnostic timeout');
await mkdir(out, { recursive: true });
const report = { diagnosticOnly: true, app, startedAt: new Date().toISOString(),
  config: { viewport: { width: 1080, height: 2400 }, deviceScaleFactor: 2.75, cpuThrottle: 4, preset: 'low', readyTimeoutMs },
  requests: [], errors: [], milestones: [], ready: false };
async function bounded(promise, ms, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(Error(`${label} timeout`)), ms);
  })]); } finally { clearTimeout(timer); }
}
const stateExpression = `JSON.stringify({
  harness:window.__gtasf ? {ready:window.__gtasf.ready,frame:window.__gtasf.frame,status:window.__gtasf.status,errors:window.__gtasf.errors}:null,
  loading:document.querySelector('#loading-detail')?.textContent,
  loadingHidden:document.querySelector('#loading')?.hidden,
  connection:document.querySelector('#connection')?.textContent,
  canvas:{...document.querySelector('#world')?.dataset},
  dialogs:[...document.querySelectorAll('dialog[open]')].map(d=>({label:d.getAttribute('aria-label'),text:d.textContent.slice(0,300)})),
  intro:Boolean(document.querySelector('.gt-sa-intro')), visibility:document.visibilityState
})`;
let pool, server, browser, cdp, profiling = false, paused = false;
try {
  pool = await startLocalPool();
  server = await preview({ root: resolve('web'), configFile: resolve('web/vite.config.ts'), build: { outDir: app },
    preview: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: pool.url.origin, ws: true } } } });
  browser = await chromium.launch({ headless: true, args: [
    ...(platform() === 'darwin' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : []),
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  ] });
  const page = await browser.newPage({ viewport: report.config.viewport,
    deviceScaleFactor: report.config.deviceScaleFactor, isMobile: true, hasTouch: true });
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('crash', () => report.errors.push('Page crashed'));
  page.on('console', message => {
    if (message.type() === 'error') report.errors.push(message.text());
    if (message.text() === 'READY' || message.text().startsWith('TEST_')) report.milestones.push(message.text());
  });
  const pending = new Map();
  page.on('request', request => {
    const entry = { path: new URL(request.url()).pathname, startedAt: Date.now() };
    pending.set(request, entry); report.requests.push(entry);
  });
  page.on('response', response => {
    const entry = pending.get(response.request());
    if (entry) { entry.status = response.status(); entry.responseAt = Date.now(); }
  });
  page.on('requestfinished', request => { const entry = pending.get(request); if (entry) entry.finishedAt = Date.now(); pending.delete(request); });
  page.on('requestfailed', request => { const entry = pending.get(request); if (entry) entry.failure = request.failure()?.errorText; pending.delete(request); });
  cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Debugger.enable');
  let pauseEvent;
  const whenPaused = new Promise(resolve => { pauseEvent = resolve; });
  cdp.on('Debugger.paused', event => { paused = true; pauseEvent(event); });
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.start'); profiling = true;
  const url = new URL(server.resolvedUrls.local[0]); url.searchParams.set('preset', 'low'); report.url = url.href;
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  try {
    await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.ready === 'true',
      null, { timeout: readyTimeoutMs });
    report.ready = true;
  } catch (error) { report.readyFailure = String(error); }
  if (!report.ready) {
    try {
      await bounded(cdp.send('Debugger.pause'), 5000, 'Pause command');
      const event = await bounded(whenPaused, 5000, 'Paused stack');
      report.stack = event.callFrames.map(frame => ({ name: frame.functionName, url: frame.url, location: frame.location }));
      if (event.callFrames[0]) {
        const value = await bounded(cdp.send('Debugger.evaluateOnCallFrame', {
          callFrameId: event.callFrames[0].callFrameId, expression: stateExpression, returnByValue: true,
        }), 5000, 'Paused state');
        if (value.result.value) report.state = JSON.parse(value.result.value);
      }
    } catch (error) { report.pauseFailure = String(error); }
  } else report.state = JSON.parse(await page.evaluate(stateExpression));
  try {
    const result = await bounded(cdp.send('Profiler.stop'), 10000, 'Startup profile'); profiling = false;
    await writeFile(`${out}/startup.cpuprofile`, JSON.stringify(result.profile));
  } catch (error) { report.profileFailure = String(error); }
  if (paused) { await cdp.send('Debugger.resume'); paused = false; }
  await page.screenshot({ path: `${out}/startup.png`, timeout: 5000, scale: 'css' })
    .catch(error => { report.screenshotFailure = String(error); });
  report.pending = [...pending.values()].map(entry => entry.path);
} catch (error) { report.failure = error.stack ?? String(error); process.exitCode = 1; }
finally {
  if (paused) await cdp?.send('Debugger.resume').catch(() => {});
  if (profiling) await bounded(cdp.send('Profiler.stop'), 5000, 'Cleanup profiler').catch(() => {});
  await browser?.close();
  if (server) { server.httpServer.closeAllConnections(); await new Promise(done => server.httpServer.close(done)); }
  await pool?.close(); report.finishedAt = new Date().toISOString();
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ out, ready: report.ready, state: report.state, stack: report.stack,
    failure: report.failure, pauseFailure: report.pauseFailure, profileFailure: report.profileFailure }, null, 2));
}
