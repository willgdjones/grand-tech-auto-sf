import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

// Disposable DOM fixture only: canonical profiles never reach an API or ledger.
const root = process.cwd(), out = resolve(root, 'artifacts/funding-animation');
await mkdir(out, { recursive: true });
const bundle = await build({ stdin: { contents: `
import { createFundingHud } from './web/src/funding/hud.ts';
import { createPlayableHud } from './web/src/hud/playableHud.ts';
import { fundingRound } from './shared/funding.ts';
const profile = total => ({deviceId:'animation-fixture',startupName:'Fog Labs',nickname:'Karl',totalCents:total,todayCents:total,round:fundingRound(total),rank:1,todayRank:1,lastAwardAt:1,streak:1});
const frames = new Map(); let frameId=0, epoch=0;
window.requestAnimationFrame = callback => { const id=++frameId; frames.set(id,callback); return id; };
window.cancelAnimationFrame = id => frames.delete(id);
const hud=createPlayableHud(); hud.update({now:1791000000000});
const samples=[];
const funding=createFundingHud({statusParent:hud.element,onSaveIdentity:async()=>profile('0'),onRefreshLeaderboard:async()=>{throw Error('Unused fixture callback');},
 onDisplayChange:({profile,displayedCents})=>{samples.push(displayedCents);hud.setFundingProfile(profile,displayedCents);}});
funding.setProfile(profile('0'));
window.animationSmoke={
 set(total){epoch=performance.now();return funding.setProfile(profile(total));},
 same(total){return funding.setProfile({...profile(total),nickname:'Saved name'});},
 step(delta){const work=[...frames.values()];frames.clear();for(const frame of work)frame(epoch+delta);return this.inspect();},
 inspect(){return {samples:[...samples],displayed:funding.animatedCents,pending:frames.size,money:document.querySelector('.gt-hud-money-value').textContent};},
 invalid(){return funding.setProfile({...profile('0'),totalCents:'-1'});},
 destroy(){funding.destroy();hud.destroy();return frames.size;}
};
`, resolveDir: root, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', loader: { '.css': 'empty' },
 plugins: [{ name:'fixture-flags', setup(b) {
  b.onResolve({filter:/^@gtasf\/shared\/flags$/},()=>({path:'flags',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const flags={hud:true,eventVisits:true,fundedStars:true,fundingLoop:true,loadingArt:false};',loader:'js'}));
 } }], logLevel:'error' });
const script=bundle.outputFiles[0].text;
const server=createServer((req,res)=>{
 if(req.url==='/app.js'){res.writeHead(200,{'Content-Type':'text/javascript'}).end(script);return;}
 if(req.url==='/favicon.ico'){res.writeHead(204).end();return;}
 res.writeHead(200,{'Content-Type':'text/html'}).end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body><script type="module" src="/app.js"></script>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
const report={at:new Date().toISOString(),scope:'Actual funding and playable HUD modules in isolated DOM; controlled animation callbacks only, no server or performance claim',errors:[],passed:false};
try {
 browser=await chromium.launch({headless:true,args:['--disable-gpu']});
 const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'no-preference'});
 page.on('pageerror',e=>report.errors.push(e.stack??e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.animationSmoke);
 await page.evaluate(()=>window.animationSmoke.set('50000000'));
 report.first=await page.evaluate(()=>window.animationSmoke.step(-4));
 assert.equal(report.first.displayed,'0');assert.equal(report.first.money,'$00000000');
 report.middle=await page.evaluate(()=>window.animationSmoke.step(400));
 assert(BigInt(report.middle.displayed)>0n&&BigInt(report.middle.displayed)<50000000n);
 await page.evaluate(()=>window.animationSmoke.same('50000000'));
 assert.equal((await page.evaluate(()=>window.animationSmoke.inspect())).displayed,report.middle.displayed);
 report.final=await page.evaluate(()=>window.animationSmoke.step(1000));
 assert.equal(report.final.displayed,'50000000');assert.equal(report.final.money,'$00500000');assert.equal(report.final.pending,0);
 for(let i=1;i<report.final.samples.length;i++)assert(BigInt(report.final.samples[i])>=BigInt(report.final.samples[i-1]));
 await page.evaluate(()=>window.animationSmoke.set('300000000'));
 const held=await page.evaluate(()=>window.animationSmoke.step(-4));assert.equal(held.displayed,'50000000');
 assert.equal((await page.evaluate(()=>window.animationSmoke.step(1000))).money,'$03000000');
 assert.equal(await page.evaluate(()=>window.animationSmoke.invalid()),false);
 await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>window.animationSmoke.set('1500000000'));
 report.reduced=await page.evaluate(()=>window.animationSmoke.inspect());assert.equal(report.reduced.displayed,'1500000000');assert.equal(report.reduced.pending,0);
 await page.emulateMedia({reducedMotion:'no-preference'});await page.evaluate(()=>window.animationSmoke.set('5000000000'));
 assert.equal(await page.evaluate(()=>window.animationSmoke.destroy()),0);assert.deepEqual(report.errors,[]);
 report.passed=true;console.log('TEST_PASSED:FundingAnimation');
} catch(error){report.failure=String(error);throw error;}
finally {await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));}
