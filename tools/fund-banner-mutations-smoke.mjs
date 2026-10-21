/** Compare the real banner's DOM semantics and writes; this is not an FPS benchmark. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';

const baselineCommit = '04763eaf53ae8dca7faaa24e62bfe2449a25657b';
const baseline = execFileSync('git', ['show', `${baselineCommit}:web/src/drops/banner.ts`], { encoding: 'utf8' });
const candidate = await readFile('web/src/drops/banner.ts', 'utf8');
const digest = text => createHash('sha256').update(text).digest('hex');
const source = resolve('artifacts/fund-banner-mutations'), out = resolve('docs/perf/fund-banner-mutations');
await mkdir(source, { recursive: true }); await mkdir(out, { recursive: true });
// Resolve only the baseline's local CSS paths; its runtime code stays verbatim.
await writeFile(`${source}/before.ts`, baseline.replace("'../theme/saTheme.css'", JSON.stringify(resolve('web/src/theme/saTheme.css')))
  .replace("'./banner.css'", JSON.stringify(resolve('web/src/drops/banner.css'))));
await writeFile(`${source}/index.html`, '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Fund banner mutation check</title><style>body{margin:0;background:#183448}</style><script type="module" src="/entry.js"></script>');
await writeFile(`${source}/entry.js`, `
import {createDropBanner as before} from './before.ts';
import {createDropBanner as after} from '${resolve('web/src/drops/banner.ts')}';
const kind=new URLSearchParams(location.search).get('kind'),banner=(kind==='before'?before:after)();
if(!banner)throw Error('Normal fundDrops switch must be enabled');
const now=1791100000000;
const drop={id:'fixture',fundName:'Growth At All Costs',tagline:'Growth At All Costs announces a new fund — come pitch!',
 capacity:50,remaining:50,closesAt:now+900000,yourClaim:null};
const client={active:[drop],nearest:{drop,compass:'NW',distance:340},state:{upcoming:null}};
const settle=()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
const fields=['.gt-drop-title','.gt-drop-count','.gt-drop-timer','.gt-drop-dir','.gt-drop-teaser'];
const snapshot=()=>({hidden:banner.element.hidden,classes:banner.element.className,
 fields:fields.map(selector=>{const e=banner.element.querySelector(selector);return {selector,text:e.textContent,hidden:e.hidden,classes:e.className};}),
 height:document.body.style.getPropertyValue('--gt-drop-banner-height')});
window.fixture={async run(){
 const states=[];const record=async name=>{banner.update(client,now);await settle();states.push({name,...snapshot()});};
 await record('open');
 const observer=new MutationObserver(()=>{});observer.observe(banner.element,{attributes:true,childList:true,characterData:true,subtree:true});
 for(let i=0;i<240;i++)banner.update(client,now);
 const unchangedMutations=observer.takeRecords().length;
 const countdown=[];let countdownMutations=0;
 for(let i=0;i<240;i++){banner.update(client,now+i*1000/60);countdown.push(snapshot().fields);countdownMutations+=observer.takeRecords().length;}
 observer.disconnect();
 drop.remaining=10;await record('low');
 drop.remaining=1;await record('last-cheque');
 client.nearest.distance=10450;client.nearest.compass='E';await record('farther');
 client.state.upcoming={fundName:'Product Market Fit Partners',location:{label:'Washington Square, North Beach'},opensAt:now+120000};await record('teaser');
 drop.yourClaim={position:7,amountCents:'10000',fundName:drop.fundName};await record('claimed');
 drop.yourClaim=null;drop.remaining=0;await record('sold-out');
 drop.remaining=30;drop.fundName='New Fund';drop.tagline='New Fund announces a new fund — come pitch!';await record('new-fund');
 client.active=[];client.nearest=null;await record('hidden');
 client.active=[drop];client.nearest={drop,compass:'N',distance:120};await record('restored');
 drop.closesAt=now-1000;client.state.upcoming=null;await record('expired-no-teaser');
 client.nearest=null;await record('without-direction');
 const result={unchangedMutations,countdownMutations,countdown,states};
 drop.closesAt=now+900000;client.nearest={drop,compass:'N',distance:120};await record('screenshot');
 return result;
},destroy(){banner.destroy();}};
`);
const config = { configFile: false, root: source, publicDir: false, logLevel: 'warn',
  resolve: { alias: { '@gtasf/shared': resolve('shared') } },
  build: { target: 'es2022', outDir: `${source}/app`, emptyOutDir: true, reportCompressedSize: false } };
await build(config);
const server = await preview({ ...config, preview: { host: '127.0.0.1', port: 0 } });
const report = { at: new Date().toISOString(), scope: 'Real DOM state and mutation counts; isolated drop data, no FPS or whole-game acceptance',
  baselineCommit, baselineSha256: digest(baseline), candidateSha256: digest(candidate), errors: [], cases: [], passed: false };
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--disable-webgl'] });
  for (const [name, width, height] of [['phone', 390, 844], ['desktop', 1365, 900]]) {
    const results = {};
    for (const kind of ['before', 'after']) {
      const page = await browser.newPage({ viewport: { width, height } });
      page.on('pageerror', e => report.errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); });
      page.on('response', r => { if (r.status() >= 400) report.errors.push(`HTTP ${r.status()} ${r.url()}`); });
      await page.goto(`${server.resolvedUrls.local[0]}?kind=${kind}`);
      await page.waitForFunction(() => Boolean(window.fixture));
      results[kind] = await page.evaluate(() => window.fixture.run());
      await page.screenshot({ path: `${out}/${name}-${kind}.png` });
      await page.evaluate(() => window.fixture.destroy());
      assert.equal(await page.locator('.gt-drop-banner,.gt-drop-toast').count(), 0);
      assert.equal(await page.evaluate(() => document.body.style.getPropertyValue('--gt-drop-banner-height')), '');
      await page.close();
    }
    assert.deepEqual(results.after.states, results.before.states, `${name}: visible states and reserved height match`);
    assert.deepEqual(results.after.countdown, results.before.countdown, `${name}: every countdown label matches`);
    assert(results.before.unchangedMutations > 0, 'Baseline demonstrates real repeated writes');
    assert.equal(results.after.unchangedMutations, 0, 'Repeated identical state creates no mutations');
    assert(results.after.countdownMutations < results.before.countdownMutations);
    report.cases.push({ name, width, height, updates: 240,
      before: { unchangedMutations: results.before.unchangedMutations, countdownMutations: results.before.countdownMutations },
      after: { unchangedMutations: results.after.unchangedMutations, countdownMutations: results.after.countdownMutations },
      stateCount: results.after.states.length, statesEqual: true, countdownEqual: true, states: results.after.states });
  }
  assert.deepEqual(report.errors, []); report.passed = true;
  console.log(`FUND_BANNER_MUTATIONS:PASS ${JSON.stringify(report.cases.map(({ name, before, after }) => ({ name, before, after })))}`);
} catch (error) { report.failure = String(error); throw error; }
finally {
  await browser?.close(); server.httpServer.closeAllConnections(); await new Promise(done => server.httpServer.close(done));
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
}
