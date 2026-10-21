// Pre-ship gate for a look-capture PNG set (e.g. artifacts/look/deploy6-preview) before it goes to the
// founder. The <50KB size guard in look-capture.mjs is NOT enough: a blank-white 1280x800 frame with
// only the HUD drawn still compresses to ~335KB and would pass as "real" (gtasf-9xxk, RubyWaterfall).
// This catches every observed failure mode:
//   (a) tiny blank          -> size < 50KB
//   (b) byte-identical shots -> duplicate md5 (all GL-lost blanks share a hash; also the
//                               ferry-dusk==lombard-golden scene-not-switching dup CyanBeaver found)
//   (c) large blank-white    -> near-uniform content (high mean, near-zero variance) via sharp stats
// Exits non-zero if any shot fails, so a broken set is never published.
//   node tools/verify-look-set.mjs [dir=artifacts/look/deploy6-preview]
import { readdir, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import sharp from 'sharp';

const dir = process.argv[2] ?? 'artifacts/look/deploy6-preview';
const MIN_BYTES = 50_000;        // (a) tiny-blank floor
const BLANK_MEAN = 235;          // (c) per-channel mean above this = mostly one bright colour
const BLANK_STDEV = 14;          // (c) and variance below this = near-uniform (blank-white)

let pngs;
try { pngs = (await readdir(dir)).filter(f => f.toLowerCase().endsWith('.png')).sort(); }
catch (e) { console.error(`cannot read ${dir}: ${e.message}`); process.exit(2); }
if (!pngs.length) { console.error(`no PNGs in ${dir}`); process.exit(2); }

const byHash = new Map();
const rows = [];
for (const name of pngs) {
  const path = join(dir, name);
  const bytes = (await stat(path)).size;
  const buf = await readFile(path);
  const md5 = createHash('md5').update(buf).digest('hex');
  (byHash.get(md5) ?? byHash.set(md5, []).get(md5)).push(name);
  let meanMin = NaN, stdevMax = NaN, blankWhite = false;
  try {
    const { channels } = await sharp(buf).stats();
    const rgb = channels.slice(0, 3);
    meanMin = Math.min(...rgb.map(c => c.mean));
    stdevMax = Math.max(...rgb.map(c => c.stdev));
    blankWhite = meanMin > BLANK_MEAN && stdevMax < BLANK_STDEV;
  } catch (e) { rows.push({ name, fail: 'decode-error: ' + e.message.slice(0, 60) }); continue; }
  const fails = [];
  if (bytes < MIN_BYTES) fails.push(`tiny(${bytes}B)`);
  if (blankWhite) fails.push(`blank-white(mean${meanMin.toFixed(0)}/stdev${stdevMax.toFixed(1)})`);
  rows.push({ name, bytes, md5: md5.slice(0, 8), meanMin: +meanMin.toFixed(0), stdevMax: +stdevMax.toFixed(1), fail: fails.join(',') });
}

const dupes = [...byHash.values()].filter(names => names.length > 1);
for (const names of dupes) for (const r of rows) if (names.includes(r.name)) r.fail = [r.fail, `dup(${names.join('=')})`].filter(Boolean).join(',');

let ok = true;
for (const r of rows) {
  const status = r.fail ? `FAIL ${r.fail}` : 'ok';
  if (r.fail) ok = false;
  console.log(`${r.fail ? '✗' : '✓'} ${r.name}  ${r.bytes ?? '?'}B md5=${r.md5 ?? '?'} mean=${r.meanMin ?? '?'} stdev=${r.stdevMax ?? '?'}  ${status}`);
}
console.log(ok ? `PASS: ${rows.length} shots all non-blank + distinct` : `FAIL: look set is not shippable (see ✗ above)`);
process.exit(ok ? 0 : 1);
