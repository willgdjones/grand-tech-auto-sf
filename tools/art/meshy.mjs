#!/usr/bin/env node
/**
 * Meshy API client for the realistic vehicle fleet (gtasf-u9n0, founder-approved, paid plan).
 *
 *   node tools/art/meshy.mjs balance
 *   node tools/art/meshy.mjs gen <id> [<id>...]   # preview (mesh) -> refine (PBR textures) -> download GLB
 *   node tools/art/meshy.mjs resume               # finish any preview whose refine was interrupted
 *   node tools/art/meshy.mjs list                 # job ids and prompts
 *
 * Reads MESHY_API_KEY from tools/art/.env (ignored) and never prints it. Every task is appended to
 * tools/art/meshy-ledger.json (prompt, task ids, credits from the balance delta, output). The ledger
 * total is capped at MESHY_BUDGET (default 1,500 credits; raise only with orchestrator approval).
 * Raw GLBs land in ignored tools/assets/cache/meshy/; tools/assets/build-meshy.mjs converts them.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const ledgerPath = join(repo, 'tools/art/meshy-ledger.json');
const cacheDir = join(repo, 'tools/assets/cache/meshy');
const BUDGET = Number(process.env.MESHY_BUDGET ?? 1500);
const API = 'https://api.meshy.ai/openapi';

// Shared clauses: parody fleet, no real marks, game-ready closed body.
const CLEAN = 'No logos, no badges, no emblems, no text, no license plate text. Clean game-ready vehicle model, closed doors, solid body, realistic proportions.';
/** Prompts are short real-world descriptions; Meshy 6 does best with concrete shapes and materials. */
export const JOBS = {
  robotaxi: {
    prompt: 'Realistic compact electric crossover SUV robotaxi, glossy pearl white paint, smooth rounded modern body, black glass roof, roof rack carrying a large black sensor dome with a spinning lidar cylinder on top, small black camera pods on the front fenders and mirrors, black alloy wheels.',
    texture: 'glossy pearl white car paint, dark tinted glass, black sensor housings, black rubber tyres, dark grey alloy wheels, red tail lights, clear headlights. ' + CLEAN,
  },
  sedan: {
    prompt: 'Realistic modern electric four-door sedan car, sleek fastback roofline, deep metallic blue paint, black glass roof, flush door handles, aero alloy wheels.',
    texture: 'metallic deep blue car paint, dark tinted glass, black rubber tyres, silver alloy wheels, red tail light bar, clear headlights. ' + CLEAN,
  },
  hatchback: {
    prompt: 'Realistic compact hybrid five-door hatchback car, wedge shaped aerodynamic body, silver grey metallic paint, black lower trim, plastic wheel covers.',
    texture: 'silver grey metallic car paint, dark glass, black plastic trim, black tyres, grey wheel covers, red tail lights, clear headlights. ' + CLEAN,
  },
  suv: {
    prompt: 'Realistic mid-size station wagon SUV car, boxy practical body, roof rails, dark forest green paint, black plastic wheel arch cladding, all-terrain tyres.',
    texture: 'dark forest green car paint, dark glass, black plastic cladding, silver roof rails, black tyres, silver alloy wheels, red tail lights. ' + CLEAN,
  },
  van: {
    prompt: 'Realistic white delivery cargo van, long body on a long wheelbase with a low standard roof, sleek car-like proportions much longer than it is tall, sliding side door, no rear windows, black plastic bumpers, steel wheels.',
    texture: 'plain white van paint, dark glass windscreen, black plastic bumpers, black tyres, grey steel wheels, amber side markers. ' + CLEAN,
  },
  cab: {
    prompt: 'Realistic yellow taxi cab, modern four-door hybrid sedan car painted bright taxi yellow, small blank white roof sign box on top, black lower trim.',
    texture: 'bright taxi yellow car paint, blank white roof sign with no text, dark glass, black trim, black tyres, silver wheels, red tail lights. ' + CLEAN,
  },
  bus: {
    prompt: 'Realistic modern 40 foot low-floor electric city transit bus, long rectangular body, large side windows, red lower body with silver upper body, black windscreen, roof equipment pods, two axles.',
    texture: 'red and silver city bus livery without text, dark tinted windows, black rubber tyres, grey wheels, black bumpers, LED headlights. ' + CLEAN,
  },
  'cable-car': {
    prompt: 'Realistic San Francisco Powell Street cable car, historic wooden tram with open-air outer benches at each end, enclosed central cabin with windows, curved roof, maroon red and cream body with gold trim, small steel wheels, brass grab poles.',
    texture: 'maroon red painted wood lower panels, cream upper panels, gold pinstripe trim, varnished wood benches, brass poles, dark glass windows, black running gear. ' + CLEAN,
  },
  supercar: {
    prompt: 'Realistic low wide mid-engine supercar, aggressive angular wedge body, large rear wing spoiler, side air intakes, glossy lime green paint, black carbon fibre accents, large black alloy wheels.',
    texture: 'glossy lime green car paint, black carbon fibre splitter and wing, dark tinted glass, black tyres, black alloy wheels, red brake calipers, thin LED lights. ' + CLEAN,
  },
  'food-truck': {
    prompt: 'Realistic street food truck, long low step-van body with a standard roof, a large side serving window with a small flat awning, bright orange and white paint, realistic proportions clearly longer than tall.',
    texture: 'bright orange and white truck paint, stainless steel serving counter, blank menu board with no text, dark glass, black tyres, steel wheels. ' + CLEAN,
  },
  scooter: {
    prompt: 'Realistic electric kick scooter for rental, standing deck, tall handlebar stem, small wheels, matte black and teal frame.',
    texture: 'matte black aluminium frame, teal accents, black rubber grips and deck tape, grey wheels. ' + CLEAN,
  },
};

