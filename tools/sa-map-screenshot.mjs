/** Headless screenshot of the real SA pause-menu map (2D canvas; GPU-independent) for look review —
 * no game/backend, fixture events only. Exercises citywide district de-overlap (gtasf-i801/z756),
 * the you-are-here gold label (gtasf-9x8a), one-blip-per-venue + the COMMUNITY tag (gtasf-x99q), and
 * the radar.css SA restyle (gtasf-swyl). Run: node tools/sa-map-screenshot.mjs [outDir]
 * Output: <outDir>/sa-map-look.png + report.json. Pane 6 reviews the PNG for the look gate.
 * Usage: node tools/sa-map-screenshot.mjs [outDir] [width] [height]  (default 1400x900; try 390 844 for phone) */
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const out = resolve(process.argv[2] ?? 'artifacts/sa-map-look');
await mkdir(out, { recursive: true });
const entry = `
import { flags } from './shared/flags';
import './web/src/theme/saTheme.css'; // the global SA tokens radar.css relies on (loaded by main.ts in-game)
import { createRadar } from './web/src/radar/radar';
if (!flags.radar || !flags.fullMap || !flags.saMapStyle) throw Error('Enable radar/fullMap/saMapStyle for this look smoke.');
const frame = { origin: { lat: 37.7955, lon: -122.3937 }, gridRotationDeg: 0 };
const graph = { version:1, nodes:[{id:'nw',x:-6500,y:0,z:-3200},{id:'se',x:3200,y:0,z:4200}],
  edges:[{id:'lane:x',from:'nw',to:'se',lengthM:13000,speedMps:10,lane:1,points:[[-6500,0,-3200],[3200,0,4200]]}] };
const DENSE = ${process.env.SAMAP_DENSE ? 'true' : 'false'};
const ev = (id,title,lat,lon,community=false,hour=18) => ({id,title,start:'2026-10-05T'+String(hour).padStart(2,'0')+':00:00Z',end:'2026-10-05T'+String(hour+2).padStart(2,'0')+':00:00Z',lat,lon,approx:false,url:'https://example.com/'+id,community,venue:title.replace(/ #\\d+$/,'')});
const VENUES = [
  ['Ferry Building',37.7955,-122.3937],['Moscone (SoMa)',37.7785,-122.3990],['Mission Hall',37.7599,-122.4148],
  ['Castro Theatre',37.7609,-122.4350],['Marina Green',37.8037,-122.4368],['North Beach',37.8003,-122.4103],
  ['Hayes Valley',37.7765,-122.4245],['Sunset Rec',37.7530,-122.4940],['Union Square',37.7880,-122.4074],
  ['Potrero Hill',37.7580,-122.4000],['Chase Center',37.7680,-122.3870],['Pier 39',37.8087,-122.4098],
  ['Hayes HQ',37.7762,-122.4260],['Dogpatch',37.7570,-122.3880],['Nob Hill',37.7930,-122.4161],['GGP Bandshell',37.7694,-122.4862],
];
let events;
if (DENSE) { // Many events, several per venue -> exercises venue grouping (one blip + "+N this week") + de-overlap at scale (the "~1,600 events overwhelming" fix).
  events = [];
  VENUES.forEach((v,i) => { const n = 1 + (i % 4); for (let k=0;k<n;k++) events.push(ev(v[0].toLowerCase().replace(/\\W/g,'')+k, v[0]+' #'+(k+1), v[1], v[2], i===2 && k===0, 10 + ((i+k)%10))); });
} else {
  events = [
    ev('e-ferry','Ferry Mixer',37.7955,-122.3937), ev('e-soma','SoMa Party',37.7785,-122.3990),
    ev('e-mission','Mission Hack Night',37.7599,-122.4148,true), ev('e-castro','Castro Demo',37.7609,-122.4350),
    ev('e-marina','Marina Meetup',37.8037,-122.4368), ev('e-nb','North Beach Pitch',37.8003,-122.4103),
    ev('e-hayes','Hayes Valley Coffee',37.7765,-122.4245), ev('e-sunset','Sunset Surf and AI',37.7530,-122.4940),
    ev('e-union','Union Square Keynote',37.7880,-122.4074), ev('e-potrero','Potrero Rooftop',37.7580,-122.4000),
  ];
}
const radar = createRadar({ graph, routeGraph: graph, frame, autoLoad:false, onSelect:()=>true, onHail:()=>false });
radar.setEvents(events);
radar.toggleMap(true);
const player = { x:-200, y:0, z:1550 };
const timer = setInterval(()=>radar.update(player,0),16);
await radar.routingReady; radar.update(player,0);
window.fixture = { ready:true, dispose(){clearInterval(timer);radar.destroy();} };
`;
const bundle = await build({ stdin:{ contents:entry, resolveDir:resolve('.'), loader:'ts' }, bundle:true,
  alias:{ '@gtasf/shared': resolve('shared') }, outfile:`${out}/app.js`, write:false, format:'esm', platform:'browser', target:'es2022', logLevel:'error' });
for (const f of bundle.outputFiles) await writeFile(f.path, f.contents);
await writeFile(`${out}/index.html`, `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="icon" href="data:,"><link rel="stylesheet" href="/app.css"><title>SA map look</title><style>body{margin:0;background:#1a2a26}</style></head><body><script type="module" src="/app.js"></script></body></html>`);
const server = createServer(async (req,res)=>{ const name=({'/':'index.html','/app.js':'app.js','/app.css':'app.css'})[(req.url??'/').split('?')[0]]; if(!name){res.writeHead(404).end();return;} res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[extname(name)]); res.end(await readFile(`${out}/${name}`)); });
await new Promise(d=>server.listen(0,'127.0.0.1',d));
const report = { checkedAt:new Date().toISOString(), errors:[], shot:null };
let browser;
try {
  browser = await chromium.launch({ headless:true, args:['--disable-gpu'] });
  const vw = Number(process.argv[3] ?? 1400), vh = Number(process.argv[4] ?? 900);
  const page = await browser.newPage({ viewport:{ width:vw, height:vh }, deviceScaleFactor:1 });
  page.on('pageerror',e=>report.errors.push(e.message));
  page.on('console',m=>{ if(m.type()==='error') report.errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(()=>window.fixture?.ready, { timeout:20000 });
  await page.waitForTimeout(500);
  report.shot = `${out}/sa-map-look.png`;
  await page.locator('.gt-radar').screenshot({ path:report.shot });
  console.log('SHOT_OK', report.shot, 'errors=', JSON.stringify(report.errors));
} catch (e) { report.failure = e.message; console.log('SHOT_FAIL', e.message, 'errors=', JSON.stringify(report.errors)); throw e; }
finally { await writeFile(`${out}/report.json`, JSON.stringify(report,null,2)+'\n'); await browser?.close(); server.closeAllConnections(); await new Promise(d=>server.close(d)); }
