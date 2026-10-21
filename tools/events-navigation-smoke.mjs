/** One real-input events/GPS smoke using a frozen web build and real local Worker. */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build, preview } from 'vite';

const out = 'artifacts/events-navigation';
await mkdir(out, { recursive: true });
const app = resolve(out, 'app'), configFile = resolve('web/vite.config.ts');
await build({ configFile, root: resolve('web'), logLevel: 'warn', build: { outDir: app, emptyOutDir: true, reportCompressedSize: false } });
const server = await preview({ configFile, root: resolve('web'), build: { outDir: app }, preview: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } } });
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const report = { checkedAt: new Date().toISOString(), url, errors: [], checks: [] };
let page;
const title = 'Rabbits on the Run'; // Real local-snapshot event, Oct 5, public Embarcadero area.
const eventId = 'tech-week:22eb5208-ca3b-4daf-93e1-65b4689f038b';
const recordErrors = target => {
  target.on('pageerror', error => report.errors.push(error.message));
  target.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
};
async function ready(target) {
  target.setDefaultTimeout(60_000); await target.goto(url);
  await target.waitForFunction(() => window.__gtasf?.ready && window.__gtasf.world.radar?.route);
  await target.waitForSelector('#world[data-connected="true"]');
}
async function selectRow(target, hail = false) {
  await target.getByRole('searchbox', { name: 'Search upcoming events' }).fill(title);
  const row = target.locator(`[data-event-id="${eventId}"]`); await row.waitFor();
  await row.getByRole('button', { name: hail ? 'Hail robotaxi to this event' : `Set destination: ${title}`, exact: true }).click();
  await target.waitForSelector('.gt-upcoming', { state: 'hidden' });
}
async function aim(target, point) {
  await target.evaluate(goal => {
    const w = window.__gtasf.world, heading = Math.atan2(goal.x - w.foot.x, goal.z - w.foot.z);
    w.foot.yaw = heading; w.camera.setOrbit(heading + Math.PI, w.camera.pitch);
  }, point);
  await target.keyboard.press('KeyC');
}
async function runTo(target, point, arrival = false) {
  await aim(target, point); await target.keyboard.down('Shift'); await target.keyboard.down('KeyW');
  try {
    await target.waitForFunction(({ point, arrival }) => {
      const w = window.__gtasf.world;
      return arrival ? !document.querySelector('.gt-event-card').hidden : Math.hypot(w.foot.x - point.x, w.foot.z - point.z) < 4;
    }, { point, arrival }, { timeout: 25_000 });
  } finally { await target.keyboard.up('KeyW'); await target.keyboard.up('Shift'); }
}
try {
  page = await browser.newPage({ viewport: { width: 1365, height: 900 } }); recordErrors(page); await ready(page);
  report.gpu = await page.evaluate(() => { const gl = document.querySelector('#world').getContext('webgl2'), info = gl.getExtension('WEBGL_debug_renderer_info'); return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); });
  await page.keyboard.press('KeyV'); await page.waitForSelector('.gt-upcoming-row');
  const panel = await page.locator('.gt-upcoming').evaluate(root => {
    const box = root.getBoundingClientRect(), header = root.querySelector('header').getBoundingClientRect();
    return { headerInside: header.x >= box.x && header.right <= box.right && header.y >= box.y, status: root.querySelector('[role=status]').textContent, tabs: [...root.querySelectorAll('[role=tab]')].map(tab => tab.textContent) };
  });
  assert.equal(panel.headerInside, true); report.checks.push({ name: 'V-real-calendar', panel });
  await page.screenshot({ path: `${out}/events-desktop.png` });
  for (const name of ['Live now', 'Today', 'Tomorrow', 'Tech Week']) {
    const tab = page.getByRole('tab', { name: new RegExp(`^${name}`) }); await tab.click(); assert.equal(await tab.getAttribute('aria-selected'), 'true');
  }
  await page.getByRole('button', { name: 'Close upcoming events' }).focus();
  const before = await page.evaluate(() => ({ ...window.__gtasf.world.foot }));
  await page.keyboard.down('KeyW'); await page.waitForTimeout(300); await page.keyboard.up('KeyW');
  const after = await page.evaluate(() => ({ ...window.__gtasf.world.foot }));
  assert.ok(Math.hypot(after.x - before.x, after.z - before.z) < .02, 'Open events panel suppresses walking');
  await selectRow(page);
  await page.waitForSelector('.gt-gps-status:not([hidden])');
  const route = await page.evaluate(() => {
    const w = window.__gtasf.world;
    window.__eventsInitialRoute = w.radar.route;
    return { foot: { ...w.foot }, approach: w.radar.route.approach, distance: w.radar.route.distanceM, points: w.radar.route.points.length,
      ribbonVertices: w.guidance.root.getObjectByName('GPS route ribbon').geometry.getAttribute('position').count,
      markerVisible: w.guidance.root.getObjectByName('GPS destination').visible, progress: w.guidance.progress };
  });
  assert.ok(route.points > 2 && route.ribbonVertices > 0 && route.markerVisible);
  assert.match(await page.locator('.gt-gps-status').innerText(), /min walk/);
  await aim(page, route.approach); await page.waitForTimeout(250); await page.screenshot({ path: `${out}/gps-ribbon-beam.png` });
  await page.keyboard.press('KeyM'); await page.waitForSelector('.gt-radar[data-expanded=true]');
  assert.match(await page.locator('.gt-radar-navigation').innerText(), new RegExp(title));
  await page.screenshot({ path: `${out}/map-route.png` }); await page.keyboard.press('Escape');
  await page.keyboard.press('KeyV'); await selectRow(page, true);
  await page.waitForFunction(() => ['pickup', 'riding'].includes(window.__gtasf.world.taxi.state));
  assert.equal(await page.evaluate(() => window.__gtasf.world.taxi.destinationTitle), title);
  report.checks.push({ name: 'event-row-hail', taxi: await page.locator('#world').evaluate(canvas => ({ ...canvas.dataset })) });
  await page.keyboard.press('KeyH');
  await page.waitForFunction(() => window.__gtasf.world.taxi.state === 'cancelled');
  // Choose a clear 42 m walk away from the old route, then use real keyboard movement.
  const deviation = await page.evaluate(() => {
    const w = window.__gtasf.world, start = { ...w.foot }, points = w.radar.route.points;
    window.__eventsInitialRoute = w.radar.route;
    const routeDistance = p => {
      let best = Infinity;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i], dx = b[0] - a[0], dz = b[2] - a[2], length = dx * dx + dz * dz;
        const t = length ? Math.max(0, Math.min(1, ((p.x - a[0]) * dx + (p.z - a[2]) * dz) / length)) : 0;
        best = Math.min(best, Math.hypot(p.x - a[0] - dx * t, p.z - a[2] - dz * t));
      }
      return best;
    };
    const choices = [];
    for (let i = 0; i < 32; i++) {
      const dx = Math.sin(i / 32 * Math.PI * 2), dz = Math.cos(i / 32 * Math.PI * 2);
      let clear = true;
      for (let step = 1; step <= 14; step++) {
        const x = start.x + dx * step * 3, z = start.z + dz * step * 3, y = w.map.surfaceHeightAt(x, z);
        if (y === null || w.map.collides(x, y, z, .4)) { clear = false; break; }
      }
      const point = { x: start.x + dx * 42, z: start.z + dz * 42 };
      if (clear && Math.hypot(point.x - w.radar.route.approach.x, point.z - w.radar.route.approach.z) > 25) choices.push({ point, origin: start, offset: routeDistance(point) });
    }
    return choices.sort((a, b) => b.offset - a.offset)[0];
  });
  assert.ok(deviation?.offset > 10, 'A clear walking departure from the route exists');
  await runTo(page, deviation.point);
  await page.waitForFunction(() => window.__gtasf.world.radar.route !== window.__eventsInitialRoute);
  report.checks.push({ name: 'source-road-route-and-off-route-recompute', route, deviation });
  await runTo(page, deviation.origin);
  await runTo(page, route.approach, true);
  assert.equal(await page.locator('.gt-event-title').innerText(), title);
  assert.match(await page.locator('#trip-status').innerText(), /ARRIVED/);
  await page.screenshot({ path: `${out}/event-arrival.png` });
  await page.keyboard.press('KeyV'); await page.waitForSelector('.gt-upcoming:not([hidden])');
  assert.equal(await page.locator('.gt-event-card').isVisible(), false, 'Opening events closes the arrival card');
  report.checks.push({ name: 'arrival-card-mission-and-modal-switch' });
  await page.close();
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  page = await mobile.newPage(); recordErrors(page); await ready(page);
  await page.locator('.gt-upcoming-open').tap(); await page.waitForSelector('.gt-upcoming-row');
  const mobileLayout = await page.locator('.gt-upcoming').evaluate(root => ({ left: root.getBoundingClientRect().left, right: root.getBoundingClientRect().right, width: innerWidth, focusedInside: root.contains(document.activeElement) }));
  assert.ok(mobileLayout.left >= 0 && mobileLayout.right <= mobileLayout.width && mobileLayout.focusedInside);
  await page.screenshot({ path: `${out}/events-mobile.png` });
  await selectRow(page); await page.waitForSelector('.gt-gps-status:not([hidden])');
  await page.screenshot({ path: `${out}/gps-mobile.png` });
  report.checks.push({ name: 'mobile-events-button-search-and-gps', mobileLayout });
  assert.deepEqual(report.errors, []); report.passed = true; console.log('TEST_PASSED:EventsNavigation');
} catch (error) {
  report.failure = String(error); await page?.screenshot({ path: `${out}/failed.png` }).catch(() => {}); throw error;
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n'); await browser.close();
  server.httpServer.closeAllConnections(); await new Promise(resolve => server.httpServer.close(resolve));
}
