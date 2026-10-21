import { addCharacterNightFill } from './characterNight';
import { BufferAttribute, BufferGeometry, DataTexture, DynamicDrawUsage, FloatType, InstancedBufferAttribute, InstancedMesh,
  MeshLambertMaterial, NearestFilter, RGBAFormat, Sphere, Vector3 } from 'three';
import { flags } from '@gtasf/shared/flags';
import { afterReady } from '../avatar/peopleAssets';

/** crowdVat (lane D, gtasf-laned-crowd-vat-y7x9d): the instanced crowd as a low-poly LOD of the CC0 cc0People bodies,
 * animated by a baked vertex-animation texture (tools/assets/build-crowd-vat.mjs). Per body one geometry + one
 * DataTexture (width = vertices, rows = walk frames then idle frames, positions then normals); each instance carries
 * (phase 0..1, clip 0 = walk / 1 = idle). No skeletons, one draw per body. */
export interface CrowdVatBody { id: string; geometry: BufferGeometry; texture: DataTexture; vertices: number }
export interface CrowdVat { bodies: CrowdVatBody[]; walkFrames: number; idleFrames: number; walkSeconds: number; idleSeconds: number }
type Header = { walkFrames: number; idleFrames: number; walkSeconds: number; idleSeconds: number; quant: number;
  bodies: { id: string; vertices: number; triangles: number; indexOffset: number; colourOffset: number; paintOffset: number; positionOffset: number; normalOffset: number }[] };

let pending: Promise<CrowdVat | null> | undefined;
/** Fetched once, after READY by its first caller; null when the flag is off or the download fails. */
export function loadCrowdVat(): Promise<CrowdVat | null> {
  if (!flags.crowdVat) return Promise.resolve(null);
  pending ??= (async () => {
    try {
      await afterReady(); // never on the first-load path
      // meshyPeople: the Meshy set (texture baked into vertex colours) + hoodie; else the CC0 set.
      const name = flags.meshyPeople ? 'crowd-vat-meshy' : 'crowd-vat';
      const [header, bin] = await Promise.all([
        fetch(`/assets/avatars/${name}.json`).then(r => { if (!r.ok) throw new Error(`${name}.json ${r.status}`); return r.json() as Promise<Header>; }),
        fetch(`/assets/avatars/${name}.bin`).then(r => { if (!r.ok) throw new Error(`${name}.bin ${r.status}`); return r.arrayBuffer(); }),
      ]);
      const frames = header.walkFrames + header.idleFrames;
      // gtasf-qvajw: one body per task (yield between them), so the post-READY build isn't one ~0.6 s long task on a phone.
      const bodies: CrowdVatBody[] = [];
      for (const body of header.bodies) {
        if (bodies.length) await new Promise(resolve => setTimeout(resolve, 0));
        const v = body.vertices, index = new Uint16Array(bin, body.indexOffset, body.triangles * 3);
        const colours = new Uint8Array(bin, body.colourOffset, v * 3);
        const positions = new Int16Array(bin, body.positionOffset, frames * v * 3), normals = new Int8Array(bin, body.normalOffset, frames * v * 3);
        const data = new Float32Array(v * frames * 2 * 4);
        for (let f = 0; f < frames; f++) for (let i = 0; i < v; i++) {
          const src = (f * v + i) * 3, pos = (f * v + i) * 4, nor = ((frames + f) * v + i) * 4;
          data[pos] = positions[src]! / header.quant; data[pos + 1] = positions[src + 1]! / header.quant; data[pos + 2] = positions[src + 2]! / header.quant; data[pos + 3] = 1;
          data[nor] = normals[src]! / 127; data[nor + 1] = normals[src + 1]! / 127; data[nor + 2] = normals[src + 2]! / 127; data[nor + 3] = 0;
        }
        const texture = new DataTexture(data, v, frames * 2, RGBAFormat, FloatType);
        texture.magFilter = texture.minFilter = NearestFilter; texture.needsUpdate = true;
        const geometry = new BufferGeometry();
        geometry.setIndex(new BufferAttribute(Uint16Array.from(index), 1));
        // Bind-ish frame-0 positions only keep three's bounds/attribute bookkeeping valid; the shader overrides them.
        const bind = new Float32Array(v * 3); // frame 0's xyz (was data.filter over every frame: one callback per element)
        for (let i = 0; i < v; i++) { bind[i * 3] = data[i * 4]!; bind[i * 3 + 1] = data[i * 4 + 1]!; bind[i * 3 + 2] = data[i * 4 + 2]!; }
        geometry.setAttribute('position', new BufferAttribute(bind, 3));
        geometry.setAttribute('normal', new BufferAttribute(new Float32Array(v * 3).fill(0), 3));
        geometry.setAttribute('color', new BufferAttribute(Float32Array.from(colours, c => c / 255), 3));
        // Paint class per vertex: 1 = clothing (per-person hue shift), .5 = skin (per-person tone), 0 = keep.
        geometry.setAttribute('crowdPaint', new BufferAttribute(Float32Array.from(new Uint8Array(bin, body.paintOffset, v), c => c / 255), 1));
        geometry.boundingSphere = new Sphere(new Vector3(0, .9, 0), 1.2);
        bodies.push({ id: body.id, geometry, texture, vertices: v });
      }
      return { bodies, walkFrames: header.walkFrames, idleFrames: header.idleFrames, walkSeconds: header.walkSeconds, idleSeconds: header.idleSeconds };
    } catch (error) { console.warn('crowd VAT skipped', error); return null; }
  })();
  return pending;
}

