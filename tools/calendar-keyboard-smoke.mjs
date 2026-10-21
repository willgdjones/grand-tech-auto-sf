/** Actual calendar/input DOM, isolated from World/API and GPU work. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const out = resolve(process.argv[2] ?? `artifacts/calendar-keyboard/${new Date().toISOString().replaceAll(':', '-')}`);
await mkdir(out, { recursive: true });
const entry = `
import {createUpcomingEvents} from './web/src/events/upcoming';
import {Input} from './web/src/input/input';
import {createActions} from './web/src/input/actions';
import {needsFreeCursor} from './web/src/input/cursor';
import calendar from './worker/src/events/data/sf-tech-week.json';
const actions=createActions(),input=new Input(document.querySelector('#game'),{actions,touch:false}),selected=[];
const events=calendar.events.filter(event=>Number.isFinite(event.lat)&&Number.isFinite(event.lon)).slice(0,2);
const view=createUpcomingEvents({enabled:true,frame:{origin:{lat:37.79,lon:-122.4},gridRotationDeg:0},now:()=>Date.parse('2026-10-05T17:00:00Z'),onOpenChange:()=>input.release(),onSelect:event=>{selected.push(event.id);},onHail:()=>false});
view.setEvents(events);const timer=setInterval(()=>input.poll(1/60),16);
window.fixture={view,input,selected,needsFreeCursor,dispose(){clearInterval(timer);view.destroy();input.dispose();actions.dispose();}};
`;
const bundle = await build({ stdin: { contents: entry, resolveDir: resolve('.'), loader: 'ts' }, bundle: true,
  alias: { '@gtasf/shared': resolve('shared') }, outfile: `${out}/app.js`, write: false,
  format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'error' });
for (const file of bundle.outputFiles) await writeFile(file.path, file.contents, { flag: 'wx' });
await writeFile(`${out}/index.html`, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/app.css"><title>Calendar keyboard check</title><style>body{background:#304b44;color:white;font:16px Arial}#game{width:200px;height:80px}</style></head><body><p>Isolated calendar keyboard check · two public events · no World connection</p><button id="before">Before game</button><canvas id="game" tabindex="0" aria-label="Game keyboard controls"></canvas><input id="other" aria-label="Other panel input"><button id="after">After game</button><script type="module" src="/app.js"></script></body></html>`, { flag: 'wx' });
const server = createServer(async (req, res) => {
  const name = ({ '/': 'index.html', '/app.js': 'app.js', '/app.css': 'app.css' })[(req.url ?? '/').split('?')[0]];
  if (!name) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extname(name)]);
  res.end(await readFile(`${out}/${name}`));
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const report = { checkedAt: new Date().toISOString(), errors: [], requests: [], checks: [], passed: false };
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
  for (const viewport of [{ width: 1100, height: 760 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport }); page.setDefaultTimeout(5000);
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
    page.on('request', request => report.requests.push(new URL(request.url()).pathname));
    page.on('websocket', socket => report.errors.push(`Unexpected socket: ${socket.url()}`));
    await page.goto(`http://127.0.0.1:${server.address().port}/`); await page.waitForFunction(() => !!window.fixture);
    const game = page.locator('#game'), other = page.locator('#other'), root = page.locator('.gt-upcoming');
    const search = page.getByRole('searchbox', { name: 'Search upcoming events' });
    const isFocused = locator => locator.evaluate(element => element === document.activeElement);
    const open = async () => { await game.focus(); await page.keyboard.press('v'); assert.equal(await isFocused(search), true); };
    await open(); await other.focus(); await page.evaluate(() => window.fixture.view.toggle(false));
    assert.equal(await isFocused(other), true, 'Closing the calendar must preserve focus already handed to another panel');
    report.checks.push(`${viewport.width}: other-panel focus handoff`);
    await open(); await page.keyboard.press('w');
    assert.equal(await search.inputValue(), 'w'); assert.equal(await page.evaluate(() => window.fixture.input.move.y), 0);
    await search.fill('');
    const focusEdge = async last => root.evaluate((element, last) => {
      const controls = [...element.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),[tabindex]')]
        .filter(control => control.tabIndex >= 0 && control.getClientRects().length && getComputedStyle(control).visibility !== 'hidden');
      (last ? controls.at(-1) : controls[0]).focus();
    }, last);
    const atEdge = async last => root.evaluate((element, last) => {
      const controls = [...element.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),[tabindex]')]
        .filter(control => control.tabIndex >= 0 && control.getClientRects().length && getComputedStyle(control).visibility !== 'hidden');
      return document.activeElement === (last ? controls.at(-1) : controls[0]);
    }, last);
    await root.evaluate(element => {
      for (const kind of ['disabled', 'hidden', 'invisible']) {
        const control = document.createElement('input'); control.dataset.fixture = 'true';
        control.disabled = kind === 'disabled'; control.hidden = kind === 'hidden';
        if (kind === 'invisible') control.style.visibility = 'hidden'; element.append(control);
      }
    });
    await focusEdge(true); await page.keyboard.press('Tab'); assert.equal(await atEdge(false), true);
    await page.keyboard.press('Shift+Tab'); assert.equal(await atEdge(true), true);
    await other.focus(); await page.keyboard.press('Tab'); assert.equal(await atEdge(false), true);
    await other.focus(); await page.keyboard.press('Shift+Tab'); assert.equal(await atEdge(true), true);
    await search.focus(); await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => window.fixture.view.isOpen), false); assert.equal(await isFocused(game), true);
    assert.equal(await page.evaluate(() => window.fixture.needsFreeCursor()), false);
    report.checks.push(`${viewport.width}: physical V/search, forward/reverse Tab, disabled/hidden filtering, external recovery, Escape`);
    await open(); await page.locator('.gt-upcoming-choose').first().focus(); await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.fixture.selected.length), 1); assert.equal(await isFocused(game), true);
    await open(); await page.evaluate(() => document.querySelector('#game').remove()); await page.keyboard.press('Escape');
    assert.equal(await isFocused(page.locator('.gt-upcoming-open')), true, 'A removed opener falls back to the calendar HUD control');
    await page.locator('#before').focus(); await page.keyboard.press('v');
    await root.evaluate(element => [...element.querySelectorAll('button,a,input,select')].forEach(control => { control.hidden = true; }));
    await other.focus(); await page.keyboard.press('Tab'); assert.equal(await isFocused(root), true);
    await page.keyboard.press('Escape'); assert.equal(await isFocused(page.locator('#before')), true);
    await root.evaluate(element => [...element.querySelectorAll('[hidden]')].forEach(control => { control.hidden = false; }));
    await page.keyboard.press('v'); assert.equal(await isFocused(search), true);
    await page.evaluate(() => window.fixture.view.destroy());
    assert.equal(await isFocused(page.locator('#before')), true); assert.equal(await page.evaluate(() => window.fixture.needsFreeCursor()), false);
    await page.keyboard.press('Tab'); assert.equal(await isFocused(other), true);
    await page.evaluate(() => window.fixture.dispose());
    report.checks.push(`${viewport.width}: destination action, removed opener, empty calendar fallback, destroy/listener/cursor cleanup`);
    await page.close();
  }
  assert.deepEqual(report.errors, []); assert.equal(report.requests.some(path => path.startsWith('/api/') || path.startsWith('/map/')), false);
  report.passed = true; console.log('TEST_PASSED:CalendarKeyboardFocus');
} catch (error) { report.failure = error.message; throw error; }
finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
  await browser?.close(); server.closeAllConnections(); await new Promise(done => server.close(done));
}
