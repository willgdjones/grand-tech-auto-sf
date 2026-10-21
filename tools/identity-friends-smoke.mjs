/** One real identity-component smoke; no game flags changed. Run through tools/heavy.sh. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const out = resolve('artifacts/identity-friends-saeb');
await mkdir(out, { recursive: true });
const report = { scope: 'Actual identity UI with current Friends OFF; injected availability callback separately. Whole-game setup recorded by phone-perf.',
  errors: [], requests: [], checks: [], passed: false };
const entry = `
import './web/src/theme/saTheme.css';
import { flags } from './shared/flags';
import { createIdentityScreen } from './web/src/hud/identity';
if (flags.friends) throw Error('This disabled-Friends regression fixture expects the current flag OFF');
let screen;
window.fixture = { saved:[], checked:[],
  open(injected) {
    screen?.destroy();
    screen = createIdentityScreen({
      onSave:choice => { window.fixture.saved.push(choice); },
      ...(injected ? {checkUsername:async name=>{
        window.fixture.checked.push(name);
        return {available:name!=='taken_name',reason:'taken'};
      }} : {}),
    });
    screen.open({username:injected?'taken_name':'phone_founder',startupName:'Phone Studio'});
  },
};`;
await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'js' }, bundle: true,
  platform: 'browser', format: 'esm', outfile: `${out}/fixture.js`, logLevel: 'warning' });
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (req.url.startsWith('/api/friends/')) {
      report.requests.push(req.url); res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Friends are disabled' })); return;
    }
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><body style="background:#27372a"><script type="module" src="/fixture.js"></script>'); return;
    }
    const root = req.url.startsWith('/fixture.') ? out : resolve('web/public');
    const path = resolve(root, '.' + req.url);
    if (!path.startsWith(root + '/')) throw Error('Invalid asset path');
    const bytes = await readFile(path);
    res.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream' }); res.end(bytes);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.fixture);
  const dialog = page.getByRole('dialog', { name: 'Create your founder' });
  await page.evaluate(() => window.fixture.open(false));
  await page.waitForFunction(() => document.querySelector('.gt-identity-check')?.textContent === '✓ Ready');
  await page.screenshot({ path: `${out}/local-ready.png` });
  await dialog.getByRole('button', { name: 'Looks good', exact: true }).tap();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => window.fixture.saved[0].username), 'phone_founder');
  assert.deepEqual(report.requests, []);
  report.checks.push('Friends OFF accepts valid local funding identity without optional HTTP calls');
  await page.evaluate(() => window.fixture.open(true));
  await page.waitForFunction(() => document.querySelector('.gt-identity-check')?.textContent === '✗ taken');
  assert.equal(await dialog.getByRole('button', { name: 'Looks good', exact: true }).isDisabled(), true);
  await dialog.getByRole('textbox', { name: 'Username', exact: true }).fill('open_name');
  await dialog.getByRole('button', { name: 'Looks good', exact: true }).tap();
  await dialog.waitFor({ state: 'hidden' });
  const state = await page.evaluate(() => ({ saved: window.fixture.saved, checked: window.fixture.checked }));
  assert.equal(state.saved[1].username, 'open_name');
  assert.deepEqual(state.checked, ['taken_name', 'open_name']);
  report.checks.push('Explicit availability check still blocks a taken name and accepts an available one');
  assert.deepEqual(report.errors, []); assert.deepEqual(report.requests, []); report.passed = true;
} catch (error) { report.failure = error.stack ?? String(error); process.exitCode = 1; }
finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(done => server.close(done));
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
}
