/** Real Chat/Input DOM with locally supplied wire messages; no server, provider or WebGL. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build, preview } from 'vite';
import { chromium } from '@playwright/test';

const root=process.cwd(),out=resolve(process.env.GTASF_CHAT_READER_OUT??'artifacts/chat-reader');
await mkdir(out,{recursive:true});
await writeFile(`${out}/index.html`,'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Chat reader check</title><canvas id="scene" tabindex="0" style="position:fixed;inset:0;width:100%;height:100%"></canvas><script type="module" src="/entry.js"></script>');
await writeFile(`${out}/entry.js`, `
import '${root}/web/src/style.css';
import {createChat} from '${root}/web/src/chat/client.ts';
import {Input} from '${root}/web/src/input/input.ts';
import {holdFreeCursor} from '${root}/web/src/input/cursor.ts';
import {chatEventId} from '${root}/shared/chat/constants.ts';
const input=new Input(document.querySelector('#scene'),{touch:false}),sent=[];let release,serial=0;
const chat=createChat({connected:()=>true,send:message=>{sent.push(message);return true;},onModalChange(open){input.release();if(open)release??=holdFreeCursor();else{release?.();release=undefined;}}});
if(!chat)throw Error('Existing chat flag must be enabled');
input.actions.on('close',()=>chat.hide());
chat.button.style.cssText='position:fixed;top:10px;left:10px';
const eventRoom=chatEventId('reader-fixture');
const append=(room=0,count=1)=>{for(let i=0;i<count;i++){serial++;chat.receive({type:'CHAT_BROADCAST',messageId:serial,senderId:serial,eventId:room,serverT:Date.now(),name:'Founder '+serial,text:'Message '+serial+': Meet by the Ferry Building clock, then take a robotaxi to the next event. '+(serial%3===0?'I will bring the pitch deck.':'See you there.')});}};
append(0,40);
window.fixture={chat,input,sent,append,eventRoom,
 readyEvent(){chat.receive({type:'WELCOME',id:1,serverT:Date.now(),name:'Reader',pose:{x:0,y:0,z:0,yaw:0,flags:0},resumeToken:'fixture',lastMoveSeq:0,resumed:false});chat.setEvent({id:'reader-fixture',title:'Reader event'});chat.receive({type:'EVENT_STATE',playerId:1,eventId:eventRoom,present:true});},
 sample(){input.poll(1/60);return {move:{...input.move},look:{...input.look}};},
 destroy(){chat.destroy();input.dispose();}};
`);
const config={configFile:false,root:out,publicDir:false,logLevel:'warn',resolve:{alias:{'@gtasf/shared':resolve('shared')}},build:{outDir:`${out}/app`,emptyOutDir:true,reportCompressedSize:false,target:'es2022'}};
await build(config);const server=await preview({...config,preview:{host:'127.0.0.1',port:0}});
const report={at:new Date().toISOString(),scope:'Actual Chat/Input/CSS, locally supplied wire messages; no API/WebGL/native evidence',
 sourceHash:createHash('sha256').update(await readFile('web/src/chat/client.ts')).digest('hex'),errors:[],views:[],passed:false};let browser;
try{
 browser=await chromium.launch({headless:true,args:['--disable-gpu','--disable-webgl']});
 for(const [name,width,height] of [['desktop',1100,720],['phone',390,844]]){
  const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});page.setDefaultTimeout(5000);
  page.on('pageerror',error=>report.errors.push(error.message));page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
  page.on('response',response=>{if(response.status()>=400)report.errors.push(`HTTP ${response.status()} ${response.url()}`);});
  await page.goto(server.resolvedUrls.local[0]);await page.waitForFunction(()=>window.fixture);
  const launcher=page.locator('.gt-chat-launch'),log=page.locator('.gt-chat-log'),composer=page.getByLabel('Your message',{exact:true}),channel=page.getByLabel('Chat channel',{exact:true});
  const focused=locator=>locator.evaluate(el=>el===document.activeElement);
  const state=()=>log.evaluate(el=>{const top=el.getBoundingClientRect().top+el.clientTop,first=[...el.children].find(child=>child.getBoundingClientRect().bottom>top);return {top:el.scrollTop,max:el.scrollHeight-el.clientHeight,first:first?.textContent,offset:first?first.getBoundingClientRect().top-top:null,firstId:first?.dataset.messageId,oldest:el.firstElementChild?.dataset.messageId,count:el.childElementCount,focused:el===document.activeElement};});
  const stable=()=>page.evaluate(async()=>{const log=document.querySelector('.gt-chat-log');let same=0,previous=NaN;for(let i=0;i<120&&same<3;i++){await new Promise(requestAnimationFrame);const current=log.scrollTop;same=current===previous?same+1:0;previous=current;}});
  const atBottom=async()=>{await page.waitForFunction(()=>{const el=document.querySelector('.gt-chat-log');return el.scrollHeight-el.clientHeight-el.scrollTop<=1;});};
  const preserved=(before,after)=>{assert.equal(after.first,before.first,`${name}: same visible message`);assert(Math.abs(after.offset-before.offset)<1,`${name}: same message pixel offset ${JSON.stringify({before,after})}`);};
  const cases=[];report.views.push({name,cases});
  await launcher.focus();await page.keyboard.press('Enter');await atBottom();await composer.fill('Unsent draft stays here');
  const box=await log.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.wheel(0,-500);
  await page.waitForFunction(()=>{const el=document.querySelector('.gt-chat-log');return el.scrollTop<el.scrollHeight-el.clientHeight-200;});await stable();
  const before=await state();await page.evaluate(()=>window.fixture.append());await stable();const after=await state();preserved(before,after);
  assert(await focused(composer));assert.equal(await composer.inputValue(),'Unsent draft stays here');
  await page.screenshot({path:`${out}/${name}-reading.png`});cases.push({name:'Wheel reader survives incoming message and display trimming',before,after});

  await page.keyboard.press('Shift+Tab');assert(await focused(log),'Native scrollable log remains keyboard reachable');
  const beforeKey=await state();await page.keyboard.press('PageUp');await page.waitForFunction(top=>document.querySelector('.gt-chat-log').scrollTop<top,beforeKey.top);await stable();
  const keyboardBefore=await state();await page.evaluate(()=>window.fixture.append(0,3));await stable();const keyboardAfter=await state();preserved(keyboardBefore,keyboardAfter);assert(await focused(log));
  await page.evaluate(()=>window.fixture.append(window.fixture.eventRoom));await stable();const otherChannel=await state();preserved(keyboardAfter,otherChannel);
  await page.keyboard.down('w');await page.keyboard.down('ArrowRight');assert.deepEqual(await page.evaluate(()=>window.fixture.sample()),{move:{x:0,y:0},look:{x:0,y:0}});await page.keyboard.up('ArrowRight');await page.keyboard.up('w');
  cases.push({name:'Keyboard reader retains anchor, focus and input masking through same/other room messages',keyboardBefore,keyboardAfter,otherChannel});

  await page.keyboard.press('End');await atBottom();await page.evaluate(()=>window.fixture.append());await atBottom();
  const pinned=await state();assert.equal(pinned.count,40);await page.screenshot({path:`${out}/${name}-latest.png`});cases.push({name:'Bottom reader follows newest',pinned});
  await page.keyboard.press('Home');await page.waitForFunction(()=>document.querySelector('.gt-chat-log').scrollTop===0);await stable();
  const oldest=await state();await page.evaluate(()=>window.fixture.append(0,45));await stable();const evicted=await state();
  assert.equal(evicted.top,0);assert.equal(evicted.count,40);assert.equal(evicted.firstId,evicted.oldest);assert.notEqual(evicted.firstId,oldest.firstId);assert(await focused(log));
  await page.evaluate(()=>window.fixture.append(window.fixture.eventRoom,41));await stable();const retainedCap=await state();
  assert.equal(retainedCap.top,0);assert.equal(retainedCap.count,39,'The shared 80-message retention bound removes one nearby row');assert.equal(retainedCap.firstId,retainedCap.oldest);
  cases.push({name:'Evicted reader falls back to oldest retained message at both history bounds',oldest,evicted,retainedCap});

  await page.evaluate(()=>window.fixture.readyEvent());await channel.selectOption('event');
  await page.waitForFunction(()=>document.querySelector('.gt-chat-dialog select').value==='event');await atBottom();assert(await focused(composer));
  const eventView=await state();assert.equal(eventView.count,40);assert.equal(await composer.inputValue(),'Unsent draft stays here');
  await page.keyboard.press('Shift+Tab');assert(await focused(log));await page.keyboard.press('Home');await page.waitForFunction(()=>document.querySelector('.gt-chat-log').scrollTop===0);
  await page.evaluate(()=>window.fixture.chat.setEvent(null));assert.equal(await channel.inputValue(),'nearby');await atBottom();
  const nearbyView=await state();assert.equal(nearbyView.count,39);cases.push({name:'Explicit event selection and room loss follow latest in the correct channel',eventView,nearbyView});

  await log.focus();await page.keyboard.press('Home');await page.waitForFunction(()=>document.querySelector('.gt-chat-log').scrollTop===0);await page.keyboard.press('Escape');assert(await focused(launcher));
  await page.keyboard.press('Enter');await atBottom();assert(await focused(composer));assert.equal(await composer.inputValue(),'Unsent draft stays here');
  assert.deepEqual(await page.evaluate(()=>window.fixture.sent.filter(message=>message.type==='CHAT')),[],'Reading never sends the draft');
  await page.keyboard.press('Escape');await page.locator('#scene').focus();await page.keyboard.down('w');assert.equal((await page.evaluate(()=>window.fixture.sample())).move.y,1);await page.keyboard.up('w');
  await launcher.focus();await page.keyboard.press('Enter');await page.evaluate(()=>window.fixture.chat.destroy());assert.equal(await launcher.count(),0,'Disposed launcher is removed');
  await page.locator('#scene').focus();await page.keyboard.down('ArrowRight');assert((await page.evaluate(()=>window.fixture.sample())).look.x>0);await page.keyboard.up('ArrowRight');
  cases.push({name:'Reopening follows latest and preserves draft; close/dispose restore gameplay'});
  await page.evaluate(()=>window.fixture.destroy());await page.close();
 }
 assert.deepEqual(report.errors,[]);report.passed=true;console.log(`CHAT_READER:PASS:${report.views.length} views/${report.views.reduce((n,v)=>n+v.cases.length,0)} groups`);
}catch(error){report.failure=String(error);throw error;}finally{await browser?.close();server.httpServer.closeAllConnections();await new Promise(done=>server.httpServer.close(done));await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
