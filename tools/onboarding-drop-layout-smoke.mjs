/** Actual notice/hint/phone-HUD DOM, isolated from networking and WebGL. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';

const out = resolve('artifacts/onboarding-drop-layout');
await mkdir(out, { recursive: true });
const gameHtml = await readFile('web/index.html', 'utf8');
const header = gameHtml.match(/<header>[\s\S]*?<\/header>/)?.[0];
const toolbar = gameHtml.match(/<nav id="play-controls"[\s\S]*?<\/nav>/)?.[0];
assert(header && toolbar, 'Use the actual game title and complete base toolbar');
await writeFile(`${out}/index.html`, `<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Onboarding fund notice placement</title>
<div id="app">${header}<aside>Connected · 1 player</aside>${toolbar}</div><div id="options" hidden></div><script type="module" src="/entry.js"></script>`);
await writeFile(`${out}/entry.js`, `
import '${resolve('web/src/style.css')}';
import '${resolve('web/src/theme/saTheme.css')}';
import '${resolve('web/src/outbid/outbid.css')}';
import { createDropBanner } from '${resolve('web/src/drops/banner.ts')}';
import { createPhoneHud } from '${resolve('web/src/hud/phoneHud.ts')}';
import { createPlayableHud } from '${resolve('web/src/hud/playableHud.ts')}';
import { SaHintChips } from '${resolve('web/src/theme/saMission.ts')}';
document.body.classList.add('gt-outbid-active');
document.querySelector('#movement-mode').textContent='Game options';
document.querySelector('#ride').hidden=false;
// These optional modules append their live actions after the HTML toolbar.
for(const [className,text] of [['gt-eventsubmit-open','+ Add event'],['gt-referral-launch','Invite friends, raise faster']]){
 const button=document.createElement('button');button.className=className;button.textContent=text;
 document.querySelector('#play-controls').append(button);
}
const banner=createDropBanner(), hud=createPlayableHud();
hud.update({now:1791100000000,fundingCents:0,radioStation:'Radio off'});
const phone=createPhoneHud({parent:document.querySelector('#options'),closeOptions(){},enabled:true});
const chips=new SaHintChips();
const drop={id:'layout-drop',fundName:'Growth At All Costs',tagline:'Growth At All Costs announces a new fund — come pitch!',capacity:50,remaining:50,closesAt:1791100900000,yourClaim:null};
const client={active:[drop],nearest:{drop,compass:'NW',distance:3200},state:{upcoming:null}};
const text='A VC fund just dropped — drive through the briefcase to pitch.';
function show(long=false){
 client.active=[drop];client.nearest={drop,compass:'NW',distance:3200};
 client.state.upcoming=long?{fundName:'Product-Market Fit Partners',location:{label:'Washington Square, North Beach'},opensAt:1791100120000}:null;
 banner.update(client,1791100000000);chips.show('firstDrop',text,{variant:'nudge'});
}
show();
window.fixture={show,hideHint(){chips.hide('firstDrop');},hideDrop(){client.active=[];client.nearest=null;banner.update(client);},
 shorter(){chips.show('firstDrop','Open the map to find the fund.',{variant:'nudge'});},
 destroy(){chips.destroy();banner.destroy();phone.destroy();hud.destroy();}};
`);
const config = { configFile: false, root: out, publicDir: false, logLevel: 'warn',
  resolve: { alias: { '@gtasf/shared': resolve('shared') } },
  build: { target: 'es2022', outDir: `${out}/app`, emptyOutDir: true, reportCompressedSize: false } };
await build(config);
const server = await preview({ ...config, preview: { host: '127.0.0.1', port: 0 } });
const report = { at: new Date().toISOString(), scope: 'Actual UI modules with isolated drop data; no game/device acceptance', errors: [], cases: [], passed: false };
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--disable-webgl'] });
  const page = await browser.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) report.errors.push(`HTTP ${response.status()} ${response.url()}`); });
  const metrics = () => page.evaluate(() => {
    const box = selector => {
      const el = document.querySelector(selector);
      if (!el || !el.checkVisibility()) return null;
      const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    return { width: innerWidth, height: innerHeight, phone: document.body.classList.contains('gt-phone-hud'),
      drop: box('.gt-drop-banner'), hint: box('.gt-sa-hint--nudge'), hud: box('.gt-hud'),
      title: box('#app>header'), connection: box('#app>aside'), controls: box('#play-controls'),
      dropHeight: document.body.style.getPropertyValue('--gt-drop-banner-height'),
      hintHeight: document.body.style.getPropertyValue('--gt-sa-nudge-height') };
  });
  const overlap = (a, b) => a && b && Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) + 1
    && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y) + 1;
  async function settled() {
    await page.waitForFunction(() => {
      const hint = document.querySelector('.gt-sa-hint--nudge');
      const height = parseFloat(document.body.style.getPropertyValue('--gt-sa-nudge-height'));
      return hint && height === Math.ceil(hint.getBoundingClientRect().height) + 8;
    });
    await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(server.resolvedUrls.local[0]);
  await page.waitForFunction(() => window.fixture);
  for (const [name, width, height, long] of [
    ['desktop', 1440, 900, false], ['portrait-desktop', 1080, 2400, false],
    ['compact-desktop', 1024, 768, true], ['tablet', 768, 1024, true],
    ['desktop-breakpoint', 701, 900, true], ['phone', 390, 844, false],
    ['phone-teaser', 390, 844, true], ['small-phone-teaser', 320, 568, true],
    ['desktop-return', 1440, 900, true],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(long => window.fixture.show(long), long); await settled();
    const value = await metrics();
    assert(value.hint && value.drop);
    assert(value.hint.x >= 0 && value.hint.x + value.hint.width <= width, `${name}: hint fits horizontally`);
    assert(value.hint.y >= value.drop.y + value.drop.height + 4, `${name}: hint clears fund notice`);
    assert(value.hint.y + value.hint.height <= height, `${name}: hint fits vertically`);
    for (const part of ['title', 'hud', 'connection', 'controls']) assert(!overlap(value.hint, value[part]), `${name}: hint clears ${part}`);
    for (const part of ['title', 'connection', 'controls']) assert(!overlap(value.drop, value[part]), `${name}: fund notice clears ${part}`);
    assert(!overlap(value.title, value.controls), `${name}: action rows clear title`);
    await page.screenshot({ path: `${out}/${name}.png` }); report.cases.push({ name, ...value });
  }
  await page.evaluate(() => window.fixture.hideDrop());
  await page.waitForFunction(() => document.body.style.getPropertyValue('--gt-drop-banner-height') === '0px');
  await settled();
  const desktopNoDrop = await metrics(); assert(!desktopNoDrop.drop);
  assert(desktopNoDrop.controls.y < report.cases.at(-1).controls.y, 'Hiding the fund notice releases its desktop space');
  for (const part of ['title', 'hud', 'connection', 'controls'])
    assert(!overlap(desktopNoDrop.hint, desktopNoDrop[part]), `desktop notice hidden: hint clears ${part}`);
  await page.setViewportSize({ width: 390, height: 844 }); await settled();
  await page.evaluate(() => window.fixture.hideDrop());
  await page.waitForFunction(() => document.body.style.getPropertyValue('--gt-drop-banner-height') === '0px');
  await settled(); const noDrop = await metrics(); assert(!noDrop.drop); assert(!overlap(noDrop.hint, noDrop.hud));
  await page.evaluate(() => window.fixture.shorter()); await settled();
  await page.evaluate(() => window.fixture.hideHint());
  await page.waitForFunction(() => !document.body.style.getPropertyValue('--gt-sa-nudge-height'));
  await page.evaluate(() => window.fixture.show()); await settled();
  await page.evaluate(() => window.fixture.destroy());
  await page.setViewportSize({ width: 320, height: 568 });
  assert.deepEqual(await page.evaluate(() => ({
    drop: document.body.style.getPropertyValue('--gt-drop-banner-height'),
    hint: document.body.style.getPropertyValue('--gt-sa-nudge-height'),
    remaining: document.querySelectorAll('.gt-drop-banner,.gt-sa-hint,.gt-hud').length,
  })), { drop: '', hint: '', remaining: 0 });
  assert.deepEqual(report.errors, []); report.passed = true;
  console.log(`ONBOARDING_DROP_LAYOUT:PASS:${report.cases.length} views plus hidden/destroy recovery`);
} catch (error) { report.failure = String(error); throw error; }
finally {
  await browser?.close(); server.httpServer.closeAllConnections(); await new Promise(done => server.httpServer.close(done));
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
}
