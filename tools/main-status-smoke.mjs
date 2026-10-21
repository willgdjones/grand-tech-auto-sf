import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { chromium } from 'playwright';

const stage = process.env.GTASF_STATUS_STAGE ?? 'after';
assert.ok(['before', 'after'].includes(stage), 'GTASF_STATUS_STAGE must be before or after');
const out = resolve(process.env.GTASF_STATUS_OUT ?? `artifacts/main-status/${stage}`);
await mkdir(out, { recursive: true });
const baselineSource = execFileSync('git', ['show', 'aad993e:web/src/main.ts'], { encoding: 'utf8' });
const source = stage === 'before' ? baselineSource : await readFile('web/src/main.ts', 'utf8');
const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
let update;
const helpers = [];
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'update') { assert.ok(!update); update = node; }
  if (ts.isFunctionDeclaration(node) && ['setStatusText', 'setStatusData'].includes(node.name?.text)) helpers.push(node.getText(ast));
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(update?.body);
const statements = [...update.body.statements];
const first = statements.findIndex(node => /\bpopulation\b/.test(node.getText(ast)));
assert.ok(first >= 0);
const tail = helpers.join('\n') + '\n' + statements.slice(first).map(node => node.getText(ast)).join('\n');
await writeFile(resolve(out, 'source.ts'), source);
await writeFile(resolve(out, 'status-tail.js'), tail);
const browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--disable-background-networking'] });
const errors = [];
const report = { checkedAt: new Date().toISOString(), sourceSha256: createHash('sha256').update(source).digest('hex'), scope: 'Actual AST-selected main update status statements in browser DOM with controlled game state; no world, native, or FPS claim.', rows: [], errors, passed: false };
try {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setContent('<main><span id="population"></span><span id="prompt"></span><span id="status"></span><button id="hail"></button><canvas id="world"></canvas></main>');
  report.rows = await page.evaluate(({ tail }) => {
    const root = document.querySelector('main');
    const nodes = { population: document.querySelector('#population'), prompt: document.querySelector('#prompt'), statusLine: document.querySelector('#status'), hailButton: document.querySelector('#hail'), canvas: document.querySelector('#world') };
    const render = new Function('state', 'nodes', `const { population, prompt, statusLine, hailButton, canvas } = nodes;
      const { remotes, fleet, mode, occupied, foot, noticeUntil, taxi, selectedDestination, speed, world, connected, radar, vehicleId } = state;
      const performance = { now: () => state.now };
      ${tail}`);
    const car = (id, kind, x = 0, z = 0) => ({ data: { id, kind }, model: { root: { position: { x, y: 0, z } } } });
    const state = { remotes: { players: new Map() }, fleet: { cars: new Map(), nearest() { return this.near; } }, mode: 'on-foot', occupied: undefined, foot: { x: 1, y: 3, z: 2 }, noticeUntil: 0, now: 100, taxi: { state: 'idle', etaSeconds: 0, vehicleId: 7, buttonLabel: 'Hail robotaxi' }, selectedDestination: { title: 'Lombard switchbacks' }, speed: 0, world: { stats: { mounted: 9 } }, connected: true, radar: { eventCount: 20 }, vehicleId: 0 };
    const observer = new MutationObserver(() => {}); observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
    const snapshot = () => ({ population: nodes.population.textContent, prompt: nodes.prompt.textContent, status: nodes.statusLine.textContent, hail: nodes.hailButton.textContent, notice: nodes.statusLine.dataset.notice, data: { ...nodes.canvas.dataset } });
    const rows = [];
    const check = (name, change) => {
      change?.(); render(state, nodes); observer.takeRecords();
      const expected = JSON.stringify(snapshot());
      for (let i = 0; i < 120; i++) render(state, nodes);
      const mutations = observer.takeRecords();
      if (JSON.stringify(snapshot()) !== expected) throw Error(`${name}: stationary status changed`);
      rows.push({ name, stationaryMutations: mutations.length, textMutations: mutations.filter(item => item.type !== 'attributes').length, attributeMutations: mutations.filter(item => item.type === 'attributes').length, snapshot: snapshot() });
    };
    check('walking-empty');
    check('near-car', () => { state.fleet.near = car(5, 'prius'); });
    check('near-cable', () => { state.fleet.near = car(8, 'cable-car'); });
    check('driving', () => { state.mode = 'driver'; state.vehicleId = 5; state.speed = 13.47; state.foot = { x: 2.1267, y: 4.782, z: -8.2414 }; });
    check('passenger-cable', () => { state.mode = 'passenger'; state.vehicleId = 8; state.occupied = car(8, 'cable-car'); });
    check('passenger-taxi', () => { state.occupied = car(7, 'robotaxi'); state.vehicleId = 7; });
    check('pickup-distant', () => { state.mode = 'on-foot'; state.vehicleId = 0; state.occupied = undefined; state.taxi.state = 'pickup'; state.fleet.cars.set(7, car(7, 'robotaxi', 20, 30)); state.taxi.buttonLabel = 'Cancel pickup'; });
    check('pickup-at-player', () => { state.fleet.cars.set(7, car(7, 'robotaxi', state.foot.x, state.foot.z)); });
    check('pickup-over-notice', () => { state.noticeUntil = 1000; nodes.statusLine.textContent = 'Temporary trip notice'; });
    check('active-notice', () => { state.taxi.state = 'idle'; state.noticeUntil = 1000; nodes.statusLine.textContent = 'Term sheet signed'; });
    check('notice-expired', () => { state.now = 1200; state.selectedDestination.title = 'Ferry Building'; });
    check('live-counts', () => { state.remotes.players.set(2, {}); state.fleet.cars.set(9, car(9, 'subaru')); state.world.stats.mounted = 12; state.radar.eventCount = 21; state.connected = false; });
    check('unloaded-calendar', () => { state.radar = null; state.remotes.players.clear(); state.fleet.cars.clear(); state.world.stats.mounted = 0; });
    observer.disconnect(); return rows;
  }, { tail: ts.transpileModule(tail, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText });
  assert.equal(errors.length, 0);
  if (stage === 'after') {
    const before = JSON.parse(await readFile(process.env.GTASF_STATUS_BEFORE ?? 'artifacts/main-status/before/report.json', 'utf8'));
    assert.equal(before.sourceSha256, createHash('sha256').update(baselineSource).digest('hex'), 'Comparison uses the frozen pre-change source');
    assert.deepEqual(report.rows.map(({ name, snapshot }) => ({ name, snapshot })), before.rows.map(({ name, snapshot }) => ({ name, snapshot })), 'Every final DOM value matches the frozen actual-source baseline');
    assert.ok(report.rows.every(row => row.stationaryMutations === 0), 'Unchanged game status causes no DOM mutation');
  }
  report.passed = true;
} finally {
  await browser.close();
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ passed: report.passed, rows: report.rows.map(({ name, stationaryMutations, textMutations, attributeMutations }) => ({ name, stationaryMutations, textMutations, attributeMutations })), errors }));
