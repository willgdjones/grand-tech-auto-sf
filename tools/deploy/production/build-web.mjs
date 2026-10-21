import { readFile, writeFile, copyFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const publicVars = JSON.parse(await readFile('worker/.wrangler/production/public-vars.json', 'utf8'));
await stat('worker/.wrangler/production/flags.ts');
// Regenerate the embedded changelog from CHANGELOG.md so the What's new panel and
// /changelog page reflect this deploy's entries (PLAN-v2 §11).
await import('../../changelog/build.mjs');
await new Promise((done, fail) => {
  const child = spawn(resolve('node_modules/.bin/vite'), ['build','--config','web/vite.staging.config.ts'], {
    stdio: 'inherit', env: { ...process.env, GTASF_FLAGS_FILE: 'worker/.wrangler/production/flags.ts',
      ...Object.fromEntries(Object.entries(publicVars).map(([key,value]) => [`VITE_${key}`,value])) },
  });
  child.once('error', fail); child.once('exit', code => code === 0 ? done() : fail(new Error(`Web build failed: ${code}`)));
});
await copyFile('tools/deploy/production/pages-worker.js','web/dist-production/_worker.js');
// Everything but the unversioned static folders goes through _worker.js: /assets/* so a chunk the new release removed is
// served from the previous deployment (24 h) or 404s (never Pages' SPA index.html), AND every HTML entry point, so the
// HTML and its hashed chunks always come from the SAME deployment. With only /assets on the worker, a fresh deploy's
// static HTML went live 1-2 min before the new worker, whose stale ASSETS 404'd the new chunks. See serveAsset.
await writeFile('web/dist-production/_routes.json', JSON.stringify({ version: 1, include: ['/*'], exclude: ['/art/*','/audio/*','/data/*','/licenses/*'] }) + '\n');
await writeFile('web/dist-production/_headers', '/*\n  Referrer-Policy: same-origin\n  X-Content-Type-Options: nosniff\n');
console.log('Prepared Pages output with same-origin Worker service routing.');
