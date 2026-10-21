import {
  CanvasTexture, Color, Group, LinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry,
  type PerspectiveCamera, type Scene,
} from 'three';

// Karl the Fog: SF's signature low fog bank, driven by the LIVE weather feed (weatherGrade.state.fog).
// A cluster of large, soft, camera-facing quads drifting low around the player reads as fog hanging in
// the streets / rolling off the bay, without a volumetric pass. Density 0 (clear weather) => fully hidden
// and skipped, so it costs nothing and is byte-identical when the feed says clear. Street-level, so it
// lands on both HD and Low.

/** Procedural soft puff alpha (feathered radial core + a little lumpiness), so there is no texture fetch. */
function puffTexture(): CanvasTexture {
  const s = 128, canvas = document.createElement('canvas');
  canvas.width = canvas.height = s;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, s, s);
  // A few soft blobs break the perfect circle so overlapping puffs read as billowing fog, not discs.
  for (let i = 0; i < 5; i++) {
    const r = s * (0.14 + 0.12 * Math.random());
    const x = s / 2 + (Math.random() - 0.5) * s * 0.4, y = s / 2 + (Math.random() - 0.5) * s * 0.4;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  }
  const tex = new CanvasTexture(canvas);
  tex.minFilter = tex.magFilter = LinearFilter; tex.needsUpdate = true;
  return tex;
}

interface Puff { mesh: Mesh; mat: MeshBasicMaterial; angle: number; radius: number; alt: number; scale: number; drift: number; bob: number; weight: number; }

export interface FogBank {
  update(camera: PerspectiveCamera, seconds: number, density: number): void;
  setColour(c: Color, storm?: number): void;
  dispose(): void;
}

/**
 * Mount the Karl fog bank into `scene`. `update(camera, seconds, density)` drifts the puffs around the
 * camera and sets overall opacity from `density` (0..1, = weatherGrade.state.fog * influence, or a demo
 * override). Colour tracks the grade's cool fog tint via setColour so the bank blends with the horizon.
 */
export function createFogBank(scene: Scene, count = 38): FogBank {
  const group = new Group();
  group.name = 'GTASF Karl fog bank';
  group.renderOrder = 6; // after opaque world + water, before HUD-space effects
  const tex = puffTexture();
  const geo = new PlaneGeometry(1, 1);
  const colour = new Color('#c7d0d7');
  const puffs: Puff[] = [];
  for (let i = 0; i < count; i++) {
    const mat = new MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false, opacity: 0, fog: false, toneMapped: true,
      color: colour.clone(), premultipliedAlpha: false,
    });
    const mesh = new Mesh(geo, mat);
    mesh.frustumCulled = false; mesh.renderOrder = 6;
    group.add(mesh);
    // Two thirds form a dense far bank that obscures distance (the "can't see the next block" read); one
    // third are nearer, lighter wisps for movement. A disc (varied radius) rather than a thin ring so the
    // view is filled from any heading.
    const far = i % 3 !== 0;
    puffs.push({
      mesh, mat,
      angle: Math.random() * Math.PI * 2,
      radius: far ? 32 + Math.random() * 64 : 12 + Math.random() * 26,
      alt: 1 + Math.random() * (far ? 20 : 9),
      scale: (far ? 95 : 46) + Math.random() * 55,
      drift: (0.01 + Math.random() * 0.018) * (Math.random() < 0.5 ? -1 : 1),
      bob: Math.random() * Math.PI * 2,
      weight: far ? 0.82 : 0.42,
    });
  }
  scene.add(group);
  // Start hidden, matching `visible`: a Group defaults to visible, so with no fog from the start (the usual case) the
  // show !== visible check never fired and all puffs drew every frame at opacity 0 (lane B, 10-19: 38 invisible
  // full-screen blended quads = ~25% of the phone Low draw calls at the Ferry, plus their fill on a phone GPU).
  group.visible = false;
  let visible = false;
  const update = (camera: PerspectiveCamera, seconds: number, density: number): void => {
    const d = Math.max(0, Math.min(1, density));
    const show = d > 0.012;
    if (show !== visible) { group.visible = show; visible = show; }
    if (!show) return;
    const cx = camera.position.x, cz = camera.position.z, cy = camera.position.y;
    for (const p of puffs) {
      const a = p.angle + seconds * p.drift;
      const x = cx + Math.cos(a) * p.radius;
      const z = cz + Math.sin(a) * p.radius;
      const y = p.alt + Math.sin(seconds * 0.08 + p.bob) * 1.4;
      p.mesh.position.set(x, y, z);
      p.mesh.lookAt(camera.position.x, y, camera.position.z); // billboard about the vertical axis
      p.mesh.scale.setScalar(p.scale * (0.88 + 0.12 * Math.sin(seconds * 0.05 + p.bob)));
      // Fade puffs almost on top of the camera so the player keeps a small clear bubble (and no whiteout).
      const dist = Math.hypot(x - cx, z - cz, y - cy);
      const near = Math.min(1, Math.max(0, (dist - 8) / 10));
      p.mat.opacity = d * p.weight * near;
      p.mat.color.copy(colour);
    }
  };
  const cool = new Color('#e7edf1');
  return {
    update,
    // Karl is cool grey-white: take the ambient/haze tint but desaturate it strongly toward cool white so
    // the bank never turns saturated-golden at sunset (it should read as marine fog catching the light).
    // `storm` (0..1, stormHaze): rain/heavy-fog storms take the slate haze instead of near-white, so the bank
    // greys the street rather than washing it out.
    setColour(c: Color, storm = 0): void { colour.copy(c).lerp(cool, 0.6 * (1 - 0.85 * storm)); },
    dispose(): void {
      scene.remove(group);
      for (const p of puffs) p.mat.dispose();
      geo.dispose(); tex.dispose();
    },
  };
}
