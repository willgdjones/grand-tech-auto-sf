import {
  CanvasTexture, Color, Group, Mesh, MeshBasicMaterial, PlaneGeometry, RepeatWrapping, Vector3,
  type PerspectiveCamera, type Scene,
} from 'three';

// Rain driven by the LIVE weather feed (weatherGrade.state.rain, derived from NWS precipitation). A few
// camera-facing streak sheets at stepped distances scroll downward (with a little wind slant) and parallax,
// which reads as falling rain across the view without a per-drop particle update. Density 0 (dry) => hidden
// and skipped, so it is byte-identical off and in dry weather, and cheap on phones (a handful of quads).

/** Procedural vertical rain streaks (random columns, varied length/opacity) tileable top-to-bottom. */
function streakTexture(): CanvasTexture {
  const w = 256, h = 256, canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);
  ctx.lineCap = 'round';
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * w, len = 16 + Math.random() * 44, y = Math.random() * h;
    const a = 0.1 + Math.random() * 0.26;
    ctx.strokeStyle = `rgba(222,230,236,${a})`;
    ctx.lineWidth = 0.5 + Math.random() * 0.9;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 1.5, y + len); ctx.stroke();
    // Wrap the streak across the seam so vertical tiling has no visible join.
    if (y + len > h) { ctx.beginPath(); ctx.moveTo(x, y - h); ctx.lineTo(x + 1.5, y + len - h); ctx.stroke(); }
  }
  const tex = new CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

interface Sheet { mesh: Mesh; mat: MeshBasicMaterial; dist: number; speed: number; repeat: number; }

export interface Rain {
  update(camera: PerspectiveCamera, seconds: number, density: number): void;
  dispose(): void;
}

/**
 * Mount rain into `scene`. `update(camera, seconds, density)` keeps the sheets in front of the camera,
 * scrolls them downward and sets opacity from `density` (0..1 = weatherGrade.state.rain, or a demo override).
 */
export function createRain(scene: Scene): Rain {
  const group = new Group();
  group.name = 'GTASF rain';
  group.renderOrder = 7; // above the fog bank
  const tex = streakTexture();
  const geo = new PlaneGeometry(1, 1);
  const tint = new Color('#dce4ea');
  const forward = new Vector3(), flat = new Vector3();
  const sheets: Sheet[] = [];
  // Three stepped layers: a near fast sheet for big foreground streaks, two further/slower for depth.
  const layers = [{ dist: 7, speed: 2.4, repeat: 2.4, size: 16 }, { dist: 15, speed: 1.7, repeat: 4, size: 32 }, { dist: 30, speed: 1.1, repeat: 7, size: 60 }];
  for (const L of layers) {
    const mat = new MeshBasicMaterial({
      map: tex.clone(), transparent: true, depthWrite: false, depthTest: false, opacity: 0, fog: false, color: tint.clone(), toneMapped: true,
    });
    mat.map!.needsUpdate = true;
    mat.map!.repeat.set(L.repeat * 1.8, L.repeat);
    const mesh = new Mesh(geo, mat);
    mesh.frustumCulled = false; mesh.renderOrder = 7;
    mesh.scale.set(L.size * 1.8, L.size, 1);
    group.add(mesh);
    sheets.push({ mesh, mat, dist: L.dist, speed: L.speed, repeat: L.repeat });
  }
  scene.add(group);
  group.visible = false; // start hidden, matching `visible` (see fogBank.ts: a Group defaults visible, so dry sessions drew 3 depthTest-off full-screen sheets at opacity 0)
  let visible = false;
  const update = (camera: PerspectiveCamera, seconds: number, density: number): void => {
    const d = Math.max(0, Math.min(1, density));
    const show = d > 0.02;
    if (show !== visible) { group.visible = show; visible = show; }
    if (!show) return;
    camera.getWorldDirection(forward);
    flat.set(forward.x, 0, forward.z); if (flat.lengthSq() < 1e-4) flat.set(0, 0, -1); flat.normalize();
    for (const s of sheets) {
      // In front of the camera at the layer distance, facing the camera, covering the view.
      s.mesh.position.set(
        camera.position.x + flat.x * s.dist,
        camera.position.y + 1 + flat.y * 0,
        camera.position.z + flat.z * s.dist,
      );
      s.mesh.lookAt(camera.position.x, s.mesh.position.y, camera.position.z);
      s.mat.map!.offset.set((seconds * 0.05) % 1, (-seconds * s.speed) % 1); // fall + slight wind drift
      s.mat.opacity = d * 0.42;
    }
  };
  return {
    update,
    dispose(): void { scene.remove(group); for (const s of sheets) { s.mat.map?.dispose(); s.mat.dispose(); } geo.dispose(); tex.dispose(); },
  };
}
