import {
  BoxGeometry, BufferGeometry, Color, type Matrix4, CylinderGeometry, DynamicDrawUsage, Float32BufferAttribute,
  Group, InstancedBufferAttribute, InstancedMesh, MeshLambertMaterial, SphereGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { flags } from '@gtasf/shared/flags';
import { createCrowdBody, crowdRiggedLook, CROWD_TOPS } from './crowdBody';
import { createVatMesh, CROWD_HUES, CROWD_SKINS, type CrowdVat } from './crowdVat';
import type { AvatarInstance, AvatarTemplate, PlayerAnimation } from '../avatar/riggedAvatar';

/** Articulated, clothed background people in one draw call. No skeletons, textures or downloads.
 * Near HD people retain the rigged player asset; phones use this inexpensive silhouette throughout.
 */
export function createCrowdPopulation(count: number, template: AvatarTemplate | null, riggedCount = 0, bodies: readonly AvatarTemplate[] = [], vat: CrowdVat | null = null) {
  // cc0People: rigged slots cycle through the CC0 bodies (people.ts) instead of all wearing the hoodie.
  const rigged = template || bodies.length ? riggedCount : 0;
  const root = new Group(), pieces: BufferGeometry[] = [];
  const colour = new Color();
  // crowdVariety (lane D): varied, proportioned people from crowdBody.ts instead of the shared silhouette below.
  const varied = flags.crowdVariety ? createCrowdBody(count) : null;
  function part(geometry: BufferGeometry, hex: number, x: number, y: number, z: number, cloth = 0, pivotY = 0, swing = 0) {
    geometry.translate(x, y, z); geometry.deleteAttribute('uv');
    const n = geometry.getAttribute('position').count, colors = new Float32Array(n * 3), pivots = new Float32Array(n * 2);
    colour.setHex(hex);
    for (let i = 0; i < n; i++) { colour.toArray(colors, i * 3); pivots[i * 2] = pivotY; pivots[i * 2 + 1] = swing; }
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    geometry.setAttribute('crowdPivot', new Float32BufferAttribute(pivots, 2));
    geometry.setAttribute('crowdCloth', new Float32BufferAttribute(new Float32Array(n).fill(cloth), 1));
    pieces.push(geometry);
  }
  // Jacket, collar, zip, pockets and backpack give even the small silhouette authored detail.
  if (!varied) {
  part(new CylinderGeometry(.235, .185, .61, 6), 0xffffff, 0, 1.16, 0, 1);
  part(new CylinderGeometry(.105, .13, .12, 6), 0xf0dfc9, 0, 1.50, 0);
  part(new BoxGeometry(.025, .48, .02), 0xd4d9d6, 0, 1.18, .205);
  part(new BoxGeometry(.26, .11, .025), 0xe0e3de, 0, .99, .19, 1);
  part(new BoxGeometry(.28, .38, .14), 0x263847, 0, 1.19, -.24);
  part(new SphereGeometry(.15, 8, 6).scale(.88, 1.13, 1), 0xc58d65, 0, 1.69, 0);
  part(new SphereGeometry(.155, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0x332820, 0, 1.71, -.015);
  part(new BoxGeometry(.045, .065, .045), 0xc58d65, 0, 1.67, .145);
  for (const side of [-1, 1]) {
    part(new BoxGeometry(.029, .018, .02), 0x24242b, side * .055, 1.72, .137);
    part(new CylinderGeometry(.078, .066, .72, 5), 0x354351, side * .11, .48, 0, 0, .85, side);
    part(new BoxGeometry(.16, .115, .30), 0xeee9da, side * .11, .10, .055, 0, .85, side);
    part(new BoxGeometry(.165, .035, .30), 0x30353b, side * .11, .035, .055, 0, .85, side);
    part(new CylinderGeometry(.077, .058, .49, 5), 0xffffff, side * .285, 1.17, 0, 1, 1.41, -side);
    part(new SphereGeometry(.069, 6, 4), 0xc58d65, side * .285, .88, 0, 0, 1.41, -side);
  }
  }
  const geometry = varied?.geometry ?? mergeGeometries(pieces, false)!; pieces.forEach(piece => piece.dispose());
  const tints = new Float32Array(count * 3), swings = new Float32Array(count);
  const tint = new InstancedBufferAttribute(tints, 3), swing = new InstancedBufferAttribute(swings, 1).setUsage(DynamicDrawUsage);
  geometry.setAttribute('crowdTint', tint); geometry.setAttribute('crowdSwing', swing);
  const palette = [0x739bb6, 0xbb5547, 0x64866d, 0xd1ab69, 0xb08fb4, 0xd6d6c7, 0x3c617a, 0xb76f37];
  for (let i = 0; i < count; i++) colour.setHex(palette[i % palette.length]!).toArray(tints, i * 3);
  const material = varied?.material ?? new MeshLambertMaterial({ vertexColors: true });
  if (!varied) material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      attribute vec2 crowdPivot;
      attribute float crowdCloth;
      attribute vec3 crowdTint;
      attribute float crowdSwing;
      mat2 crowdRotation(float a) { return mat2(cos(a), sin(a), -sin(a), cos(a)); }`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        objectNormal.yz = crowdRotation(crowdSwing * crowdPivot.y) * objectNormal.yz;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed.y -= crowdPivot.x;
        transformed.yz = crowdRotation(crowdSwing * crowdPivot.y) * transformed.yz;
        transformed.y += crowdPivot.x;`)
      .replace('#include <color_vertex>', `#include <color_vertex>
        vColor.xyz *= mix(vec3(1.0), crowdTint, crowdCloth);`);
  };
  if (!varied) material.customProgramCacheKey = () => 'gtasf-articulated-crowd-v1';
  const mesh = new InstancedMesh(geometry, material, count); mesh.name = 'Instanced clothed walkers';
  mesh.instanceMatrix.setUsage(DynamicDrawUsage); mesh.frustumCulled = false; root.add(mesh);
  const actors: AvatarInstance[] = [], proxy = new Group(); proxy.scale.setScalar(0); proxy.updateMatrix();
  // crowdVat: unrigged people are the CC0 bodies' vertex-animated LOD (crowdVat.ts), one instanced draw per body,
  // instead of the box figure; person i wears body i % n in slot floor(i / n).
  const vats = vat ? vat.bodies.map(body => createVatMesh(vat, body, Math.ceil(count / vat.bodies.length))) : [];
  vats.forEach(v => root.add(v.mesh)); mesh.visible = !vats.length;
  // Bodies with no live person this frame are hidden in flush(): small populations (coffee queue, ferry) would otherwise
  // issue one empty instanced draw per body.
  const live = new Uint8Array(vats.length);
  const place = (i: number, matrix: Matrix4) => {
    if (!vats.length) { mesh.setMatrixAt(i, matrix); return; }
    const b = i % vats.length; vats[b]!.mesh.setMatrixAt(Math.floor(i / vats.length), matrix);
    if (matrix !== proxy.matrix) live[b] = 1;
  };
  for (let i = 0; i < count; i++) place(i, proxy.matrix);
  // Per-person clothing hue + skin tone so a repeated body still reads as a different person (crowdVat.ts).
  vats.forEach((v, b) => { const anim = v.anim.array as Float32Array; for (let slot = 0; slot * vats.length + b < count; slot++) {
    const person = slot * vats.length + b; anim[slot * 4 + 2] = CROWD_HUES[(person * 5 + b) % CROWD_HUES.length]!; anim[slot * 4 + 3] = CROWD_SKINS[(person * 3 + b * 2) % CROWD_SKINS.length]!; } });
  let disposed = false;
  for (let i = 0; i < count; i++) {
    if (i < rigged) {
      // crowdVariety: near rigged people wear varied local looks (forceLook: scenery never sends SET_APPEARANCE).
      const body = bodies.length ? bodies[i % bodies.length]! : template!;
      const actor = bodies.length ? body.createInstance(i % 4) : varied ? body.createInstance(i % 4, crowdRiggedLook(i), true) : body.createInstance(i % 4);
      root.add(actor.root); actors.push(actor); continue;
    }
    const pose = new Group(); pose.visible = false; pose.name = `Crowd person ${i + 1}`;
    const height = .94 + i % 5 * .03, look = varied?.people[i];
    if (look) pose.scale.set(look.width * look.height, look.height, look.height); else pose.scale.setScalar(height);
    root.add(pose);
    let phase = i * 2.399, outfit = i % palette.length, vatPhase = (i * .618) % 1;
    const actor: AvatarInstance = {
      root: pose, get outfit() { return outfit; },
      setOutfit(value) {
        outfit = Math.abs(Math.trunc(value)) % palette.length;
        if (varied) { varied.setTop(i, CROWD_TOPS[outfit]!); return; }
        colour.setHex(palette[outfit]!).toArray(tints, i * 3); tint.needsUpdate = true;
      },
      applyLook() { /* Local scenery has no player identity or cosmetic entitlement. */ },
      update(dt: number, clip: PlayerAnimation, opacity = 1) {
        pose.visible = opacity > .01;
        phase += dt * 14;
        swings[i] = clip === 'walk' ? Math.sin(phase) * .52 : 0;
        if (vat && vats.length) {
          const slot = Math.floor(i / vats.length), anim = vats[i % vats.length]!.anim.array as Float32Array;
          vatPhase = (vatPhase + dt / (clip === 'walk' ? vat.walkSeconds : vat.idleSeconds)) % 1;
          anim[slot * 4] = vatPhase; anim[slot * 4 + 1] = clip === 'walk' ? 0 : 1;
        }
        if (pose.visible) { pose.updateMatrix(); place(i, pose.matrix); }
        else place(i, proxy.matrix);
      },
      dispose() { pose.removeFromParent(); place(i, proxy.matrix); },
    };
    actors.push(actor);
  }
  return {
    root, actors,
    flush() {
      // Some callers cull an actor without updating its animation. Clear its old GPU instance too.
      for (let i = rigged; i < actors.length; i++) if (!actors[i]!.root.visible) place(i, proxy.matrix);
      mesh.instanceMatrix.needsUpdate = true; swing.needsUpdate = true;
      vats.forEach((v, b) => { v.mesh.visible = live[b] === 1; live[b] = 0; v.mesh.instanceMatrix.needsUpdate = true; v.anim.needsUpdate = true; });
    },
    dispose() { if (disposed) return; disposed = true; actors.forEach(actor => actor.dispose()); vats.forEach(v => v.dispose()); geometry.dispose(); material.dispose(); root.removeFromParent(); },
  };
}
