import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, delimiter, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { supervise } from './dev-supervisor.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const required = readFileSync(join(root, '.nvmrc'), 'utf8').trim();
const versionAtLeast = (value, minimum) => {
  const got = value.replace(/^v/, '').split('.').map(Number), need = minimum.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if (got[i] !== need[i]) return got[i] > need[i]; }
  return true;
};
// The default login shell may still select Node 22. Use an already installed supported runtime.
if (!versionAtLeast(process.version, required)) {
  const candidates = [
    join(process.env.NVM_DIR || join(homedir(), '.nvm'), 'versions/node', `v${required}`, 'bin/node'),
    join(homedir(), '.local/share/mise/installs/node', required, 'bin/node'),
    '/opt/homebrew/opt/node@24/bin/node',
  ];
  const runtime = candidates.find(path => existsSync(path) && versionAtLeast(spawnSync(path, ['--version'], { encoding: 'utf8' }).stdout.trim(), required));
  if (!runtime) { console.error(`GTASF needs Node ${required} or newer. Run nvm install && nvm use, then npm run dev.`); process.exit(1); }
  console.log(`GTASF: using ${runtime}`);
  const child = spawn(runtime, [fileURLToPath(import.meta.url)], { cwd: root, stdio: 'inherit', env: { ...process.env, PATH: `${dirname(runtime)}${delimiter}${process.env.PATH || ''}` } });
  process.on('SIGINT', () => child.kill('SIGINT')); process.on('SIGTERM', () => child.kill('SIGTERM'));
  child.on('exit', code => process.exit(code ?? 0));
} else {
  const roads = spawnSync(process.execPath, [join(root, 'tools/map/seed-local.mjs')], { cwd: root, stdio: 'inherit' });
  if (roads.error || roads.status !== 0) { console.error('Local road setup failed. See the error above.'); process.exit(roads.status || 1); }
  const seed = spawnSync(process.execPath, [join(root, 'tools/events/seed-local.mjs')], { cwd: root, stdio: 'inherit' });
  if (seed.error || seed.status !== 0) { console.error('Local event setup failed. See the error above.'); process.exit(seed.status || 1); }
  const dev = supervise([
    // GTASF_DEV_REMOTE_AI=1: proxy only the Workers AI binding to Cloudflare (spoken-bubble STT; needs wrangler login).
    { name: 'Worker', command: 'npm', args: process.env.GTASF_DEV_REMOTE_AI === '1' ? ['run', 'dev:ai', '-w', '@gtasf/worker'] : ['run', 'dev:worker'], restart: true },
    { name: 'Web', command: 'npm', args: ['run', 'dev:web'] },
    { name: 'Event refresh', command: process.execPath, args: [join(root, 'tools/events/refresh-local.mjs')] },
  ], { cwd: root });
  const stop = () => dev.stop();
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  dev.done.then(code => {
    process.exitCode = code;
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  });
}
