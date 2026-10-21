/** Host observations around the unchanged Columbus test; never filter its frames. */
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadavg, platform } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export async function readHostSnapshot() {
  const started = performance.now();
  async function read(command, args) {
    try { return { stdout: (await execute(command, args, { timeout: 2000, maxBuffer: 1024 * 1024 })).stdout }; }
    catch (error) { return { error: String(error) }; }
  }
  const [processes, thermal] = await Promise.all([
    read('ps', ['-Ao', 'pid,pcpu,pmem,comm']),
    platform() === 'darwin' ? read('pmset', ['-g', 'therm']) : Promise.resolve({ error: 'pmset unavailable on this platform' }),
  ]);
  const topProcesses = (processes.stdout ?? '').split('\n').flatMap(line => {
    // Executable names only: command arguments can contain private values.
    const match = line.trim().match(/^(\d+)\s+([\d.]+)\s+([\d.]+)\s+(.+)$/);
    return match ? [{ pid: Number(match[1]), cpuPercent: Number(match[2]), memoryPercent: Number(match[3]), name: match[4] }] : [];
  }).sort((a, b) => b.cpuPercent - a.cpuPercent).slice(0, 16);
  const limits = Object.fromEntries([...(thermal.stdout ?? '').matchAll(/(CPU_\w+)\s*=\s*(\d+)/g)].map(match => [match[1], Number(match[2])]));
  return { observedAt: new Date().toISOString(), durationMs: performance.now() - started, loadAverage: loadavg(),
    limits, thermal, topProcesses, ...(processes.error ? { processError: processes.error } : {}) };
}

export async function runWithHostSnapshots({ command, args, out, intervalMs = 15_000, snapshot = readHostSnapshot }) {
  await mkdir(out, { recursive: true });
  const samplesPath = resolve(out, 'host-samples.jsonl'), resultPath = resolve(out, 'host-run.json');
  await writeFile(samplesPath, '', { flag: 'wx' }); // Never mix measurements from different runs.
  const started = performance.now(), startedAt = new Date().toISOString();
  const sample = async phase => {
    let value;
    try { value = await snapshot(); } catch (error) { value = { error: String(error) }; }
    await appendFile(samplesPath, JSON.stringify({ phase, elapsedMs: performance.now() - started, ...value }) + '\n');
  };
  await sample('before');
  let pending, monitorError;
  const timer = setInterval(() => {
    if (pending) return;
    pending = sample('during').catch(error => { monitorError = String(error); }).finally(() => { pending = undefined; });
  }, intervalMs);
  let result;
  try {
    result = await new Promise(resolveExit => {
      const child = spawn(command, args, { stdio: 'inherit' });
      child.once('error', error => resolveExit({ exitCode: 1, launchError: String(error) }));
      child.once('close', (exitCode, signal) => resolveExit({ exitCode: exitCode ?? 1, signal }));
    });
  } finally {
    clearInterval(timer);
    await pending;
    await sample('after');
  }
  await writeFile(resultPath, JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), intervalMs,
    samplingNote: 'Host observations are diagnostic. All application frames and acceptance criteria remain unchanged.',
    ...result, ...(monitorError ? { monitorError } : {}) }, null, 2) + '\n');
  return result.exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert(process.env.GTASF_STREAM_APP && process.env.GTASF_STREAM_OUT, 'Set a pinned GTASF_STREAM_APP and fresh GTASF_STREAM_OUT');
  const harness = resolve('tools/columbus-stream-smoke.mjs');
  const out = resolve(process.env.GTASF_STREAM_OUT);
  await mkdir(out, { recursive: true });
  await writeFile(resolve(out, 'host-wrapper-source.json'), JSON.stringify({
    wrapperSha256: createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex'),
    harnessSha256: createHash('sha256').update(await readFile(harness)).digest('hex'),
    nodeVersion: process.version, app: process.env.GTASF_STREAM_APP,
  }, null, 2) + '\n');
  process.exitCode = await runWithHostSnapshots({ command: process.execPath,
    args: [resolve('node_modules/tsx/dist/cli.mjs'), harness], out });
}
