/** Real admission/Game options/Events DOM; isolated admission and waitlist responses. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';
const stage = process.env.GTASF_ADMISSION_KEYS_STAGE === 'before' ? 'before' : 'after';
const out = resolve('artifacts/admission-keyboard', stage);
await mkdir(out, { recursive: true });
const config = { configFile: false, root: out, logLevel: 'warn', resolve: { alias: { '@gtasf/shared': resolve('shared'), '../input/cursor': resolve('web/src/input/cursor.ts') } },
  build: { target: 'es2022', outDir: `${out}/app`, emptyOutDir: true, reportCompressedSize: false } };
if (!process.argv.includes('--run-only')) {
  // Keep the original source byte-for-byte while native acceptance owns the CPU.
  if(stage==='before'){
    await mkdir(`${out}/source`,{recursive:true});
    for(const name of ['client.ts','style.css']){
      try{await writeFile(`${out}/source/${name}`,await readFile(resolve('web/src/admission',name)),{flag:'wx'});}
      catch(error){if(error.code!=='EEXIST')throw error;}
    }
  }
  await writeFile(`${out}/index.html`, '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Admission keyboard fixture</title><style>body{background:#263932;color:white;margin:20px;font:16px Arial}</style><button id="launcher">Game options</button><button id="other">Other game action</button><script type="module" src="/entry.js"></script>');
  await writeFile(`${out}/entry.js`, `import * as admission from '${stage==='before'?`${out}/source/client.ts`:resolve('web/src/admission/client.ts')}';
import {createGameOptions} from '${resolve('web/src/hud/gameOptions.ts')}';
import {createUpcomingEvents} from '${resolve('web/src/events/upcoming.ts')}';
import {needsFreeCursor} from '${resolve('web/src/input/cursor.ts')}';
let admit=false,allowed=true,signups=0,joined=false,gameActions=0;const requests=[];
window.fetch=async(url,init)=>{const path=String(url);requests.push(path);if(path==='/api/admission')return Response.json({allowed,enabled:true,launchMode:'invite',capacity:1,waitlist:true});
if(path==='/api/waitlist'){signups++;return Response.json({accepted:true});}if(path==='/api/admission/leave')return Response.json({ok:true});
if(path==='/api/admission/poll'||path==='/api/admission/enter')return Response.json(admit?{status:'admitted',ticket:'a'.repeat(64),grant:'b'.repeat(64),nextPollS:10}:{status:'queued',ticket:'a'.repeat(64),position:2,queueLength:2,population:1,capacity:1,etaSeconds:null,nextPollS:1});throw Error('Unexpected fixture request '+path);};
const options=createGameOptions({launcher:document.querySelector('#launcher'),tankControls:()=>false,toggleMovement:()=>{},onModalChange:()=>{}});
const events=createUpcomingEvents({enabled:true,frame:{origin:{lat:37.7955,lon:-122.3937},gridRotationDeg:0},onSelect:()=>{},onHail:()=>{}});events.setEvents([]);
document.querySelector('#other').onclick=()=>gameActions++;
window.fixture={options,events,requests,needsFreeCursor,admission,start(idle=true){void admission.waitForAdmission({requireInput:idle}).then(()=>joined=true);},admit(){admit=true;},launch(){allowed=false;},get joined(){return joined;},get signups(){return signups;},get gameActions(){return gameActions;},destroy(){admission.admissionConsumed();events.destroy();options.destroy();}};
`);
  await build(config);
}
if (process.argv.includes('--build-only')) { console.log('Built '+stage+' admission keyboard fixture'); process.exit(0); }
const server = await preview({ ...config, preview: { host: '127.0.0.1', port: 0 } });
let browser; const report = { checkedAt: new Date().toISOString(), stage, scope: 'Admission keyboard DOM with local response fixtures; no live API/World/rendering', errors: [], views: [], passed: false };
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--disable-webgl'] });
  for (const [name, width, height] of [['desktop', 1100, 720], ['phone', 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } }); page.setDefaultTimeout(5000);
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
    page.on('request', request => { if(new URL(request.url()).pathname.startsWith('/api/'))report.errors.push('Unstubbed API request'); });
    const reset = async () => { await page.goto(server.resolvedUrls.local[0]); await page.waitForFunction(() => window.fixture); };
    const launcher = page.locator('#launcher'), rejoin = page.getByRole('button', { name: 'Rejoin the queue', exact: true });
    const email = page.getByRole('textbox', { name: 'Get notified when a spot opens', exact: true });
    const focused = locator => locator.evaluate(element => document.activeElement === element);
    const inPanel = () => page.locator('.admission').evaluate(element => element.contains(document.activeElement));
    const cases = [];
    await reset(); await launcher.focus(); await page.evaluate(() => window.fixture.start()); await rejoin.waitFor();
    assert.equal(await focused(stage === 'before' ? launcher : rejoin), true);
    if(stage === 'before') {
      await page.keyboard.press('Enter'); assert.equal(await page.evaluate(() => window.fixture.options.modalOpen), true);
      cases.push('idle screen leaves underlying launcher focused; Enter opens Game options over admission');
      await reset(); await launcher.focus(); await page.evaluate(() => window.fixture.start()); await rejoin.waitFor();
      await page.keyboard.press('v'); assert.equal(await page.evaluate(() => window.fixture.events.isOpen), true);
      cases.push('idle screen allows Events V shortcut');
    } else {
      for(let i=0;i<5;i++){await page.keyboard.press('Tab');assert.equal(await inPanel(),true);}
      for(let i=0;i<5;i++){await page.keyboard.press('Shift+Tab');assert.equal(await inPanel(),true);}
      await rejoin.focus(); await page.keyboard.press('v'); await page.keyboard.press('m'); await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => window.fixture.events.isOpen || window.fixture.options.modalOpen),false);
      assert.equal(await page.evaluate(() => window.fixture.admission.admissionBlocked()),true);
      assert.equal(await page.evaluate(() => window.fixture.requests.length),0);
      cases.push('idle focuses rejoin, both Tab directions stay inside, game shortcuts/Escape cannot dismiss gate');
      await page.keyboard.press('Enter'); await page.getByRole('heading',{name:'You’re #2 in line',exact:true}).waitFor();
      await email.fill('queue-fixture@example.test'); await page.keyboard.press('End');
      for(let i=0;i<4;i++)await page.keyboard.press('ArrowLeft');
      const count=await page.evaluate(()=>window.fixture.requests.length);
      await page.waitForFunction(count=>window.fixture.requests.length>count,count);
      assert.equal(await focused(email),true); assert.equal(await email.inputValue(),'queue-fixture@example.test');
      await page.keyboard.type('x'); assert.equal(await email.inputValue(),'queue-fixture@example.xtest');
      await page.screenshot({path:`${out}/${name}.png`});
      await page.getByRole('button',{name:'Notify me',exact:true}).click();
      await page.getByText('You’re on the list.',{exact:false}).waitFor(); assert.equal(await page.evaluate(()=>window.fixture.signups),1);
      await page.keyboard.press('Tab'); assert.equal(await inPanel(),true);
      cases.push('keyboard rejoin polls normally; queue refresh preserves email/caret; signup stays local and gate retains focus');
      await page.evaluate(()=>window.fixture.admit()); await page.waitForFunction(()=>window.fixture.joined);
      assert.equal(await page.locator('.admission').count(),0); assert.equal(await page.evaluate(()=>window.fixture.needsFreeCursor()),false);
      await launcher.focus(); await page.keyboard.press('Enter'); assert.equal(await page.evaluate(()=>window.fixture.options.modalOpen),true);
      await page.keyboard.press('Escape'); assert.equal(await focused(launcher),true);
      cases.push('admission removes gate and keyboard/cursor ownership; normal game controls work');
      await reset(); await launcher.click(); await page.evaluate(()=>window.fixture.start()); await rejoin.waitFor();
      assert.equal(await focused(rejoin),true); await page.keyboard.press('Escape'); assert.equal(await inPanel(),true);
      await page.evaluate(()=>window.fixture.admit()); await rejoin.press('Enter'); await page.waitForFunction(()=>window.fixture.joined);
      assert.equal(await page.evaluate(()=>window.fixture.options.modalOpen),true);
      assert.equal(await page.locator('.gt-game-options').evaluate(element=>element.contains(document.activeElement)),true);
      cases.push('idle gate sits above an already-open native dialog and restores its focus after admission');
      await reset(); await launcher.focus(); await page.evaluate(()=>{window.fixture.launch();window.fixture.start(false);});
      await page.getByRole('heading',{name:'San Francisco is opening soon',exact:true}).waitFor();
      assert.equal(await focused(page.getByRole('textbox',{name:'Get notified when the city opens',exact:true})),true);
      await page.keyboard.press('Shift+Tab'); assert.equal(await inPanel(),true);
      await page.keyboard.press('Tab'); assert.equal(await inPanel(),true);
      await page.keyboard.press('Escape'); assert.equal(await page.evaluate(()=>window.fixture.admission.admissionBlocked()),true);
      assert.deepEqual(await page.evaluate(()=>window.fixture.requests),['/api/admission']);
      cases.push('launch-only screen uses the same keyboard boundary without World or waitlist requests');
    }
    await page.evaluate(()=>window.fixture.destroy()); await page.close(); report.views.push({name,cases});
  }
  assert.deepEqual(report.errors,[]);report.passed=true;console.log(JSON.stringify({stage,passed:true,views:report.views.length,errors:report.errors}));
} catch(error){report.failure=error.message;throw error;}
finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser?.close();server.httpServer.closeAllConnections();await new Promise(done=>server.httpServer.close(done));}
