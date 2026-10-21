/** Pane-6 native comparison for gtasf-n24e. Isolated 2D diagnostic, never a phone FPS gate. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const hash = value => createHash('sha256').update(value).digest('hex');
const runFile = promisify(execFile);
const out = resolve(process.env.GTASF_RADAR_CACHE_OUT ?? `artifacts/radar-text-cache/${new Date().toISOString().replaceAll(':', '-')}`);
assert.ok(!(process.argv.includes('--prepare-only') && process.argv.includes('--run-only')), 'Choose preparation or execution');
const report = { at: new Date().toISOString(), out, kind: 'isolated fixed-time 2D CPU submission diagnostic; not wall-frame FPS',
  sources: {}, scenarios: [], errors: [], checks: [], passed: false };
await mkdir(out, { recursive: true });
async function candidateSources() {
  const before = process.env.GTASF_RADAR_CACHE_BASE ? await readFile(resolve(process.env.GTASF_RADAR_CACHE_BASE), 'utf8')
    : (await runFile('git', ['show', '0425a5d:web/src/radar/radar.ts'], { maxBuffer: 1_000_000 })).stdout;
  const patchPath = resolve('tools/radar-text-cache-candidate.patch');
  const patch = await readFile(patchPath, 'utf8'), cache = await readFile('tools/radar-text-cache-candidate.ts', 'utf8');
  assert.equal(hash(before), 'b6f99ae46a4a5983dcc570beaf77e88a24f6842f5858383d5b6f578b611e7d87', 'Pinned baseline revision');
  assert.equal(hash(cache), '691e3aadc2f4cd0862a9f08d2ac4f7165f9898204325adf6977810f0a828e334', 'Measured cache candidate');
  // Reconstruct the rejected wiring in an owned temporary directory, never in the checkout.
  const scratch = await mkdtemp(join(tmpdir(), 'gtasf-radar-cache-'));
  try {
    await mkdir(`${scratch}/web/src/radar`, { recursive: true }); await writeFile(`${scratch}/web/src/radar/radar.ts`, before);
    await runFile('git', ['apply', '--unidiff-zero', '--check', patchPath], { cwd: scratch });
    await runFile('git', ['apply', '--unidiff-zero', patchPath], { cwd: scratch });
    const after = await readFile(`${scratch}/web/src/radar/radar.ts`, 'utf8');
    assert.equal(hash(after), 'e944a14b0a5eca80f05c11f5ff5dbe2c9f86d979794611bc0ad89d6800db4a67', 'Measured radar candidate');
    return { before, after, cache, patch };
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
const entry = `
import './web/src/theme/saTheme.css';
import { flags } from './shared/flags';
import { createRadar } from './web/src/radar/radar';
import { createRadarTextCache } from './tools/radar-text-cache-candidate';
if (!flags.radar || !flags.fullMap || !flags.saMapStyle || !flags.venueGrouping || !flags.eventFocus24h) throw Error('Local map flags required');
const NOW = Date.parse('2026-10-04T12:00:00Z'); Date.now = () => NOW;
let seed = 481; Math.random = () => ((seed = seed * 16807 % 2147483647) - 1) / 2147483646;
const frame = { origin: {lat:37.7955,lon:-122.3937},gridRotationDeg:0 };
const graph = {version:1,nodes:[{id:'a',x:-12000,y:0,z:0},{id:'b',x:12000,y:0,z:0}],edges:[
  {id:'lane:out',from:'a',to:'b',lengthM:24000,speedMps:10,lane:1,points:[[-12000,0,0],[12000,0,0]]},
  {id:'lane:back',from:'b',to:'a',lengthM:24000,speedMps:10,lane:1,points:[[12000,0,0],[-12000,0,0]]}]};
const kinds = ['Investor office hours','Demo pitch','Hackathon','Party mixer','Talk panel','Networking coffee','Launch event'];
const feed = [];
for(let venue=0;venue<420;venue++) {
  const count = venue % 3 === 0 ? 2 + venue % 7 : 1;
  for(let i=0;i<count;i++) feed.push({id:venue+'-'+i,title:kinds[venue%kinds.length]+' '+venue+'/'+i,
    start:new Date(NOW+(venue%5===0?-3600000:3600000)).toISOString(),end:new Date(NOW+7200000).toISOString(),
    venue:'Cache venue '+String(venue).padStart(3,'0'),lat:37.7955+(Math.floor(venue/20)-10)*.002,
    lon:-122.3937+((venue%20)-10)*.003,approx:venue%11===0,url:'https://example.com/'+venue+'/'+i});
}
feed.push({id:'anchor',title:'Anchor investor pitch',venue:'Anchor venue',lat:37.7955,lon:-122.3937,
  start:new Date(NOW+3600000).toISOString(),end:new Date(NOW+7200000).toISOString(),approx:false,url:'https://example.com/anchor'});
const collected = new Set(feed.filter((_,i)=>i%9===0).map(event=>event.id)), selected=[];
const radar = createRadar({graph,frame,routeGraph:graph,autoLoad:false,onSelect:value=>{selected.push(value);return true;}});
await Promise.all([radar.ready,radar.routingReady]); radar.setEvents(feed); radar.setCollected(collected);
const canvas = radar.element.querySelector('canvas');
const counts = {targetText:0,stampText:0,images:0};
const nativeText = CanvasRenderingContext2D.prototype.fillText, nativeImage = CanvasRenderingContext2D.prototype.drawImage;
CanvasRenderingContext2D.prototype.fillText = function(...args){counts[this.canvas===canvas?'targetText':'stampText']++;return nativeText.apply(this,args);};
CanvasRenderingContext2D.prototype.drawImage = function(...args){if(this.canvas===canvas)counts.images++;return nativeImage.apply(this,args);};
function draw(){radar.setCollected(collected);radar.update({x:0,y:0,z:0},.35);}
function resetCounts(){counts.targetText=counts.stampText=counts.images=0;}
function sample(expanded){
  radar.setEvents(feed);radar.setCollected(collected);radar.toggleMap(expanded);
  // Feed replacement clears stamps before the cold draw. Search focus keeps the
  // unrelated five-second DOM-list refresh outside this 2D submission diagnostic.
  if(expanded)radar.element.querySelector('.gt-radar-search').focus();else document.body.focus();
  resetCounts(); const coldAt=performance.now(); draw(); const coldMs=performance.now()-coldAt, cold={...counts};
  for(let i=0;i<20;i++) draw(); resetCounts();
  const milliseconds=[];
  for(let i=0;i<60;i++){const start=performance.now();draw();milliseconds.push(performance.now()-start);}
  return {expanded,coldMs,cold,hot:{...counts},milliseconds,eventCount:radar.eventCount,sourceCount:feed.length};
}
function cacheProof(){
  const before=document.createElement('canvas'),after=document.createElement('canvas'); before.width=after.width=720;before.height=after.height=300;
  const a=before.getContext('2d'),b=after.getContext('2d'),cache=createRadarTextCache(b);
  const glyphs=['$','🎤','💻','🍸','🎙','🤝','★','2','19','99+'];
  let i=0;
  for(const ratio of [1,2]){
    a.clearRect(0,0,720,300);b.clearRect(0,0,720,300);a.setTransform(ratio,0,0,ratio,0,0);b.setTransform(ratio,0,0,ratio,0,0);cache.setPixelRatio(ratio);
    for(let j=0;j<glyphs.length;j++){
      const font=(j<7?'22px "Apple Color Emoji","Segoe UI Emoji",Arial,sans-serif':'bold 9px Arial'),color=j%2?'#17211d':'#f0b429',baseline=j<7?'middle':'alphabetic';
      const x=22+(j%5)*66,y=28+Math.floor(j/5)*38;
      a.font=b.font=font;a.fillStyle=b.fillStyle=color;a.textAlign=b.textAlign='center';a.textBaseline=b.textBaseline=baseline;a.globalAlpha=b.globalAlpha=j%3===0?.55:1;
      a.fillText(glyphs[j],x,y);cache.paint(glyphs[j],x,y,font,color,baseline);
    }
    const x=a.getImageData(0,0,720,300).data,y=b.getImageData(0,0,720,300).data;
    // Compare premultiplied channels: transparent antialiasing fringes must not
    // count arbitrary unpremultiplied RGB rounding as a visible colour change.
    let total=0,ink=0,max=0;for(let p=0;p<x.length;p+=4)if(x[p+3]||y[p+3]){ink++;for(let c=0;c<4;c++){const diff=c===3?Math.abs(x[p+3]-y[p+3]):Math.abs(x[p+c]*x[p+3]/255-y[p+c]*y[p+3]/255);total+=diff;max=Math.max(max,diff);}}
    if(!ink||total/(ink*4)>2)throw Error('Stamp pixel mismatch at DPR '+ratio+': '+total/(ink*4));
    window.fixture.pixelComparisons.push({ratio,ink,meanPremultipliedChannelDifference:total/(ink*4),max});i++;
  }
  b.setTransform(1,0,0,1,0,0);cache.setPixelRatio(1);
  for(let j=0;j<900;j++)cache.paint(String(j),30,30,'bold 15px Arial','#17211d','alphabetic');
  const bounded=cache.stats;if(bounded.entries>bounded.maxEntries||bounded.pixels>bounded.maxPixels||!bounded.evictions)throw Error('Cache bounds not enforced');
  cache.paint('899',30,30,'bold 15px Arial','#17211d','alphabetic');if(cache.stats.hits<=bounded.hits)throw Error('Warm stamp was not reused');
  cache.clear();const cleared=cache.stats;if(cleared.entries||cleared.pixels)throw Error('Cache clear retained bitmap memory');
  cache.paint('123456789',30,30,'bold 15px Arial','#17211d','alphabetic');if(cache.stats.fallbacks<1)throw Error('Uncached text did not use fallback');
  return {bounded,cleared,comparisons:i};
}
window.fixture={radar,canvas,sample,draw,selected,feed,pixelComparisons:[],cacheProof};draw();
`;

if (!process.argv.includes('--run-only')) {
  const { before, after, cache, patch } = await candidateSources();
  report.sources = { before: hash(before), after: hash(after), cache: hash(cache), patch: hash(patch), harness: hash(await readFile(import.meta.filename)) };
  await writeFile(`${out}/textCache-source.ts`, cache);
  for (const [stage, source] of [['before', before], ['after', after]]) {
    await mkdir(`${out}/${stage}`, { recursive: true }); await writeFile(`${out}/${stage}/radar-source.ts`, source);
  }
  await writeFile(`${out}/sources.json`, JSON.stringify(report.sources, null, 2));
  if (process.argv.includes('--prepare-only')) { console.log(JSON.stringify({ out, sources: report.sources, prepared: true }, null, 2)); process.exit(0); }
  const { build } = await import('esbuild');
  for (const [stage, source] of [['before', before], ['after', after]]) {
    const result = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'ts' }, bundle: true,
      alias: { '@gtasf/shared': resolve('shared') }, outfile: `${out}/${stage}/app.js`, write: false,
      plugins: [{ name: 'snapshot', setup(builder) {
        builder.onResolve({filter:/^\.\/textCache$/},args=>args.importer===resolve('web/src/radar/radar.ts')?{path:resolve('tools/radar-text-cache-candidate.ts')}:undefined);
        builder.onLoad({filter:/web\/src\/radar\/radar\.ts$/},()=>({contents:source,loader:'ts',resolveDir:resolve('web/src/radar')}));
        builder.onLoad({filter:/radar-text-cache-candidate\.ts$/},()=>({contents:cache,loader:'ts',resolveDir:resolve('tools')}));
      } }], format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'error' });
    for (const file of result.outputFiles) await writeFile(file.path, file.contents);
    await writeFile(`${out}/${stage}/index.html`, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="app.css"><title>Radar cache comparison</title><style>body{margin:0;background:#304b44;color:white;font:16px Arial}</style><body tabindex="-1"><p>Isolated radar comparison · fixture events · no game connection</p><script type="module" src="app.js"></script></body></html>`);
  }
} else report.sources = JSON.parse(await readFile(`${out}/sources.json`, 'utf8'));
if (process.argv.includes('--build-only')) process.exit(0);

const { chromium } = await import('@playwright/test');
const server = createServer(async (req,res) => {
  const match = /^\/(before|after)\/(index\.html|app\.js|app\.css)?$/.exec((req.url??'/').split('?')[0]);
  if(!match){res.writeHead(404).end();return;}
  const name=match[2]??'index.html';res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');
  res.end(await readFile(`${out}/${match[1]}/${name}`));
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
let browser;
try {
  browser=await chromium.launch({headless:true});report.browser=await browser.version();
  for(const phone of [false,true]) for(const stage of ['before','after']) {
    const label=phone?'phone':'desktop',page=await browser.newPage({viewport:phone?{width:390,height:844}:{width:1100,height:760},deviceScaleFactor:phone?2:1,isMobile:phone,hasTouch:phone});
    page.on('pageerror',error=>report.errors.push(`${label}/${stage}: ${error.message}`));
    page.on('console',message=>{if(message.type()==='error')report.errors.push(`${label}/${stage}: ${message.text()}`);});
    page.on('websocket',socket=>report.errors.push(`Unexpected socket: ${socket.url()}`));
    await page.goto(`http://127.0.0.1:${server.address().port}/${stage}/`);await page.waitForFunction(()=>Boolean(window.fixture));
    const session=await page.context().newCDPSession(page);if(phone)await session.send('Emulation.setCPUThrottlingRate',{rate:4});
    const scenario={label,stage,dpr:phone?2:1,throttle:phone?4:1};
    report.scenarios.push(scenario); // Preserve completed measurements even if a later UI check fails.
    for(const expanded of [false,true]){
      const result=await page.evaluate(expanded=>window.fixture.sample(expanded),expanded);
      assert.equal(result.eventCount,result.sourceCount,'Every fixture event remains available');
      assert.equal(result.milliseconds.length,60);const sorted=[...result.milliseconds].sort((a,b)=>a-b);
      result.meanMs=result.milliseconds.reduce((sum,n)=>sum+n,0)/60;result.p95Ms=sorted[Math.ceil(.95*sorted.length)-1];
      scenario[expanded?'map':'minimap']=result;
      await page.screenshot({path:`${out}/${label}-${stage}-${expanded?'map':'minimap'}.png`,scale:'css'});
    }
    // Every venue stays discoverable even beyond the sidebar's nearest-60 limit.
    const search=page.locator('.gt-radar-search');await search.fill('Cache venue 419');
    const row=page.locator('.gt-radar-list button').filter({hasText:'Cache venue 419'});await row.click();
    const lastTitle=await page.evaluate(()=>window.fixture.feed.find(event=>event.venue==='Cache venue 419').title);
    await page.getByRole('heading',{name:lastTitle,exact:true}).waitFor();
    scenario.lastVenueSearch=true;
    await search.fill('Cache venue 003');await page.locator('.gt-radar-list button').filter({hasText:'Cache venue 003'}).click();
    await page.getByRole('heading',{name:'Cache venue 003',exact:true}).waitFor();
    assert.equal(await page.locator('.gt-radar-venue-events button').count(),await page.evaluate(()=>window.fixture.feed.filter(event=>event.venue==='Cache venue 003').length));
    scenario.groupedVenueEvents=true;
    await search.fill('Anchor venue');await page.locator('.gt-radar-list button').filter({hasText:'Anchor venue'}).click();
    await page.getByRole('button',{name:'Set destination',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.fixture.selected.length),1,'A source-road destination remains selectable');
    scenario.destinationSelected=true;
    await page.evaluate(()=>{window.fixture.radar.toggleMap(true);window.fixture.draw();});
    const map=page.locator('.gt-radar canvas'),box=await map.boundingBox();
    if(phone)await page.touchscreen.tap(box.x+box.width*.72,box.y+box.height*.5);else await page.mouse.click(box.x+box.width*.72,box.y+box.height*.5);
    assert.equal(await page.evaluate(()=>window.fixture.selected.length),2,'A native map tap still accepts one road waypoint');
    scenario.nativeMapTap=true;
    if(stage==='after'){
      scenario.cache=await page.evaluate(()=>window.fixture.cacheProof());scenario.pixelComparisons=await page.evaluate(()=>window.fixture.pixelComparisons);
      assert.equal(scenario.minimap.hot.stampText,0,'Warm minimap stamps need no text rasterization');
      assert.ok(scenario.minimap.hot.images>0,'Minimap uses cached text stamps');
    }
    await page.evaluate(()=>window.fixture.radar.destroy());assert.equal(await page.locator('.gt-radar').count(),0);
    await page.close();
  }
  for(const label of ['desktop','phone']){
    const before=report.scenarios.find(row=>row.label===label&&row.stage==='before'),after=report.scenarios.find(row=>row.label===label&&row.stage==='after');
    for(const mode of ['minimap','map'])report.checks.push({label,mode,beforeMs:before[mode].meanMs,afterMs:after[mode].meanMs,
      changePercent:(after[mode].meanMs/before[mode].meanMs-1)*100,targetTextBefore:before[mode].hot.targetText,targetTextAfter:after[mode].hot.targetText});
  }
  assert.deepEqual(report.errors,[]);report.passed=true;
} catch(error){report.failure=error.stack??String(error);process.exitCode=1;}
finally{await browser?.close();await new Promise(done=>server.close(done));await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
console.log(JSON.stringify({out,passed:report.passed,checks:report.checks,errors:report.errors,failure:report.failure},null,2));
