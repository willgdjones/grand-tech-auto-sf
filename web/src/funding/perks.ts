import { CanvasTexture, Group, LOD, Matrix3, Mesh, MeshBasicMaterial, PlaneGeometry, Raycaster,
  RingGeometry, Sprite, SpriteMaterial, SRGBColorSpace, Vector3, type Object3D, type Scene } from 'three';
import { flags } from '@gtasf/shared/flags';
import { FUNDING_ROUNDS, formatFunding, fundingRound, type FundingProfile } from '@gtasf/shared/funding';
/** The first round at a star, so perk copy follows the active ladder (v2 Pre-seed/Seed/Series A, v3 Seed/A/B). */
const atStar = (stars: number) => FUNDING_ROUNDS.find(round => round.stars >= stars)!;
const unlockCopy = (stars: number) => `Available at ${formatFunding(atStar(stars).thresholdCents)} raised.`;
import type { FundingParties, FundingParty } from '@gtasf/shared/funding-perks';
import type { FleetCar } from '../game/fleet';
import type { VehicleInstance } from '../vehicles/models/vehicle';
import { createStageCarSlot, LEGACY_PERK_CAR, stageCarForRound } from '../vehicles/models/stageCar';
import './perks.css';

interface Point { x: number; y: number; z: number }
interface PartyVisual { root: Group; geometry: RingGeometry; label: Sprite; texture: CanvasTexture; party: FundingParty }
// Avoid phase-locking with local workerd's five-second pooled HTTP timeout.
// https://github.com/cloudflare/workers-sdk/issues/15452
const PARTY_POLL_MS = 6000;
function button(text: string) { const value = document.createElement('button'); value.type = 'button'; value.textContent = text; return value; }
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text: string) { const value = document.createElement(tag); value.textContent = text; return value; }

