import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { flags } from '@gtasf/shared/flags';
import { SkinnedMesh, Vector3, type AnimationClip, type Material, type Object3D } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** cc0People bodies (tools/assets/build-people.mjs; CC0 Quaternius, see web/public/assets/LICENSES.md), on the hoodie's rig. */
export const CC0_BODIES = ['business-man', 'casual-woman', 'casual-man', 'formal-woman', 'worker-man', 'beach-man', 'punk-woman', 'punk-man'] as const;
const CC0_LABELS = ['Business suit', 'Weekend casual', 'Tee and jeans', 'Green dress', 'Hi-vis worker', 'Beach day', 'Punk (her)', 'Punk (him)'] as const;
/** meshyPeople bodies (tools/assets/build-meshy-people.mjs; Meshy-6, bones renamed to the hoodie rig): player looks first. */
// The first WARDROBE_BODIES entries double as the player's wardrobe looks (see avatarOutfits). Review 2026-10-14 dropped
// meshy-older-man (crouched lump) and meshy-dress-woman (fused legs, smeared hair).
export const MESHY_BODIES = ['meshy-founder-hoodie', 'meshy-founder-blazer', 'meshy-founder-bomber', 'meshy-hoodie-woman', 'meshy-tech-vest-man',
  'meshy-business-woman', 'meshy-jogger-woman', 'meshy-flannel-man', 'meshy-denim-woman', 'meshy-puffer-man', 'meshy-skater-man'] as const;
const MESHY_LABELS = ['Founder hoodie', 'Founder blazer (long hair + beard)', 'Bomber jacket', 'Black hoodie', 'Fleece vest',
  'Navy blazer', 'Running kit', 'Plaid flannel', 'Denim jacket', 'Puffer jacket', 'Skate tee'] as const;
/** Bodies offered in the wardrobe after the 4 hoodie palettes: the appearance id packs the outfit in 3 bits
 * (shared/content/cosmetics.ts encodeAppearance), so the whole wardrobe must stay <= 8 options or remotes desync. */
export const WARDROBE_BODIES = 4;
/** The wardrobe / pedestrian body pool: the Meshy set when meshyPeople is on, else the CC0 set. */
export const PEOPLE_BODIES: readonly string[] = flags.meshyPeople ? MESHY_BODIES : CC0_BODIES;
/** Wardrobe labels, in PEOPLE_BODIES order. */
export const PEOPLE_LABELS: readonly string[] = flags.meshyPeople ? MESHY_LABELS : CC0_LABELS;
/** The Meshy SFPD officer body (sfpdOfficer.ts uses it when meshyPeople is on). */
export const MESHY_OFFICER = 'meshy-sfpd-officer';

/** Resolves once the game reports READY (window.__gtasf.ready): CC0 bodies and the crowd VAT must never sit on the
 * first-load path (<=15 MB budget). Callers can ask early; the download starts only after READY. */
let ready: Promise<void> | undefined, readyNow: Promise<void> | undefined;
/** localBodyFirst: the local player's body download; every afterReady() load waits for it, so it isn't queued behind the
 * crowd VAT and the walkers' bodies (critic N12: the new player's outfit swapped ~30 s into the reveal). */
let localBody: Promise<unknown> | undefined;
export function afterReady(): Promise<void> {
  // Bounded: a stalled local-body download (bad mobile link) must not hold back every other people load for the session.
  return readyGate().then(() => localBody && Promise.race([localBody, new Promise(resolve => setTimeout(resolve, 4000))])).then(() => undefined);
}
/** Resolves the moment the game reports READY (no grace). */
export function whenReady(): Promise<void> { return readyGate(false); }
/** READY (no grace), then the local player's body (localBodyFirst) or 4 s, whichever is first: for early post-READY loads that
 * must not compete with the body download (carNearDetail's pre-warm; review: it could push the body past its 2.5 s reveal). */
export function afterLocalBody(): Promise<void> {
  return readyGate(false).then(() => localBody && Promise.race([localBody, new Promise(resolve => setTimeout(resolve, 4000))])).then(() => undefined);
}
function readyGate(grace = true): Promise<void> {
  if (!grace) return readyNow ??= new Promise(resolve => { const check = () => (isReady() ? resolve() : setTimeout(check, 100)); check(); });
  return ready ??= new Promise(resolve => {
    // +3 s grace: clearly outside the READY network trace, and off the first frames' critical path.
    const check = () => (isReady() ? setTimeout(resolve, 3000) : setTimeout(check, 250));
    check();
  });
}

// READY = the harness flag when present (testingHarness ships), else the loading screen being hidden.
function isReady(): boolean {
  const harness = (globalThis as { __gtasf?: { ready?: boolean } }).__gtasf;
  if (harness) return Boolean(harness.ready);
  const loading = typeof document === 'undefined' ? null : document.querySelector<HTMLElement>('#loading');
  return !loading || loading.hidden;
}

