import { build } from 'vite';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { resolve,extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

// Isolated UI fixture: these profiles never enter the game, API or ledger.
export async function checkFundingHud(existingBrowser,{buildOnly=false}={}) {
  const root=fileURLToPath(new URL('../',import.meta.url));
  const src=resolve(root,'artifacts/funding-hud/source'),out=resolve(root,'artifacts/funding-hud/preview');
  await mkdir(src,{recursive:true});
  await writeFile(resolve(src,'flags.ts'),'export const flags={hud:true,eventVisits:true,fundedStars:true,fundingLoop:true,loadingArt:true};');
  await writeFile(resolve(src,'index.html'),`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Funding UI smoke</title></head><body style="margin:0;background:linear-gradient(#6f9eaa,#c7ba91);height:100vh"><script type="module" src="./scene.ts"></script></body></html>`);
  await writeFile(resolve(src,'scene.ts'),`
import {createPlayableHud} from '/web/src/hud/playableHud.ts';
import {createFundingHud} from '/web/src/funding/hud.ts';
import {createUpcomingEvents} from '/web/src/events/upcoming.ts';
import {fundingRound} from '/shared/funding.ts';
const profile=(total='0')=>({deviceId:'ui-smoke',startupName:'Fog & Founders',nickname:'Karl',totalCents:total,todayCents:total,round:fundingRound(total),rank:2,todayRank:1,lastAwardAt:total==='0'?null:1791000000000,streak:1});
let canonical=profile(),failSave=true,saveCalls=0,refreshCalls=0,modal=false,clockBase=Date.now(),clockAt=performance.now(),resetDay=false;
const other={...profile('900000000'),deviceId:'other',startupName:'<img src=x onerror=alert(1)>',nickname:'Text only',rank:1,todayRank:2,live:false};
const board=()=>{const now=clockBase+performance.now()-clockAt,reset=resetDay&&now>=Date.parse('2026-10-06T07:00:00Z');if(reset)canonical={...canonical,todayCents:'0',todayRank:null};return {week:[other,{...canonical,live:true}],today:reset?[]:[{...canonical,live:true},other],you:canonical,serverNow:now};};
const hud=createPlayableHud();hud.update({now:1791000000000,radioStation:'KVC Radio',radioPlaying:true,radioTicker:'Breaking: another founder just raised a coffee round.'});
const funding=createFundingHud({statusParent:hud.element,onModalChange:open=>modal=open,onDisplayChange:({profile,displayedCents})=>hud.setFundingProfile(profile,displayedCents),
onSaveIdentity:async(startupName,nickname)=>{saveCalls++;if(failSave)throw new Error('Connection lost. Please retry.');canonical={...canonical,startupName,nickname};return canonical;},
onRefreshLeaderboard:async()=>{refreshCalls++;return board();}});
funding.setProfile(canonical);
const award=()=>{const previousRound=canonical.round;canonical=profile('1500000000');return{id:'ui-award',eventId:'fixture',eventTitle:'Founders on the waterfront',awardedAt:1791000000000,day:'2026-10-02',previousRound,profile:canonical,kind:'investor',baseCents:'100000000',timing:'live',timeMultiplier:3,crowdCount:2,crowdMultiplier:1.2,streakCount:1,streakMultiplier:1,amountCents:'1500000000'};};
const upcoming=createUpcomingEvents({enabled:true,frame:{origin:{lat:37.79,lon:-122.4},gridRotationDeg:0},now:()=>Date.parse('2026-10-05T17:00:00Z'),onSelect:()=>false,onHail:()=>false});
upcoming.setEvents([{id:'ui-live',title:'Live fixture founders',start:'2026-10-05T16:00:00Z',end:'2026-10-05T18:00:00Z',lat:37.79,lon:-122.4,approx:true,url:'https://www.tech-week.com/calendar/sf'}]);
window.fundingSmoke={funding,award,allowSave:()=>failSave=false,rollover:()=>{resetDay=true;clockBase=Date.parse('2026-10-06T06:59:59.800Z');clockAt=performance.now();funding.setLeaderboard(board());},inspect:()=>({modal,saveCalls,refreshCalls,animatedCents:funding.animatedCents,canonical}),destroy:()=>{upcoming.destroy();funding.destroy();hud.destroy();}};
`);
  await build({configFile:false,root,publicDir:false,logLevel:'warn',resolve:{alias:[{find:/^@gtasf\/shared\/flags$/,replacement:resolve(src,'flags.ts')}]},
    build:{outDir:out,emptyOutDir:false,rollupOptions:{input:resolve(src,'index.html')}}});
  if(buildOnly)return {built:true,out};
  const server=createServer(async(req,res)=>{
    const path=(req.url??'/').split('?')[0];if(path==='/favicon.ico'){res.writeHead(204).end();return;}
    const isRoundArt=path==='/art/loading/round-closed.webp';
    const file=isRoundArt?resolve(root,'web/public/art/loading/round-closed.webp'):path==='/'?resolve(out,'artifacts/funding-hud/source/index.html'):resolve(out,`.${path}`);
    if(!isRoundArt&&!file.startsWith(`${out}/`)){res.writeHead(403).end();return;}
    try{const data=await readFile(file);res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.webp':'image/webp'})[extname(file)]??'application/octet-stream');res.end(data);}
    catch{res.writeHead(404).end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  let browser=existingBrowser,page;const errors=[];
  try{
    browser??=await chromium.launch({headless:true,args:['--disable-gpu']});
    page=await browser.newPage({viewport:{width:1200,height:800}});
    page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>!!window.fundingSmoke);
    await page.getByRole('button',{name:'Edit startup name and nickname'}).click();
    assert.equal(await page.evaluate(()=>window.fundingSmoke.inspect().modal),true);
    await page.getByLabel('Startup name',{exact:true}).fill('Fog Machine Labs');await page.getByLabel('Your nickname',{exact:true}).fill('Ada');
    await page.getByRole('button',{name:'Save startup'}).click();await page.getByText('Connection lost. Please retry.').waitFor();
    assert.equal((await page.evaluate(()=>window.fundingSmoke.inspect())).canonical.startupName,'Fog & Founders');
    await page.screenshot({path:resolve(out,'identity-desktop.png')});
    await page.evaluate(()=>window.fundingSmoke.allowSave());await page.getByRole('button',{name:'Save startup'}).click();
    await page.waitForFunction(()=>!window.fundingSmoke.inspect().modal);
    assert.equal((await page.evaluate(()=>window.fundingSmoke.inspect())).canonical.startupName,'Fog Machine Labs');
    await page.getByRole('button',{name:'Open earned funding leaderboard'}).click();await page.locator('tbody tr').nth(1).waitFor();
    assert.equal(await page.locator('tbody img').count(),0);assert.equal(await page.locator('tbody tr').count(),2);
    await page.screenshot({path:resolve(out,'leaderboard-desktop.png')});
    await page.getByRole('button',{name:'Top raisers today',exact:true}).click();assert.match(await page.locator('tbody tr').first().innerText(),/Fog Machine Labs/);
    await page.getByRole('button',{name:'Online now',exact:true}).click();assert.equal(await page.locator('tbody tr').count(),1);
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:resolve(out,'leaderboard-phone.png')});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    const bounds=await page.locator('dialog[open]').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=390);
    await page.keyboard.press('Escape');await page.waitForFunction(()=>!window.fundingSmoke.inspect().modal);
    const accepted=await page.evaluate(()=>{const award=window.fundingSmoke.award();return [window.fundingSmoke.funding.showAward(award),window.fundingSmoke.funding.showAward(award)];});
    assert.deepEqual(accepted,[true,false]);
    await page.waitForFunction(()=>window.fundingSmoke.inspect().animatedCents==='1500000000');
    assert.equal(await page.locator('.gt-star.earned').count(),3);assert.equal(await page.locator('.gt-star').count(),5);
    assert.match(await page.locator('.gt-funding-toast-title').innerText(),/SERIES A CLOSED/);
    assert.match(await page.locator('.gt-hud-rank').innerText(),/#2/);
    assert.match(await page.locator('.gt-funding-headline').innerText(),/hires someone to explain/);
    assert.match(await page.locator('.gt-funding-toast-bonus').innerText(),/2 other founders · \+20% crowd/);
    await page.waitForFunction(()=>document.querySelector('.gt-funding-round-art')!==null);
    const [controls,toast]=await Promise.all([page.locator('.gt-funding-controls').boundingBox(),page.locator('.gt-funding-toast').boundingBox()]);
    await page.screenshot({path:resolve(out,'award-phone.png')});
    assert.ok(controls.y+controls.height<toast.y,`Phone controls/toast overlap: ${JSON.stringify({controls,toast})}`);
    await page.getByRole('button',{name:'Open earned funding leaderboard'}).click();
    await page.getByRole('button',{name:'Top raisers today',exact:true}).click();
    await page.evaluate(()=>window.fundingSmoke.rollover());
    await page.waitForFunction(()=>document.querySelector('.gt-funding-reset').textContent.includes('2026-10-06')&&document.querySelectorAll('tbody tr').length===0);
    assert.match(await page.locator('.gt-funding-totals').innerText(),/\$15M[\s\S]*\$0/);
    assert.match(await page.locator('.gt-funding-next-round').innerText(),/to Series B/);
    await page.keyboard.press('Escape');
    await page.locator('.gt-upcoming-open').click();
    assert.equal(await page.getByRole('tab',{name:/^Live now/}).getAttribute('aria-selected'),'true');
    assert.match(await page.locator('.gt-upcoming-callout-label').innerText(),/1 happening now · ×3/);
    await page.screenshot({path:resolve(out,'live-callout-phone.png')});
    await page.evaluate(()=>window.fundingSmoke.destroy());assert.deepEqual(errors,[]);
    const evidence={checkedAt:new Date().toISOString(),ok:true,identityRetry:true,canonicalCountUp:true,stars:'3/5',awardDeduped:true,desktop:true,phone:true,phoneBounds:{controls,toast},sfMidnightRollover:true,liveCallout:true,roundHeadline:'SERIES A CLOSED',errors};
    await writeFile(resolve(out,'smoke.json'),JSON.stringify(evidence,null,2));return {...evidence,out};
  }finally{await page?.close();if(!existingBrowser)await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await checkFundingHud(undefined,{buildOnly:process.argv.includes('--build-only')})));
