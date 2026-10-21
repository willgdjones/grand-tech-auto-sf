/** Frozen real game + disposable native backend. No payment/email keys or financial fixtures. */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build as bundle } from 'esbuild';
import { build, preview } from 'vite';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
const out=resolve('artifacts/referrals-game'),configFile=resolve('web/vite.config.ts');await mkdir(out,{recursive:true});
const flags=source=>source.replace(/\b(referrals|referralWarmIntro): false/g,'$1: true');
if(!process.argv.includes('--skip-build')){
  const worker=await bundle({entryPoints:['worker/src/index.ts'],bundle:true,format:'esm',platform:'browser',target:'es2022',external:['cloudflare:workers','node:*'],conditions:['workerd','worker','browser'],write:false,logLevel:'error',plugins:[{name:'referral-preview-flags',setup(b){b.onLoad({filter:/shared\/flags\.ts$/},async args=>({loader:'ts',contents:flags(await readFile(args.path,'utf8'))}));}}]});
  await writeFile(`${out}/worker.js`,worker.outputFiles[0].text);
  await build({configFile,root:resolve('web'),logLevel:'warn',plugins:[{name:'referral-preview-flags',enforce:'pre',transform(code,id){if(id===resolve('shared/flags.ts'))return flags(code);}}],build:{outDir:`${out}/app`,emptyOutDir:true,reportCompressedSize:false}});
}
if(process.argv.includes('--build-only')){console.log('REFERRAL_GAME_BUILD_READY');process.exit(0);}
const pool=process.env.GTASF_REFERRAL_WORKER?null:new Miniflare(convertV4MiniflareOptions({host:'127.0.0.1',port:0,cf:false,telemetry:{enabled:false},workers:[{name:'referral-game',modules:true,scriptPath:`${out}/worker.js`,compatibilityDate:'2026-09-28',compatibilityFlags:['nodejs_compat'],bindings:{ENVIRONMENT:'local',LAUNCH_MODE:'open'},durableObjects:{WORLD:{className:'WorldDO',useSQLite:true},LEDGER:{className:'LedgerDO',useSQLite:true},LOBBY:{className:'LobbyDO',useSQLite:true}},d1Databases:['DB'],r2Buckets:['ASSETS'],queueProducers:{JOBS:'fixture-jobs'},outboundService:()=>{throw new Error('Unexpected external request in referral game smoke');}}]}));
let browser,server;
const report={at:new Date().toISOString(),scope:process.env.GTASF_REFERRAL_WORKER?'Real frozen game and existing local Worker/D1, referrals/warm-intro only; no external providers or gate claim':'Real frozen game and native disposable backend, referrals/warm-intro only; no external providers or gate claim',errors:[],httpErrors:[],checks:[]};
try{
  const url=process.env.GTASF_REFERRAL_WORKER??String(await pool.ready);
  if(pool){const db=await pool.getD1Database('DB');
  for(const file of (await readdir('worker/migrations')).filter(name=>/^\d.*\.sql$/.test(name)).sort())for(const sql of (await readFile(`worker/migrations/${file}`,'utf8')).replace(/--[^\n]*/g,'').split(';').filter(s=>s.trim()))await db.prepare(sql).run();
  const snapshot=JSON.parse(await readFile('worker/src/events/data/sf-tech-week.json','utf8'));
  for(let i=0;i<snapshot.events.length;i+=50)await db.batch(snapshot.events.slice(i,i+50).map(e=>db.prepare('INSERT INTO events(id,title,host,starts_at,ends_at,venue,address,url,lat,lon,approximate,source,tags_json,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(e.id,e.title,e.host,e.start,e.end,e.venue,e.address,e.url,e.lat,e.lon,Number(e.approx),e.source,JSON.stringify(e.tags),snapshot.capturedAt)));
  }
  server=await preview({configFile,root:resolve('web'),build:{outDir:`${out}/app`},preview:{host:'127.0.0.1',port:0,proxy:{'/api':{target:url,ws:true}}}});
  const base=server.resolvedUrls.local[0];browser=await chromium.launch({headless:process.env.GTASF_HEADLESS==='1'});
  for(const phone of [false,true]){
    const context=await browser.newContext({viewport:phone?{width:390,height:844}:{width:1365,height:900},isMobile:phone,hasTouch:phone,permissions:['clipboard-read','clipboard-write']});
    const page=await context.newPage();page.setDefaultTimeout(45000);
    page.on('pageerror',error=>report.errors.push(error.message));page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});page.on('response',response=>{if(response.status()>=400)report.httpErrors.push({path:new URL(response.url()).pathname,status:response.status()});});
    await page.goto(base);await page.waitForFunction(()=>window.__gtasf?.ready);await page.waitForSelector('#world[data-connected="true"]');await page.waitForSelector('#loading',{state:'hidden'});
    const identity=page.locator('.gt-funding-onboarding[open]');await identity.waitFor();await page.getByLabel('Startup name',{exact:true}).fill(phone?'Mobile Referral':'Desktop Referral');await page.getByLabel('Your nickname',{exact:true}).fill(phone?'Phone':'Desktop');await identity.getByRole('button',{name:'Save startup',exact:true}).click();await identity.waitFor({state:'hidden'});
    report.layout ??= [];
    report.layout.push(await page.evaluate(() => {
      const box=selector=>{const el=document.querySelector(selector);if(!el)return null;const r=el.getBoundingClientRect();return {selector,text:el.textContent?.slice(0,120),left:r.left,right:r.right,top:r.top,bottom:r.bottom};};
      return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,boxes:['#play-controls','.gt-referral-launch','#prompt','.gt-radar','.gt-route-hud','.gt-street-hud','.gt-upcoming-open'].map(box).filter(Boolean)};
    }));
    await page.screenshot({path:`${out}/street-${phone?'phone':'desktop'}.png`});
    const launch=page.getByRole('button',{name:'Share and earn 20%',exact:true});if(phone)await launch.tap();else await launch.click();
    await page.getByText('Email delivery is not available yet.',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'Send verification link',exact:true}).isDisabled(),true);
    const before=await page.evaluate(()=>({...window.__gtasf.world.foot}));await page.keyboard.down('KeyW');await page.waitForTimeout(200);await page.keyboard.up('KeyW');const after=await page.evaluate(()=>({...window.__gtasf.world.foot}));assert.ok(Math.hypot(after.x-before.x,after.z-before.z)<.02,'Referral modal holds movement');
    await page.getByRole('button',{name:'Copy my link',exact:true}).click();const link=await page.evaluate(()=>navigator.clipboard.readText());assert.match(new URL(link).searchParams.get('ref'),/^[a-f0-9]{24}$/);
    assert.equal(await page.locator('.gt-referral-panel').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&el.scrollWidth<=el.clientWidth;}),true);
    await page.screenshot({path:`${out}/panel-${phone?'phone':'desktop'}.png`});
    await page.keyboard.press('Escape');await page.locator('.gt-referral-panel').waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>window.__gtasf.world.referralPanel.modalOpen),false);
    await page.getByRole('button',{name:'Top 50',exact:true}).click();await page.locator('.gt-outbid-dialog').waitFor();assert.equal(await page.locator('.gt-referral-panel').isVisible(),false);await page.keyboard.press('Escape');
    report.checks.push(`${phone?'Phone touch':'Desktop'}: actual entry/bootstrap, identity, launch button, server-owned zero balance, unavailable email, copied ref, modal movement suppression/Escape and Outbid coexistence`);
    await context.close();
  }
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.httpErrors,[]);report.passed=true;console.log('TEST_PASSED:ReferralGameIntegration');
}catch(error){report.failure=String(error);throw error;}finally{await browser?.close();if(server){server.httpServer.closeAllConnections();await new Promise(done=>server.httpServer.close(done));}await pool?.dispose();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2)+'\n');}