const cache = new Map<string, Promise<GLTF>>();
/** meshyHeadMaps: Meshy bodies load the head-mapped build (meshy-<id>.hm.glb: face on its own 512x256 texture, so it stays
 * sharp at <3 m); the production build ships only the set the flag selects. */
const headMapped = (id: string) => flags.meshyHeadMaps && id.startsWith('meshy-');

/** meshyHeadMaps (gtasf-eu1ox): a head-mapped body is one glTF mesh with two primitives (body + head on its own texture), which
 * GLTFLoader turns into a Group of two SkinnedMeshes; with that, GPU-only shards appeared near the camera. Merge them back into
 * ONE SkinnedMesh with geometry groups and a [body, head] material array, bound to the same skeleton. */
function mergeHeadPrimitive(scene: Object3D): void {
  const groups: Object3D[] = [];
  scene.traverse(o => { const kids = o.children.filter(c => (c as SkinnedMesh).isSkinnedMesh) as SkinnedMesh[]; if (kids.length === 2 && kids[0]!.skeleton === kids[1]!.skeleton) groups.push(o); });
  for (const group of groups) {
    const [body, head] = group.children.filter(c => (c as SkinnedMesh).isSkinnedMesh) as SkinnedMesh[];
    const keep = (g: SkinnedMesh['geometry']) => Object.keys(g.attributes).filter(k => k in body!.geometry.attributes && k in head!.geometry.attributes);
    const names = keep(body!.geometry), strip = (g: SkinnedMesh['geometry']) => { const c = g.clone(); for (const k of Object.keys(c.attributes)) if (!names.includes(k)) c.deleteAttribute(k); return c; };
    const merged = mergeGeometries([strip(body!.geometry), strip(head!.geometry)], true);
    // Incompatible attributes (e.g. differently quantized body/head): keep the two meshes, but say so - that is the shard path.
    if (!merged) { console.warn(`meshyHeadMaps: could not merge the head primitive of ${group.name || 'a body'}; keeping two meshes`); continue; }
    const mesh = new SkinnedMesh(merged, [body!.material as Material, head!.material as Material]);
    mesh.name = body!.name; mesh.position.copy(body!.position); mesh.quaternion.copy(body!.quaternion); mesh.scale.copy(body!.scale);
    mesh.bind(body!.skeleton, body!.bindMatrix);
    group.remove(body!, head!); group.add(mesh);
  }
}

/** One download per body per page, started only after READY; callers own cloning. `urgent` (localBodyFirst, the local
 * player's body) starts the moment READY fires, and every other people load waits for it. */
export function loadPeopleGltf(id: string, urgent = false): Promise<GLTF> {
  let pending = cache.get(id);
  urgent &&= flags.localBodyFirst;
  if (!pending) {
    pending = (urgent ? readyGate(false) : afterReady()).then(() => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(`/assets/avatars/${id}${headMapped(id) ? '.hm' : ''}.glb`))
      .then(gltf => { if (headMapped(id)) mergeHeadPrimitive(gltf.scene); return gltf; });
    cache.set(id, pending);
    // Only a download the urgent call started: an earlier walker request already waits on afterReady(), and making
    // afterReady() wait on it in turn would deadlock.
    if (urgent) localBody = pending.catch(() => undefined);
  }
  return pending;
}

/** meshyDeathClips: one-shot clips shared by every Meshy body (meshy-clips.glb, tools/assets/build-meshy-clips.mjs): rotation
 * tracks + the hip (Body) translation, with the source body's rest hip position for per-body retargeting. Loaded once,
 * after READY; empty (callers fall back) when the flag is off or the file fails. */
export type SharedClips = { clips: AnimationClip[]; hipsRest: Vector3 };
let sharedClips: Promise<SharedClips | null> | undefined;
export function loadMeshyClips(): Promise<SharedClips | null> {
  if (!flags.meshyDeathClips || !flags.meshyPeople) return Promise.resolve(null);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  sharedClips ??= afterReady()
    .then(() => Promise.all([loader.loadAsync('/assets/avatars/meshy-clips.glb'),
      // pedIdleVariety: phone call / look around / texting walk, a separate file so it only ships with that flag.
      flags.pedIdleVariety ? loader.loadAsync('/assets/avatars/meshy-idle-clips.glb').catch(() => null) : Promise.resolve(null),
      // crowdPanic: the cower crouch, likewise its own file.
      flags.crowdPanic ? loader.loadAsync('/assets/avatars/meshy-panic-clips.glb').catch(() => null) : Promise.resolve(null)]))
    .then(([gltf, idle, panic]) => ({ clips: [...gltf.animations, ...(idle?.animations ?? []), ...(panic?.animations ?? [])], hipsRest: gltf.scene.getObjectByName('Body')?.position.clone() ?? new Vector3(0, 1, 0) }), () => null);
  return sharedClips;
}
