// Silence audit for shipped audio (lane B, 2026-10-16): the #6.39 voiced SFPD barks and both male screams shipped as
// digital silence (a bad trim/normalise) and nothing caught it. Decodes every clip with ffmpeg and fails any whose
// loudest 50 ms window is under -30 dBFS. Usage: node tools/_audio-silence-audit.mjs [dir ...]  (default web/public/audio/combat)
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const dirs = process.argv.slice(2).length ? process.argv.slice(2) : ['web/public/audio/combat'];
let bad = 0, total = 0;
for (const dir of dirs) for (const name of readdirSync(dir).filter(n => /\.(mp3|ogg|wav|m4a|opus|webm)$/.test(n)).sort()) {
  const pcm = spawnSync('ffmpeg', ['-v', 'error', '-i', join(dir, name), '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], { maxBuffer: 1 << 28 }).stdout;
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
  if (samples.length === 0) { console.log(`skip   ${join(dir, name)}  (no audio track — e.g. a muted video)`); continue; }
  let peak = -Infinity;
  for (let i = 0; i + 800 <= Math.max(800, samples.length); i += 800) {
    let sum = 0; for (let j = i; j < Math.min(samples.length, i + 800); j++) sum += (samples[j] / 32768) ** 2;
    peak = Math.max(peak, 10 * Math.log10(sum / 800 + 1e-18));
  }
  total++; const silent = !(peak >= -30); if (silent) bad++;
  console.log(`${silent ? 'SILENT' : 'ok    '} ${join(dir, name)}  ${(samples.length / 16000).toFixed(2)} s  peak ${peak.toFixed(1)} dBFS`);
}
console.log(`RESULT ${bad ? `FAIL ${bad}/${total} clips near-silent` : `PASS ${total} clips audible`}`);
process.exitCode = bad ? 1 : 0;
