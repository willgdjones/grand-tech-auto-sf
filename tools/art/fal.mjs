#!/usr/bin/env node
/** Capped, resumable fal queue client. See FAL.md; never log credentials or API bodies. */
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { editLedger, readLedger, finite } from './ledger.ts';

// Art helpers must not inherit disabled certificate verification from an agent shell.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '1';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const QUEUE = 'https://queue.fal.run';
const HARD_CAP_USD = 50;
const MAX_FILE_BYTES = 25_000_000;
const hash = value => createHash('sha256').update(value).digest('hex');
const sleep = ms => new Promise(done => setTimeout(done, ms));
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;

function queueUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid fal queue URL'); }
  if (url.origin !== QUEUE || url.username || url.password || url.hash || url.search) throw new Error('Untrusted fal queue URL');
  return url.href;
}

/** Dependency options permit isolated, unpaid unit tests; CLI always uses this checkout. */
export function createFalClient({ root = ROOT, fetchImpl = globalThis.fetch, wait = sleep, pollMs = 2500, timeoutMs = 600_000 } = {}) {
  const ledgerPath = resolve(root, 'tools/art/ledger.json');
  async function config() {
    let env;
    try { env = parseEnv(await readFile(resolve(root, 'tools/art/.env'), 'utf8')); }
    catch { throw new Error('Cannot read tools/art/.env'); }
    const key = env.FAL_KEY?.trim();
    if (!key || !env.FAL_MAX_USD?.trim()) throw new Error('FAL_KEY and FAL_MAX_USD are required in tools/art/.env');
    const limits = [HARD_CAP_USD, finite(Number(env.FAL_MAX_USD), 'FAL_MAX_USD')];
    if (process.env.FAL_MAX_USD !== undefined) limits.push(finite(Number(process.env.FAL_MAX_USD), 'process FAL_MAX_USD'));
    return { key, capUsd: Math.min(...limits) };
  }
  function counted(entries) {
    return entries.filter(e => e.provider === 'fal').reduce((sum, e) => sum + finite(e.reservedCredits, 'fal reserved cost') * finite(e.usdPerCredit, 'fal cost unit', true), 0);
  }
  function outputPath(output) {
    if (typeof output !== 'string') throw new Error('Recipe output path required');
    const path = relative(root, resolve(root, output));
    if (!(path.startsWith('web/public/art/') || path.startsWith('tools/assets/cache/')) || path.includes('..')) throw new Error('Output must be under web/public/art/ or tools/assets/cache/');
    return path;
  }
  async function update(id, fields) {
    return editLedger(ledgerPath, ledger => {
      const entry = ledger.entries.find(e => e.id === id && e.provider === 'fal');
      if (!entry) throw new Error('Fal ledger entry missing');
      Object.assign(entry, fields); return structuredClone(entry);
    });
  }
  async function request(url, key, input) {
    let response;
    try {
      response = await fetchImpl(queueUrl(url), {
        method: input === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(60_000),
        headers: { Authorization: `Key ${key}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        ...(input === undefined ? {} : { body: JSON.stringify(input) }),
      });
    } catch { throw new Error('Fal request failed; reservation retained, no automatic paid retry'); }
    if (!response.ok) throw new Error(`Fal request returned HTTP ${response.status}; reservation retained`);
    try { return await response.json(); } catch { throw new Error('Fal returned invalid JSON; reservation retained'); }
  }
  async function download(url, output) {
    let address;
    try { address = new URL(url); } catch { throw new Error('Fal result has no downloadable URL'); }
    if (address.protocol !== 'https:' || address.username || address.password) throw new Error('Fal output must be HTTPS');
    // A CDN request has no Authorization header. Never print signed result URLs.
    let response;
    try { response = await fetchImpl(address.href, { signal: AbortSignal.timeout(60_000), redirect: 'error' }); }
    catch { throw new Error('Fal download failed; resume the existing job'); }
    if (!response.ok || !response.body) throw new Error('Fal download unavailable; resume the existing job');
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > MAX_FILE_BYTES) throw new Error('Fal output exceeds 25 MB; download stopped');
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    const target = resolve(root, outputPath(output));
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, bytes); await rename(temporary, target);
    return { bytes: size, sha256: hash(bytes) };
  }
  async function finish(entry) {
    const { key } = await config();
    if (entry.status === 'complete') {
      try { if (hash(await readFile(resolve(root, outputPath(entry.output)))) === entry.sha256) return entry; } catch { /* redownload */ }
    }
    if (!entry.jobId || !entry.statusUrl || !entry.responseUrl) throw new Error(`Fal submission ${entry.id} is unresolved; reconcile it in fal before another paid submission`);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const status = await request(entry.statusUrl, key);
      if (status.error || ['FAILED', 'CANCELED', 'CANCELLED'].includes(status.status)) {
        await update(entry.id, { status: 'failed' });
        throw new Error(`Fal job ${entry.id} failed; estimated cost stays counted`);
      }
      if (status.status === 'COMPLETED') {
        const result = await request(entry.responseUrl, key);
        if (result.error) throw new Error('Fal result failed; estimated cost stays counted');
        const selected = entry.resultPath ? entry.resultPath.split('.').reduce((value, part) => value?.[part], result)
          : result.images?.[0]?.url ?? result.image?.url ?? result.video?.url ?? result.audio?.url;
        const file = await download(selected, entry.output);
        return update(entry.id, { status: 'complete', ...file, completedAt: new Date().toISOString() });
      }
      if (!['IN_QUEUE', 'IN_PROGRESS'].includes(status.status)) throw new Error('Unknown fal queue state; resume this job later');
      await wait(pollMs);
    }
    throw new Error(`Fal job ${entry.id} still running; use resume, never resubmit`);
  }
  async function run(recipe) {
    const { key } = await config();
    if (!recipe || !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*)+$/.test(recipe.model ?? '')) throw new Error('Recipe requires a fal model ID');
    if (!recipe.input || Array.isArray(recipe.input) || typeof recipe.input !== 'object') throw new Error('Recipe input must be an object');
    if (recipe.resultPath !== undefined && (typeof recipe.resultPath !== 'string' || !/^[\w-]+(?:\.[\w-]+)*$/.test(recipe.resultPath))) throw new Error('Invalid resultPath');
    if (JSON.stringify(recipe).includes(key)) throw new Error('Credential detected in recipe; refusing to store it');
    const estimate = finite(recipe.estimatedUsd, 'estimated USD cost', true);
    const reservedUsd = Math.ceil(estimate * 1_000_000) / 1_000_000;
    const output = outputPath(recipe.output);
    const fingerprint = hash(JSON.stringify(canonical([recipe.model, recipe.input])));
    const reservation = await editLedger(ledgerPath, async ledger => {
      const prior = ledger.entries.find(e => e.provider === 'fal' && e.key === fingerprint);
      if (prior) {
        if (prior.output !== output || prior.resultPath !== recipe.resultPath) throw new Error('Recipe already has another output; copy the cached file');
        return { entry: structuredClone(prior), fresh: false };
      }
      const { capUsd } = await config();
      const used = counted(ledger.entries);
      if (used + reservedUsd > capUsd + 1e-9) throw new Error(`Fal cap $${capUsd} would be exceeded (reserved $${used.toFixed(6)})`);
      if (ledger.entries.some(e => e.provider === 'fal' && ['submitting', 'ambiguous'].includes(e.status))) throw new Error('Unresolved fal submission; reconcile it before more paid work');
      if (ledger.entries.some(e => e.output === output)) throw new Error('Output already belongs to another art recipe');
      // USD-denominated credits preserve compatibility with the shared Scenario ledger.
      // No actualCredits: estimates remain reserved even after success/failure, never presented as billing.
      const entry = { id: randomUUID(), provider: 'fal', key: fingerprint, createdAt: new Date().toISOString(),
        prompt: String(recipe.input.prompt ?? ''), model: recipe.model, body: recipe.input, output,
        estimatedUsd: estimate, estimatedCredits: estimate, reservedCredits: reservedUsd, usdPerCredit: 1,
        costSource: 'caller conservative USD estimate; not a provider invoice', status: 'submitting',
        ...(recipe.resultPath ? { resultPath: recipe.resultPath } : {}) };
      ledger.entries.push(entry); return { entry: structuredClone(entry), fresh: true };
    });
    if (!reservation.fresh) return finish(reservation.entry);
    let submitted;
    try {
      const reply = await request(`${QUEUE}/${recipe.model}`, key, recipe.input);
      if (!reply.request_id || typeof reply.request_id !== 'string') throw new Error('Fal returned no request ID');
      submitted = await update(reservation.entry.id, { jobId: reply.request_id,
        statusUrl: queueUrl(reply.status_url), responseUrl: queueUrl(reply.response_url), status: 'submitted' });
    } catch (error) {
      await update(reservation.entry.id, { status: 'ambiguous' }); throw error;
    }
    return finish(submitted);
  }
  async function budget() {
    const { capUsd } = await config(); const ledger = await readLedger(ledgerPath);
    const entries = ledger.entries.filter(e => e.provider === 'fal');
    const reservedUsd = counted(entries);
    return { capUsd, reservedUsd, remainingUsd: Math.max(0, capUsd - reservedUsd),
      calls: entries.map(e => ({ id: e.id, model: e.model, status: e.status, estimatedUsd: e.estimatedUsd, output: e.output })) };
  }
  async function resume(id) {
    const entry = (await readLedger(ledgerPath)).entries.find(e => e.provider === 'fal' && e.id === id);
    if (!entry) throw new Error('Fal ledger ID not found');
    return finish(entry);
  }
  return { run, resume, budget };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, arg] = process.argv.slice(2);
  try {
    const client = createFalClient();
    if (command === 'budget') console.log(JSON.stringify(await client.budget(), null, 2));
    else if ((command === 'run' || command === 'resume') && arg) {
      let recipe;
      if (command === 'run') {
        try { recipe = JSON.parse(await readFile(arg, 'utf8')); } catch { throw new Error('Could not read recipe JSON'); }
      }
      const entry = command === 'run' ? await client.run(recipe) : await client.resume(arg);
      console.log(JSON.stringify({ id: entry.id, status: entry.status, output: entry.output, bytes: entry.bytes, estimatedUsd: entry.estimatedUsd }));
    } else throw new Error('usage: node tools/art/fal.mjs budget | run recipe.json | resume <ledger-id>');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
