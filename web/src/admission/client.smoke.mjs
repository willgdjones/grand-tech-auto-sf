// Non-WebGL component smoke against Vite; API fixtures complement the native cross-DO smoke.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const origin = process.env.GTASF_PREVIEW ?? 'http://127.0.0.1:5173';
const output = 'artifacts/admission'; await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [], requests = [], report = { at: new Date().toISOString(), componentFixture: true };
page.on('pageerror', error => errors.push(error.message));
let allowed = false, admit = false, signups = 0;
await page.route('**/admission-smoke', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body></body></html>' }));
await page.route('**/api/**', async route => {
  const path = new URL(route.request().url()).pathname; requests.push(path);
  const json = value => route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) });
  if (path === '/api/admission') return json({ launchMode: 'invite', allowed, enabled: true, capacity: 1, waitlist: true });
  if (path === '/api/waitlist') { assert.equal(route.request().postDataJSON().email, 'queue-fixture@example.test'); signups++; return json({ accepted: true }); }
  if (path === '/api/admission/leave') return json({ ok: true });
  return json(admit ? { status: 'admitted', ticket: 'a'.repeat(64), grant: 'b'.repeat(64), expiresAt: Date.now() + 30000, nextPollS: 10 } :
    { status: 'queued', ticket: 'a'.repeat(64), position: 2, queueLength: 2, population: 1, capacity: 1, etaSeconds: null, nextPollS: 1 });
});
try {
  await page.goto(`${origin}/admission-smoke`);
  await page.evaluate(async () => { window.admission = await import('/src/admission/client.ts'); void window.admission.waitForAdmission(); });
  await page.getByRole('heading', { name: 'San Francisco is opening soon' }).waitFor();
  await page.screenshot({ path: `${output}/launch-phone.png` });
  report.launch = await page.locator('.admission-detail').innerText();
  // Fresh page avoids the intentional 15s launch poll interval.
  allowed = true; await page.reload();
  await page.evaluate(async () => { window.admission = await import('/src/admission/client.ts'); void window.admission.waitForAdmission().then(value => window.admitted = value); });
  await page.getByRole('heading', { name: 'You’re #2 in line' }).waitFor();
  await page.getByRole('textbox').fill('queue-fixture@example.test'); await page.getByRole('button', { name: 'Notify me' }).click();
  await page.getByText('You’re on the list.', { exact: false }).waitFor();
  assert.equal(signups, 1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.equal(await page.locator('.admission-card').evaluate(element => { const rect = element.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth; }), true);
  await page.screenshot({ path: `${output}/queue-phone.png` });
  report.queue = await page.locator('.admission-detail').innerText();
  assert(!requests.some(path => path === '/api/world'));
  admit = true; await page.waitForFunction(() => window.admitted === 'b'.repeat(64));
  assert.equal(await page.locator('.admission').count(), 0);
  await page.evaluate(() => { window.admission.admissionConsumed(); window.admitted = null; void window.admission.waitForAdmission({ requireInput: true }).then(value => window.admitted = value); });
  await page.getByRole('button', { name: 'Rejoin the queue' }).waitFor();
  const before = requests.length; await page.waitForTimeout(1100); assert.equal(requests.length, before);
  await page.screenshot({ path: `${output}/idle-phone.png` });
  await page.getByRole('button', { name: 'Rejoin the queue' }).click();
  await page.waitForFunction(() => window.admitted === 'b'.repeat(64));
  await page.evaluate(() => window.admission.admissionConsumed());
  assert.deepEqual(errors, []);
  Object.assign(report, { passed: true, noWorldSocketWhileWaiting: true, signup: true, autoAdmission: true, idleRequiresInput: true, errors });
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally { await browser.close(); }
