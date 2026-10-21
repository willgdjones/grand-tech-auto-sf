import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, type Page } from '@playwright/test';
import { expect, test } from 'vitest';

test('native funding, ad and Friends dialogs retain the input/cursor guard across close, reopen and disposal', async () => {
  const root = resolve('artifacts/dialog-lifecycle-eln9', new Date().toISOString().replaceAll(':', '-'));
  await mkdir(root, { recursive: true });
  const bundle = await build({ bundle: true, write: false, outdir: root, format: 'iife', platform: 'browser',
    plugins: [{ name: 'explicit-dialog-fixture', setup(builder) {
      builder.onResolve({ filter: /^@gtasf\/shared\/flags$/ }, () => ({ path: 'flags', namespace: 'dialog-fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'dialog-fixture' }, () => ({ contents: 'export const flags={capTable:true,adSlots:true,friends:true,accountRecovery:true,driving:true,arcadeHandling:true,hillJumps:false,rentals:false,stripe:false};' }));
    } }], stdin: { resolveDir: process.cwd(), sourcefile: 'dialog-fixture.ts', loader: 'ts', contents: `
      import { createCapTable } from './web/src/hud/capTable';
      import { createAdSlotPage } from './web/src/hud/adSlotPage';
      import { createFriendsPanel } from './web/src/friends/friendsPanel';
      import { holdFreeCursor, needsFreeCursor } from './web/src/input/cursor';
      import { openSaveStartup, openRestoreStartup, isRecoveryDialogOpen, onRecoveryDialogChange, closeRecoveryDialogs } from './web/src/recovery/panel';
      import { createDrivingState, updateDriving } from './web/src/vehicles/driving/controller';
      import { BILLBOARD_SURFACES } from './shared/content/billboards';
      import './web/src/style.css';
      import './web/src/theme/saTheme.css';
      const calls={me:0,dm:0}, changes=[], leases=new Map();
      function modal(name,open) {
        changes.push([name,open]);
        if(open) { if(!leases.has(name)) leases.set(name,holdFreeCursor()); document.exitPointerLock?.(); }
        else { leases.get(name)?.(); leases.delete(name); }
      }
      // Explicit API fixtures; no funding write, friend message or purchase is sent.
      const requests=[];
      globalThis.fetch=async(url,options)=>{requests.push({url,method:options?.method??'GET'});return new Response(JSON.stringify(String(url).includes('/recovery/')?{hasCode:false}:{startupName:'Fogware',nickname:'foggy',round:{label:'Seed'},totalCents:'50000000',groups:[]}))};
      let finishDm;
      const client={me:async()=>{calls.me++;return{username:'local',friends:['peer'],incoming:[],outgoing:[]}},
        presence:async()=>[],fetchDms:()=>{calls.dm++;return new Promise(resolve=>{finishDm=resolve})}};
      const cap=createCapTable({parent:document.body,onModalChange:open=>modal('cap',open)});
      const ad=createAdSlotPage({onModalChange:open=>modal('ad',open)});
      const friends=createFriendsPanel({client,onModalChange:open=>modal('friends',open)});
      const target={kind:'billboard',id:BILLBOARD_SURFACES[0].id};
      const adButton=document.createElement('button');adButton.textContent='Inspect ad';adButton.onclick=()=>ad.open(target);document.body.append(adButton);
      const panels={cap,ad,friends};
      const open=name=>name==='ad'?ad.open(target):panels[name].open();
      const blocked=()=>cap.isOpen||ad.isOpen||friends.element.open||isRecoveryDialogOpen();
      const offRecovery=onRecoveryDialogChange(open=>changes.push(['recovery',open]));
      for(const [label,show] of [['Save fixture',openSaveStartup],['Restore fixture',openRestoreStartup]]){const button=document.createElement('button');button.textContent=label;button.onclick=()=>show();document.body.append(button)}
      const car=createDrivingState({x:0,y:0,z:0,yaw:0});
      const world={heightAt:()=>0,collidesCircle:()=>false};
      function drive(seconds){for(let i=0;i<Math.round(seconds*60);i++){const held=blocked();updateDriving(car,{steer:0,throttle:held?0:1,brake:0,handbrake:held},1/60,world)}return{speed:car.speed,z:car.z,blocked:blocked(),free:needsFreeCursor()}}
      Object.assign(window,{fixture:{panels,open,blocked,car,drive,changes,calls,needsFreeCursor,finishDm:()=>finishDm?.([]),requests,openSaveStartup,openRestoreStartup,closeRecoveryDialogs,isRecoveryDialogOpen,offRecovery}});
    ` } });
  const js = bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  const css = bundle.outputFiles.find(file => file.path.endsWith('.css'))!.text;
  await writeFile(resolve(root, 'bundle.js'), js);
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const errors: string[] = [];
  let page: Page | undefined;
  try {
    page = await browser.newPage({ viewport: { width: 1280, height: 800 }, hasTouch: true });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.setContent('<!doctype html><html><body style="background:#253746"></body></html>');
    await page.addStyleTag({ content: css }); await page.addScriptTag({ content: js });
    const entries = [
      { name: 'cap', button: 'My cap table', dialog: 'Player cap table' },
      { name: 'ad', button: 'Inspect ad', dialog: 'Buy this ad slot' },
      { name: 'friends', button: '👥 Friends', dialog: 'Friends and direct messages' },
    ];
    for (const entry of entries) {
      await page.evaluate('fixture.car.speed=8');
      await page.getByRole('button', { name: entry.button, exact: true }).click();
      const dialog = page.getByRole('dialog', { name: entry.dialog, exact: true });
      expect(await dialog.isVisible()).toBe(true);
      expect(await page.evaluate('fixture.drive(1)')).toMatchObject({ speed: 0, blocked: true, free: true });
      const result = await page.evaluate(name => {
        const f = (window as any).fixture;
        f.panels[name].close(); const closed = { blocked: f.blocked(), free: f.needsFreeCursor(), change: f.changes.at(-1) };
        f.open(name); return closed;
      }, entry.name);
      expect(result).toEqual({ blocked: false, free: false, change: [entry.name, false] });
      // Let the native queued close event arrive after showModal has reopened the same panel.
      await page.waitForTimeout(50);
      expect(await page.evaluate('({blocked:fixture.blocked(),free:fixture.needsFreeCursor(),change:fixture.changes.at(-1)})'))
        .toEqual({ blocked: true, free: true, change: [entry.name, true] });
      if (entry.name === 'ad') expect(await dialog.getByRole('button', { name: 'Buy this slot · checkout opens soon' }).isDisabled()).toBe(true);
      await page.keyboard.press('Escape');
      expect(await dialog.isVisible()).toBe(false);
      expect(await page.evaluate('fixture.drive(.1)')).toMatchObject({ blocked: false, free: false });
      expect((await page.evaluate('fixture.car.speed')) as number).toBeGreaterThan(0);
    }
    // Opening an already-open Friends panel must not create a second roster poll.
    await page.getByRole('button', { name: '👥 Friends', exact: true }).click();
    await page.evaluate('fixture.panels.friends.open();fixture.panels.friends.open()');
    const beforePoll = await page.evaluate('fixture.calls.me') as number;
    await page.waitForTimeout(5250);
    expect(await page.evaluate('fixture.calls.me')).toBe(beforePoll + 1);
    await page.getByRole('button', { name: 'Message', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.evaluate('fixture.finishDm()');
    const stopped = await page.evaluate('({...fixture.calls})');
    await page.waitForTimeout(5250);
    expect(await page.evaluate('({...fixture.calls})')).toEqual(stopped);
    expect(await page.evaluate('fixture.needsFreeCursor()')).toBe(false);

    await page.setViewportSize({ width: 390, height: 844 });
    for (const entry of entries) {
      await page.getByRole('button', { name: entry.button, exact: true }).tap();
      const dialog = page.getByRole('dialog', { name: entry.dialog, exact: true });
      expect(await dialog.isVisible()).toBe(true);
      expect(await page.evaluate('fixture.drive(1)')).toMatchObject({ speed: 0, blocked: true, free: true });
      if (entry.name === 'friends') {
        expect(await dialog.getByPlaceholder('Message…', { exact: true }).isVisible()).toBe(false);
        expect(await dialog.getByPlaceholder('Pick your username', { exact: true }).isVisible()).toBe(false);
      }
      await page.screenshot({ path: resolve(root, `${entry.name}-phone.png`) });
      await dialog.getByRole('button', { name: entry.name === 'friends' ? 'Close ×' : 'Close', exact: true }).tap();
      expect(await page.evaluate('fixture.blocked()||fixture.needsFreeCursor()')).toBe(false);
    }
    for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      for (const entry of [{ button: 'Save fixture', dialog: 'Save your startup' }, { button: 'Restore fixture', dialog: 'Restore your startup' }]) {
        await page.getByRole('button', { name: entry.button, exact: true }).tap();
        const dialog = page.getByRole('dialog', { name: entry.dialog, exact: true });
        expect(await dialog.isVisible()).toBe(true);
        expect(await page.evaluate('fixture.drive(1)')).toMatchObject({ speed: 0, blocked: true, free: true });
        const layout = await dialog.evaluate(element => {
          const title = element.querySelector('h2')!.getBoundingClientRect();
          const close = element.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.getBoundingClientRect();
          return { overlap: title.left < close.right && close.left < title.right && title.top < close.bottom && close.top < title.bottom,
            closeHeight: close.height, titleInView: title.top >= 0 && title.bottom <= innerHeight };
        });
        expect(layout.overlap).toBe(false); expect(layout.titleInView).toBe(true); expect(layout.closeHeight).toBeGreaterThanOrEqual(44);
        await page.screenshot({ path: resolve(root, `${entry.button.split(' ')[0]!.toLowerCase()}-${viewport.width}-phone.png`) });
        await dialog.getByRole('button', { name: 'Close', exact: true }).tap();
        expect(await page.evaluate('fixture.blocked()||fixture.needsFreeCursor()')).toBe(false);
      }
    }
    // A second recovery dialog owns a separate lease; closing one cannot unpause the other.
    await page.evaluate('fixture.openSaveStartup();fixture.openRestoreStartup()');
    await page.keyboard.press('Escape');
    expect(await page.evaluate('({open:fixture.isRecoveryDialogOpen(),free:fixture.needsFreeCursor()})')).toEqual({ open: true, free: true });
    await page.evaluate('fixture.closeRecoveryDialogs();fixture.closeRecoveryDialogs()');
    expect(await page.evaluate('({open:fixture.isRecoveryDialogOpen(),free:fixture.needsFreeCursor()})')).toEqual({ open: false, free: false });
    expect(await page.evaluate('fixture.requests.every(request=>request.method==="GET")')).toBe(true);
    // Teardown is synchronous and idempotent even with more than one native modal open.
    expect(await page.evaluate(() => {
      const f = (window as any).fixture;
      for (const name of ['cap', 'ad', 'friends']) f.open(name);
      f.offRecovery();
      f.panels.cap.destroy(); const oneRemaining = f.needsFreeCursor();
      f.panels.ad.destroy(); f.panels.friends.destroy();
      for (const panel of Object.values(f.panels) as any[]) panel.destroy();
      for (const name of ['cap', 'ad', 'friends']) f.open(name);
      return { oneRemaining, blocked: f.blocked(), free: f.needsFreeCursor(), dialogs: document.querySelectorAll('dialog').length };
    })).toEqual({ oneRemaining: true, blocked: false, free: false, dialogs: 0 });
    expect(errors).toEqual([]);
    await writeFile(resolve(root, 'report.json'), JSON.stringify({ passed: true, errors,
      scope: 'Actual native dialog modules, cursor leases and driving controller with explicit API/flag/flat-ground fixtures. No full-game, map, WebSocket, payment, device or performance acceptance.' }, null, 2));
  } catch (error) {
    await page?.screenshot({ path: resolve(root, 'failure.png') });
    const state = await page?.evaluate('({text:document.body.innerText,changes:window.fixture?.changes,calls:window.fixture?.calls})');
    await writeFile(resolve(root, 'failure.json'), JSON.stringify({ error: String(error), errors, state }, null, 2));
    throw error;
  } finally { await browser.close(); }
}, 120_000);
