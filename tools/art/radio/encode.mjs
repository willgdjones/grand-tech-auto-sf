// Lossy game deliverables only; fal WAV masters remain in the ignored asset cache.
import { readFile, mkdir, stat, readdir, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { execFileSync } from 'node:child_process';
const recipes = JSON.parse(await readFile(new URL('./recipes.json', import.meta.url), 'utf8'));
const out = 'web/public/audio/radio';
await mkdir(out, { recursive: true });
const rows = [];
for (const recipe of recipes) {
  try { await stat(recipe.output); } catch {
    if (process.argv.includes('--partial')) continue;
    throw new Error(`Missing master: ${recipe.output}; resume generation before encoding`);
  }
  const music = recipe.kind === 'music', target = `${out}/${basename(recipe.output, '.wav')}.mp3`;
  const master = await stat(recipe.output);
  const cached = await stat(target).catch(() => null);
  if (!cached || cached.mtimeMs < master.mtimeMs) {
    const filters = music
      ? 'afade=t=in:st=0:d=0.08,afade=t=out:st=119:d=0.9,loudnorm=I=-18:TP=-1.5:LRA=9'
      : 'highpass=f=80,loudnorm=I=-17:TP=-1.5:LRA=7';
    execFileSync('nice', ['-n', '10', 'ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-threads', '1', '-filter_threads', '1',
      '-i', recipe.output, '-map_metadata', '-1', '-af', filters, '-ar', '44100', '-ac', music ? '2' : '1',
      '-codec:a', 'libmp3lame', '-b:a', '64k', '-metadata', `title=${recipe.title}`,
      '-metadata', 'artist=GTASF Original Radio', target], { stdio: ['ignore', 'ignore', 'pipe'] });
  }
  const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size:stream=sample_rate,channels,bit_rate', '-of', 'json', target], { encoding: 'utf8' }));
  const bytes = Number(info.format.size), duration = Number(info.format.duration);
  if (bytes >= 25_000_000 || !(duration > 1) || (music && (duration < 115 || duration > 125))) throw new Error(`Invalid radio deliverable ${target}`);
  rows.push({ file: basename(target), kind: recipe.kind, title: recipe.title, bytes, duration, bitrate: 64000 });
}
const files = (await readdir(out)).filter(name => name.endsWith('.mp3'));
const totalBytes = (await Promise.all(files.map(name => stat(`${out}/${name}`)))).reduce((sum, file) => sum + file.size, 0);
if (totalBytes >= 25_000_000) throw new Error(`Radio set exceeds 25 MB: ${totalBytes}`);
await writeFile('tools/art/radio/inventory.json', `${JSON.stringify({ totalBytesIncludingLegacy: totalBytes, files: rows }, null, 2)}\n`);
console.log(`${rows.length} new clips encoded; ${totalBytes} total MP3 bytes including legacy loops.`);
