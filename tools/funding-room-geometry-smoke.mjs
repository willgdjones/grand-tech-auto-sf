/** Actual Three.js funding room with a minimal DOM shell; no renderer, API or FPS claim. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RingGeometry, Scene } from 'three';

const out = resolve(process.env.GTASF_ROOM_OUT ?? 'artifacts/funding-room-reuse/current');
await mkdir(out, { recursive: true });
const bundle = resolve(out, 'room.mjs');
await build({ entryPoints: [resolve('web/src/funding/room.ts')], outfile: bundle, bundle: true, platform: 'node', format: 'esm', external: ['three'], logLevel: 'error',
  plugins: process.env.GTASF_ROOM_SOURCE ? [{ name: 'recorded-source', setup(builder) {
    builder.onLoad({ filter: /web\/src\/funding\/room\.ts$/ }, async args => ({ contents: await readFile(process.env.GTASF_ROOM_SOURCE, 'utf8'), loader: 'ts', resolveDir: dirname(args.path) }));
  } }] : [] });
const { createFundingRoom } = await import(pathToFileURL(bundle).href);
class Element {
  children = []; style = {}; hidden = false; textContent = ''; attributes = {}; removed = false;
  append(...children) { this.children.push(...children); }
  setAttribute(name, value) { this.attributes[name] = value; }
  remove() { this.removed = true; }
}
const originalDocument = globalThis.document, originalMatchMedia = globalThis.matchMedia;
const media = Object.assign(new EventTarget(), { matches: false });
globalThis.document = { createElement: () => new Element(), body: new Element() };
globalThis.matchMedia = () => media;
const report = { at: new Date().toISOString(), scope: 'Actual Three.js room geometry; minimal DOM shell, no GPU/API/native/performance claim', checks: [], metrics: {}, passed: false };
let samples = 0, relief = .03, available = true, perimeterMissing = false, room;
const terrain = (x, z) => x * .2 + z * .13 + relief * Math.sin(x / 3) * Math.cos(z / 4);
let client = { target: { eventId: 'event-a', title: 'Event A', anchor: { x: 10, y: 0, z: 20 }, radiusM: 8, approx: false, quote: { amountCents: '50000000', streakMultiplier: 1 }, alreadyAwarded: false }, status: null, inside: true, progress: .5, busy: false, error: '' };
function check(name, run) {
  try { run(); report.checks.push({ name, passed: true }); }
  catch (error) { report.checks.push({ name, passed: false, error: String(error) }); }
}
function assertGeometry(target, base, fill) {
  const plane = new RingGeometry(target.radiusM - .6, target.radiusM, 64);
  try {
    const expected = plane.getAttribute('position'), height = terrain(target.anchor.x, target.anchor.z);
    assert.deepEqual(room.root.position.toArray(), [target.anchor.x, height, target.anchor.z]);
    for (const [mesh, lift] of [[base, .22], [fill, .25]]) {
      const points = mesh.geometry.getAttribute('position');
      assert.equal(points.count, expected.count); assert.deepEqual([...mesh.geometry.index.array], [...plane.index.array]);
      for (let i = 0; i < points.count; i++) {
        const x = expected.getX(i), z = -expected.getY(i), y = perimeterMissing ? height : terrain(target.anchor.x + x, target.anchor.z + z);
        assert.ok(Math.abs(points.getX(i) - x) < 1e-6 && Math.abs(points.getZ(i) - z) < 1e-6 && Math.abs(points.getY(i) - (y - height + lift)) < 1e-6, `Vertex ${i} must follow terrain and its own overlay height`);
      }
      assert.ok(mesh.geometry.boundingSphere && Number.isFinite(mesh.geometry.boundingSphere.radius));
      for (let i = 0; i < points.count; i++) {
        const sphere = mesh.geometry.boundingSphere, c = sphere.center;
        assert.ok(Math.hypot(points.getX(i) - c.x, points.getY(i) - c.y, points.getZ(i) - c.z) <= sphere.radius + 1e-6, 'Updated bounds contain the warped ring');
      }
    }
  } finally { plane.dispose(); }
}
try {
  const scene = new Scene();
  room = createFundingRoom({ scene, surfaceHeightAt(x, z) {
    samples++;
    if (!available || perimeterMissing && (x !== client.target?.anchor.x || z !== client.target?.anchor.z)) return null;
    return terrain(x, z);
  } });
  assert.ok(room, 'Current flags enable the actual funding room');
  const base = room.root.getObjectByName('Room boundary'), fill = room.root.getObjectByName('Work the room progress');
  const initial = [base.geometry, fill.geometry], vertices = base.geometry.getAttribute('position').count;
  room.update(client, 0);
  report.metrics.firstSamples = samples;
  check('initial grounding retains constructor buffers and samples both rings once', () => {
    assert.ok(base.geometry === initial[0] && fill.geometry === initial[1], 'Initial grounding must retain existing ring buffers'); assert.equal(samples, vertices + 1);
  });
  check('sloped ring positions, indices and updated bounds retain authored geometry', () => assertGeometry(client.target, base, fill));
  const first = [base.geometry, fill.geometry], beforeStable = samples;
  room.update(client, 100);
  check('unchanged frame does no ground work', () => { assert.equal(samples, beforeStable); assert.equal(base.geometry, first[0]); });
  relief = .45; client.target = { ...client.target, title: 'Refreshed event', quote: { amountCents: '75000000', streakMultiplier: 1.5 }, alreadyAwarded: true };
  samples = 0; room.update(client, 60_001);
  report.metrics.refreshSamples = samples;
  check('same-radius refresh reuses geometry but resamples current streamed terrain', () => {
    assert.ok(base.geometry === first[0] && fill.geometry === first[1], 'A same-radius refresh must retain existing ring buffers'); assert.equal(samples, vertices + 1); assertGeometry(client.target, base, fill);
  });
  check('fresh eligibility and room display remain live', () => {
    assert.equal(fill.geometry.drawRange.count, 384); assert.equal(room.root.children[2].visible, false);
    assert.equal(room.element.children[0].textContent, 'Refreshed event'); assert.equal(room.element.children[1].textContent, 'ALREADY RAISED TODAY');
  });
  client.target = { ...client.target, eventId: 'event-b', anchor: { x: -30, y: 70, z: 45 }, alreadyAwarded: false };
  client.status = { state: 'working', room: { ...client.target } }; samples = 0; room.update(client, 61_000);
  check('changed destination resamples the new anchor and retains partial progress', () => {
    assertGeometry(client.target, base, fill); assert.equal(fill.geometry.drawRange.count, 192); assert.equal(room.root.children[2].visible, true);
  });
  const replaced = [base.geometry, fill.geometry]; let radiusDisposals = 0;
  for (const geometry of replaced) geometry.addEventListener('dispose', () => radiusDisposals++);
  client.target = { ...client.target, radiusM: 9 }; client.status = null; room.update(client, 62_000);
  check('a changed radius replaces and disposes the prior buffers', () => {
    assert.notEqual(base.geometry, replaced[0]); assert.notEqual(fill.geometry, replaced[1]); assert.equal(radiusDisposals, 2); assertGeometry(client.target, base, fill);
  });
  available = false; client.target = { ...client.target, anchor: { x: 80, y: 0, z: -20 } }; samples = 0; room.update(client, 63_000);
  check('unloaded center hides the ring and retries at the existing bound', () => {
    assert.equal(room.root.visible, false); assert.equal(samples, 1); room.update(client, 63_100); assert.equal(samples, 1);
    available = true; perimeterMissing = true; room.update(client, 63_201); assert.equal(room.root.visible, true); assertGeometry(client.target, base, fill);
  });
  perimeterMissing = false; relief = .8; client.target = { ...client.target }; room.update(client, 64_000);
  check('a later refresh picks up newly loaded perimeter terrain', () => assertGeometry(client.target, base, fill));
  client.target = null; client.status = null; client.inside = false; room.update(client, 65_000);
  check('clearing a destination hides the room and panel', () => { assert.equal(room.root.visible, false); assert.equal(room.element.hidden, true); });
  const final = [base.geometry, fill.geometry, room.root.children[2].geometry]; let disposals = 0;
  for (const geometry of final) geometry.addEventListener('dispose', () => disposals++);
  room.destroy(); room.destroy(); const afterDestroy = samples; room.update(client, 70_000);
  check('disposal releases owned geometry once and stops updates', () => {
    assert.equal(disposals, 3); assert.equal(room.root.parent, null); assert.equal(room.element.removed, true); assert.equal(samples, afterDestroy);
  });
  report.passed = report.checks.every(check => check.passed);
  if (!report.passed) process.exitCode = 1;
} catch (error) { report.failure = String(error); process.exitCode = 1; }
finally {
  room?.destroy(); globalThis.document = originalDocument; globalThis.matchMedia = originalMatchMedia;
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