/** Per-person variety for VAT and rigged CC0 people alike: clothing hue rotation (radians) and skin tone multiplier. */
export const CROWD_HUES = [0, 2.1, 4.2, 1.05, 3.15, 5.25, .5] as const;
export const CROWD_SKINS = [1, .62, .82, .45, 1.06, .72, .55] as const;
/** CC0 body materials that are clothing (recoloured per person); keep in sync with tools/assets/build-crowd-vat.mjs. */
export const CROWD_CLOTH = new Set(['Suit', 'Tie', 'Red_Dark', 'LightBlue', 'Pink', 'Orange', 'LimeGreen', 'Grey', 'LightBrown', 'White', 'Black', 'Purple']);

/** One instanced draw of `capacity` people wearing `body`. Per instance `anim` = (phase, clip, clothing hue, skin tone). */
export function createVatMesh(vat: CrowdVat, body: CrowdVatBody, capacity: number) {
  const anim = new InstancedBufferAttribute(new Float32Array(capacity * 4).map((_, k) => k % 4 === 3 ? 1 : 0), 4).setUsage(DynamicDrawUsage);
  const geometry = body.geometry.clone(); geometry.setAttribute('crowdAnim', anim);
  const material = new MeshLambertMaterial({ vertexColors: true });
  material.onBeforeCompile = shader => {
    shader.uniforms.uVat = { value: body.texture };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      uniform highp sampler2D uVat;
      attribute vec4 crowdAnim;
      attribute float crowdPaint;
      vec3 crowdHue(vec3 c, float a) {
        vec3 yiq = mat3(.299, .596, .211, .587, -.274, -.523, .114, -.322, .312) * c;
        float h = atan(yiq.z, yiq.y) + a, chroma = length(yiq.yz);
        return max(mat3(1., 1., 1., .956, -.272, -1.106, .621, -.647, 1.703) * vec3(yiq.x, chroma * cos(h), chroma * sin(h)), 0.0);
      }
      vec3 vatPosition; vec3 vatNormal;
      void vatSample() {
        float walk = step(crowdAnim.y, .5), count = walk > .5 ? ${vat.walkFrames.toFixed(1)} : ${vat.idleFrames.toFixed(1)};
        float base = walk > .5 ? 0.0 : ${vat.walkFrames.toFixed(1)}, f = fract(crowdAnim.x) * count, t = fract(f);
        int r0 = int(base + floor(f)), r1 = int(base + mod(floor(f) + 1.0, count)), id = gl_VertexID;
        vatPosition = mix(texelFetch(uVat, ivec2(id, r0), 0).xyz, texelFetch(uVat, ivec2(id, r1), 0).xyz, t);
        vatNormal = normalize(mix(texelFetch(uVat, ivec2(id, r0 + ${vat.walkFrames + vat.idleFrames}), 0).xyz,
          texelFetch(uVat, ivec2(id, r1 + ${vat.walkFrames + vat.idleFrames}), 0).xyz, t));
      }`)
      .replace('#include <beginnormal_vertex>', `vatSample();
        vec3 objectNormal = vatNormal;
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3( tangent.xyz );
        #endif`)
      .replace('#include <begin_vertex>', 'vec3 transformed = vatPosition;')
      .replace('#include <color_vertex>', `#include <color_vertex>
        if (crowdPaint > .75) vColor.rgb = crowdHue(vColor.rgb, crowdAnim.z);
        else if (crowdPaint > .25) vColor.rgb *= crowdAnim.w;`);
  };
  material.customProgramCacheKey = () => `gtasf-crowd-vat-v2:${vat.walkFrames}:${vat.idleFrames}`;
  addCharacterNightFill(material); // avatarNightFill: dark Meshy crowd stays readable at night (extends the cache key)
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.name = `Crowd VAT ${body.id}`; mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  return { mesh, anim, dispose() { geometry.dispose(); material.dispose(); mesh.dispose(); } };
}
