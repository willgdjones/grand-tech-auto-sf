import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { supervise } from './dev-supervisor.mjs';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'gtasf-dev-supervisor-'));
  const worker = join(root, 'worker.mjs'), web = join(root, 'web.mjs');
  await writeFile(worker, `import {appendFileSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
    const count = existsSync('attempts') ? Number(readFileSync('attempts')) + 1 : 1;
    writeFileSync('attempts', String(count)); appendFileSync('pids', process.pid+'\\n');
    if (count <= Number(process.argv[2])) process.exit(1);
    writeFileSync('ready', String(process.pid)); setInterval(()=>{}, 1000);`);
  await writeFile(web, `import {appendFileSync,writeFileSync} from 'node:fs'; import {spawn} from 'node:child_process';
    appendFileSync('web-starts', process.pid+'\\n');
    const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
    writeFileSync('web-child',String(child.pid));
    if (process.argv[2] === 'fail') setTimeout(()=>process.exit(2),100);
    else setInterval(()=>{},1000);`);
  return { root, worker, web };
}
async function until(read, timeout = 4000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { try { const value = await read(); if (value) return value; } catch {} await delay(15); }
  throw new Error('Subprocess fixture did not reach the expected state');
}
const alive = pid => { try { process.kill(Number(pid), 0); return true; } catch { return false; } };
function launch(files, failCount, failWeb = false) {
  const messages = [];
  const dev = supervise([
    { name: 'Worker', command: process.execPath, args: [files.worker, String(failCount)], restart: true },
    { name: 'Web', command: process.execPath, args: [files.web, failWeb ? 'fail' : 'stay'] },
  ], { cwd: files.root, restartDelays: [30, 50, 70], shutdownMs: 500, log: value => messages.push(value) });
  return { ...dev, messages };
}

test('Worker retries retain one web process, then explicit stop cleans its descendant', async () => {
  const files = await fixture(), dev = launch(files, 2);
  try {
    await until(() => readFile(join(files.root, 'ready'), 'utf8'));
    const webPids = (await readFile(join(files.root, 'web-starts'), 'utf8')).trim().split('\n');
    const webChild = await readFile(join(files.root, 'web-child'), 'utf8');
    assert.equal(webPids.length, 1); assert.equal(alive(webPids[0]), true); assert.equal(alive(webChild), true);
    assert.equal(await readFile(join(files.root, 'attempts'), 'utf8'), '3');
    assert.equal(dev.messages.filter(m => m.includes('restart ')).length, 2);
    dev.stop(); assert.equal(await dev.done, 0);
    await until(() => !alive(webPids[0]) && !alive(webChild));
  } finally { dev.stop(); await dev.done; await rm(files.root, { recursive: true, force: true }); }
});

test('Repeated Worker failure exhausts three retries and stops the web process', async () => {
  const files = await fixture(), dev = launch(files, 99);
  try {
    assert.equal(await dev.done, 1);
    assert.equal(await readFile(join(files.root, 'attempts'), 'utf8'), '4');
    assert.ok(dev.messages.some(m => m.includes('failed repeatedly')));
    const webPid = (await readFile(join(files.root, 'web-starts'), 'utf8')).trim();
    await until(() => !alive(webPid));
  } finally { dev.stop(); await dev.done; await rm(files.root, { recursive: true, force: true }); }
});

test('A web failure stops the healthy Worker without starting a retry loop', async () => {
  const files = await fixture(), dev = launch(files, 0, true);
  try {
    assert.equal(await dev.done, 2);
    assert.equal(await readFile(join(files.root, 'attempts'), 'utf8'), '1');
    const workerPid = await readFile(join(files.root, 'ready'), 'utf8');
    await until(() => !alive(workerPid));
    assert.equal(dev.messages.some(m => m.includes('restart ')), false);
  } finally { dev.stop(); await dev.done; await rm(files.root, { recursive: true, force: true }); }
});
