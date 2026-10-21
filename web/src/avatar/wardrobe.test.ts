import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium, type Page } from '@playwright/test';
import { expect, test } from 'vitest';

/** One native DOM smoke; the catalogue and flag are explicit fixture inputs, never runtime overrides. */
test('wardrobe applies eligible choices, cancels safely, announces unlocks and fits a phone', async () => {
  const root = resolve('artifacts/wardrobe-ui-7aby', new Date().toISOString().replaceAll(':', '-'));
  await mkdir(root, { recursive: true });
  const bundle = await build({ bundle: true, write: false, outdir: root, format: 'iife', platform: 'browser',
    plugins: [{ name: 'explicit-wardrobe-fixture', setup(builder) {
      builder.onResolve({ filter: /^@gtasf\/shared\/flags$/ }, () => ({ path: 'flags', namespace: 'wardrobe-fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'wardrobe-fixture' }, () => ({ contents: 'export const flags={characterLooks:true};' }));
    } }], stdin: { resolveDir: process.cwd(), sourcefile: 'wardrobe-fixture.ts', loader: 'ts', contents: `
      import { createWardrobe } from './web/src/avatar/wardrobe';
      import { defaultAppearance } from './shared/content/cosmetics';
      import { flags } from '@gtasf/shared/flags';
      import './web/src/style.css';
      import './web/src/theme/saTheme.css';
      const state = { appearance: defaultAppearance(), round: { id: 'bootstrapping' }, changes: [], unlocks: [], modals: [] };
      const wardrobe = createWardrobe({ getAppearance: () => state.appearance, getRound: () => state.round,
        choices: { outfit: [{index:0,label:'Ocean hoodie'},{index:1,label:'Mission red'},{index:2,label:'Series A fixture',tier:2}] },
        onChange: value => { state.appearance=value; state.changes.push(value); },
        onUnlock: tier => state.unlocks.push(tier.index), onModalChange: open => state.modals.push(open) });
      document.body.append(wardrobe.launcher);
      Object.assign(window, { wardrobe, state, flagOff: () => { flags.characterLooks=false; return createWardrobe({}) === null; } });
    ` } });
  const js = bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  const css = bundle.outputFiles.find(file => file.path.endsWith('.css'))!.text;
  await writeFile(resolve(root, 'bundle.js'), js);
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const errors: string[] = [];
  let page: Page | undefined;
  try {
    page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.setContent('<!doctype html><html><body style="background:#253746"></body></html>');
    await page.addStyleTag({ content: css }); await page.addScriptTag({ content: js });
    const dialog = page.getByRole('dialog'), launcher = page.getByRole('button', { name: 'Wardrobe · O' });
    await launcher.click();
    expect(await dialog.isVisible()).toBe(true);
    expect(await page.getByLabel('Hairstyle', { exact: true }).isDisabled()).toBe(true);
    // isDisabled() follows an enclosing label to its enabled select in Playwright.
    // Read the option's native state directly, so the locked item is the subject.
    expect(await page.getByLabel('Outfit', { exact: true }).locator('option[value="2"]').evaluate(option => (option as HTMLOptionElement).disabled)).toBe(true);
    expect(await page.getByLabel('Outfit', { exact: true }).locator('option[value="2"]').textContent()).toContain('Series A required');
    await page.getByLabel('Outfit', { exact: true }).selectOption('1');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await page.evaluate('state.changes.length')).toBe(0);
    expect(await launcher.evaluate(element => element === document.activeElement)).toBe(true);
    await launcher.click();
    await page.getByLabel('Outfit', { exact: true }).selectOption('1');
    // A profile update while open must not be overwritten by the older draft identity/stage.
    await page.evaluate("state.appearance={...state.appearance,sex:'female',archetype:'design',car:3,stageRound:7}");
    await page.getByRole('button', { name: 'Wear this look' }).click();
    expect(await page.evaluate('state.appearance')).toMatchObject({ outfit: 1, sex: 'female', archetype: 'design', car: 3, stageRound: 7 });
    await page.evaluate("state.round={id:'series-a'};wardrobe.refresh();wardrobe.refresh()");
    expect(await page.evaluate('state.unlocks')).toEqual([2]);
    await launcher.click(); await page.getByLabel('Outfit', { exact: true }).selectOption('2');
    // Eligibility can fall while open: applying the old selection must not bypass it.
    await page.evaluate("state.round={id:'bootstrapping'}");
    await page.getByRole('button', { name: 'Wear this look' }).click();
    expect(await page.evaluate('state.appearance.outfit')).toBe(1);
    await launcher.click(); await page.screenshot({ path: resolve(root, 'desktop.png') });
    await page.keyboard.press('Escape'); expect(await dialog.isVisible()).toBe(false);
    expect(await page.evaluate('state.modals.at(-1)')).toBe(false);
    await page.setViewportSize({ width: 390, height: 844 });
    // Secondary touch while a joystick finger is held must open the same native dialog.
    await launcher.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: false });
    expect(await dialog.isVisible()).toBe(true);
    const layout = await dialog.evaluate(element => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom,
        width: element.clientWidth, contentWidth: element.scrollWidth,
        targets: [...element.querySelectorAll('select,button')].map(control => control.getBoundingClientRect().height) };
    });
    expect(layout.left).toBeGreaterThanOrEqual(0); expect(layout.right).toBeLessThanOrEqual(390);
    expect(layout.top).toBeGreaterThanOrEqual(0); expect(layout.bottom).toBeLessThanOrEqual(844);
    expect(layout.contentWidth).toBeLessThanOrEqual(layout.width);
    expect(layout.targets.every(height => height >= 44)).toBe(true);
    await page.screenshot({ path: resolve(root, 'phone.png') });
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await page.evaluate('flagOff()')).toBe(true);
    await page.evaluate('wardrobe.dispose();wardrobe.show()'); expect(await dialog.count()).toBe(0);
    expect(errors).toEqual([]);
    await writeFile(resolve(root, 'report.json'), JSON.stringify({ passed: true, errors, layout,
      scope: 'Isolated real wardrobe DOM, explicit catalogue/flag fixture; game wiring and avatar rendering require separate acceptance.' }, null, 2));
  } catch (error) {
    const state = await page?.evaluate(() => ({ text: document.body.innerText,
      options: [...document.querySelectorAll('option')].map(option => ({ value: option.value, disabled: option.disabled, text: option.textContent })) }));
    await page?.screenshot({ path: resolve(root, 'failure.png') });
    await writeFile(resolve(root, 'failure.json'), JSON.stringify({ error: String(error), errors, state }, null, 2));
    throw error;
  } finally { await browser.close(); }
}, 90_000);
