// LANE E weather A/B (N31 rain at night; Karl fog-on check). Run: [WX='rain=0.6'|'fog=0.8'] [TAG=x] node tools/_qa-n31-rain.mjs.
// Arm 1 = live weather as-is (rain/fog 0), arm 2 = live weather with WX applied: prod #6.41 at real night, /api/weather stubbed to the live response with rain forced (0 vs RAIN).
// Frames + sky luma at 5 s and 45 s after READY: the weather grade blends in over ~12 s time constants after load.
import { createRequire } from 'node:module'; const { chromium } = createRequire('/Users/USER/Documents/GTASF/package.json')('@playwright/test');
const sharp = createRequire('/Users/USER/Documents/GTASF/package.json')('sharp');
const OUT = `/Users/USER/Documents/GTASF/docs/qa/n31-rain-${new Date().toISOString().slice(0, 10)}`;
import { mkdirSync } from 'node:fs'; mkdirSync(OUT, { recursive: true });
const live = await (await fetch('https://gtasf.com/api/weather')).json();
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const luma = async f => { const { width, height } = await sharp(f).metadata(); const st = await sharp(f).extract({ left: Math.round(width * 0.3), top: Math.round(height * 0.02), width: Math.round(width * 0.4), height: Math.round(height * 0.05) }).stats(); return Math.round(st.channels.slice(0, 3).reduce((a, c) => a + c.mean, 0) / 3); };
const wx = Object.fromEntries((process.env.WX ?? `rain=${process.env.RAIN ?? 0.6}`).split(',').map(kv => { const [k, v] = kv.split('='); return [k.trim(), Number(v)]; }));
for (const arm of [{ rain: 0, fog: 0 }, { rain: 0, fog: 0, ...wx }]) {
  const label = Object.entries(arm).filter(([, v]) => v).map(([k, v]) => `${k}${v}`).join('-') || 'clear';
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('gtasf.founder.v1', JSON.stringify({ founded: true, startupName: 'QA Founder', foundedAt: 1, billboardSeen: true, preSeedClosed: true, lastRoundCloseDay: '2020-01-01' })); } catch {} });
  await ctx.route('**/api/weather*', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...live, ...arm, status: 'live' }) }));
  const p = await ctx.newPage();
  // Ferry plaza, facing the Bay Bridge side: a wide open sky band above the HUD.
  await p.goto('https://gtasf.com/?at=37.795570,-122.393900,150&bot=1', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 150000 });
  for (let i = 0; i < 10; i++) { await p.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await p.waitForTimeout(300); }
  const res = {};
  for (const t of [5, 45]) { await p.waitForTimeout(t === 5 ? 2000 : 40000); const f = `${OUT}/${process.env.TAG ? process.env.TAG + '-' : ''}${label}-t${t}.jpg`; await p.screenshot({ path: f, type: 'jpeg', quality: 72 }); res[`t${t}`] = await luma(f); }
  console.log(`${label} skyLuma`, JSON.stringify(res), 'liveWeather', JSON.stringify({ cloudCover: live.cloudCover, fog: live.fog }));
  await ctx.close();
}
await b.close();
