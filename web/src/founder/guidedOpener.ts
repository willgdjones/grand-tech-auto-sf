/**
 * Guided GTA-style opener (flag guidedOpener, gtasf-dzrrn; plan velvety-tickling-ripple item 2). A ~20 s, skippable,
 * three-step first mission for a device that has not seen it yet (new devices, and once for returning devices —
 * localStorage OPENER_KEY):
 *
 *   1. MOVE   — the Pear VC partner rings (text-only call: portrait + subtitles, no audio) while the banner says how to walk.
 *   2. CAR    — the nearest drivable car is highlighted (GPS beam + minimap waypoint + an "E" key cap over it).
 *   3. DRIVE  — GPS to the partner, who now waits ~370 m down the Embarcadero (FOUNDER_OPENER_ANGEL); an E key cap
 *               floats over them. Arriving hands back to the founder-ladder walk-up pitch.
 *
 * Client-only, DOM + two sprites. It owns no money path: the pitch that follows is the existing ladder pitch.
 */
import { CanvasTexture, LinearFilter, SRGBColorSpace, Sprite, SpriteMaterial, type Object3D } from 'three';
import './guidedOpener.css';

export const OPENER_KEY = 'gtasf.opener.v1';
/** Arriving within this many metres of the partner completes the drive (a car at the kerb counts). */
export const OPENER_ARRIVE_M = 28;
/** Walking this far from where the opener started completes the move step. */
const MOVE_DONE_M = 4;
const CALL_LINE_MS = 2900;

export function openerPending(): boolean {
  try { return localStorage.getItem(OPENER_KEY) === null; } catch { return false; } // no storage → never nag
}
export function markOpenerDone(how: 'done' | 'skipped'): void {
  try { localStorage.setItem(OPENER_KEY, how); } catch { /* best effort */ }
}

export type OpenerStep = 'call' | 'move' | 'car' | 'drive' | 'arrived' | 'skipped';
export type OpenerMode = 'on-foot' | 'driver' | 'passenger';

export interface GuidedOpenerDeps {
  parent?: HTMLElement;
  /** Where the key-cap sprites live (the scene or a landmarks group). */
  root: Object3D;
  isTouch: boolean;
  /** The player's position (the car's when driving) and mode, read every update. */
  player(): { x: number; y: number; z: number; mode: OpenerMode };
  /** Drivable, unoccupied cars near the player (world metres). */
  cars(): Iterable<{ id: number; x: number; y: number; z: number }>;
  /** Where the partner stands (resolved NPC position or its geodetic anchor), or null before the map is ready. */
  partner(): { x: number; y?: number; z: number } | null;
  /** Point the GPS (minimap route + world beam) at a place, or clear it. */
  route(dest: { x: number; z: number; title: string } | null): void;
  /** Ground height for placing the key caps. */
  heightAt?(x: number, z: number): number | null;
  /** After arrival the partner keeps an E key cap while this is true (the pitch is still open). */
  partnerActive?(): boolean;
  partnerFirm: string;
  startupName?(): string | undefined;
  onStep?(step: OpenerStep): void;
}

