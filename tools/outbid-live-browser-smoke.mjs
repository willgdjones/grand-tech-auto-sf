/** Browser-only Outbid transport fixture. Never changes a real ledger or sends a payment. */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';

const base = process.env.GTASF_SMOKE_URL ?? 'https://gtasf.pages.dev';
const invite = (await readFile('worker/.wrangler/production/invite-code.txt', 'utf8')).trim();
const out = 'artifacts/outbid-live'; await mkdir(out, { recursive: true });
const report = { at: new Date().toISOString(), base, fixtureOnly: true, paidEvidence: false, errors: [], transitions: [] };
const redact = value => String(value).replaceAll(invite, '[REDACTED]');
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const contexts = [], peers = [];
let snapshot = { version: 1, revision: 0, currency: 'usd', mode: 'test', checkoutAvailable: false, minimumBidCents: 100, entries: [] };
async function notice(revision) {
  // The actual shared v2 OUTBID_CHANGED frame: opcode + little-endian f64.
  const bytes = Buffer.alloc(9); bytes[0] = 0x98; bytes.writeDoubleLE(revision, 1);
  for (const peer of peers) await peer.page.evaluate(frame => {
    window.__outbidFixtureSocket.dispatchEvent(new MessageEvent('message', { data: Uint8Array.from(frame).buffer }));
  }, [...bytes]);
}
async function crown(page) {
  return page.evaluate(async () => {
    const tower = window.__gtasf.world.landmarks.children.find(object => object.userData.landmarkId === 'salesforce-tower');
    const mesh = tower.children.find(object => object.userData.outbidCrown);
    if (!mesh) return { visible: false };
    const texture = mesh.material.map, canvas = texture.image;
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', pixels))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    return { visible: mesh.visible, width: canvas.width, height: canvas.height, version: texture.version, digest };
  });
}
async function settleFixture(revision, name) {
  snapshot = { ...snapshot, revision, entries: name ? [{ bidderId: `fixture-${revision}`, rank: 1, name,
    message: 'Browser fixture — no payment or production leaderboard change.', url: 'https://example.com/', totalCents: String(revision * 100) }] : [] };
  const before = peers.map(peer => peer.fetches); await notice(revision);
  report.phase = `revision-${revision}`;
  const states = [];
  for (const [index, peer] of peers.entries()) {
    await peer.page.waitForFunction(expected => document.querySelector('.gt-outbid-name')?.textContent.includes(expected), name ?? 'The crown is open');
    assert.ok(peer.fetches > before[index], 'The decoded notice must fetch canonical HTTP state');
    assert.equal(await peer.page.locator('.gt-outbid-row').count(), name ? 1 : 0);
    const state = await crown(peer.page); assert.equal(state.visible, !!name);
    if (name) assert.ok(state.width * state.height <= 1_000_000);
    states.push(state);
  }
  if (name) assert.equal(states[0].digest, states[1].digest, 'Both crowns render identical canonical content');
  report.transitions.push({ revision, name: name ?? null, crowns: states, fetches: peers.map(peer => peer.fetches) });
  return states;
}
try {
  for (let index = 0; index < 2; index++) {
    const context = await browser.newContext({ viewport: { width: 1100, height: 760 } }); contexts.push(context);
    const page = await context.newPage(), peer = { page, fetches: 0 }; peers.push(peer);
    page.setDefaultTimeout(60_000);
    page.on('pageerror', error => report.errors.push(redact(error.message)));
    page.on('console', message => { if (message.type() === 'error') report.errors.push(redact(message.text())); });
    await page.route(`${base}/api/outbid`, async route => {
      assert.equal(route.request().method(), 'GET'); peer.fetches++;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ snapshot }) });
    });
    // Keep the native cookie/subprotocol handshake and real server connection.
    // Inject only a browser-local message event; do not send fixture state upstream.
    await page.addInitScript(() => {
      const NativeWebSocket = window.WebSocket;
      window.WebSocket = class extends NativeWebSocket {
        constructor(url, protocols) { super(url, protocols); if (new URL(url).pathname === '/api/world') window.__outbidFixtureSocket = this; }
      };
    });
    const url = new URL(base); url.searchParams.set('invite', invite);
    report.phase = `peer-${index + 1}-navigation`;
    await page.goto(url.href);
    report.phase = `peer-${index + 1}-ready`;
    await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true');
    report.phase = `peer-${index + 1}-initial-banner`;
    await page.waitForFunction(() => document.querySelector('.gt-outbid-name')?.textContent === 'The crown is open');
    assert.equal(await page.evaluate(() => window.__outbidFixtureSocket?.readyState), 1);
    assert.equal((await crown(page)).visible, false);
  }
  const first = await settleFixture(1, 'FIRST FIXTURE WINNER');
  const second = await settleFixture(2, 'SECOND FIXTURE WINNER');
  assert.notEqual(first[0].digest, second[0].digest);
  assert.ok(second[0].version > first[0].version);
  assert.ok(second[1].version > first[1].version);
  for (let index = 0; index < peers.length; index++) {
    await peers[index].page.getByRole('button', { name: 'Top 50', exact: true }).click();
    await peers[index].page.screenshot({ path: `${out}/peer-${index + 1}-updated.png` });
    assert.equal(await peers[index].page.locator('.gt-outbid-submit').isDisabled(), true);
    await peers[index].page.getByRole('button', { name: 'Close Outbid', exact: true }).click();
  }
  await settleFixture(3, null);
  assert.deepEqual(report.errors, []); report.passed = true;
  console.log('PASS: two actual game clients refresh banner, leaderboard and crown from bounded wire notices (browser-only ledger fixture).');
} catch (error) {
  report.failure = redact(error); report.diagnostics = [];
  for (const peer of peers) {
    try { report.diagnostics.push(await peer.page.evaluate(() => ({ ready: window.__gtasf?.ready,
      state: document.querySelector('#world')?.dataset, title: document.querySelector('.admission h1')?.textContent,
      banner: document.querySelector('.gt-outbid-name')?.textContent, socket: window.__outbidFixtureSocket?.readyState,
      status: document.querySelector('.gt-outbid-status')?.textContent }))); } catch { /* Browser was interrupted. */ }
  }
  console.error(report.phase, report.failure, JSON.stringify(report.diagnostics)); process.exitCode = 1;
}
finally { await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n'); await Promise.allSettled(contexts.map(context => context.close())); await browser.close(); }
