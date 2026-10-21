/** Record the mounted city at a fixed simulation rate; wall time is deliberately irrelevant. */
import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { resolve } from 'node:path';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1];
  if (!key?.startsWith('--') || value === undefined) throw new Error('Arguments use --name value. See web/src/cinematic/GUIDE.md.');
  const name = key.slice(2);
  if (!['path', 'framing', 'fps', 'duration', 'out', 'url', 'event', 'hud', 'snapshot'].includes(name)) throw new Error(`Unknown argument ${key}`);
  args.set(name, value);
}
const paths = (args.get('path') ?? 'lombard').split(',');
const framings = (args.get('framing') ?? 'landscape').split(',');
const fps = Number(args.get('fps') ?? 30), duration = Number(args.get('duration') ?? 0);
if (!Number.isInteger(fps) || fps < 1 || fps > 60) throw new Error('fps must be an integer from1 to60');
if (args.has('duration') && (!Number.isFinite(duration) || duration < 2 || duration > 120)) throw new Error('duration must be2..120 seconds');
for (const path of paths) if (!['lombard', 'ferry', 'salesforce', 'event'].includes(path)) throw new Error(`Unknown rail ${path}`);
for (const framing of framings) if (!['portrait', 'landscape'].includes(framing)) throw new Error(`Unknown framing ${framing}`);
for (const command of ['ffmpeg', 'ffprobe']) if (spawnSync(command, ['-version'], { stdio: 'ignore' }).status !== 0) throw new Error(`${command} is required on PATH`);
const out = resolve(args.get('out') ?? `artifacts/cinematic/${new Date().toISOString().replaceAll(':', '-')}`);
await mkdir(out, { recursive: true });
let preview, browser, currentPage;
let baseUrl = args.get('url') ?? process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173/';
const report = { startedAt: new Date().toISOString(), fps, captures: [], errors: [], passed: false };
try {
if (args.get('snapshot') === '1') {
  // One scoped web build isolates this recording from other panes' HMR edits.
  const { build, preview: startPreview } = await import('vite');
  const configFile = resolve('web/vite.config.ts'), root = resolve('web'), app = `${out}/app`;
  await build({ configFile, root, logLevel: 'warn', build: { outDir: app, emptyOutDir: true, reportCompressedSize: false } });
  preview = await startPreview({ configFile, root, build: { outDir: app }, preview: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } } });
  baseUrl = preview.resolvedUrls.local[0];
}
browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  for (const path of paths) for (const framing of framings) {
    const width = framing === 'portrait' ? 1080 : 1920, height = framing === 'portrait' ? 1920 : 1080;
    const url = new URL(baseUrl);
    url.searchParams.set('capture', '1'); url.searchParams.set('cinematic', path);
    url.searchParams.set('fps', String(fps)); url.searchParams.set('hud', args.get('hud') ?? '0'); url.searchParams.set('preset', 'high');
    if (duration) url.searchParams.set('duration', String(duration));
    if (args.has('event')) url.searchParams.set('event', args.get('event'));
    // Start on mapped ground. City-wide landmarks can sit beyond the current ground corridor.
    if (path === 'lombard') url.searchParams.set('at', '37.80199520213967,-122.41963019831591,87.8');
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    currentPage = page;
    page.setDefaultTimeout(90_000);
    let navigations = 0, worldSockets = 0;
    page.on('websocket', socket => { if (new URL(socket.url()).pathname === '/api/world') worldSockets++; });
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
    url.searchParams.set('bot', '1'); // automated visit: excluded from analytics and player counts
    await page.goto(url.href);
    await page.waitForFunction(() => window.__gtasf?.ready || document.querySelector('#loading.failed'));
    const availability = await page.evaluate(() => ({ active: Boolean(window.__gtasf?.world?.cinematic), error: document.querySelector('#loading.failed #loading-detail')?.textContent }));
    if (!availability.active) throw new Error(availability.error ?? 'Cinematic mode is disabled or its main-loop integration is missing.');
    if (worldSockets) throw new Error('Cinematic capture must remain offline from multiplayer.');
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
    await page.waitForSelector('#loading', { state: 'hidden' });
    const metadata = await page.evaluate(() => window.__gtasf.world.cinematic.metadata);
    const frames = Math.ceil(metadata.duration * fps), name = `${path}-${framing}`, file = `${out}/${name}.mp4`;
    const capture = { path, framing, width, height, frames, file, url: url.href, metadata, samples: [] };
    report.captures.push(capture);
    const ffmpeg = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-n', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-framerate', String(fps), '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-threads', '2', '-preset', 'fast', '-crf', '19', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file], { stdio: ['pipe', 'ignore', 'pipe'] });
    let encoderError = '';
    let pipeError;
    ffmpeg.stdin.on('error', error => { pipeError = error; });
    ffmpeg.stderr.on('data', data => { encoderError = (encoderError + data).slice(-6000); });
    const encoderDone = new Promise((resolveDone, reject) => {
      ffmpeg.on('error', reject);
      ffmpeg.on('close', code => code === 0 ? resolveDone() : reject(new Error(`ffmpeg exit${code}: ${encoderError}`)));
    });
    // Keep early encoder errors handled while screenshot I/O is still pending.
    encoderDone.catch(() => {});
    try {
      for (let i = 0; i < frames; i++) {
        if (i > 0) await page.evaluate(async () => { await window.__gtasf.step(1); });
        if (navigations || report.errors.length) throw new Error(`Capture interrupted: ${navigations} navigations, ${report.errors.join('; ')}`);
        const buffer = await page.screenshot({ type: 'jpeg', quality: 94 });
        if (pipeError || ffmpeg.exitCode !== null) throw pipeError ?? new Error(`Encoder exited: ${encoderError}`);
        if (!ffmpeg.stdin.write(buffer)) await Promise.race([once(ffmpeg.stdin, 'drain'), encoderDone.then(() => { throw new Error('Encoder ended before all frames'); })]);
        if ([0, Math.floor(frames / 2), frames - 1].includes(i)) {
          await writeFile(`${out}/${name}-${String(i).padStart(4, '0')}.jpg`, buffer);
          const sample = await page.evaluate(() => ({ frame: window.__gtasf.frame, seconds: window.__gtasf.seconds, metadata: window.__gtasf.world.cinematic.metadata }));
          if (sample.frame !== i || Math.abs(sample.seconds - i / fps) > 1e-6 || Math.abs(sample.metadata.seconds - sample.seconds) > 1e-6) throw new Error(`Rail and fixed clock diverged at frame${i}`);
          capture.samples.push(sample);
        }
      }
      ffmpeg.stdin.end(); await encoderDone;
    } catch (error) { ffmpeg.stdin.destroy(); ffmpeg.kill('SIGTERM'); await encoderDone.catch(() => {}); throw error; }
    const probe = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,nb_frames,avg_frame_rate', '-of', 'json', file], { encoding: 'utf8' });
    if (probe.status !== 0) throw new Error(probe.stderr);
    capture.encoded = JSON.parse(probe.stdout).streams[0];
    if (capture.encoded.width !== width || capture.encoded.height !== height || Number(capture.encoded.nb_frames) !== frames) throw new Error(`Unexpected encoded dimensions or frame count: ${JSON.stringify(capture.encoded)}`);
    capture.harnessErrors = await page.evaluate(() => window.__gtasf.errors);
    if (capture.harnessErrors.length) throw new Error(capture.harnessErrors.join('; '));
    const first = capture.samples[0].metadata.position, middle = capture.samples[1].metadata.position;
    if (Math.hypot(...first.map((value, index) => value - middle[index])) < .1) throw new Error('The rail camera did not move between sampled frames.');
    if (worldSockets) throw new Error('Cinematic capture opened a multiplayer connection.');
    await page.close(); currentPage = undefined; console.log(`Recorded ${name}: ${frames} frames at ${fps}fps → ${file}`);
  }
  report.passed = report.errors.length === 0;
} catch (error) { report.failure = String(error); await currentPage?.screenshot({ path: `${out}/failed.png` }).catch(() => {}); throw error; }
finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n'); await browser?.close();
  if (preview) { preview.httpServer.closeAllConnections(); await new Promise(resolveClose => preview.httpServer.close(resolveClose)); }
}
