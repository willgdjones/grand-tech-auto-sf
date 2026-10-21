#!/usr/bin/env node
/**
 * Meshy characters (lane D, gtasf-laned-meshy-people): SFPD officer + pedestrian looks + player looks, generated with credits
 * ALREADY IN the existing Meshy plan (founder 2026-10-14: never upgrade, buy credits or enter payment details; stop and
 * report if credits run out). Per character: Meshy-6 preview (A-pose) -> refine (2k base colour) -> auto-rig (returns
 * walking/running clips) -> Idle animation (library action 0). ~38 credits each.
 *
 *   node tools/art/meshy-people.mjs balance
 *   node tools/art/meshy-people.mjs list
 *   node tools/art/meshy-people.mjs gen <id...>       # all steps; resumes from the ledger per step
 *
 * Shares tools/art/meshy-ledger.json and its MESHY_BUDGET cap (default 1,500 credits) with tools/art/meshy.mjs; never run
 * both at once. Reads MESHY_API_KEY from tools/art/.env (never printed). Raw files: ignored tools/assets/cache/meshy-people/<id>/.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const ledgerPath = join(repo, 'tools/art/meshy-ledger.json');
const cacheDir = join(repo, 'tools/assets/cache/meshy-people');
const BUDGET = Number(process.env.MESHY_BUDGET ?? 1500), ESTIMATE = 38;
/** Meshy library idle: 11 = 'Idle 1', a calm square-on stand (action 0 'Idle' fidgets and turns its back). */
const IDLE_ACTION = Number(process.env.IDLE_ACTION ?? 11), IDLE_STEP = IDLE_ACTION === 0 ? 'idle' : `idle-${IDLE_ACTION}`;
const API = 'https://api.meshy.ai/openapi';

