#!/usr/bin/env node
/**
 * Meshy API client for realistic facade HERO PIECES (gtasf-realistic-facade-meshy-pieces-xyrw).
 * A handful of generic, reusable architectural pieces (SF bay window, iron fire escape, cornice,
 * awning, storefront) generated once and INSTANCED procedurally onto real building footprints by
 * tools/assets/build-facade-pieces.mjs + the render instancer — the teleop approach, no hand-made
 * per-building models.
 *
 *   node tools/art/meshy-facade-pieces.mjs balance
 *   node tools/art/meshy-facade-pieces.mjs gen <id> [<id>...]
 *   node tools/art/meshy-facade-pieces.mjs resume      # finish any interrupted preview
 *   node tools/art/meshy-facade-pieces.mjs list
 *
 * Shares the paid Meshy plan, the 1,500-credit budget and the ledger (tools/art/meshy-ledger.json)
 * with the cars pane (gtasf-u9n0) — coordinate spend. Reads MESHY_API_KEY from tools/art/.env
 * (ignored) and never prints it. Raw GLBs land in ignored tools/assets/cache/meshy-facades/.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const ledgerPath = join(repo, 'tools/art/meshy-ledger.json');
const cacheDir = join(repo, 'tools/assets/cache/meshy-facades');
const BUDGET = Number(process.env.MESHY_BUDGET ?? 1500);
const API = 'https://api.meshy.ai/openapi';

// Generic reusable pieces, no logos/text. Instanced many times, so keep them modest.
const CLEAN = 'No logos, no badges, no text, no signage lettering. Clean game-ready architectural piece, generic, realistic proportions.';
export const JOBS = {
  'bay-window': {
    prompt: 'Realistic San Francisco Victorian bay window, a three-sided projecting oriel window unit with slim wood mullions, glass panes and carved trim, cream and white painted wood, flat back to mount flush on a building wall.',
    texture: 'cream and white painted wood trim, clear glass panes, subtle weathering. ' + CLEAN,
  },
  'fire-escape': {
    prompt: 'Realistic black wrought-iron fire escape, a narrow steel balcony platform with a safety railing and a drop ladder, flat back to bolt onto a building wall, weathered black paint.',
    texture: 'weathered matte black painted steel, slight rust at the joints. ' + CLEAN,
  },
  'cornice': {
    prompt: 'Realistic ornate building cornice, a long horizontal crown moulding strip for a building roofline with classical dentils and small brackets, pale stone grey, flat back.',
    texture: 'pale grey cast-stone, soft weathering in the recesses. ' + CLEAN,
  },
  'awning': {
    prompt: 'Realistic storefront awning, a simple angled canopy over a shop window with a metal frame and a plain fabric cover, dark green canvas, flat back to mount above a shopfront.',
    texture: 'dark green canvas cover, dark metal frame, plain with no lettering. ' + CLEAN,
  },
  'storefront': {
    prompt: 'Realistic ground-floor storefront unit, a shopfront with large display windows, a central recessed glass door, a low bulkhead base and a plain blank signage band above, dark framed, flat back to line up along a building base.',
    texture: 'dark anodised metal frames, clear display glass, blank signage band, concrete bulkhead. ' + CLEAN,
  },
  entrance: {
    prompt: 'Realistic ornate building entrance, a grand doorway with a carved pale stone surround, two slim pilasters, a decorative pediment and a transom window above, recessed double doors, flat back to mount at a building base.',
    texture: 'pale carved stone surround, dark painted timber doors, clear transom glass, subtle weathering. ' + CLEAN,
  },
  balcony: {
    prompt: 'Realistic small wrought-iron Juliet balcony, a shallow ornate black iron railing balconette with scrollwork projecting a little from a tall window, flat back to bolt onto a building wall.',
    texture: 'ornate matte black painted wrought iron with scrollwork, slight rust at the joints. ' + CLEAN,
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

const COST = { preview: 20, refine: 10 };
async function refineStep(job, tag, previewId) {
  const refineBody = { mode: 'refine', preview_task_id: previewId, enable_pbr: true, texture_resolution: '2k', texture_prompt: job.texture, remove_lighting: true, target_formats: ['glb'] };
  const refineId = (await api('/v2/text-to-3d', { method: 'POST', body: JSON.stringify(refineBody) })).result;
  console.log(`${tag}: refine ${refineId}`);
  const refine = await waitTask('refine', refineId);
  await mkdir(cacheDir, { recursive: true });
  const out = join(cacheDir, `${tag}.glb`);
  const file = await download(refine.model_urls.glb, out);
  if (refine.thumbnail_url) await download(refine.thumbnail_url, join(cacheDir, `${tag}.png`)).catch(() => {});
  await appendLedger({ id: `facade-${tag}`, step: 'refine', taskId: refineId, previewTaskId: previewId, createdAt: new Date().toISOString(), model: 'meshy-6', prompt: job.texture, body: { ...refineBody, texture_prompt: undefined }, credits: COST.refine, output: `tools/assets/cache/meshy-facades/${tag}.glb`, ...file });
  console.log(`${tag}: ${file.bytes} bytes -> ${out}`);
}

async function generate(id) {
  const job = JOBS[id];
  if (!job) throw new Error(`unknown facade piece ${id}; see list`);
  const ledger = await readLedger();
  if ((ledger.totalCredits ?? 0) + COST.preview + COST.refine > BUDGET) throw new Error(`budget ${BUDGET} would be exceeded (ledger ${ledger.totalCredits})`);
  const previewBody = { mode: 'preview', prompt: job.prompt, ai_model: 'meshy-6', should_remesh: true, topology: 'triangle', target_polycount: job.polycount ?? 16_000, target_formats: ['glb'] };
  const previewId = (await api('/v2/text-to-3d', { method: 'POST', body: JSON.stringify(previewBody) })).result;
  console.log(`${id}: preview ${previewId}`);
  const preview = await waitTask('preview', previewId);
  await appendLedger({ id: `facade-${id}`, step: 'preview', taskId: previewId, createdAt: new Date().toISOString(), model: 'meshy-6', prompt: job.prompt, body: previewBody, credits: COST.preview, thumbnail: preview.thumbnail_url ? 'expires' : undefined });
  await refineStep(job, id, previewId);
}

/** Finish any facade preview whose refine never recorded (process died mid-run). */
async function resume() {
  const ledger = await readLedger();
  const refined = new Set(ledger.entries.filter(e => e.step === 'refine' && e.id?.startsWith('facade-')).map(e => e.id));
  const pending = ledger.entries.filter(e => e.step === 'preview' && e.id?.startsWith('facade-') && !refined.has(e.id));
  if (!pending.length) { console.log('resume: nothing pending'); return; }
  if ((ledger.totalCredits ?? 0) + pending.length * COST.refine > BUDGET) throw new Error(`resume would exceed budget ${BUDGET}`);
  const before = await balance();
  const results = await Promise.allSettled(pending.map(e => {
    const id = e.id.replace(/^facade-/, ''), job = JOBS[id];
    return job ? refineStep(job, id, e.taskId) : Promise.reject(new Error(`no JOBS entry for ${id}`));
  }));
  results.forEach((r, i) => { if (r.status === 'rejected') console.error(`${pending[i].id}: ${r.reason.message}`); });
  console.log(`credits spent this run (balance delta): ${before - await balance()}`);
}

const [command, ...args] = process.argv.slice(2);
if (command === 'balance') console.log(`balance ${await balance()} credits; ledger ${(await readLedger()).totalCredits ?? 0}/${BUDGET}`);
else if (command === 'list') for (const [id, job] of Object.entries(JOBS)) console.log(`${id}: ${job.prompt}`);
else if (command === 'resume') await resume();
else if (command === 'gen') {
  const spent = (await readLedger()).totalCredits ?? 0;
  if (spent + args.length * (COST.preview + COST.refine) > BUDGET) throw new Error(`batch would exceed budget ${BUDGET} (ledger ${spent})`);
  const before = await balance();
  const results = await Promise.allSettled(args.map(id => generate(id)));
  results.forEach((r, i) => { if (r.status === 'rejected') console.error(`${args[i]}: ${r.reason.message}`); });
  console.log(`credits spent this run (balance delta): ${before - await balance()}`);
} else { console.error('usage: meshy-facade-pieces.mjs balance | list | gen <id...> | resume'); process.exit(2); }
