import { BoxGeometry, CanvasTexture, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial,
  PlaneGeometry, SphereGeometry, SRGBColorSpace, type Material } from 'three';
import { flags } from '@gtasf/shared/flags';
import { ellipsePoint, headingFromVelocity, skyAdCreative, SKY_AD_CRAFT, SKY_AD_CREATIVES,
  type SkyAdCraftConfig, type SkyAdCreative } from '@gtasf/shared/content/skyAds';
import { geodeticToWorld } from '../../../../tools/map/src/geo';
import { SF_FRAME } from '../../../../tools/map/src/config';

/**
 * Flying parody ads (founder playtest feedback, gtasf-more-billboards-sky-ads-hyvs): a blimp looping
 * over the Bay/FiDi and banner planes along the Embarcadero and over the Tech Week hotspots, each a
 * presell "plane-flyover" slot showing a parody creative until sold (checkout gated, pane 7). Low-poly
 * and few (1 blimp + 2 planes; blimp-only on low tier) for the phone frame budget; no bloom/emissive.
 * Lifecycle mirrors the other scenery modules: { root, update(dt, now), destroy() }, mounted via
 * foundation.mountGeometry. Returns null when flagged off.
 */

function bannerTexture(creative: SkyAdCreative): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = creative.bg; ctx.fillRect(0, 0, 1024, 256);
  ctx.strokeStyle = creative.fg; ctx.lineWidth = 12; ctx.strokeRect(10, 10, 1004, 236);
  ctx.fillStyle = creative.fg; ctx.textAlign = 'center';
  ctx.font = "bold 132px Impact, 'Arial Narrow Bold', 'Arial Narrow', sans-serif";
  ctx.fillText(creative.headline, 512, 150);
  ctx.font = '46px Arial, sans-serif';
  ctx.fillText(creative.subline, 512, 212);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** A vertical strip whose face normal points along local ±X (readable from the side as it passes). */
function banner(width: number, height: number, texture: CanvasTexture, faceLeft = false): Mesh {
  const material = new MeshBasicMaterial({ map: texture, side: DoubleSide, toneMapped: false });
  material.userData.gtasfUnlit = true; // keep banner ads full-bright; skip the realisticRender PBR conversion (gtasf-1ob8)
  const mesh = new Mesh(new PlaneGeometry(width, height), material);
  mesh.rotation.y = faceLeft ? -Math.PI / 2 : Math.PI / 2;
  return mesh;
}

function buildBlimp(texture: CanvasTexture): Group {
  const craft = new Group();
  const hull = new MeshLambertMaterial({ color: '#e3e7ec' }), trim = new MeshLambertMaterial({ color: '#4a5560' });
  const body = new Mesh(new SphereGeometry(16, 18, 12), hull); body.scale.set(1, 1, 2.7); craft.add(body); // long axis +Z
  const gondola = new Mesh(new BoxGeometry(5, 4, 12), trim); gondola.position.set(0, -16, 2); craft.add(gondola);
  for (const roll of [0, Math.PI / 2]) {
    const fin = new Mesh(new BoxGeometry(1, 16, 10), trim); fin.position.z = -40; fin.rotation.z = roll; craft.add(fin);
  }
  craft.add(banner(42, 11, texture), banner(42, 11, texture, true)); // one per flank
  craft.children.at(-1)!.position.x = -13.5; craft.children.at(-2)!.position.x = 13.5;
  return craft;
}

function buildPlane(texture: CanvasTexture): Group {
  const craft = new Group();
  const skin = new MeshLambertMaterial({ color: '#d7c24a' }), dark = new MeshLambertMaterial({ color: '#36414d' });
  craft.add(new Mesh(new BoxGeometry(2.4, 2.4, 15), skin)); // fuselage, nose at +Z
  const wing = new Mesh(new BoxGeometry(24, 0.5, 3.6), skin); wing.position.z = 1; craft.add(wing);
  const tailWing = new Mesh(new BoxGeometry(9, 0.4, 2.2), skin); tailWing.position.z = -6.5; craft.add(tailWing);
  const tailFin = new Mesh(new BoxGeometry(0.4, 3.2, 2.4), dark); tailFin.position.set(0, 1.6, -6.5); craft.add(tailFin);
  const line = new Mesh(new BoxGeometry(0.15, 0.15, 12), dark); line.position.z = -13.5; craft.add(line); // tow line
  const trail = banner(44, 11, texture); trail.position.z = -34; craft.add(trail); // trails behind the tail
  return craft;
}

interface Craft { config: SkyAdCraftConfig; group: Group; cx: number; cz: number; phase: number; prev: { x: number; z: number }; }

export function createSkyAds(options: { low?: boolean; enabled?: boolean } = {}) {
  if (!(options.enabled ?? ('skyAds' in flags && Boolean((flags as Record<string, boolean>).skyAds)))) return null;

  const root = new Group(); root.name = 'Sky ads (blimp + banner planes)';
  const crafts: Craft[] = [];
  // On low tier keep only the blimp (one aircraft) to protect the phone frame budget.
  const configs = options.low ? SKY_AD_CRAFT.filter(c => c.kind === 'blimp') : SKY_AD_CRAFT;
  for (const config of configs) {
    const creative = skyAdCreative(config.creativeId) ?? SKY_AD_CREATIVES[0]!;
    const texture = bannerTexture(creative);
    const group = config.kind === 'blimp' ? buildBlimp(texture) : buildPlane(texture);
    const [cx, cz] = geodeticToWorld(config.center.lat, config.center.lon, SF_FRAME);
    group.position.set(cx + config.radiusXM, config.altitudeM, cz);
    root.add(group);
    crafts.push({ config, group, cx, cz, phase: Math.random() * Math.PI * 2, prev: { x: cx + config.radiusXM, z: cz } });
  }

  let disposed = false;
  function update(dt: number, now = performance.now()) {
    if (disposed) return;
    const step = Math.max(0, Math.min(0.1, dt)); // clamp long frames so the flight never jumps
    for (const craft of crafts) {
      craft.phase = (craft.phase + (Math.PI * 2 * step) / craft.config.periodSec) % (Math.PI * 2);
      const p = ellipsePoint(craft.cx, craft.cz, craft.config.radiusXM, craft.config.radiusZM, craft.phase);
      const bob = Math.sin(now / 1000 * 0.3 + craft.cx) * (craft.config.kind === 'blimp' ? 4 : 2);
      craft.group.position.set(p.x, craft.config.altitudeM + bob, p.z);
      const vx = p.x - craft.prev.x, vz = p.z - craft.prev.z;
      // Keep the last heading on a zero-velocity frame (e.g. the dt=0 init tick) so the craft never
      // snaps to due north for a frame.
      if (Math.abs(vx) > 1e-4 || Math.abs(vz) > 1e-4) craft.group.rotation.y = headingFromVelocity(vx, vz);
      craft.prev.x = p.x; craft.prev.z = p.z;
    }
  }
  // Seed one step so headings face the direction of travel on the first rendered frame.
  update(0.016, 0);

  return {
    root,
    update,
    destroy() {
      if (disposed) return; disposed = true;
      root.removeFromParent();
      root.traverse(object => {
        const mesh = object as Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = mesh.material as Material | Material[] | undefined;
        for (const m of Array.isArray(material) ? material : material ? [material] : []) {
          const map = (m as MeshBasicMaterial).map; if (map) map.dispose();
          m.dispose();
        }
      });
    },
  };
}