export interface GuidedOpener {
  readonly running: boolean;
  /** Run the opener. `onDone` fires once: 'arrived' at the partner, or 'skipped'. */
  start(onDone: (how: 'arrived' | 'skipped') => void): void;
  /** Per frame. */
  update(now: number): void;
  destroy(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.className = className; if (text) node.textContent = text; return node;
}

/** A drawn (not photographic, not a real person) portrait of "a partner" — blazer, open collar, pear pin. */
const PORTRAIT_SVG = `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="gto-bg" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#2d5a46"/><stop offset="1" stop-color="#10221a"/></linearGradient></defs>
<rect width="64" height="64" rx="14" fill="url(#gto-bg)"/>
<path d="M10 64c2-13 10-19 22-19s20 6 22 19z" fill="#26313a"/><path d="M26 45l6 9 6-9z" fill="#f2efe6"/>
<path d="M29 46l3 6 3-6z" fill="#c9d6de"/><circle cx="44" cy="54" r="2.4" fill="#9bd36a"/>
<rect x="28" y="36" width="8" height="10" rx="3" fill="#c98f6b"/><ellipse cx="32" cy="27" rx="11" ry="13" fill="#d9a07a"/>
<path d="M20 25c0-10 6-15 12-15s13 4 12 15c-2-5-6-8-12-8s-10 3-12 8z" fill="#3a2a22"/>
<circle cx="27.5" cy="28" r="1.4" fill="#1b1b1b"/><circle cx="36.5" cy="28" r="1.4" fill="#1b1b1b"/>
<path d="M28 34c2.4 1.8 5.6 1.8 8 0" stroke="#7a3f2c" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>`;

/** "E" (or a tap glyph on touch) key cap floating in the world over the thing to interact with. */
function keyCapSprite(label: string): Sprite {
  const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 160;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#000a'; ctx.beginPath(); ctx.roundRect(14, 18, 100, 100, 18); ctx.fill();
    ctx.fillStyle = '#f6edda'; ctx.beginPath(); ctx.roundRect(10, 8, 100, 100, 18); ctx.fill();
    ctx.strokeStyle = '#f0b429'; ctx.lineWidth = 6; ctx.beginPath(); ctx.roundRect(10, 8, 100, 100, 18); ctx.stroke();
    ctx.fillStyle = '#10221a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = label.length > 3 ? '900 26px Arial, sans-serif' : label.length > 1 ? '900 30px Arial, sans-serif' : '900 66px Arial, sans-serif';
    ctx.fillText(label, 60, 60);
    ctx.fillStyle = '#f0b429'; ctx.beginPath(); ctx.moveTo(44, 120); ctx.lineTo(76, 120); ctx.lineTo(60, 150); ctx.closePath(); ctx.fill();
  }
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace; texture.magFilter = LinearFilter;
  // depthTest off: a guide marker reads through the car roof / a tree, like GTA's blips.
  const sprite = new Sprite(new SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
  sprite.scale.set(0.9, 1.125, 1); sprite.renderOrder = 20; sprite.visible = false; sprite.name = 'Guided opener key cap';
  return sprite;
}

export function createGuidedOpener(deps: GuidedOpenerDeps): GuidedOpener {
  const parent = deps.parent ?? document.body;
  const key = deps.isTouch ? 'Enter / exit' : 'E';

  // Phone call (top-right): portrait, caller, typed subtitles. Auto-answered, no audio.
  const call = el('section', 'gt-opener-call'); call.hidden = true;
  call.setAttribute('role', 'status'); call.setAttribute('aria-live', 'polite');
  const portrait = el('div', 'gt-opener-call-portrait'); portrait.innerHTML = PORTRAIT_SVG;
  const callText = el('div', 'gt-opener-call-text');
  const callWho = el('div', 'gt-opener-call-who', `📱 A partner · ${deps.partnerFirm}`);
  const callLine = el('p', 'gt-opener-call-line');
  callText.append(callWho, callLine); call.append(portrait, callText);

  // Objective banner (lower-centre, big text) + Skip.
  const banner = el('section', 'gt-opener-banner'); banner.hidden = true; banner.setAttribute('aria-live', 'polite');
  const kicker = el('div', 'gt-opener-banner-kicker', 'FIRST MEETING');
  const objective = el('div', 'gt-opener-banner-objective');
  const sub = el('div', 'gt-opener-banner-sub');
  const skip = el('button', 'gt-opener-skip', 'Skip tutorial'); skip.type = 'button';
  banner.append(kicker, objective, sub, skip);
  parent.append(call, banner);

  // Touch: the cap names the button to press (critic: a bare 'TAP' over the car read as 'tap the nearest button', which was
  // HOST A STREET RACE). The ENTER / EXIT button itself pulses during the car step (guidedOpener.css).
  const carCap = keyCapSprite(deps.isTouch ? 'ENTER' : 'E'), partnerCap = keyCapSprite(deps.isTouch ? 'ENTER' : 'E');
  /** body[data-opener-step] while the opener runs: guidedOpener.css hides the race/paint buttons and the controls panel
   *  (critic: six HUD layers at once on a phone) and pulses ENTER / EXIT on the car step. */
  const markStep = (value: OpenerStep | null) => {
    if (typeof document === 'undefined') return;
    if (value) document.body.dataset.openerStep = value; else delete document.body.dataset.openerStep;
  };
  deps.root.add(carCap, partnerCap);

  let running = false, disposed = false, step: OpenerStep = 'call';
  let done: ((how: 'arrived' | 'skipped') => void) | undefined;
  let origin = { x: 0, z: 0 }, target: { id: number; x: number; y: number; z: number } | null = null, lastCarScan = 0;
  let callTimer: ReturnType<typeof setTimeout> | undefined;
  let routedTo = '';

  const firm = deps.partnerFirm;
  const lines = () => [
    `Hey — saw ${deps.startupName?.() || 'your startup'} up on that billboard. I like it.`,
    `I'm down the Embarcadero by Mission Street. Grab one of those cars and come pitch me.`,
    `Don't keep me waiting. I've got fifteen minutes.`,
  ];

  /** Objective text: plain text with [key] segments rendered as key caps. */
  function setObjective(text: string, detail = ''): void {
    objective.replaceChildren();
    for (const part of text.split(/(\[[^\]]+\])/)) {
      if (!part) continue;
      if (part.startsWith('[')) objective.append(el('kbd', 'gt-opener-key', part.slice(1, -1)));
      else objective.append(document.createTextNode(part));
    }
    sub.textContent = detail; sub.hidden = !detail;
  }
  function enter(next: OpenerStep): void {
    if (step === next) return;
    step = next; deps.onStep?.(next); markStep(next);
    if (next === 'move') setObjective(deps.isTouch ? 'Walk with the [stick]' : 'Walk with [W][A][S][D]', deps.isTouch ? 'Drag the screen to look around.' : 'Hold Shift to run · move the mouse to look.');
    if (next === 'car') { target = null; lastCarScan = 0; setObjective(`Get in the highlighted car — [${key}]`, 'Follow the yellow beam.'); }
    if (next === 'drive') {
      carCap.visible = false;
      setObjective(`Drive to the ${firm} partner`, deps.isTouch ? 'GO / BRAKE to drive · follow the GPS.' : 'W gas · S brake · A/D steer · Space handbrake. Follow the GPS.');
    }
  }
  function routeTo(id: string, dest: { x: number; z: number; title: string } | null): void {
    if (routedTo === id) return; routedTo = id; deps.route(dest);
  }
  function placeCap(cap: Sprite, p: { x: number; y?: number; z: number }, lift: number, now: number): void {
    const ground = p.y ?? deps.heightAt?.(p.x, p.z) ?? 0;
    cap.position.set(p.x, ground + lift + Math.sin(now / 320) * 0.12, p.z); cap.visible = true;
  }
  function finish(how: 'arrived' | 'skipped'): void {
    if (!running) return;
    running = false; carCap.visible = false; partnerCap.visible = false; markStep(null);
    if (callTimer) clearTimeout(callTimer); call.hidden = true;
    markOpenerDone(how === 'arrived' ? 'done' : 'skipped');
    if (how === 'arrived') {
      step = 'arrived'; deps.onStep?.('arrived'); routeTo('', null);
      // The ladder's quest card carries the walk-up line from here (two big cards would stack on a phone).
      banner.hidden = true;
    } else { step = 'skipped'; deps.onStep?.('skipped'); banner.hidden = true; routeTo('', null); }
    const cb = done; done = undefined; cb?.(how);
  }
  skip.addEventListener('click', () => finish('skipped'));

