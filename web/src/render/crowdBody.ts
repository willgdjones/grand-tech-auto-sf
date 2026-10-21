import {
  BoxGeometry, BufferGeometry, Color, CylinderGeometry, Float32BufferAttribute, InstancedBufferAttribute,
  MeshLambertMaterial, SphereGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { defaultAppearance, resolveLook } from '@gtasf/shared/content/cosmetics';
import type { FounderArchetype, ResolvedLook } from '@gtasf/shared/content/cosmetics';

/** crowdVariety (lane D): one instanced, articulated body that reads as varied San Francisco people rather than
 * identical mannequins. Each instance picks clothing colours, skin tone, hair colour, a hairstyle, outer layer,
 * skirt or shorts, bags and glasses. Optional parts are switched per instance in the vertex shader (a hidden part
 * collapses to a point), so the whole crowd is still one draw call with no textures, skeletons or downloads. */

// Colour channels: 0 = baked vertex colour, then the per-instance colours.
const FIXED = 0, TOP = 1, LEGS = 2, SKIN = 3, HAIR = 4, ACCENT = 5;
// Part switches (bit numbers in the per-instance mask).
const B = {
  hair: 0, long: 1, bun: 2, beanie: 3, cap: 4, jacket: 5, jacketSleeve: 6, longSleeve: 7, bareArm: 8,
  skirt: 9, shorts: 10, backpack: 11, tote: 12, glasses: 13, hood: 14, sneakers: 15,
} as const;
type Bit = keyof typeof B;
/** Show a part when `on` is set, or when `off` is clear. */
type Gate = { on?: Bit; off?: Bit };

const SKINS = [0xf3cfb3, 0xe8b894, 0xd29e76, 0xb47b52, 0x93603d, 0x6e4529, 0x4f311e, 0xf1c2a0];
const HAIRS = [0x161211, 0x241a14, 0x3b281b, 0x5a3c26, 0x8a6236, 0xc49c62, 0x8e8b88, 0x6b2a17];
const TEES = [0xece9e2, 0x3a3c42, 0x3a4f78, 0x9a9da3, 0x9a3a42, 0xd6a748, 0x7fb0d6, 0x4f7558, 0xc9563a, 0xab9fd0, 0xe2d3b4, 0x3a9490];
const HOODIES = [0x45484f, 0x8e939c, 0x3b4d73, 0x737b58, 0x9b444c, 0xbdb9ae, 0x527491, 0xc7743a];
const SHIRTS = [0xf2f1eb, 0xc4d7ea, 0xe9e4d8, 0x9db4cd, 0xe2cfc6];
const JEANS = [0x41608e, 0x30405f, 0x5c7ca6, 0x8ba6c6, 0x35363b];
const TROUSERS = [0x40434b, 0x666b75, 0x34405c, 0xc0a77e, 0x6e7255, 0x89735c];
const JACKETS = [0x34363c, 0x34466a, 0x636c4b, 0xbc9a6c, 0x50545c, 0xa63f3a, 0xab8550, 0x6b7f92, 0xd0c9b8];
const BLAZERS = [0x464a52, 0x33456a, 0x6a6e75, 0x7a634e];
const KNITS = [0xc4483a, 0x4a4d55, 0xdcbd62, 0x4d7590, 0xebe5d8, 0x6c8f61, 0xd08a9a];
/** Outfit palette kept for setOutfit (remote-player impostor colours, coffee queue regulars). */
export const CROWD_TOPS = [0x739bb6, 0xbb5547, 0x64866d, 0xd1ab69, 0xb08fb4, 0xd6d6c7, 0x3c617a, 0xb76f37];

export interface CrowdLook { top: number; legs: number; skin: number; hair: number; accent: number; mask: number; width: number; height: number }

/** Deterministic, weighted wardrobe for instance `i` (stable across sessions and clients). */
export function crowdLook(i: number): CrowdLook {
  let s = (i * 2654435761 + 0x9e3779b9) >>> 0;
  const r = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const pick = <T>(list: readonly T[]) => list[Math.floor(r() * list.length)]!;
  const bits = new Set<Bit>();
  const skin = pick(SKINS), hair = r() < .12 ? HAIRS[6]! : pick(HAIRS.slice(0, 6).concat(HAIRS[7]!));
  const feminine = r() < .48;
  let top = pick(TEES), legs = pick(JEANS), accent = pick(JACKETS);
  const style = r();
  if (style < .26) { // tech hoodie
    top = pick(HOODIES); bits.add('hood').add('longSleeve').add('sneakers');
    if (r() < .55) bits.add('backpack');
  } else if (style < .44) { // office: blazer or vest over a shirt
    top = pick(SHIRTS); legs = pick(TROUSERS); accent = pick(BLAZERS);
    bits.add('jacket'); bits.add(r() < .4 ? 'longSleeve' : 'jacketSleeve');
    if (feminine && r() < .5) { bits.add('skirt'); legs = r() < .5 ? 0x2c2c31 : skin; }
  } else if (style < .62) { // coat or puffer
    bits.add('jacket').add('jacketSleeve');
    if (r() < .5) bits.add('sneakers');
    if (r() < .3) { bits.add('beanie'); }
  } else if (style < .76) { // tee and jeans or shorts
    bits.add('bareArm').add('sneakers');
    if (r() < .3) { bits.add('shorts'); legs = pick([0xc0a77e, 0x41608e, 0x6e7255, 0x3a3c42]); }
    if (r() < .2) bits.add('cap');
  } else if (style < .88 && feminine) { // dress, sometimes with a jacket
    top = pick([...TEES, ...KNITS]); legs = r() < .5 ? skin : 0x2c2c31; bits.add('skirt');
    if (r() < .45) bits.add('jacket').add('jacketSleeve'); else bits.add('bareArm');
  } else { // knit sweater
    top = pick(KNITS); bits.add('longSleeve');
    if (r() < .5) bits.add('sneakers');
  }
  if (!bits.has('beanie') && !bits.has('cap')) {
    if (r() > .06) bits.add('hair');
    if (feminine && bits.has('hair')) bits.add(r() < .7 ? 'long' : 'bun');
  } else bits.add('hair');
  if (bits.has('beanie')) accent = bits.has('jacket') ? accent : pick(KNITS);
  if (!bits.has('backpack') && r() < .22) bits.add('tote');
  if (r() < .14) bits.add('glasses');
  let mask = 0; for (const bit of bits) mask |= 1 << B[bit];
  const width = feminine ? .9 + r() * .08 : .97 + r() * .12;
  const height = (feminine ? .93 : .98) + r() * .08;
  return { top, legs, skin, hair, accent, mask, width, height };
}

// Archetypes whose signature prop reads as an ordinary passer-by (no lab coat or folding bike on every corner).
const STREET_ARCHETYPES: readonly FounderArchetype[] = ['hacker', 'ai-researcher', 'crypto', 'design', 'growth', 'consumer', 'ex-faang', 'dropout', 'serial', 'deep-tech'];

/** A varied, deterministic full look for rigged near pedestrian `i` (HD): sex, archetype prop, garment tier, hair,
 * hair colour and accessory through the existing appearance system. Local scenery only (applied with forceLook). */
export function crowdRiggedLook(i: number): ResolvedLook {
  let s = (i * 2246822519 + 0x85ebca6b) >>> 0;
  const r = (n: number) => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return Math.floor(s / 4294967296 * n); };
  const sex = r(2) ? 'female' : 'male', archetype = STREET_ARCHETYPES[r(STREET_ARCHETYPES.length)]!;
  // Weighted toward natural hair, muted clothing and bare heads (appearance.ts index order).
  const pick = (weights: readonly number[]) => weights[r(weights.length)]!;
  return resolveLook({ ...defaultAppearance(sex, archetype), outfit: pick([0, 2, 3, 4, 4, 5, 7, 7, 1, 6]), hair: r(8),
    hairColor: pick([1, 1, 1, 2, 2, 0, 0, 3, 4, 5]), accessory: pick([0, 0, 0, 0, 0, 1, 1, 2, 3, 5, 6, 7]), stageRound: r(5) });
}