/** Earned appearance only: never changes handling, collision, event payout, paid ads or Outbid. */
export function createFundingPerks(options: {
  scene: Scene; fleet: { cars: Map<number, FleetCar> }; surfaceHeightAt(x: number, z: number): number | null;
  parent?: HTMLElement; onModalChange?(open: boolean): void; notify?(message: string): void; enabled?: boolean;
}) {
  if (!(options.enabled ?? flags.fundingLoop)) return null;
  const openButton = button('Round perks'); openButton.className = 'gt-funding-perks-open';
  openButton.setAttribute('aria-label', 'Open earned round perks'); (options.parent ?? document.body).append(openButton);
  const dialog = document.createElement('dialog'); dialog.className = 'gt-funding-dialog'; dialog.setAttribute('aria-labelledby', 'gt-funding-perks-title');
  const title = element('h2', 'Your round, your city'); title.id = 'gt-funding-perks-title';
  const close = button('Close ×'); close.className = 'gt-funding-close';
  const status = element('p', ''); status.className = 'gt-funding-perks-status'; status.setAttribute('role', 'status');
  function card(title: string, copy: string, action: string) {
    const root = element('section', ''); root.className = 'gt-funding-perk'; const control = button(action);
    root.append(element('h3', title), element('p', copy), control); dialog.append(root); return control;
  }
  dialog.append(close, title, element('p', 'Earn funding at events to unlock these city perks.'));
  const carButton = card(flags.characterLooks ? 'Your funding-stage car' : `${atStar(1).label} · VC coupe`,
    flags.characterLooks ? `Your car appearance follows your current funding round. Car looks start at ${atStar(1).label}; your scooter is available on foot.` : `A new look for the car you drive. ${unlockCopy(1)}`, 'Use VC coupe');
  const signButton = card(`${atStar(2).label} · Your startup HQ`, `Put your startup name on a nearby building. ${unlockCopy(2)}`, 'Claim nearby HQ');
  const partyButton = card(`${atStar(3).label} · Host a party`, `Open a glowing meetup marker for everyone in the city for 15 minutes. ${unlockCopy(3)}`, 'Host party here');
  dialog.append(status); document.body.append(dialog);
  const root = new Group(); root.name = 'Earned funding cosmetics'; options.scene.add(root);
  const parties = new Map<string, PartyVisual>();
  const partyMaterial = new MeshBasicMaterial({ color: '#c67eff', transparent: true, opacity: .8, depthWrite: false });
  let disposed = false, profile: FundingProfile | null = null, stars = 0, mode = 'on-foot', vehicleId = 0, foot: Point = { x: 0, y: 0, z: 0 };
  let modalOpen = false, returnFocus: HTMLElement | null = null, wantedCar = false;
  let car: { base: FleetCar; model: VehicleInstance; hidden: { object: Object3D; visible: boolean }[] } | undefined;
  let sign: { mesh: Mesh<PlaneGeometry, MeshBasicMaterial>; texture: CanvasTexture; canvas: HTMLCanvasElement; host: Mesh } | undefined;
  let yourParty: FundingParty | null = null, partyBusy = false, partyConnected = false, partyUnconfirmed = false, lastPartyPoll = -Infinity, lastGroundCheck = -Infinity;
  let cancelPartyRequest: (() => void) | undefined;
  const carSlot = createStageCarSlot({ beforeReplace: restoreCar, changed: controls,
    failed: () => { if (!carSlot.template) wantedCar = false; message('Car appearance is unavailable. Try again shortly.'); } });
  function carChoice() { return flags.characterLooks && profile ? stageCarForRound(profile.round) : LEGACY_PERK_CAR; }
  function message(text: string) { status.textContent = text; options.notify?.(text); }
  function controls() {
    carButton.disabled = stars < 1 || !carChoice() || carSlot.busy; signButton.disabled = stars < 2; partyButton.disabled = stars < 3 || partyBusy || !partyConnected;
    carButton.textContent = wantedCar ? 'Use original car look' : `Use ${carChoice()?.label ?? 'stage car'}`; partyButton.textContent = yourParty ? 'End your party' : 'Host party here';
  }
  function publishModal() {
    const open = dialog.open;
    if (open !== modalOpen) { modalOpen = open; options.onModalChange?.(open); }
    if (!open && returnFocus) {
      const target = returnFocus; returnFocus = null;
      if (target.isConnected) target.focus({ preventScroll: true });
    }
  }
  function hide() { if (dialog.open) dialog.close(); publishModal(); }
  openButton.addEventListener('click', () => {
    if (disposed) return;
    if (!dialog.open) {
      returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    }
    publishModal(); close.focus({ preventScroll: true });
  });
  close.addEventListener('click', hide); dialog.addEventListener('close', publishModal);
  dialog.addEventListener('cancel', event => { event.preventDefault(); hide(); });
  function restoreCar() {
    if (!car) return; for (const child of car.hidden) child.object.visible = child.visible; car.model.dispose(); car = undefined;
  }
  function ensureCar() {
    if (disposed) return;
    carSlot.select(wantedCar && stars >= 1 ? carChoice() : null);
  }
  carButton.addEventListener('click', () => {
    const choice = carChoice(); if (stars < 1 || !choice) return; wantedCar = !wantedCar; ensureCar();
    if (wantedCar) message(`${choice.label} selected. Enter a car to use your new look.`); controls();
  });
  function drawSign() {
    if (!sign || !profile) return; const ctx = sign.canvas.getContext('2d')!;
    ctx.fillStyle = '#132923'; ctx.fillRect(0, 0, 1024, 256); ctx.strokeStyle = '#f0cb76'; ctx.lineWidth = 12; ctx.strokeRect(8, 8, 1008, 240);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#f4d990'; ctx.font = '700 29px system-ui'; ctx.fillText(`${atStar(2).label.toUpperCase()} STAGE · SAN FRANCISCO HQ`, 512, 56);
    let size = 77; do { ctx.font = `800 ${size}px system-ui`; if (ctx.measureText(profile.startupName || 'Stealth startup').width <= 920) break; size--; } while (size > 18);
    ctx.fillStyle = '#ffffff'; ctx.fillText(profile.startupName || 'Stealth startup', 512, 153, 920); sign.texture.needsUpdate = true; // unnamed players earn too (gtasf-ighk)
  }
  function clearSign() { if (!sign) return; sign.mesh.removeFromParent(); sign.mesh.geometry.dispose(); sign.mesh.material.dispose(); sign.texture.dispose(); sign = undefined; }
  signButton.addEventListener('click', () => {
    if (stars < 2 || !profile) return;
    const meshes: Mesh[] = []; options.scene.traverseVisible(object => { if (object instanceof Mesh && object.name === 'buildings') meshes.push(object); });
    options.scene.updateMatrixWorld(true);
    const ray = new Raycaster(), origin = new Vector3(foot.x, foot.y + 3, foot.z); ray.far = 90;
    let closest: ReturnType<Raycaster['intersectObjects']>[number] | undefined;
    for (let index = 0; index < 48; index++) {
      const angle = index / 48 * Math.PI * 2; ray.set(origin, new Vector3(Math.sin(angle), 0, Math.cos(angle)));
      const hit = ray.intersectObjects(meshes, false)[0]; if (hit && hit.distance > 2 && (!closest || hit.distance < closest.distance)) closest = hit;
    }
    if (!closest?.face || !(closest.object instanceof Mesh)) { message('Walk closer to a building, then claim your HQ sign.'); return; }
    const normal = closest.face.normal.clone().applyMatrix3(new Matrix3().getNormalMatrix(closest.object.matrixWorld)).normalize();
    if (Math.abs(normal.y) > .25) { message('Find a nearby street-facing wall for your HQ.'); return; }
    clearSign(); const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 256;
    const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace;
    const mesh = new Mesh(new PlaneGeometry(5.4, 1.35), new MeshBasicMaterial({ map: texture, toneMapped: false })); mesh.name = 'Earned startup HQ sign';
    mesh.position.copy(closest.point).addScaledVector(normal, .08); mesh.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), normal); root.add(mesh);
    sign = { mesh, texture, canvas, host: closest.object }; drawSign(); message(`${profile.startupName || 'Your startup'} HQ sign installed nearby.`); hide();
  });
  function removeParty(id: string) { const value = parties.get(id); if (!value) return; value.root.removeFromParent(); value.geometry.dispose(); value.label.material.dispose(); value.texture.dispose(); parties.delete(id); }
  function renderParties(snapshot: FundingParties) {
    yourParty = snapshot.yours; const visible = snapshot.parties.slice(0, 32), present = new Set(visible.map(party => party.hostId));
    for (const id of parties.keys()) if (!present.has(id)) removeParty(id);
    for (const party of visible) {
      let item = parties.get(party.hostId);
      if (item && JSON.stringify(item.party) === JSON.stringify(party)) continue;
      if (item) removeParty(party.hostId);
      const group = new Group(); group.name = `Startup party ${party.hostId}`;
      const geometry = new RingGeometry(3, 3.3, 48); geometry.rotateX(-Math.PI / 2);
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128; const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#301347'; ctx.fillRect(0, 0, 512, 128); ctx.fillStyle = '#f1d6ff'; ctx.textAlign = 'center'; ctx.font = '800 25px system-ui';
      ctx.fillText('FOUNDER PARTY', 256, 42); ctx.font = '600 28px system-ui'; ctx.fillText(party.startupName, 256, 90, 476);
      const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace;
      const label = new Sprite(new SpriteMaterial({ map: texture, depthWrite: false, toneMapped: false })); label.scale.set(6, 1.5, 1); label.position.y = 4;
      group.add(new Mesh(geometry, partyMaterial), label); root.add(group); group.position.set(party.anchor.x, party.anchor.y + .12, party.anchor.z);
      item = { root: group, geometry, label, texture, party }; parties.set(party.hostId, item);
    }
    lastGroundCheck = -Infinity; controls();
  }
  async function partyRequest(hosting?: boolean) {
    if (partyBusy || disposed || !profile || !partyConnected) return;
    partyBusy = true; controls();
    const request = new AbortController();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const uncertain = 'Party update could not be confirmed. Check your party after reconnecting.';
    try {
      // Include headers and body in the deadline; even an unresponsive transport must release controls.
      const interrupted = new Promise<never>((_, reject) => {
        cancelPartyRequest = () => { reject(new Error(uncertain)); request.abort(); };
        deadline = setTimeout(cancelPartyRequest, 8000);
      });
      const value = await Promise.race([(async () => {
        const response = await fetch('/api/funding/parties', { credentials: 'same-origin', cache: 'no-store', signal: request.signal,
          ...(hosting === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hosting }) }) });
        const value = await response.json() as FundingParties & { error?: string };
        if (!response.ok) throw new Error(value.error ?? 'Parties are temporarily unavailable');
        return value;
      })(), interrupted]);
      if (!disposed && partyConnected && !request.signal.aborted) {
        renderParties(value);
        if (hosting !== undefined) message(hosting ? 'Party is open for 15 minutes. Other players can meet you here.' : 'Your party has ended.');
        else if (partyUnconfirmed) message(value.yours ? 'Your party is active.' : 'No active party. You can host again.');
        partyUnconfirmed = false;
      }
    } catch (error) {
      if (!disposed && hosting !== undefined) {
        partyUnconfirmed = request.signal.aborted;
        message(error instanceof Error ? error.message : 'Party unavailable');
      }
    }
    finally { clearTimeout(deadline); cancelPartyRequest = undefined; partyBusy = false; if (!disposed) controls(); }
  }
  partyButton.addEventListener('click', () => { if (stars < 3) return; if (!yourParty && mode !== 'on-foot') { message('Step out of the car to host your party.'); return; } void partyRequest(!yourParty); });
  controls();
  return {
    element: openButton, root, hide, get isOpen() { return dialog.open; },
    setProfile(next: FundingProfile) { if (disposed) return; profile = next; stars = fundingRound(next.totalCents).stars; ensureCar(); drawSign(); controls(); },
    update(position: Point, nextMode: string, currentVehicleId: number, dt: number, connected = true, now = performance.now()) {
      if (disposed) return; foot = { ...position }; mode = nextMode; vehicleId = currentVehicleId;
      if (partyConnected !== connected) {
        partyConnected = connected;
        if (!connected) cancelPartyRequest?.();
        else lastPartyPoll = -Infinity;
        controls();
      }
      const template = carSlot.template;
      if (wantedCar && template && stars >= 1) {
        const base = mode === 'driver' ? options.fleet.cars.get(vehicleId) : car?.base;
        if (base && (!car || car.base !== base)) {
          restoreCar(); const model = template.createInstance(), hidden = base.model.root.children.filter(object => object instanceof LOD).map(object => ({ object, visible: object.visible }));
          for (const child of hidden) child.object.visible = false; base.model.root.add(model.root); car = { base, model, hidden };
        }
        if (car && options.fleet.cars.get(car.base.data.id) !== car.base) restoreCar();
        car?.model.update(dt, car.base.data.speedCmps / 100);
      }
      if (connected && profile && now - lastPartyPoll > PARTY_POLL_MS) { lastPartyPoll = now; void partyRequest(); }
      if (now - lastGroundCheck > 2000) {
        lastGroundCheck = now;
        if (sign) { let ancestor: Object3D = sign.host; while (ancestor.parent) ancestor = ancestor.parent; sign.mesh.visible = ancestor === options.scene; }
        for (const item of parties.values()) {
          const position = item.geometry.getAttribute('position'); let loaded = true;
          for (let index = 0; index < position.count; index++) {
            const y = options.surfaceHeightAt(item.party.anchor.x + position.getX(index), item.party.anchor.z + position.getZ(index));
            if (y === null) { loaded = false; break; } position.setY(index, y - item.party.anchor.y);
          }
          item.root.visible = loaded; if (loaded) { position.needsUpdate = true; item.geometry.computeBoundingSphere(); }
        }
      }
    },
    destroy() { if (disposed) return; disposed = true; cancelPartyRequest?.(); hide(); carSlot.destroy(); clearSign(); for (const id of parties.keys()) removeParty(id); partyMaterial.dispose(); root.removeFromParent(); dialog.remove(); openButton.remove(); },
  };
}
