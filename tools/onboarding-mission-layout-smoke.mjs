/** Real mission/HUD/hint components; layout proof only, not a world/device/performance gate. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';

const source = resolve('artifacts/onboarding-mission-layout');
const out = resolve('docs/perf/onboarding-mission-layout');
const baselineCommit = '79df417';
const paths = ['web/src/theme/saMission.ts', 'web/src/theme/saMission.css', 'web/src/hud/phoneHud.css'];
const before = new Map(), after = new Map();
for (const path of paths) {
  before.set(resolve(path), execFileSync('git', ['show', `${baselineCommit}:${path}`], { encoding: 'utf8' }));
  after.set(resolve(path), await readFile(path, 'utf8'));
}
await mkdir(source, { recursive: true }); await mkdir(out, { recursive: true });
const html = (await readFile('web/index.html', 'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace('</body>', '<script type="module" src="/entry.js"></script></body>');
await writeFile(`${source}/index.html`, html);
await writeFile(`${source}/entry.js`, `
import '${resolve('web/src/style.css')}';
import '${resolve('web/src/theme/saTheme.css')}';
import {flags} from '${resolve('shared/flags.ts')}';
import {SaMissionBanner,SaHintChips} from '${resolve('web/src/theme/saMission.ts')}';
import {createPlayableHud} from '${resolve('web/src/hud/playableHud.ts')}';
import {createGameOptions} from '${resolve('web/src/hud/gameOptions.ts')}';
import {createPhoneHud} from '${resolve('web/src/hud/phoneHud.ts')}';
import {createStreetHud} from '${resolve('web/src/hud/streetHud.ts')}';
document.querySelector('#loading').hidden=true;
document.querySelector('#connection').textContent='Connected';
document.querySelector('#app>footer').hidden=true;
document.body.style.background='#486778';
const hud=createPlayableHud(),street=createStreetHud();
if(!hud||!street)throw Error('Normal hud flag must be enabled');
hud.update({now:1791090600000,fundingCents:0});
street.update({street:'The Embarcadero',neighbourhood:'Financial District/South Beach'},0);
const options=createGameOptions({launcher:document.querySelector('#movement-mode'),tankControls:()=>false,toggleMovement(){},onModalChange(){}});
const phone=createPhoneHud({parent:options.content,closeOptions:options.hide,enabled:flags.hud&&flags.mobile});
if(!phone)throw Error('Normal mobile HUD flag must be enabled');
let mission=new SaMissionBanner();const hints=new SaHintChips();
const steps={
 walk:{title:'Get moving',objective:'Walk to the gold marker · Push the stick fully to sprint · Game options → Ride for your scooter',step:{index:0,total:4}},
 drive:{title:'Founder Orientation',objective:'Enter the parked car. Drive through the gold ring.',reward:'+$500,000',step:{index:1,total:4}},
 gps:{title:'Find your first event',objective:'Tap Map and choose an event to set your GPS destination.',step:{index:2,total:4}}
};
window.fixture={
 step(name){mission.setStep(steps[name]);},
 nudge(show){if(show)hints.show('idle','Nearest event 400 m → tap Map',{variant:'nudge'});else hints.hide('idle');},
 hide(){mission.hide();},
 remove(){mission.destroy();},
 recreate(){mission=new SaMissionBanner();mission.setStep(steps.walk);},
 destroy(){mission.destroy();hints.destroy();phone.destroy();options.destroy();hud.destroy();street.destroy();}
};
window.fixture.step('walk');window.fixture.nudge(true);
`);
const report = { at: new Date().toISOString(), scope: 'Actual mission, phone HUD, Game options and contextual hint DOM/CSS. No world or device gate.',
  baselineCommit, hashes: Object.fromEntries(paths.map(path => [path, { before: createHash('sha256').update(before.get(resolve(path))).digest('hex'), after: createHash('sha256').update(after.get(resolve(path))).digest('hex') }])),
  cases: [], errors: [], passed: false };
const overlap = (a, b) => a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
let browser, server;
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--disable-webgl'] });
  for (const [variant, snapshots] of [['before', before], ['after', after]]) {
    const config = { configFile: false, root: source, publicDir: false, logLevel: 'warn',
      plugins: [{ name: 'recorded-mission-source', enforce: 'pre', load(id) { return snapshots.get(id.split('?')[0]) ?? null; } }],
      resolve: { alias: { '@gtasf/shared': resolve('shared') } },
      build: { target: 'es2022', outDir: `${source}/${variant}`, emptyOutDir: true, reportCompressedSize: false } };
    await build(config); server = await preview({ ...config, preview: { host: '127.0.0.1', port: 0 } });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    page.on('pageerror', e => report.errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); });
    page.on('response', r => { if (r.status() >= 400) report.errors.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`); });
    await page.route('**/favicon.ico', route => route.fulfill({ status: 204 }));
    await page.goto(server.resolvedUrls.local[0]); await page.waitForFunction(() => Boolean(window.fixture));
    await page.evaluate(() => document.fonts.ready);
    const measure = () => page.evaluate(() => {
      const selectors = ['.gt-sa-mission', '.gt-sa-hint--nudge', '#app>aside', '#movement-mode', '.gt-hud'];
      return Object.fromEntries(selectors.map(selector => {
        const el = document.querySelector(selector), rect = el?.getBoundingClientRect();
        return [selector, el?.checkVisibility({ visibilityProperty: true }) ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null];
      }));
    });
    const settled = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    await settled();
    if (variant === 'before') {
      const boxes = await measure(); report.cases.push({ variant, width: 390, step: 'walk', boxes });
      assert(overlap(boxes['.gt-sa-mission'], boxes['#app>aside']), 'Pinned baseline must reproduce objective/connection overlap');
      await page.screenshot({ path: `${out}/before-390.png` });
    } else {
      for (const [width, height] of [[320, 568], [390, 844], [700, 844]]) {
        await page.setViewportSize({ width, height });
        for (const step of ['walk', 'drive', 'gps']) {
          await page.evaluate(step => window.fixture.step(step), step); await settled();
          const boxes = await measure(); report.cases.push({ variant, width, height, step, boxes });
          for (const [name, box] of Object.entries(boxes)) assert(box && box.left >= 0 && box.right <= width && box.top >= 0 && box.bottom <= height, `${width}/${step}: ${name} fits`);
          const entries = Object.entries(boxes);
          for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++)
            assert(!overlap(entries[i][1], entries[j][1]), `${width}/${step}: ${entries[i][0]} overlaps ${entries[j][0]}`);
          if (step === 'walk') await page.screenshot({ path: `${out}/after-${width}.png` });
        }
      }
      await page.setViewportSize({ width: 390, height: 844 }); await settled();
      const visibleTop = (await measure())['#app>aside'].top;
      await page.evaluate(() => window.fixture.hide());
      await page.waitForFunction(() => document.querySelector('.gt-sa-mission').hidden && !document.body.style.getPropertyValue('--gt-sa-mission-height'));
      await settled(); const hiddenTop = (await measure())['#app>aside'].top;
      assert(hiddenTop < visibleTop, 'Hiding the banner releases reserved space');
      await page.locator('#movement-mode').tap();
      await page.getByRole('dialog', { name: 'Game options', exact: true }).waitFor();
      await page.getByRole('dialog', { name: 'Game options', exact: true }).getByRole('button', { name: /^Close/ }).tap();
      await page.evaluate(() => window.fixture.step('walk')); await settled();
      await page.evaluate(() => window.fixture.remove()); await settled();
      assert.equal(await page.evaluate(() => document.body.style.getPropertyValue('--gt-sa-mission-height')), '');
      await page.evaluate(() => window.fixture.recreate()); await settled();
      assert((await measure())['#app>aside'].top > hiddenTop, 'New banner reserves space again');
      await page.evaluate(() => window.fixture.destroy()); await settled();
      assert.equal(await page.evaluate(() => document.body.style.getPropertyValue('--gt-sa-mission-height')), '');
      report.cleanup = { hide: true, destroy: true, recreate: true, gameOptionsTouch: true };
    }
    await page.close(); server.httpServer.closeAllConnections(); await new Promise(done => server.httpServer.close(done)); server = undefined;
  }
  assert.deepEqual(report.errors, []); report.passed = true;
  console.log(`ONBOARDING_MISSION_LAYOUT:PASS ${report.cases.length} cases; real options tap and cleanup`);
} catch (error) { report.failure = String(error); throw error; }
finally {
  await browser?.close();
  if (server) { server.httpServer.closeAllConnections(); await new Promise(done => server.httpServer.close(done)); }
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
}
