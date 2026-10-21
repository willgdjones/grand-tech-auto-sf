/** One native phone boot, then DOM-only layout checks. Synthetic room text is not funding acceptance. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';

const out = resolve('artifacts/phone-status-layout'), configFile = resolve('web/vite.config.ts');
const app = resolve(process.env.GTASF_STATUS_APP ?? `${out}/app`);
const domOnly = process.argv.includes('--dom-only');
await mkdir(out, { recursive: true });
if (!domOnly && !process.env.GTASF_STATUS_APP) await build({ configFile, root: resolve('web'), logLevel: 'warn', build: { outDir: app, emptyOutDir: true, reportCompressedSize: false } });
const report = { at: new Date().toISOString(), scope: domOnly ? 'Saved mounted markup with current source CSS; DOM geometry only, no native game or funding acceptance' : 'Native phone onboarding/share notification; synthetic DOM geometry only for room and narrow-width variants', errors: [], httpErrors: [], layouts: [] };
let browser, server;
try {
  server = await preview({ configFile, root: resolve('web'), build: { outDir: app }, preview: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } } });
  const url = server.resolvedUrls.local[0];
  browser = await chromium.launch({ headless: domOnly || process.env.GTASF_HEADLESS === '1', args: domOnly ? ['--disable-gpu'] : [] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ['clipboard-read', 'clipboard-write'] });
  let html;
  if (domOnly) html = (await readFile(`${out}/mounted.html`, 'utf8')).replace(/<base\b[^>]*>/, `<base href="${url}">`);
  else {
    const page = await context.newPage(); page.setDefaultTimeout(45000);
    page.on('pageerror', e => report.errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); });
    page.on('response', r => { if (r.status() >= 400) report.httpErrors.push({ path: new URL(r.url()).pathname, status: r.status() }); });
    await page.goto(url); await page.locator('#world[data-connected=true]').waitFor(); await page.locator('#loading').waitFor({ state: 'hidden' });
    const identity = page.locator('.gt-funding-onboarding[open]'); await identity.waitFor();
    await page.getByLabel('Startup name', { exact: true }).fill('Phone Layout');
    await page.getByLabel('Your nickname', { exact: true }).fill('Layout');
    await identity.getByRole('button', { name: 'Save startup', exact: true }).click(); await identity.waitFor({ state: 'hidden' });
    await page.locator('#trip-status[data-notice=false]').waitFor({ state: 'attached' });
    assert.equal(await page.locator('#prompt').isVisible(), false);
    assert.equal(await page.locator('.gt-gps-status').isVisible(), true);
    await page.screenshot({ path: `${out}/phone-ready.png` });
    await page.locator('#share-location').tap(); await page.locator('#trip-status[data-notice=true]').waitFor();
    assert.match(await page.locator('#trip-status').innerText(), /copied/i);
    assert.equal(await page.locator('.gt-gps-status').isVisible(), false);
    await page.screenshot({ path: `${out}/phone-notice.png` });
    // Reuse mounted markup/styles without animation, game connections, WebGL, or room claims.
    html = (await page.content()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace('<head>', `<head><base href="${url}">`);
    await writeFile(`${out}/mounted.html`, html);
    await page.close();
  }
  // Same origin retains crossorigin stylesheet/font loading from the mounted game.
  const dom = await context.newPage();
  dom.on('pageerror', e => report.errors.push(e.message));
  dom.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); });
  dom.on('response', r => { if (r.status() >= 400) report.httpErrors.push({ path: new URL(r.url()).pathname, status: r.status() }); });
  await dom.route('**/layout-fixture', route => route.fulfill({ contentType: 'text/html', body: html }));
  await dom.goto(`${url}layout-fixture`); await dom.evaluate(() => document.fonts.ready);
  if (domOnly) await dom.addStyleTag({ content: await readFile('web/src/style.css', 'utf8') });
  const inspect = async (width, room, notice, gps = true) => {
    await dom.setViewportSize({ width, height: 844 });
    await dom.evaluate(({ room, notice, gps }) => {
      const status = document.querySelector('#trip-status'); status.dataset.notice = String(notice);
      status.textContent = notice ? 'Your white robotaxi is waiting at the curb · 123 m. Walk toward it to board. This longer notification must remain readable without covering game controls.' : 'Destination: Lombard switchbacks';
      const panel = document.querySelector('.gt-funding-room'); panel.hidden = !room;
      // Keep the production title's single-line ellipsis styling.
      ['Tech Week event', 'WORK THE ROOM · 17s', '~$2.4M · ×1.5 streak'].forEach((text, i) => { panel.children[i].textContent = text; });
      document.querySelector('.gt-gps-status').hidden = !gps;
    }, { room, notice, gps });
    const layout = await dom.evaluate(() => {
      const box = selector => { const el = document.querySelector(selector), css = getComputedStyle(el), r = el.getBoundingClientRect(); return { selector, visible: css.display !== 'none' && css.visibility !== 'hidden' && r.width > 0 && r.height > 0, left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }; };
      const buttons = selector => [...document.querySelectorAll(selector)].filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden').map(el => {
        const r = el.getBoundingClientRect();
        return { label: el.textContent, left: r.left, top: r.top, right: r.right, bottom: r.bottom, clipped: el.scrollWidth > el.clientWidth + 1, reachable: el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)) };
      });
      return { width: innerWidth, boxes: ['#prompt', '#trip-status', '.gt-radar', '.gt-gps-status', '.gt-funding-room', '.gt-upcoming-open', '.gtasf-touch .buttons'].map(box), toolbar: buttons('#play-controls button'), funding: buttons('.gt-funding-controls button') };
    });
    const by = selector => layout.boxes.find(b => b.selector === selector);
    const status = by('#trip-status');
    const radar = by('.gt-radar'), buttons = by('.gtasf-touch .buttons');
    report.layouts.push({ room, notice, gps, ...layout });
    for (const button of [...layout.toolbar, ...layout.funding]) {
      assert.ok(button.left >= 0 && button.right <= width && !button.clipped, `${width}px ${button.label} stays in bounds`);
      assert.ok(button.reachable, `${width}px ${button.label} receives taps`);
    }
    for (const action of layout.toolbar) for (const funding of layout.funding) {
      assert.ok(action.right <= funding.left || action.left >= funding.right || action.bottom <= funding.top || action.top >= funding.bottom, `${width}px ${action.label} overlaps ${funding.label}`);
    }
    assert.ok(radar.right <= buttons.left || radar.bottom <= buttons.top, `${width}px collapsed radar overlaps touch buttons`);
    assert.equal(by('#prompt').visible, false, `Touch hint hidden at ${width}px (innerWidth=${layout.width})`);
    assert.equal(status.visible, notice || !gps && !room);
    if (room) {
      const panel = by('.gt-funding-room');
      assert.equal(panel.visible, true, 'Room progress remains visible');
      for (const other of ['.gt-upcoming-open', '.gt-radar', '.gtasf-touch .buttons'].map(by)) {
        assert.ok(panel.right <= other.left || panel.left >= other.right || panel.bottom <= other.top || panel.top >= other.bottom, `${width}px room overlaps ${other.selector}`);
      }
    }
    if (notice) assert.equal(by('.gt-gps-status').visible, false, 'Notice takes GPS slot');
    if (status.visible) {
      assert.ok(status.left >= 0 && status.right <= width);
      for (const other of ['.gt-radar', '.gt-gps-status', '.gt-funding-room', '.gt-upcoming-open', '.gtasf-touch .buttons'].map(by).filter(b => b.visible)) {
        assert.ok(status.right <= other.left || status.left >= other.right || status.bottom <= other.top || status.top >= other.bottom, `${width}px notice overlaps ${other.selector}`);
      }
      assert.equal(await dom.locator('#trip-status').evaluate(el => { el.scrollTop = el.scrollHeight; return el.scrollTop + el.clientHeight >= el.scrollHeight - 1; }), true, 'Full long message can be scrolled into view');
      assert.equal(await dom.locator('#trip-status').evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); }), true, 'Notice receives touch scrolling');
    }
  };
  for (const width of [320, 360, 390]) {
    await inspect(width, false, false);
    await inspect(width, false, true);
    await inspect(width, true, true);
    await dom.screenshot({ path: `${out}/room-long-notice-dom-${width}.png` });
    await inspect(width, false, false, false);
  }
  await dom.setViewportSize({ width: 320, height: 844 });
  await dom.locator('.gt-radar').evaluate(el => { el.dataset.expanded = 'true'; });
  assert.deepEqual(await dom.locator('.gt-radar').evaluate(el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right }; }), { left: 8, right: 312 }, 'Expanded map retains its full width');
  await dom.locator('.gt-radar').evaluate(el => { el.dataset.expanded = 'false'; });
  await dom.setViewportSize({ width: 1365, height: 900 });
  await dom.evaluate(() => document.querySelector('.gtasf-touch').classList.remove('on'));
  assert.equal(await dom.locator('#prompt').isVisible(), true);
  assert.deepEqual(await dom.locator('#app>footer').evaluate(el => ({ left: getComputedStyle(el).left, bottom: getComputedStyle(el).bottom })), { left: '280px', bottom: '36px' });
  assert.deepEqual(await dom.locator('#play-controls').evaluate(el => ({ right: getComputedStyle(el).right, maxWidth: getComputedStyle(el).maxWidth })), { right: '24px', maxWidth: '440px' });
  assert.deepEqual(report.errors, []); assert.deepEqual(report.httpErrors, []);
  report.passed = true; console.log('TEST_PASSED:PhoneStatusLayout');
} catch (error) { report.failure = String(error); throw error; }
finally {
  await browser?.close();
  if (server) { server.httpServer.closeAllConnections(); await new Promise(done => server.httpServer.close(done)); }
  await writeFile(`${out}/${domOnly ? 'layout-only-report' : 'report'}.json`, `${JSON.stringify(report, null, 2)}\n`);
}
