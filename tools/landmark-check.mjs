import { build } from 'vite';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

// One short-lived preview build + browser smoke. No dev/watch server or golden/perf suite.
const root=fileURLToPath(new URL('../',import.meta.url));
const requested=new Set(process.argv.slice(2));
const out=resolve(root,'artifacts/landmarks/preview');
await mkdir(out,{recursive:true});
await build({configFile:false,root:resolve(root,'web'),publicDir:false,logLevel:'warn',
  build:{outDir:out,emptyOutDir:false,reportCompressedSize:false,
    rollupOptions:{input:resolve(root,'web/landmarks.html')}}});
const server=createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  const base=pathname.startsWith('/assets/vehicles/')?resolve(root,'web/public'):out;
  const path=resolve(base,`.${pathname==='/'?'/landmarks.html':decodeURIComponent(pathname)}`);
  if(!path.startsWith(base+sep)){res.writeHead(403).end();return;}
  try{const bytes=await readFile(path);res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.html')?'text/html':'application/octet-stream');res.end(bytes);}
  catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}`;
let browser;
try{
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1360,height:900},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('favicon'))errors.push(m.text());});
  await page.goto(`${url}/landmarks.html`);
  await page.waitForSelector('canvas[data-ready="true"]');
  const ids=(await page.locator('#landmark option').evaluateAll(options=>options.map(o=>o.value))).filter(id=>requested.size===0||requested.has(id));
  assert.ok(ids.length,'Select a valid landmark ID for the scoped smoke.');
  const results=[];
  for(const id of ids){
    await page.selectOption('#landmark',id);
    await page.waitForFunction(id=>document.querySelector('canvas').dataset.landmark===id,id);
    await page.waitForTimeout(180);
    const stats=await page.locator('#stats').innerText();
    assert.match(stats,/1 mesh · 0 textures/);
    await page.screenshot({path:resolve(out,`${id}.png`)});
    results.push({id,stats});
  }
  if(ids.includes('ferry-building')) {
    await page.selectOption('#landmark','ferry-building');
    for(const view of ['arrival','back']){
      await page.click(`#${view}`);await page.waitForTimeout(220);
      await page.screenshot({path:resolve(out,`ferry-${view}.png`)});
    }
  }
  if(ids.includes('pier-39')) {
  await page.selectOption('#landmark','pier-39');await page.click('#drive');
  await page.waitForSelector('canvas[data-driving="true"]');
  await page.keyboard.down('w');
  try{await page.waitForFunction(()=>Number(document.querySelector('canvas').dataset.carZ)<145,{},{timeout:40000});}
  catch(error){console.log('Driving diagnostic',await page.locator('canvas').evaluate(e=>({...e.dataset})));throw error;}
  finally{await page.keyboard.up('w');await page.screenshot({path:resolve(out,'pier-39-driving.png')});}
  const carZ=await page.locator('canvas').getAttribute('data-car-z');
  assert.ok(Number(carZ)<145,`The workshop car must travel onto the pier; actual z=${carZ}.`);
  }
  assert.deepEqual(errors,[]);
  await writeFile(resolve(out,requested.size?'smoke-scoped.json':'smoke.json'),JSON.stringify({checkedAt:new Date().toISOString(),results,errors},null,2));
  console.log(JSON.stringify({ok:true,preview:out,results}));
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
