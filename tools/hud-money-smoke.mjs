import { build } from 'vite';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd(), out = resolve(root,'artifacts/hud-money'), src = resolve(out,'source');
await mkdir(src,{recursive:true});
await writeFile(resolve(src,'flags.ts'),'export const flags={hud:true,eventVisits:true,fundedStars:true,fundingLoop:true};');
await writeFile(resolve(src,'index.html'),'<meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;background:#758878"><script type="module" src="./check.ts"></script>');
await writeFile(resolve(src,'check.ts'),`
import {createPlayableHud} from '/web/src/hud/playableHud.ts';
import {fundingRound} from '/shared/funding.ts';
const hud=createPlayableHud(); hud.update({now:1791000000000});
window.moneySmoke={set(total,display=total){hud.setFundingProfile({deviceId:'fixture',startupName:'Fixture',nickname:'Fixture',totalCents:total,todayCents:total,round:fundingRound(total),rank:2,todayRank:1,lastAwardAt:null,streak:1},display);},destroy(){hud.destroy();}};
`);
await build({configFile:false,root,publicDir:false,logLevel:'warn',resolve:{alias:[{find:/^@gtasf\/shared\/flags$/,replacement:resolve(src,'flags.ts')}]},build:{outDir:resolve(out,'app'),emptyOutDir:true,rollupOptions:{input:resolve(src,'index.html')}}});
const server=createServer(async(req,res)=>{const path=(req.url??'/').split('?')[0];if(path==='/favicon.ico'){res.writeHead(204).end();return;}const file=path==='/'?resolve(out,'app/artifacts/hud-money/source/index.html'):resolve(out,`app/.${path}`);if(!file.startsWith(resolve(out,'app')+'/')){res.writeHead(403).end();return;}try{res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[extname(file)]??'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--disable-gpu']}), page=await browser.newPage({viewport:{width:1100,height:720}}),errors=[],cases=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
try{
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.moneySmoke);
  for(const [total,expected] of [['0','$00000000'],['386310300','$03863103'],['999','$00000009'],['1500000000','$15000000'],['100000000000','$1000000000'],['1000000000000000','$10000000000000']]){
    await page.evaluate(total=>window.moneySmoke.set(total),total);const text=await page.locator('.gt-hud-money-value').innerText();assert.equal(text,expected);cases.push({total,text});
    await page.setViewportSize({width:390,height:844});const box=await page.locator('.gt-hud-money').boundingBox();assert(box.x>=0&&box.x+box.width<=390);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }
  await page.evaluate(()=>window.moneySmoke.set('1500000000','386310300'));assert.equal(await page.locator('.gt-hud-money-value').innerText(),'$03863103');
  await page.screenshot({path:resolve(out,'phone.png')});await page.setViewportSize({width:1100,height:720});await page.screenshot({path:resolve(out,'desktop.png')});
  assert.deepEqual(errors,[]);const evidence={cases,countUpUsesDisplayedCents:true,desktop:true,phone:true,errors};await writeFile(resolve(out,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