  let script: string[] = [];
  function playCall(i = 0): void {
    if (!running || disposed) return;
    if (i >= script.length) { call.classList.add('gt-opener-call--ended'); callTimer = setTimeout(() => { call.hidden = true; }, 900); return; }
    callLine.textContent = `“${script[i]}”`;
    callTimer = setTimeout(() => playCall(i + 1), CALL_LINE_MS + script[i]!.length * 12);
  }

  return {
    get running() { return running; },
    start(onDone) {
      if (running || disposed) return;
      running = true; done = onDone; step = 'call'; markStep('call');
      const p = deps.player(); origin = { x: p.x, z: p.z };
      call.hidden = false; call.classList.remove('gt-opener-call--ended'); banner.hidden = false; skip.hidden = false;
      deps.onStep?.('call'); script = lines(); playCall();
      enter(p.mode === 'on-foot' ? 'move' : 'drive');
    },
    update(now) {
      if (disposed) return;
      if (!running) {
        // Arrived: keep the E over the partner while the walk-up pitch is still open and they're close.
        const partner = step === 'arrived' ? deps.partner() : null, p = partner ? deps.player() : null;
        if (partner && p && p.mode === 'on-foot' && deps.partnerActive?.() && Math.hypot(p.x - partner.x, p.z - partner.z) < 60) placeCap(partnerCap, partner, 3.4, now);
        else partnerCap.visible = false;
        return;
      }
      const p = deps.player();
      if (step === 'move') {
        if (p.mode !== 'on-foot') enter('drive');
        else if (Math.hypot(p.x - origin.x, p.z - origin.z) >= MOVE_DONE_M) enter('car');
      }
      if (step === 'car') {
        if (p.mode !== 'on-foot') { enter('drive'); }
        else {
          // Re-pick the nearest free car twice a second (the highlighted one can be taken or despawn).
          if (now - lastCarScan > 500 || !target) {
            lastCarScan = now;
            let best: typeof target = null, bestD = Infinity, same: typeof target = null;
            for (const car of deps.cars()) {
              const d = Math.hypot(car.x - p.x, car.z - p.z);
              if (d < bestD) { best = car; bestD = d; }
              if (car.id === target?.id) same = car;
            }
            // Keep the highlighted car unless it's gone/taken or another free car is clearly nearer (no flicker).
            target = same && !(best && bestD + 5 < Math.hypot(same.x - p.x, same.z - p.z)) ? same : best;
          }
          if (target) { placeCap(carCap, target, 2.35, now); routeTo(`car:${target.id}`, { x: target.x, z: target.z, title: 'Your car' }); }
          else carCap.visible = false;
        }
      }
      const partner = deps.partner();
      // Walking all the way there (no free car nearby, or the player just prefers it) also counts.
      if (step === 'car' && partner && Math.hypot(p.x - partner.x, p.z - partner.z) <= OPENER_ARRIVE_M) { finish('arrived'); return; }
      if (step === 'drive' && partner) {
        routeTo('partner', { x: partner.x, z: partner.z, title: firm });
        const d = Math.hypot(p.x - partner.x, p.z - partner.z);
        sub.textContent = `${Math.round(d)} m · ${deps.isTouch ? 'GO / BRAKE to drive.' : 'W gas · S brake · A/D steer · Space handbrake.'}`;
        if (d <= OPENER_ARRIVE_M) { finish('arrived'); return; }
      }
      if (step === 'drive' && partner && Math.hypot(p.x - partner.x, p.z - partner.z) < 140) placeCap(partnerCap, partner, 3.4, now);
      else partnerCap.visible = false;
    },
    destroy() {
      if (disposed) return; disposed = true; running = false; markStep(null);
      if (callTimer) clearTimeout(callTimer);
      call.remove(); banner.remove();
      for (const cap of [carCap, partnerCap]) { cap.removeFromParent(); cap.material.map?.dispose(); cap.material.dispose(); }
    },
  };
}