const POSE = 'Single person, full body head to feet, standing upright in a relaxed A-pose with arms slightly away from the body, facing forward, realistic adult proportions, no props in hands.';
const CLEAN = 'Realistic fabric and skin, natural colours. No text, no logos, no lettering, no numbers, no brand marks.';
/** Roles: 'police' (SFPD officer), 'crowd' (pedestrians), 'player' (wardrobe looks). */
export const PEOPLE = {
  'sfpd-officer': { role: 'police', height: 1.8, prompt: `Realistic San Francisco city police officer man, dark navy long-sleeve uniform shirt tucked into navy uniform trousers, black duty belt, silver chest badge, navy peaked police cap, black polished boots. ${POSE}`,
    texture: `dark navy police uniform fabric, silver metal badge and shirt buttons, black leather duty belt and boots, black cap peak. ${CLEAN}` },
  'tech-vest-man': { role: 'crowd', height: 1.8, prompt: `Realistic man in his thirties, grey zip fleece vest over a light blue button-down shirt, khaki chino trousers, white sneakers, short brown hair. ${POSE}`,
    texture: `grey fleece, light blue cotton shirt, khaki chinos, white leather sneakers. ${CLEAN}` },
  'hoodie-woman': { role: 'crowd', height: 1.66, prompt: `Realistic young woman, oversized black hoodie, black leggings, white sneakers, long dark hair in a ponytail. ${POSE}`,
    texture: `black cotton hoodie, black leggings, white sneakers, dark brown hair. ${CLEAN}` },
  'business-woman': { role: 'crowd', height: 1.68, prompt: `Realistic professional woman, tailored navy blazer over a white blouse, grey tailored trousers, black flat shoes, shoulder-length dark hair. ${POSE}`,
    texture: `navy wool blazer, white silk blouse, grey trousers, black leather flats. ${CLEAN}` },
  'older-man': { role: 'crowd', height: 1.74, prompt: `Realistic older man in his sixties with short grey hair, beige trench coat, dark grey trousers, brown leather shoes. ${POSE}`,
    texture: `beige cotton trench coat, dark grey wool trousers, brown leather shoes, grey hair. ${CLEAN}` },
  'jogger-woman': { role: 'crowd', height: 1.67, prompt: `Realistic athletic woman jogger, fitted teal running jacket, black running shorts, grey running shoes, blonde hair in a bun. ${POSE}`,
    texture: `teal technical running jacket, black running shorts, grey mesh running shoes, blonde hair. ${CLEAN}` },
  'flannel-man': { role: 'crowd', height: 1.82, prompt: `Realistic bearded man, red and black plaid flannel shirt, dark blue jeans, brown leather work boots, short dark hair. ${POSE}`,
    texture: `red and black plaid flannel, dark indigo denim jeans, brown leather boots, dark brown beard and hair. ${CLEAN}` },
  'denim-woman': { role: 'crowd', height: 1.64, prompt: `Realistic young woman student, light blue denim jacket over a white t-shirt, black jeans, white sneakers, curly black hair. ${POSE}`,
    texture: `light blue denim jacket, plain white t-shirt, black jeans, white sneakers, curly black hair. ${CLEAN}` },
  'puffer-man': { role: 'crowd', height: 1.78, prompt: `Realistic young man, black quilted puffer jacket, grey knit beanie, slim dark jeans, white sneakers. ${POSE}`,
    texture: `black quilted nylon puffer jacket, grey knit beanie, dark denim jeans, white sneakers. ${CLEAN}` },
  'dress-woman': { role: 'crowd', height: 1.65, prompt: `Realistic woman, knee-length floral summer dress, light beige cardigan, tan sandals, wavy auburn hair. ${POSE}`,
    texture: `floral printed cotton dress in blue and white, beige knit cardigan, tan leather sandals, auburn hair. ${CLEAN}` },
  'skater-man': { role: 'crowd', height: 1.76, prompt: `Realistic young man, plain olive green t-shirt, beige cargo shorts, black baseball cap, black canvas skate shoes. ${POSE}`,
    texture: `plain olive cotton t-shirt, beige cargo shorts, black cap, black canvas shoes. ${CLEAN}` },
  'founder-hoodie': { role: 'player', height: 1.78, prompt: `Realistic young tech startup founder man, heather grey zip hoodie over a black t-shirt, dark slim jeans, white minimalist sneakers, short dark hair. ${POSE}`,
    texture: `heather grey cotton hoodie, black t-shirt, dark denim, white leather sneakers. ${CLEAN}` },
  'founder-blazer': { role: 'player', height: 1.7, prompt: `Realistic startup founder woman, black blazer over a plain white t-shirt, dark jeans, white sneakers, sleek straight dark hair. ${POSE}`,
    texture: `black blazer, plain white t-shirt, dark denim jeans, white sneakers. ${CLEAN}` },
  'founder-bomber': { role: 'player', height: 1.79, prompt: `Realistic stylish young man, olive green bomber jacket, black joggers, chunky white sneakers, short black hair. ${POSE}`,
    texture: `olive nylon bomber jacket, black cotton joggers, white chunky sneakers. ${CLEAN}` },
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
    if (res.status === 402) throw new Error(`OUT OF CREDITS (402) — stop and tell the orchestrator; never buy credits. ${body.slice(0, 200)}`);
    if (!res.ok) throw new Error(`Meshy ${init.method ?? 'GET'} ${path} -> ${res.status} ${body.slice(0, 300)}`);
    return JSON.parse(body);
  }
}
const balance = async () => (await api('/v1/balance')).balance;
async function readLedger() { try { return JSON.parse(await readFile(ledgerPath, 'utf8')); } catch { return { version: 1, provider: 'meshy', entries: [] }; } }
let ledgerLock = Promise.resolve();
function appendLedger(entry) {
  ledgerLock = ledgerLock.then(async () => {
    const ledger = await readLedger(); ledger.entries.push(entry);
    ledger.totalCredits = ledger.entries.reduce((sum, e) => sum + (e.credits ?? 0), 0);
    await writeFile(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  });
  return ledgerLock;
}
async function wait(path) {
  for (;;) {
    const task = await api(path);
    if (task.status === 'SUCCEEDED') return task;
    if (task.status === 'FAILED' || task.status === 'CANCELED') throw new Error(`${path} ${task.status}: ${task.task_error?.message ?? ''}`);
    await new Promise(r => setTimeout(r, 10_000));
  }
}
async function download(url, path) {
  const res = await fetch(url); if (!res.ok) throw new Error(`download ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer()); await writeFile(path, bytes);
  return { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
/** Step results recorded for `id` (lets a rerun resume without re-spending). */
const done = (ledger, id, step) => ledger.entries.find(e => e.id === `people:${id}` && e.step === step);
async function record(id, step, taskId, task, extra = {}) {
  await appendLedger({ id: `people:${id}`, step, taskId, createdAt: new Date().toISOString(), credits: task.consumed_credits ?? 0, ...extra });
}

async function generate(id) {
  const job = PEOPLE[id]; if (!job) throw new Error(`unknown ${id}; see list`);
  const dir = join(cacheDir, id); await mkdir(dir, { recursive: true });
  let ledger = await readLedger();
  if (!done(ledger, id, IDLE_STEP) && (ledger.totalCredits ?? 0) + (done(ledger, id, 'rig') ? 3 : ESTIMATE) > BUDGET) throw new Error(`budget ${BUDGET} would be exceeded (ledger ${ledger.totalCredits})`);
  let preview = done(ledger, id, 'preview')?.taskId;
  if (!preview) {
    const body = { mode: 'preview', prompt: job.prompt, ai_model: 'meshy-6', pose_mode: 'a-pose', should_remesh: true, topology: 'triangle', target_polycount: 12_000, target_formats: ['glb'] };
    preview = (await api('/v2/text-to-3d', { method: 'POST', body: JSON.stringify(body) })).result; console.log(`${id}: preview ${preview}`);
    await record(id, 'preview', preview, await wait(`/v2/text-to-3d/${preview}`), { prompt: job.prompt, body });
  }
  ledger = await readLedger();
  let refine = done(ledger, id, 'refine')?.taskId;
  if (!refine) {
    const body = { mode: 'refine', preview_task_id: preview, enable_pbr: false, texture_resolution: '2k', texture_prompt: job.texture, remove_lighting: true, target_formats: ['glb'] };
    refine = (await api('/v2/text-to-3d', { method: 'POST', body: JSON.stringify(body) })).result; console.log(`${id}: refine ${refine}`);
    const task = await wait(`/v2/text-to-3d/${refine}`);
    await download(task.model_urls.glb, join(dir, 'textured.glb')); if (task.thumbnail_url) await download(task.thumbnail_url, join(dir, 'thumb.png')).catch(() => {});
    await record(id, 'refine', refine, task, { prompt: job.texture });
  }
  ledger = await readLedger();
  let rig = done(ledger, id, 'rig')?.taskId;
  if (!rig) {
    rig = (await api('/v1/rigging', { method: 'POST', body: JSON.stringify({ input_task_id: refine, height_meters: job.height }) })).result; console.log(`${id}: rig ${rig}`);
    const task = await wait(`/v1/rigging/${rig}`);
    await download(task.result.rigged_character_glb_url, join(dir, 'rigged.glb'));
    if (task.result.basic_animations?.walking_glb_url) await download(task.result.basic_animations.walking_glb_url, join(dir, 'walking.glb'));
    if (task.result.basic_animations?.running_glb_url) await download(task.result.basic_animations.running_glb_url, join(dir, 'running.glb'));
    await record(id, 'rig', rig, task);
  }
  ledger = await readLedger();
  if (!done(ledger, id, IDLE_STEP)) {
    const anim = (await api('/v1/animations', { method: 'POST', body: JSON.stringify({ rig_task_id: rig, action_id: IDLE_ACTION }) })).result; console.log(`${id}: idle ${anim}`);
    const task = await wait(`/v1/animations/${anim}`);
    await download(task.result.animation_glb_url, join(dir, 'idle.glb'));
    await record(id, IDLE_STEP, anim, task, { actionId: IDLE_ACTION });
  }
  console.log(`${id}: done -> ${dir}`);
}

const [command, ...args] = process.argv.slice(2);
if (command === 'balance') console.log(`balance ${await balance()} credits; ledger ${(await readLedger()).totalCredits ?? 0}/${BUDGET}`);
else if (command === 'list') for (const [id, job] of Object.entries(PEOPLE)) console.log(`${id} [${job.role}]`);
// Free: search Meshy's animation library (id, name, category) before spending on clips.
else if (command === 'library') {
  const found = await api(`/v1/animations/library?search=${encodeURIComponent(args.join(' '))}&page_size=50`);
  for (const item of found.items ?? found.result ?? found) console.log(`${item.action_id ?? item.id}\t${item.name}\t${item.category ?? ''}\t${item.sub_category ?? ''}`);
}
// Extra clips (3 credits each) on already-rigged bodies: clips <name=actionId,...> [id...] -> cache/<id>/<name>.glb.
else if (command === 'clips') {
  const wanted = args[0].split(',').map(pair => { const [name, action] = pair.split('='); return { name, action: Number(action) }; });
  const ids = args.length > 1 ? args.slice(1) : Object.keys(PEOPLE);
  let ledger = await readLedger();
  const todo = ids.flatMap(id => wanted.filter(w => !done(ledger, id, `clip:${w.name}`)).map(w => ({ id, ...w })));
  if ((ledger.totalCredits ?? 0) + todo.length * 3 > BUDGET) throw new Error(`${todo.length} clips would exceed budget ${BUDGET} (ledger ${ledger.totalCredits})`);
  const before = await balance(); console.log(`balance before ${before}; ${todo.length} clips`);
  const results = await Promise.allSettled(todo.map(async ({ id, name, action }) => {
    const rig = done(await readLedger(), id, 'rig')?.taskId; if (!rig) throw new Error(`${id}: not rigged`);
    const anim = (await api('/v1/animations', { method: 'POST', body: JSON.stringify({ rig_task_id: rig, action_id: action }) })).result;
    const task = await wait(`/v1/animations/${anim}`);
    await download(task.result.animation_glb_url, join(cacheDir, id, `${name}.glb`));
    await record(id, `clip:${name}`, anim, task, { actionId: action });
    console.log(`${id}: ${name} (${action}) done`);
  }));
  results.forEach((r, i) => { if (r.status === 'rejected') console.error(`${todo[i].id} ${todo[i].name}: ${r.reason.message}`); });
  console.log(`credits spent this run (balance delta): ${before - await balance()}`);
}
else if (command === 'gen') {
  const ids = args.length ? args : Object.keys(PEOPLE), ledger = await readLedger();
  const todo = ids.filter(id => !done(ledger, id, IDLE_STEP));
  const cost = todo.reduce((n, id) => n + (done(ledger, id, 'rig') ? 3 : ESTIMATE), 0);
  if ((ledger.totalCredits ?? 0) + cost > BUDGET) throw new Error(`batch of ${todo.length} would exceed budget ${BUDGET} (ledger ${ledger.totalCredits}); shrink it`);
  const before = await balance(); console.log(`balance before ${before}`);
  const results = await Promise.allSettled(ids.map(generate));
  results.forEach((r, i) => { if (r.status === 'rejected') console.error(`${ids[i]}: ${r.reason.message}`); });
  console.log(`credits spent this run (balance delta): ${before - await balance()}`);
} else { console.error('usage: meshy-people.mjs balance | list | gen [id...]'); process.exit(2); }
