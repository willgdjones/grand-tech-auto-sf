import { CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, RingGeometry, type Scene } from 'three';
import { flags } from '@gtasf/shared/flags';
import { ROOM_DURATION_MS, formatFunding } from '@gtasf/shared/funding';
import type { FundingClient, FundingTarget } from './client';

/** Server progress is interpolated only for display. A full ring requires the server's award response. */
export function createFundingRoom(options: { scene: Scene | Group; parent?: HTMLElement; surfaceHeightAt(x: number, z: number): number | null }) {
  if (!flags.fundingLoop) return null;
  const root = new Group(); root.name = 'Earned funding room'; root.visible = false; options.scene.add(root);
  const baseMaterial = new MeshBasicMaterial({ color: 0x9dde9b, opacity: .25, transparent: true, depthWrite: false, side: DoubleSide });
  const fillMaterial = new MeshBasicMaterial({ color: 0xc7ff98, opacity: .9, transparent: true, depthWrite: false, side: DoubleSide });
  const base = new Mesh(new RingGeometry(7.4, 8, 64), baseMaterial), fill = new Mesh(new RingGeometry(7.4, 8, 64), fillMaterial);
  base.name = 'Room boundary'; fill.name = 'Work the room progress'; root.add(base, fill);
  const beamMaterial = new MeshBasicMaterial({ color: 0xa4ffad, opacity: .22, transparent: true, depthWrite: false, side: DoubleSide });
  const beam = new Mesh(new CylinderGeometry(.7, .7, 8, 12, 1, true), beamMaterial); beam.position.y = 4; root.add(beam);
  const panel = document.createElement('div'); panel.className = 'gt-funding-room'; panel.hidden = true; panel.setAttribute('aria-label', 'Work the room progress');
  const title = document.createElement('strong'), progress = document.createElement('div'), amount = document.createElement('div');
  Object.assign(title.style, { display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' });
  panel.append(title, progress, amount); (options.parent ?? document.body).append(panel);
  Object.assign(panel.style, { position: 'fixed', padding: '8px 10px', border: '1px solid #b6e791', borderRadius: '5px', background: '#132b20f2',
    color: '#dcffc1', font: 'bold 12px/1.4 Arial', textAlign: 'center', pointerEvents: 'none', zIndex: '13' });
  const narrow = matchMedia('(max-width:700px)');
  const layout = () => Object.assign(panel.style, narrow.matches
    ? { left: 'auto', right: '12px', bottom: '264px', transform: 'none', width: 'calc(100vw - 210px)', maxWidth: '220px' }
    : { left: '50%', right: 'auto', bottom: '190px', transform: 'translateX(-50%)', width: 'auto', maxWidth: 'min(420px, 45vw)' });
  layout(); narrow.addEventListener('change', layout);
  let target: FundingTarget | null = null, grounded = false, sampledAt = -Infinity, lastText = '', disposed = false;
  let radiusM = 8, ringPlane = base.geometry.getAttribute('position').clone();
  function ground(value: FundingTarget): boolean {
    const height = options.surfaceHeightAt(value.anchor.x, value.anchor.z); if (height === null) return false;
    root.position.set(value.anchor.x, height, value.anchor.z);
    if (radiusM !== value.radiusM) {
      base.geometry.dispose(); fill.geometry.dispose();
      base.geometry = new RingGeometry(value.radiusM - .6, value.radiusM, 64); fill.geometry = base.geometry.clone();
      ringPlane = base.geometry.getAttribute('position').clone(); radiusM = value.radiusM;
    }
    const basePositions = base.geometry.getAttribute('position'), fillPositions = fill.geometry.getAttribute('position');
    // Both rings follow the same terrain; retain their flat offsets for later resampling.
    for (let i = 0; i < ringPlane.count; i++) {
      const x = ringPlane.getX(i), z = -ringPlane.getY(i), y = options.surfaceHeightAt(value.anchor.x + x, value.anchor.z + z) ?? height;
      basePositions.setXYZ(i, x, y - height + .22, z); fillPositions.setXYZ(i, x, y - height + .25, z);
    }
    basePositions.needsUpdate = true; fillPositions.needsUpdate = true;
    base.geometry.computeBoundingSphere(); fill.geometry.computeBoundingSphere();
    return true;
  }
  return {
    root, element: panel,
    update(client: FundingClient, now = performance.now()) {
      if (disposed) return;
      const selected = client.target;
      if (selected !== target) { target = selected; grounded = false; sampledAt = -Infinity; lastText = ''; }
      if (!selected) { root.visible = false; panel.hidden = true; return; }
      if (!grounded && now - sampledAt > 200) { sampledAt = now; grounded = ground(selected); }
      root.visible = grounded;
      const working = client.status?.state === 'working' && client.status.room?.eventId === selected.eventId;
      const done = selected.alreadyAwarded;
      baseMaterial.color.setHex(done ? 0x82a092 : 0x9dde9b); beam.visible = !done;
      const fraction = done ? 1 : working ? client.progress : 0;
      fill.geometry.setDrawRange(0, Math.floor(fraction * 64) * 6); fillMaterial.opacity = done ? .35 : .85 + Math.sin(now / 250) * .1;
      panel.hidden = !client.inside && !working;
      if (panel.hidden) return;
      const quote = working ? client.status!.room!.quote : selected.quote;
      // Drive-through pays on pass-through (once ever), so its copy differs from the v1 dwell room.
      const state = done ? (flags.driveThroughFunding ? 'RAISED ✓' : 'ALREADY RAISED TODAY')
        : working ? fraction >= .98 ? 'Confirming term sheet…' : `WORK THE ROOM · ${Math.ceil((1 - fraction) * ROOM_DURATION_MS / 1000)}s`
        : client.error || (client.busy ? 'Meeting the hosts…' : flags.driveThroughFunding ? 'Drive or walk through to raise' : 'Stay in the glowing marker');
      const value = done ? 'Find your next event' : `~${formatFunding(quote.amountCents)} · ×${quote.streakMultiplier} streak`;
      const text = `${selected.title}|${state}|${value}`;
      if (text !== lastText) { title.textContent = selected.title; progress.textContent = state; amount.textContent = value; lastText = text; }
    },
    destroy() {
      if (disposed) return; disposed = true; narrow.removeEventListener('change', layout); panel.remove(); root.removeFromParent();
      base.geometry.dispose(); fill.geometry.dispose(); beam.geometry.dispose(); baseMaterial.dispose(); fillMaterial.dispose(); beamMaterial.dispose();
    },
  };
}
