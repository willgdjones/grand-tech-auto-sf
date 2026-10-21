import {build} from 'esbuild';
import {chromium} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import assert from 'node:assert/strict';

// Actual perks DOM module, no renderer, vehicle request, API call or earned profile.
const root=process.cwd(), out=resolve(root,process.env.GTASF_PERKS_MODAL_OUT??'artifacts/perks-modal');
await mkdir(out,{recursive:true});
const source=process.env.GTASF_PERKS_SOURCE;
const result=await build({stdin:{contents:`
import {Scene} from 'three';
import {createFundingPerks} from './web/src/funding/perks.ts';
let perks,events=[];
window.modalSmoke={
 reset(){perks?.destroy();events=[];perks=createFundingPerks({enabled:true,scene:new Scene(),fleet:{cars:new Map()},surfaceHeightAt:()=>0,onModalChange:open=>events.push(open)});},
 open(){perks.element.focus();perks.element.click();},hide(){perks.hide();},
 nativeClose(){document.querySelector('.gt-funding-dialog').close();},
 inspect(){return{open:perks.isOpen,events:[...events],focus:document.activeElement?.id||document.activeElement?.getAttribute('aria-label')||document.activeElement?.textContent};},
 destroy(){const stale=perks.element;perks.destroy();return()=>stale.click();}
};window.modalSmoke.reset();
`,resolveDir:root,loader:'ts'},bundle:true,write:false,format:'esm',platform:'browser',loader:{'.css':'empty'},logLevel:'error',
plugins:source?[{name:'isolated-before-after',setup(b){b.onLoad({filter:/web\/src\/funding\/perks\.ts$/},async args=>({contents:await readFile(source,'utf8'),loader:'ts',resolveDir:dirname(args.path)}));}}]:[]});
const server=createServer((req,res)=>{if(req.url==='/favicon.ico'){res.writeHead(204).end();return;}res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?result.outputFiles[0].text:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><button id="next-control">Next control</button><script type="module" src="/app.js"></script>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
const report={at:new Date().toISOString(),scope:'Actual Round perks DOM lifecycle, isolated profiles and no server/GPU acceptance',source:source??'web/src/funding/perks.ts',cases:[],errors:[],passed:false};
try{
 browser=await chromium.launch({headless:true,args:['--disable-gpu']});
 for(const viewport of [{width:1100,height:720},{width:390,height:844}]){
  const page=await browser.newPage({viewport});page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.modalSmoke);
  async function check(name,test){await page.evaluate(()=>window.modalSmoke.reset());await page.waitForTimeout(20);try{await test();report.cases.push({viewport:viewport.width,name,passed:true});}catch(e){report.cases.push({viewport:viewport.width,name,passed:false,error:String(e)});}}
  await check('programmatic close releases the input hold synchronously',async()=>{
   const state=await page.evaluate(()=>{window.modalSmoke.open();window.modalSmoke.hide();return window.modalSmoke.inspect();});assert.equal(state.open,false);assert.deepEqual(state.events,[true,false]);
  });
  await check('queued close cannot duplicate a reopened dialog transition',async()=>{
   await page.evaluate(()=>{window.modalSmoke.open();window.modalSmoke.hide();window.modalSmoke.open();});await page.waitForTimeout(40);const state=await page.evaluate(()=>window.modalSmoke.inspect());assert.equal(state.open,true);assert.deepEqual(state.events,[true,false,true]);
  });
  await check('queued close cannot steal focus from the next control',async()=>{
   await page.evaluate(()=>{window.modalSmoke.open();window.modalSmoke.hide();document.querySelector('#next-control').focus();});await page.waitForTimeout(40);assert.equal((await page.evaluate(()=>window.modalSmoke.inspect())).focus,'next-control');
  });
  await check('Close button restores launcher and publishes one close',async()=>{
   await page.getByRole('button',{name:'Open earned round perks',exact:true}).click();await page.getByRole('button',{name:'Close ×',exact:true}).click();await page.waitForTimeout(20);const state=await page.evaluate(()=>window.modalSmoke.inspect());assert.equal(state.open,false);assert.deepEqual(state.events,[true,false]);assert.equal(state.focus,'Open earned round perks');
  });
  await check('Escape closes and restores launcher',async()=>{
   await page.getByRole('button',{name:'Open earned round perks',exact:true}).click();await page.keyboard.press('Escape');await page.waitForTimeout(20);const state=await page.evaluate(()=>window.modalSmoke.inspect());assert.equal(state.open,false);assert.deepEqual(state.events,[true,false]);assert.equal(state.focus,'Open earned round perks');
  });
  await check('native close event still releases the hold',async()=>{
   await page.evaluate(()=>{window.modalSmoke.open();window.modalSmoke.nativeClose();});await page.waitForTimeout(40);assert.deepEqual((await page.evaluate(()=>window.modalSmoke.inspect())).events,[true,false]);
  });
  await check('destroy releases the hold and ignores a stale launcher',async()=>{
   const state=await page.evaluate(()=>{window.modalSmoke.open();const stale=window.modalSmoke.destroy();const state=window.modalSmoke.inspect();stale();return state;});assert.equal(state.open,false);assert.deepEqual(state.events,[true,false]);
  });
  await page.evaluate(()=>window.modalSmoke.destroy());await page.close();
 }
 report.passed=report.cases.every(c=>c.passed)&&report.errors.length===0;
 console.log(JSON.stringify({passed:report.passed,cases:report.cases.length,failures:report.cases.filter(c=>!c.passed),errors:report.errors}));
 if(!report.passed)process.exitCode=1;
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));}
