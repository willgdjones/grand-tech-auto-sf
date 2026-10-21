/** Actual Input + radar DOM keyboard smoke; synthetic roads/events, no game/backend traffic. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const out = resolve(process.argv[2] ?? `artifacts/map-keyboard/${new Date().toISOString().replaceAll(':', '-')}`);
await mkdir(out, { recursive: true });
const entry = `
import { flags } from './shared/flags';
import { createRadar } from './web/src/radar/radar';
import { Input } from './web/src/input/input';
import { createActions } from './web/src/input/actions';
import { needsFreeCursor } from './web/src/input/cursor';
if (!flags.radar || !flags.fullMap || !flags.waypoints || !flags.unifiedInput) throw Error('Enable the existing local radar/map/input flags before this smoke.');
const graph = {version:1,nodes:[{id:'a',x:0,y:0,z:0},{id:'b',x:500,y:0,z:0}],edges:[{id:'lane:fixture',from:'a',to:'b',lengthM:500,speedMps:10,lane:1,points:[[0,0,0],[500,0,0]]}]};
const selected = [], actions = createActions(), canvas = document.querySelector('#game');
const input = new Input(canvas, {actions,touch:false});
const radar = createRadar({graph,routeGraph:graph,frame:{origin:{lat:37.7955,lon:-122.3937},gridRotationDeg:0},autoLoad:false,landmarks:[{id:'fixture',title:'Keyboard smoke landmark',x:200,y:0,z:0}],onSelect:value=>{selected.push(value);},onHail:()=>false});
radar.setEvents([{id:'fixture-event',title:'Keyboard smoke event',start:'2026-10-05T18:00:00Z',lat:37.7955,lon:-122.3907,approx:false,url:'https://example.com/keyboard-smoke'}]);
actions.on('map',()=>radar.toggleMap());
const timer = setInterval(()=>input.poll(1/60),16);
await radar.routingReady;
window.fixture = {radar,input,selected,needsFreeCursor,destroyMap:()=>radar.destroy(),dispose(){clearInterval(timer);radar.destroy();input.dispose();actions.dispose();}};
`;
const bundle = await build({ stdin: { contents: entry, resolveDir: resolve('.'), loader: 'ts' }, bundle: true,
  alias: { '@gtasf/shared': resolve('shared') }, outfile: `${out}/app.js`, write: false,
  format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'error' });
for (const file of bundle.outputFiles) await writeFile(file.path, file.contents, { flag: 'wx' });
await writeFile(`${out}/index.html`, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/app.css"><title>Map keyboard smoke</title><style>body{margin:0;background:#304b44;color:white;font:16px Arial}#game{width:300px;height:150px;border:1px solid white}#outside{position:fixed;right:12px;top:12px}</style></head><body><p>Isolated keyboard smoke · fixture roads/events · no World connection</p><button id="before">Before game</button><canvas id="game" tabindex="0" aria-label="Game keyboard controls"></canvas><button id="outside">Other HUD control</button><script type="module" src="/app.js"></script></body></html>`, { flag: 'wx' });
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
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  page.on('request', request => report.requests.push(new URL(request.url()).pathname));
  page.on('websocket', socket => report.errors.push(`Unexpected socket: ${socket.url()}`));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => Boolean(window.fixture));
  const game = page.locator('#game'), search = page.getByRole('searchbox', { name: 'Find a Tech Week event' });
  const openWithKeyboard = async () => {
    await game.focus(); await page.keyboard.press('m');
    await page.waitForFunction(() => window.fixture.radar.isExpanded);
    assert.equal(await search.evaluate(element => element === document.activeElement), true, 'M must focus the map search');
  };
  await openWithKeyboard();
  assert.equal(await page.locator('.gt-radar').getAttribute('role'), 'dialog');
  assert.equal(await page.locator('.gt-radar').getAttribute('aria-modal'), 'true');
  await page.keyboard.press('w');
  assert.equal(await search.inputValue(), 'w');
  assert.equal(await page.evaluate(() => window.fixture.input.move.y), 0);
  await search.fill('');
  report.checks.push('Physical M opens and focuses search; typing W stays in the map with movement released');

  const focusEdge = async last => page.locator('.gt-radar').evaluate((root, last) => {
    const controls = [...root.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled)')].filter(element => element.getClientRects().length && element.tabIndex >= 0);
    (last ? controls.at(-1) : controls[0]).focus();
  }, last);
  const atEdge = async last => page.locator('.gt-radar').evaluate((root, last) => {
    const controls = [...root.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled)')].filter(element => element.getClientRects().length && element.tabIndex >= 0);
    return document.activeElement === (last ? controls.at(-1) : controls[0]);
  }, last);
  await focusEdge(true); await page.keyboard.press('Tab'); assert.equal(await atEdge(false), true);
  await page.keyboard.press('Shift+Tab'); assert.equal(await atEdge(true), true);
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('.gt-radar').evaluate(root => root.contains(document.activeElement)), true);
  }
  await search.focus(); await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.fixture.radar.isExpanded), false);
  assert.equal(await game.evaluate(element => element === document.activeElement), true);
  assert.equal(await page.evaluate(() => window.fixture.needsFreeCursor()), false);
  report.checks.push('Tab/Shift+Tab wrap visible map controls; Escape from search closes and restores game focus/cursor');

  await openWithKeyboard(); await search.fill('Keyboard smoke event');
  await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Set destination', exact: true }).waitFor({ state: 'visible' });
  let reachedDestination = false;
  for (let i = 0; i < 12; i++) {
    if (await page.getByRole('button', { name: 'Set destination', exact: true }).evaluate(element => element === document.activeElement)) { reachedDestination = true; break; }
    await page.keyboard.press('Tab');
  }
  assert.equal(reachedDestination, true, 'The route action must be reachable by Tab');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => window.fixture.selected[0]?.id), 'fixture-event');
  assert.equal(await page.evaluate(() => window.fixture.radar.isExpanded), false);
  assert.equal(await game.evaluate(element => element === document.activeElement), true);
  report.checks.push('Search → Tab → Enter selects an event; tabbing to Set destination commits its road route and closes');

  await openWithKeyboard();
  await page.locator('#outside').focus(); await page.evaluate(() => window.fixture.radar.toggleMap(false));
  assert.equal(await page.locator('#outside').evaluate(element => element === document.activeElement), true);
  report.checks.push('Another HUD/dialog taking focus is not overwritten when integration closes the map');
  await openWithKeyboard();
  await page.evaluate(() => window.fixture.destroyMap());
  assert.equal(await game.evaluate(element => element === document.activeElement), true);
  assert.equal(await page.evaluate(() => window.fixture.needsFreeCursor()), false);
  await page.keyboard.down('w');
  await page.waitForFunction(() => window.fixture.input.move.y === 1);
  await page.keyboard.up('w');
  await page.locator('#before').focus(); await page.keyboard.press('Tab');
  assert.equal(await game.evaluate(element => element === document.activeElement), true);
  await page.evaluate(() => window.fixture.dispose());
  report.checks.push('Destroy restores focus and releases cursor/listeners; normal Tab and gameplay movement resume');
  assert.deepEqual(report.errors, []);
  assert.equal(report.requests.some(path => path.startsWith('/api/') || path.startsWith('/map/')), false);
  report.passed = true; console.log('TEST_PASSED:MapKeyboardFocus');
} catch (error) {
  report.failure = error.message; throw error;
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
  await browser?.close(); server.closeAllConnections(); await new Promise(done => server.close(done));
}