/** Body geometry + material + per-instance look attributes for `count` people. */
export function createCrowdBody(count: number) {
  const pieces: BufferGeometry[] = [], colour = new Color();
  function part(geometry: BufferGeometry, hex: number, channel: number, x: number, y: number, z: number,
    o: { gate?: Gate; pivotY?: number; swing?: number; shade?: number } = {}) {
    // Read the local bounds before translate(), which recomputes the bounding box in place.
    geometry.computeBoundingBox();
    const bottom = geometry.boundingBox!.min.y, height = Math.max(1e-4, geometry.boundingBox!.max.y - bottom);
    geometry.translate(x, y, z); if (geometry.getAttribute('uv')) geometry.deleteAttribute('uv');
    const position = geometry.getAttribute('position'), n = position.count;
    const colours = new Float32Array(n * 3), parts = new Float32Array(n * 4);
    const bit = o.gate?.on ? B[o.gate.on] + 1 : o.gate?.off ? -(B[o.gate.off] + 1) : 0;
    const shade = o.shade ?? .06;
    for (let i = 0; i < n; i++) {
      // A soft gradient within each part plus one continuous feet-to-head gradient (contact shading) gives the flat
      // Lambert figure some form without visible bands where parts meet.
      const t = (position.getY(i) - y - bottom) / height, body = .78 + .22 * Math.min(1, Math.max(0, position.getY(i) / 1.45));
      const f = (1 - shade + shade * t) * body;
      colour.setHex(channel === FIXED ? hex : 0xffffff).multiplyScalar(f).toArray(colours, i * 3);
      parts[i * 4] = o.pivotY ?? 0; parts[i * 4 + 1] = o.swing ?? 0; parts[i * 4 + 2] = channel; parts[i * 4 + 3] = bit;
    }
    geometry.setAttribute('color', new Float32BufferAttribute(colours, 3));
    geometry.setAttribute('crowdPart', new Float32BufferAttribute(parts, 4));
    pieces.push(geometry);
  }
  const cyl = (top: number, bottom: number, h: number, seg = 10, depth = 1) => new CylinderGeometry(top, bottom, h, seg).scale(1, 1, depth);
  // Head, face and neck.
  part(new SphereGeometry(.1, 14, 10).scale(.8, 1.12, .96), 0, SKIN, 0, 1.64, 0, { shade: .1 });
  part(new CylinderGeometry(.05, .057, .11, 8), 0, SKIN, 0, 1.52, -.005);
  part(new BoxGeometry(.026, .044, .04), 0, SKIN, 0, 1.632, .093, { shade: .2 });
  for (const side of [-1, 1]) {
    part(new SphereGeometry(.022, 6, 4).scale(.5, 1.2, 1), 0, SKIN, side * .08, 1.64, -.005);
    part(new BoxGeometry(.03, .014, .01), 0x1d1918, FIXED, side * .034, 1.66, .094, { shade: 0 });
    part(new BoxGeometry(.04, .011, .012), 0, HAIR, side * .035, 1.684, .092, { shade: 0 });
  }
  part(new BoxGeometry(.036, .008, .008), 0x7b4b42, FIXED, 0, 1.597, .09, { shade: 0 });
  // Hair: a cap tilted back so the hairline sits above the brows and the back covers the nape.
  const cap = (r: number) => new SphereGeometry(r, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2).scale(.86, 1.1, 1.02).rotateX(-.45);
  part(cap(.106), 0, HAIR, 0, 1.652, -.01, { gate: { on: 'hair' }, shade: .25 });
  part(new BoxGeometry(.15, .26, .045), 0, HAIR, 0, 1.55, -.08, { gate: { on: 'long' }, shade: .2 });
  for (const side of [-1, 1]) part(new BoxGeometry(.022, .17, .085), 0, HAIR, side * .078, 1.59, -.035, { gate: { on: 'long' } });
  part(new SphereGeometry(.046, 8, 6), 0, HAIR, 0, 1.745, -.075, { gate: { on: 'bun' } });
  part(cap(.114), 0, ACCENT, 0, 1.672, -.012, { gate: { on: 'beanie' }, shade: .2 });
  part(cap(.112), 0, ACCENT, 0, 1.678, -.006, { gate: { on: 'cap' }, shade: .15 });
  part(new BoxGeometry(.15, .012, .09), 0, ACCENT, 0, 1.712, .1, { gate: { on: 'cap' }, shade: 0 });
  part(new BoxGeometry(.13, .026, .012), 0x121212, FIXED, 0, 1.662, .1, { gate: { on: 'glasses' }, shade: 0 });
  // Torso: elliptical, not round, with a waist; hood rolled at the back of the neck.
  part(cyl(.205, .17, .25, 12, .64), 0, TOP, 0, 1.35, 0);
  part(cyl(.17, .174, .22, 12, .66), 0, TOP, 0, 1.13, 0);
  part(new BoxGeometry(.2, .07, .08), 0, TOP, 0, 1.45, -.1, { gate: { on: 'hood' } });
  for (const side of [-1, 1]) part(new BoxGeometry(.01, .12, .01), 0xe8e6e0, FIXED, side * .035, 1.41, .135, { gate: { on: 'hood' }, shade: 0 });
  // Open-front outer layer (blazer, coat, vest) over the top.
  part(new CylinderGeometry(.218, .196, .5, 12, 1, true, .42, Math.PI * 2 - .84).scale(1, 1, .7), 0, ACCENT, 0, 1.225, 0, { gate: { on: 'jacket' } });
  part(new CylinderGeometry(.16, .218, .05, 12, 1, true).scale(1, 1, .7), 0, ACCENT, 0, 1.495, 0, { gate: { on: 'jacket' } });
  // Hips and skirt.
  part(cyl(.172, .165, .16, 12, .7), 0, LEGS, 0, .95, 0);
  part(cyl(.18, .265, .4, 14, .78), 0, TOP, 0, .8, 0, { gate: { on: 'skirt' }, shade: .22 });
  // Bags.
  part(new BoxGeometry(.28, .36, .13), 0x2a2d33, FIXED, 0, 1.22, -.19, { gate: { on: 'backpack' }, shade: .25 });
  for (const side of [-1, 1]) part(new BoxGeometry(.035, .28, .02), 0x2a2d33, FIXED, side * .1, 1.3, .135, { gate: { on: 'backpack' } });
  part(new BoxGeometry(.05, .3, .27), 0xcfc3a6, FIXED, .3, .98, 0, { gate: { on: 'tote' }, shade: .2 });
  part(new BoxGeometry(.02, .3, .02), 0xcfc3a6, FIXED, .24, 1.3, 0, { gate: { on: 'tote' }, shade: 0 });
  for (const side of [-1, 1]) {
    const leg = { pivotY: .92, swing: side }, arm = { pivotY: 1.43, swing: -side };
    // Legs: thigh, shin (bare under shorts), shoe upper (sneaker or dark) and sole.
    part(cyl(.084, .064, .44, 9), 0, LEGS, side * .095, .7, 0, leg);
    part(cyl(.06, .05, .4, 9), 0, LEGS, side * .095, .29, 0, { ...leg, gate: { off: 'shorts' } });
    part(cyl(.054, .046, .4, 9), 0, SKIN, side * .095, .29, 0, { ...leg, gate: { on: 'shorts' } });
    part(new BoxGeometry(.1, .07, .25), 0xe9e7e2, FIXED, side * .095, .06, .035, { ...leg, gate: { on: 'sneakers' }, shade: .1 });
    part(new BoxGeometry(.1, .07, .25), 0x2b2522, FIXED, side * .095, .06, .035, { ...leg, gate: { off: 'sneakers' }, shade: .1 });
    part(new BoxGeometry(.108, .025, .262), 0x2a2a2a, FIXED, side * .095, .0125, .035, { ...leg, shade: 0 });
    // Arms: shoulder, upper arm and forearm in the top, the outer layer or bare skin; hands.
    part(new SphereGeometry(.062, 8, 6).scale(1, .8, 1), 0, TOP, side * .19, 1.42, 0, { ...arm, gate: { off: 'jacketSleeve' } });
    part(new SphereGeometry(.07, 8, 6).scale(1, .8, 1), 0, ACCENT, side * .19, 1.425, 0, { ...arm, gate: { on: 'jacketSleeve' } });
    part(cyl(.052, .046, .29, 8), 0, TOP, side * .215, 1.3, 0, { ...arm, gate: { off: 'jacketSleeve' } });
    part(cyl(.058, .052, .29, 8), 0, ACCENT, side * .218, 1.3, 0, { ...arm, gate: { on: 'jacketSleeve' } });
    part(cyl(.05, .044, .27, 8), 0, ACCENT, side * .218, 1.02, 0, { ...arm, gate: { on: 'jacketSleeve' } });
    part(cyl(.045, .039, .27, 8), 0, TOP, side * .215, 1.02, 0, { ...arm, gate: { on: 'longSleeve' } });
    part(cyl(.04, .035, .27, 8), 0, SKIN, side * .215, 1.02, 0, { ...arm, gate: { on: 'bareArm' } });
    part(new SphereGeometry(.042, 8, 6).scale(.75, 1.25, .6), 0, SKIN, side * .215, .855, 0, { ...arm, shade: .1 });
  }
  const geometry = mergeGeometries(pieces, false)!; pieces.forEach(piece => piece.dispose());
  const looks = new Float32Array(count * 4), legs = new Float32Array(count * 3), skin = new Float32Array(count * 3);
  const hair = new Float32Array(count * 3), accent = new Float32Array(count * 3);
  const top = new InstancedBufferAttribute(looks, 4);
  geometry.setAttribute('crowdTop', top);
  geometry.setAttribute('crowdLegs', new InstancedBufferAttribute(legs, 3));
  geometry.setAttribute('crowdSkin', new InstancedBufferAttribute(skin, 3));
  geometry.setAttribute('crowdHair', new InstancedBufferAttribute(hair, 3));
  geometry.setAttribute('crowdAccent', new InstancedBufferAttribute(accent, 3));
  const people: CrowdLook[] = [];
  for (let i = 0; i < count; i++) {
    const look = crowdLook(i); people.push(look);
    colour.setHex(look.top).toArray(looks, i * 4); looks[i * 4 + 3] = look.mask;
    colour.setHex(look.legs).toArray(legs, i * 3); colour.setHex(look.skin).toArray(skin, i * 3);
    colour.setHex(look.hair).toArray(hair, i * 3); colour.setHex(look.accent).toArray(accent, i * 3);
  }
  const material = new MeshLambertMaterial({ vertexColors: true });
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      attribute vec4 crowdPart;
      attribute vec4 crowdTop;
      attribute vec3 crowdLegs;
      attribute vec3 crowdSkin;
      attribute vec3 crowdHair;
      attribute vec3 crowdAccent;
      attribute float crowdSwing;
      mat2 crowdRotation(float a) { return mat2(cos(a), sin(a), -sin(a), cos(a)); }
      float crowdShown() {
        if (abs(crowdPart.w) < .5) return 1.0;
        int bit = int(abs(crowdPart.w) + .5) - 1, mask = int(crowdTop.w + .5);
        bool set = ((mask >> bit) & 1) == 1;
        return (crowdPart.w > 0.0) == set ? 1.0 : 0.0;
      }`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        objectNormal.yz = crowdRotation(crowdSwing * crowdPart.y) * objectNormal.yz;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed.y -= crowdPart.x;
        transformed.yz = crowdRotation(crowdSwing * crowdPart.y) * transformed.yz;
        transformed.y += crowdPart.x;
        transformed *= crowdShown();`)
      .replace('#include <color_vertex>', `#include <color_vertex>
        float crowdChannel = crowdPart.z;
        vColor.xyz *= crowdChannel < .5 ? vec3(1.0) : crowdChannel < 1.5 ? crowdTop.rgb : crowdChannel < 2.5 ? crowdLegs
          : crowdChannel < 3.5 ? crowdSkin : crowdChannel < 4.5 ? crowdHair : crowdAccent;`);
  };
  material.customProgramCacheKey = () => 'gtasf-crowd-variety-v1';
  return {
    geometry, material, people,
    /** Override instance `i`'s top colour (remote impostors, queue regulars). */
    setTop(i: number, hex: number) { colour.setHex(hex).toArray(looks, i * 4); top.needsUpdate = true; },
  };
}
