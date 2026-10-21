/** Production event-card DOM and keyboard behavior; no WebGL/world/device acceptance. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';

const root = process.cwd(), out = resolve(process.env.GTASF_CARD_SCROLL_OUT ?? 'artifacts/event-card-scroll');
await mkdir(out, { recursive: true });
const snapshot = JSON.parse(await readFile('worker/src/events/data/sf-tech-week.json', 'utf8'));
const events = ['tech-week:8354511f-3173-4949-924d-1e281ae9b9d1', 'tech-week:9e6a32fd-f931-48b4-b0f7-7115a7b6617d'].map(id => snapshot.events.find(event => event.id === id));
assert(events.every(Boolean));
await writeFile(`${out}/index.html`, '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Event card scroll baseline</title><style>body{margin:0;background:#263932;color:white}#scene{position:fixed;inset:0;width:100%;height:100%}#launch{position:fixed;left:8px;top:8px;z-index:30}</style><canvas id="scene" tabindex="0"></canvas><button id="launch">Open event</button><script type="module" src="/entry.js"></script>');
await writeFile(`${out}/entry.js`, `
import '${root}/web/src/style.css';
import {createPlayableHud} from '${root}/web/src/hud/playableHud.ts';
import {Input} from '${root}/web/src/input/input.ts';
import {holdFreeCursor} from '${root}/web/src/input/cursor.ts';
const events=${JSON.stringify(events)};
const input=new Input(document.querySelector('#scene'),{touch:false});
let release;
const hud=createPlayableHud({onShareEvent:async()=>{},onCardChange(open){input.release();if(open)release??=holdFreeCursor();else{release?.();release=undefined;}}});
let eventIndex=0;
document.querySelector('#launch').onclick=()=>hud.showEvent(events[eventIndex],2);
window.fixture={hud,events,input,select(index){eventIndex=index;},update(){hud.showEvent({...events[eventIndex]},3);},
sample(){input.poll(1/60);return {move:{...input.move},look:{...input.look}};},destroy(){hud.destroy();input.dispose();}};
`);
const config = {configFile:false,root:out,publicDir:false,logLevel:'warn',resolve:{alias:{'@gtasf/shared':resolve('shared')}},build:{target:'es2022',outDir:`${out}/app`,emptyOutDir:true,reportCompressedSize:false}};
await build(config);
const server=await preview({...config,preview:{host:'127.0.0.1',port:0}});
const report={at:new Date().toISOString(),scope:'Actual HUD/Input/CSS with committed public events; isolated DOM only',
  sourceHash:createHash('sha256').update(await readFile('web/src/hud/playableHud.ts')).digest('hex'),
  eventIds:events.map(event=>event.id),errors:[],cases:[],passed:false};
let browser;
try{
  browser=await chromium.launch({headless:true,args:['--disable-gpu','--disable-webgl']});
  for(const [name,width,height] of [['desktop-short',1100,400],['desktop',1100,720],['phone',390,568],['small-phone',320,568],['tall-phone',390,844]]){
    const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});
    page.on('pageerror',error=>report.errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
    page.on('response',response=>{if(response.status()>=400)report.errors.push(`HTTP ${response.status()} ${response.url()}`);});
    await page.goto(server.resolvedUrls.local[0]);await page.waitForFunction(()=>window.fixture);
    const launch=page.locator('#launch'),share=page.locator('.gt-event-share'),close=page.locator('.gt-event-close'),link=page.locator('.gt-event-link');
    const focused=locator=>locator.evaluate(el=>document.activeElement===el);
    const metrics=()=>page.locator('.gt-event-card').evaluate(card=>{
      const box=card.getBoundingClientRect(),close=card.querySelector('.gt-event-close'),r=close.getBoundingClientRect(),heading=card.querySelector('h2'),h=heading.getBoundingClientRect();
      return {scrollTop:card.scrollTop,scrollHeight:card.scrollHeight,clientHeight:card.clientHeight,closeFocused:document.activeElement===close,closeVisible:r.top>=box.top&&r.bottom<=box.bottom,
        headingVisible:h.top>=box.top&&h.bottom<=box.bottom,closeTop:r.top,cardTop:box.top,title:heading.textContent};
    });
    const startsAtHeading=value=>{assert.equal(value.scrollTop,0);assert(value.closeFocused&&value.closeVisible&&value.headingVisible,`${name}: fresh heading and focused Close visible`);};
    await launch.focus();await page.keyboard.press('Enter');
    const opened=await metrics();startsAtHeading(opened);
    await page.keyboard.press('Shift+Tab');assert(await focused(share));
    const scrolled=await metrics();
    await page.evaluate(()=>window.fixture.update());
    const updated=await metrics();assert.equal(updated.scrollTop,scrolled.scrollTop,'Open-card refresh preserves scroll');assert(await focused(share),'Open-card refresh preserves focused action');
    await page.keyboard.press('Escape');assert(await focused(launch));
    await page.keyboard.press('Enter');const reopened=await metrics();startsAtHeading(reopened);
    await page.screenshot({path:`${out}/${name}.png`});
    await page.keyboard.press('Tab');assert(await focused(link));
    await page.keyboard.press('Tab');assert(await focused(share));
    assert(await share.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));}),'Scrolled action is reachable');
    await page.keyboard.down('w');await page.keyboard.down('ArrowRight');
    assert.deepEqual(await page.evaluate(()=>window.fixture.sample()),{move:{x:0,y:0},look:{x:0,y:0}},'Modal blocks gameplay keys');
    await page.keyboard.up('ArrowRight');await page.keyboard.up('w');
    await page.keyboard.press('Escape');await page.evaluate(()=>window.fixture.select(1));
    await page.keyboard.press('Enter');const nextEvent=await metrics();startsAtHeading(nextEvent);assert.equal(nextEvent.title,events[1].title);
    await page.keyboard.press('Escape');await page.locator('#scene').focus();
    await page.keyboard.down('w');assert.equal((await page.evaluate(()=>window.fixture.sample())).move.y,1,'Closing returns movement');await page.keyboard.up('w');
    await page.keyboard.down('ArrowRight');assert((await page.evaluate(()=>window.fixture.sample())).look.x>0,'Closing returns camera');await page.keyboard.up('ArrowRight');
    await launch.focus();await page.keyboard.press('Enter');await page.evaluate(()=>window.fixture.hud.destroy());
    assert(await focused(launch),'Destroy restores opener');await page.locator('#scene').focus();
    await page.keyboard.down('w');assert.equal((await page.evaluate(()=>window.fixture.sample())).move.y,1,'Destroy releases modal');await page.keyboard.up('w');
    report.cases.push({name,width,height,opened,scrolled,updated,reopened,nextEvent,keyboardAndDisposal:true});
    await page.evaluate(()=>window.fixture.destroy());await page.close();
  }
  assert.deepEqual(report.errors,[]);
  assert(report.cases.filter(c=>c.scrolled.scrollTop>0).length>=2,'Exercise real overflow at two sizes');
  report.passed=true;console.log(`EVENT_CARD_SCROLL:PASS:${report.cases.length} cases`);
}catch(error){report.failure=String(error);throw error;}finally{
  await browser?.close();server.httpServer.closeAllConnections();await new Promise(done=>server.httpServer.close(done));
  await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));
}
