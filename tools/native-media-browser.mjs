import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';

/** An owned fresh browser profile, with real tab visibility and no autoplay bypass. */
export async function nativeMediaBrowser({ gpu = false } = {}) {
  const profile = await mkdtemp(join(tmpdir(), 'gtasf-radio-browser-'));
  const child = spawn(chromium.executablePath(), [
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking', ...(!gpu ? ['--disable-gpu'] : []), 'about:blank',
  ], { stdio: 'ignore' });
  let launchError, browser, closed = false;
  child.on('error', error => { launchError = error; });
  const exited = new Promise(done => child.once('exit', done));
  async function close() {
    if (closed) return; closed = true;
    if (browser) await Promise.race([browser.close().catch(() => {}), delay(3000)]);
    if (child.exitCode === null) child.kill('SIGTERM');
    await Promise.race([exited, delay(2000)]);
    if (child.exitCode === null) { child.kill('SIGKILL'); await exited; }
    await rm(profile, { recursive: true, force: true });
  }
  try {
    let port; const until = Date.now() + 15_000;
    while (!port && Date.now() < until) {
      if (launchError) throw launchError;
      if (child.exitCode !== null) throw new Error(`Native media browser exited ${child.exitCode}`);
      try { const value = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); if (Number.isInteger(value) && value > 0) port = value; } catch { /* Browser is still starting. */ }
      if (!port) await delay(100);
    }
    if (!port) throw new Error('Native media browser did not expose its local control port');
    // The documented noDefaults option prevents Playwright's own CDP session
    // from forcing every tab to stay visible/focused. No synthetic hide event.
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { noDefaults: true });
    const context = browser.contexts()[0]; if (!context) throw new Error('Native browser default context unavailable');
    const page = context.pages()[0] ?? await context.newPage(); await page.bringToFront();
    return { browser, context, page, close };
  } catch (error) { await close(); throw error; }
}
