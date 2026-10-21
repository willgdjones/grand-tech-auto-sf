/** Physical keyboard taps through the actual Input module; no game/FPS claim. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';

const out = resolve(process.env.GTASF_KEY_TAPS_OUT ?? 'artifacts/keyboard-taps/check');
await mkdir(out, { recursive: true });
const config = { configFile: false, root: out, publicDir: false, logLevel: 'warn',
  resolve: { alias: { '@gtasf/shared': resolve('shared') } },
  build: { target: 'es2022', outDir: `${out}/app`, emptyOutDir: true, reportCompressedSize: false } };
await writeFile(`${out}/index.html`, '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><input aria-label="Nickname"><canvas tabindex="0" style="display:block;width:600px;height:400px"></canvas><script type="module" src="/entry.js"></script>');
await writeFile(`${out}/entry.js`, `import {Input} from '${resolve('web/src/input/input.ts')}';
import {holdFreeCursor} from '${resolve('web/src/input/cursor.ts')}';
const input=new Input(document.querySelector('canvas'),{touch:false});
const counts={'enter-exit':0,hail:0,map:0,horn:0};
for(const action of Object.keys(counts)) input.actions.on(action,()=>counts[action]++);
let free,pad=null;
Object.defineProperty(navigator,'getGamepads',{value:()=>pad?[pad]:[]});
window.taps={
  poll(){input.poll(1/60);return {counts:{...counts},horn:input.held('horn'),pressed:input.pressed('horn'),move:{...input.move}};},
  release(){input.release();},
  virtual(value){input.virtual=value;},
  modal(value){if(value)free??=holdFreeCursor();else{free?.();free=undefined;}},
  pad(value){pad=value?{connected:true,axes:[0,0,0,0],buttons:Array.from({length:16},(_,i)=>({pressed:i===4,value:i===4?1:0,touched:false}))}:null;},
  destroy(){free?.();input.dispose();}
};`);
await build(config);
const server = await preview({ ...config, preview: { host: '127.0.0.1', port: 0 } });
let browser;
const report = { checkedAt: new Date().toISOString(), scope: 'Actual Input keyboard and gamepad integration; no renderer/server', cases: [], errors: [], failures: [], passed: false };
const check = async (name, test) => {
  try { const evidence = await test(); report.cases.push({ name, passed: true, ...evidence }); }
  catch (error) { report.cases.push({ name, passed: false, failure: String(error) }); report.failures.push(name); }
};
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--disable-webgl'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
  page.setDefaultTimeout(5000);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  await page.goto(server.resolvedUrls.local[0]); await page.waitForFunction(() => window.taps);
  const poll = () => page.evaluate(() => window.taps.poll());
  const reset = async () => { await page.evaluate(() => { window.taps.modal(false); window.taps.pad(false); window.taps.virtual(null); window.taps.release(); }); await page.locator('canvas').focus(); await poll(); };
  for (const [key, action] of [['KeyE','enter-exit'],['KeyH','hail'],['KeyM','map'],['KeyF','horn']]) {
    await check(`${key}: two adjacent completed taps each fire once`, async () => {
      await reset(); const start = (await poll()).counts[action];
      await page.keyboard.press(key); const first = (await poll()).counts[action];
      await page.keyboard.press(key); const second = (await poll()).counts[action];
      const deltas = [first-start, second-first]; assert.deepEqual(deltas, [1,1]);
      assert.equal((await poll()).counts[action], second); return { deltas };
    });
  }
  await check('Held key and auto-repeat fire once, release then repress fires again', async () => {
    await reset(); const start = (await poll()).counts.horn;
    await page.keyboard.down('KeyF'); assert.equal((await poll()).counts.horn, start+1);
    await page.keyboard.down('KeyF'); assert.equal((await poll()).counts.horn, start+1);
    assert.equal((await poll()).pressed, false); await page.keyboard.up('KeyF');
    await page.keyboard.down('KeyF'); assert.equal((await poll()).counts.horn, start+2);
    await page.keyboard.up('KeyF'); assert.equal((await poll()).horn, false);
  });
  await check('Gamepad held button keeps rising-edge semantics', async () => {
    await reset(); const start = (await poll()).counts.horn;
    await page.evaluate(() => window.taps.pad(true)); assert.equal((await poll()).counts.horn, start+1);
    for (let i=0;i<8;i++) assert.equal((await poll()).counts.horn, start+1);
    await page.evaluate(() => window.taps.pad(false)); assert.equal((await poll()).horn, false);
    await page.evaluate(() => window.taps.pad(true)); assert.equal((await poll()).counts.horn, start+2);
  });
  await check('Modal/release/text cancel queued gameplay taps while map can close UI', async () => {
    await reset(); const start = (await poll()).counts;
    await page.keyboard.press('KeyF'); await page.evaluate(() => window.taps.modal(true));
    assert.equal((await poll()).counts.horn, start.horn);
    await page.keyboard.press('KeyF'); assert.equal((await poll()).counts.horn, start.horn);
    await page.keyboard.press('KeyM'); assert.equal((await poll()).counts.map, start.map+1);
    await page.keyboard.press('KeyM'); assert.equal((await poll()).counts.map, start.map+2);
    await page.evaluate(() => window.taps.modal(false));
    await page.keyboard.press('KeyF'); await page.evaluate(() => window.taps.release());
    assert.equal((await poll()).counts.horn, start.horn);
    await page.getByLabel('Nickname').fill('Founder'); await page.keyboard.press('KeyF');
    assert.equal((await poll()).counts.horn, start.horn);
  });
  await check('Virtual neutral discards physical tap; held virtual horn fires once', async () => {
    await reset(); const start = (await poll()).counts.horn;
    await page.evaluate(() => window.taps.virtual({})); await page.keyboard.press('KeyF');
    assert.equal((await poll()).counts.horn, start);
    await page.evaluate(() => window.taps.virtual(null)); assert.equal((await poll()).counts.horn, start);
    await page.evaluate(() => window.taps.virtual({actions:['horn']}));
    assert.equal((await poll()).counts.horn, start+1); assert.equal((await poll()).counts.horn, start+1);
    await page.evaluate(() => window.taps.virtual({})); assert.equal((await poll()).horn, false);
    await page.evaluate(() => window.taps.virtual(null)); await page.keyboard.press('KeyF');
    assert.equal((await poll()).counts.horn, start+2);
  });
  await page.evaluate(() => window.taps.destroy()); await page.close();
  assert.deepEqual(report.errors, []); assert.deepEqual(report.failures, []); report.passed = true;
} catch (error) { report.failure = String(error); throw error; }
finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2)+'\n');
  await browser?.close(); server.httpServer.closeAllConnections(); await new Promise(done => server.httpServer.close(done));
  console.log(JSON.stringify(report));
}