async function apiKey() {
  const text = await readFile(join(repo, 'tools/art/.env'), 'utf8');
  const key = /^\s*MESHY_API_KEY\s*=\s*["']?([^"'\s]+)/m.exec(text)?.[1];
  if (!key) throw new Error('MESHY_API_KEY missing from tools/art/.env');
  return key;
}
const KEY = await apiKey();

async function api(path, init = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(API + path, { ...init, headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json', ...init.headers } });
    if (res.status === 429 && attempt < 6) { await new Promise(r => setTimeout(r, 5000 * (attempt + 1))); continue; }
    const body = await res.text();
    if (!res.ok) throw new Error(`Meshy ${init.method ?? 'GET'} ${path} -> ${res.status} ${body.slice(0, 300)}`);
    return JSON.parse(body);
  }
}
const balance = async () => (await api('/v1/balance')).balance;

async function readLedger() {
  try { return JSON.parse(await readFile(ledgerPath, 'utf8')); } catch { return { version: 1, provider: 'meshy', entries: [] }; }
}
// Serialised ledger writes: parallel gen jobs share one file.
let ledgerLock = Promise.resolve();
function appendLedger(entry) {
  ledgerLock = ledgerLock.then(async () => {
    const ledger = await readLedger();
    ledger.entries.push(entry);
    ledger.totalCredits = ledger.entries.reduce((sum, e) => sum + (e.credits ?? 0), 0);
    await writeFile(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  });
  return ledgerLock;
}

async function waitTask(kind, id) {
  for (;;) {
    const task = await api(`/v2/text-to-3d/${id}`);
    if (task.status === 'SUCCEEDED') return task;
    if (task.status === 'FAILED' || task.status === 'CANCELED') throw new Error(`${kind} ${id} ${task.status}: ${task.task_error?.message ?? ''}`);
    await new Promise(r => setTimeout(r, 10_000));
  }
}

async function download(url, path) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  await writeFile(path, bytes);
  return { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

// Meshy 6 preview 20 + refine 10 (2K PBR) credits.
const COST = { preview: 20, refine: 10 };

/** Refine an existing preview mesh into a textured PBR GLB, download it, and record the ledger. */
async function refineStep(job, tag, previewId) {
  const refineBody = { mode: 'refine', preview_task_id: previewId, enable_pbr: true, texture_resolution: '2k', texture_prompt: job.texture, remove_lighting: true, target_formats: ['glb'] };
  const refineId = (await api('/v2/text-to-3d', { method: 'POST', body: JSON.stringify(refineBody) })).result;
  console.log(`${tag}: refine ${refineId}`);
  const refine = await waitTask('refine', refineId);
  await mkdir(cacheDir, { recursive: true });
  const out = join(cacheDir, `${tag}.glb`);
  const file = await download(refine.model_urls.glb, out);
  if (refine.thumbnail_url) await download(refine.thumbnail_url, join(cacheDir, `${tag}.png`)).catch(() => {});
  await appendLedger({ id: tag, step: 'refine', taskId: refineId, previewTaskId: previewId, createdAt: new Date().toISOString(), model: 'meshy-6', prompt: job.texture, body: { ...refineBody, texture_prompt: undefined }, credits: COST.refine, output: `tools/assets/cache/meshy/${tag}.glb`, ...file });
  console.log(`${tag}: ${file.bytes} bytes -> ${out}`);
}

async function generate(id, variant) {
  const job = JOBS[id];
  if (!job) throw new Error(`unknown job ${id}; see list`);
  const ledger = await readLedger();
  if ((ledger.totalCredits ?? 0) + COST.preview + COST.refine > BUDGET) throw new Error(`budget ${BUDGET} would be exceeded (ledger ${ledger.totalCredits})`);
  const tag = variant ? `${id}-${variant}` : id;
  const previewBody = {
    mode: 'preview', prompt: job.prompt, ai_model: 'meshy-6', should_remesh: true, topology: 'triangle',
    target_polycount: job.polycount ?? 24_000, target_formats: ['glb'],
  };
  const previewId = (await api('/v2/text-to-3d', { method: 'POST', body: JSON.stringify(previewBody) })).result;
  console.log(`${tag}: preview ${previewId}`);
  const preview = await waitTask('preview', previewId);
  await appendLedger({ id: tag, step: 'preview', taskId: previewId, createdAt: new Date().toISOString(), model: 'meshy-6', prompt: job.prompt, body: previewBody, credits: COST.preview, thumbnail: preview.thumbnail_url ? 'expires' : undefined });
  await refineStep(job, tag, previewId);
}

/**
 * Finish any preview whose refine never recorded (e.g. the process died mid-run): refine from the
 * stored preview task id so we don't re-spend 20 credits re-previewing. Idempotent on the ledger.
 */
async function resume() {
  const ledger = await readLedger();
  const refined = new Set(ledger.entries.filter(e => e.step === 'refine').map(e => e.id));
  const pending = ledger.entries.filter(e => e.step === 'preview' && !refined.has(e.id));
  if (!pending.length) { console.log('resume: nothing pending'); return; }
  if ((ledger.totalCredits ?? 0) + pending.length * COST.refine > BUDGET) throw new Error(`resume would exceed budget ${BUDGET} (ledger ${ledger.totalCredits})`);
  console.log(`resume: refining ${pending.map(e => e.id).join(', ')}`);
  const before = await balance();
  const results = await Promise.allSettled(pending.map(e => {
    const job = JOBS[e.id];
    return job ? refineStep(job, e.id, e.taskId) : Promise.reject(new Error(`no JOBS entry for ${e.id}`));
  }));
  results.forEach((r, i) => { if (r.status === 'rejected') console.error(`${pending[i].id}: ${r.reason.message}`); });
  console.log(`credits spent this run (balance delta): ${before - await balance()}`);
}

const [command, ...args] = process.argv.slice(2);
if (command === 'balance') console.log(`balance ${await balance()} credits; ledger ${(await readLedger()).totalCredits ?? 0}/${BUDGET}`);
else if (command === 'list') for (const [id, job] of Object.entries(JOBS)) console.log(`${id}: ${job.prompt}`);
else if (command === 'resume') await resume();
else if (command === 'gen') {
  const variant = process.env.MESHY_VARIANT;
  const spent = (await readLedger()).totalCredits ?? 0;
  if (spent + args.length * (COST.preview + COST.refine) > BUDGET) throw new Error(`batch would exceed budget ${BUDGET} (ledger ${spent})`);
  const before = await balance();
  const results = await Promise.allSettled(args.map(id => generate(id, variant)));
  results.forEach((r, i) => { if (r.status === 'rejected') console.error(`${args[i]}: ${r.reason.message}`); });
  console.log(`credits spent this run (balance delta): ${before - await balance()}`);
} else { console.error('usage: meshy.mjs balance | list | gen <id...> | resume'); process.exit(2); }
