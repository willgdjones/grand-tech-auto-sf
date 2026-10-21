/** One real H/tap/cancel/reconnect smoke against the already-running playable build. */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

/** Reuse an existing browser page after its other checks; navigates it to the Ferry spawn. */
export async function checkTaxiRecovery(page, options = {}) {
  const url = options.url ?? process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173/';
  const out = options.out ?? 'artifacts/taxi-recovery';
  await mkdir(out, { recursive: true });
  const report = { url, checkedAt: new Date().toISOString(), errors: [], checkpoints: [] };
  const onPageError = error => report.errors.push(error.message);
  const onConsole = message => { if (message.type() === 'error') report.errors.push(message.text()); };
  try {
  page.setDefaultTimeout(60_000);
  page.on('pageerror', onPageError);
  page.on('console', onConsole);
  // This script owns only its browser's transport. No game hook or server shortcut is added.
  await page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    window.__taxiSmokeSockets = [];
    window.WebSocket = class extends NativeWebSocket {
      constructor(...args) {
        super(...args);
        if (new URL(String(args[0]), location.href).pathname === '/api/world') window.__taxiSmokeSockets.push(this);
      }
    };
  });
  await page.goto(url);
  await page.waitForSelector('#world[data-ready="true"][data-connected="true"]');
  await page.waitForSelector('#loading', { state: 'hidden' });
  const taxiState = expected => page.waitForFunction(value => document.querySelector('#world')?.dataset.taxiState === value, expected);
  const checkpoint = async name => {
    const state = await page.locator('#world').evaluate(canvas => ({ ...canvas.dataset }));
    const button = await page.locator('#hail').textContent();
    report.checkpoints.push({ name, state, button });
    console.log(`${name}: ${JSON.stringify({ state, button })}`);
    return state;
  };
  await page.keyboard.press('KeyH');
  await taxiState('pickup');
  const pickup = await checkpoint('pickup');
  assert.equal(pickup.mode, 'on-foot', 'Ferry pickup waits at the curb');
  assert.match(await page.locator('#hail').textContent(), /Cancel robotaxi/);
  await page.locator('#hail').click();
  await taxiState('cancelled');
  await checkpoint('tap-cancelled');
  await page.waitForTimeout(2100); // Respect the real server's two-second hail limit.
  await page.keyboard.press('KeyH');
  await taxiState('pickup');
  await checkpoint('pickup-before-disconnect');
  const connections = await page.evaluate(() => {
    const sockets = window.__taxiSmokeSockets;
    sockets.at(-1).close(4000, 'Client recovery smoke');
    return sockets.length;
  });
  await page.waitForFunction(count => window.__taxiSmokeSockets.length > count, connections);
  await page.waitForSelector('#world[data-connected="true"][data-taxi-state="idle"]');
  const resumed = await checkpoint('reconnected');
  assert.equal(resumed.mode, 'on-foot');
  assert.equal(resumed.vehicleId, '0');
  assert.match(await page.locator('#hail').textContent(), /Hail robotaxi/);
  assert.doesNotMatch(await page.locator('#trip-status').textContent(), /arriving|waiting at the curb|Robotaxi →/);
  await page.keyboard.press('KeyH');
  await taxiState('pickup');
  await checkpoint('new-pickup-after-reconnect');
  await page.keyboard.press('KeyH');
  await taxiState('cancelled');
  await checkpoint('keyboard-cancelled');
  await page.screenshot({ path: `${out}/recovered.png` });
  assert.deepEqual(report.errors, [], 'Console/page errors fail recovery acceptance');
  report.passed = true;
  return report;
  } catch (error) {
  report.failure = String(error);
  await page?.screenshot({ path: `${out}/failed.png` }).catch(() => {});
  throw error;
  } finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
  page.off('pageerror', onPageError); page.off('console', onConsole);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Headed Chromium uses the local GPU; software headless remains available explicitly.
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  try { await checkTaxiRecovery(await browser.newPage({ viewport: { width: 1280, height: 800 } })); }
  finally { await browser.close(); }
}
