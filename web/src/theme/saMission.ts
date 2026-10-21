/**
 * GTASF onboarding SA UI kit (gtasf-ha2l, PLAN-onboarding.md pane-8 row).
 *
 * The shared San Andreas presentation layer the onboarding owner (pane 14) consumes. This file is
 * PRESENTATION ONLY — it owns no onboarding state, persistence, awards or flag checks. Pane 14 drives
 * it from the onboarding state machine (behind the `onboarding` flag) and the server-validated steps.
 *
 * Exports:
 *   - SaMissionBanner   — persistent objective block (step title + objective line + reward chip + dots)
 *   - saMissionStinger  — big centre one-shot ("MISSION PASSED" / "PRE-SEED CLOSED")
 *   - SaIntroSlides     — SA loading-screen intro overlay (poster frame, Skip, any-key/tap advance)
 *   - SaHintChips       — contextual hint chips (near-object key prompts, touch labels, idle nudges)
 *   - SaObjectiveArrow  — gold edge arrow that points at the current marker + shows distance
 *   - objectiveArrowLayout / advanceSlide — pure helpers (geometry + slide reducer), unit-tested
 *
 * SA look comes from theme/saMission.css (tokens from theme/saTheme.css). Import the CSS once at the
 * app entry if your bundler tree-shakes side-effect imports; this module imports it defensively.
 */
import './saMission.css';

/* ================================= Pure helpers (unit-tested) ================================= */

export interface Viewport { w: number; h: number }
export interface ArrowLayout {
  /** Where to anchor the arrow's centre, in screen px. */
  x: number;
  y: number;
  /** Rotation for an up-pointing triangle so it faces the target (CSS deg, clockwise). */
  angleDeg: number;
  /** True when the target lies within the viewport (pane 14 may hide the edge arrow and show a world marker). */
  onScreen: boolean;
}

/**
 * Lay out the gold objective arrow for a target at screen (targetX, targetY). When the target is
 * off-screen the arrow is clamped to an inset rectangle edge along the centre→target ray and rotated
 * to point at it; when on-screen it sits on the target. Pure (no DOM), so pane 14 can project a world
 * marker to screen and call this each frame.
 */
export function objectiveArrowLayout(targetX: number, targetY: number, view: Viewport, inset = 56): ArrowLayout {
  const w = Math.max(1, view.w), h = Math.max(1, view.h);
  const cx = w / 2, cy = h / 2;
  const dx = targetX - cx, dy = targetY - cy;
  // Up-pointing triangle faces (0,-1); rotate by the bearing from "up" to (dx,dy).
  const angleDeg = Math.atan2(dx, -dy) * (180 / Math.PI);
  const onScreen = targetX >= 0 && targetX <= w && targetY >= 0 && targetY <= h;
  if (onScreen) return { x: targetX, y: targetY, angleDeg, onScreen: true };
  const mx = Math.max(1, cx - inset), my = Math.max(1, cy - inset);
  let x = cx, y = cy;
  if (dx !== 0 || dy !== 0) {
    // Scale the ray to the nearest inset edge (whichever axis is hit first).
    const tx = dx !== 0 ? mx / Math.abs(dx) : Infinity;
    const ty = dy !== 0 ? my / Math.abs(dy) : Infinity;
    const t = Math.min(tx, ty);
    x = cx + dx * t;
    y = cy + dy * t;
  }
  return { x, y, angleDeg, onScreen: false };
}

export type SlideMood = 'day' | 'gold' | 'dusk';
/** San Andreas sky mood for the no-art intro poster fallback, cycled by slide index. Pure. */
export function slideMood(index: number): SlideMood {
  const moods: SlideMood[] = ['day', 'gold', 'dusk'];
  return moods[((Math.trunc(index) % 3) + 3) % 3]!;
}

export interface SlideAdvance { index: number; done: boolean }
/** Slide-advance reducer: step forward one slide; `done` once advanced past the last. Pure. */
export function advanceSlide(current: number, total: number): SlideAdvance {
  if (total <= 0) return { index: 0, done: true };
  const next = current + 1;
  if (next >= total) return { index: total - 1, done: true };
  return { index: Math.max(0, next), done: false };
}

/* ========================================= DOM helpers ========================================= */

function div(cls: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  return d;
}
/** rAF-guarded add of the `gt-sa-show` class so the opacity transition actually runs on first paint. */
function fadeIn(el: HTMLElement): void {
  el.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('gt-sa-show')));
}

/* ==================================== Mission objective banner ==================================== */

export interface MissionStep {
  /** Big pricedown-style line, e.g. "GET IN THE CAR". Uppercased by CSS. */
  title: string;
  /** Objective sub-line, e.g. "Drive through the Founder Orientation ring". */
  objective?: string;
  /** Pre-formatted reward string shown as a green SA-money chip, e.g. "+$5,000". */
  reward?: string;
  /** Tutorial progress; renders dots (index is 0-based). */
  step?: { index: number; total: number };
}

/** Persistent top-centre objective banner for a tutorial step. Never captures pointer input. */
export class SaMissionBanner {
  readonly el: HTMLElement;
  private readonly stepEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly objEl: HTMLElement;
  private readonly rewardEl: HTMLElement;
  private readonly dotsEl: HTMLElement;
  private hideTimer = 0;
  private readonly sizeObserver: ResizeObserver;
  private reservedHeight = 0;

  // Objective wrapping changes with the step and phone width. Keep the HUD
  // below the visible banner without adding a layout read to the game loop.
  private readonly reserveSpace = () => {
    const height = this.el.hidden ? 0 : this.el.getBoundingClientRect().height;
    const next = height > 0 ? Math.ceil(height) + 8 : 0;
    if (next === this.reservedHeight) return;
    this.reservedHeight = next;
    if (next) document.body.style.setProperty('--gt-sa-mission-height', `${next}px`);
    else document.body.style.removeProperty('--gt-sa-mission-height');
  };

  constructor(parent: HTMLElement = document.body) {
    this.el = div('gt-sa-mission');
    this.el.hidden = true;
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');
    this.stepEl = div('gt-sa-mission__step');
    this.titleEl = div('gt-sa-mission__title');
    this.objEl = div('gt-sa-mission__obj');
    this.rewardEl = div('gt-sa-mission__reward');
    this.dotsEl = div('gt-sa-mission__dots');
    this.el.append(this.stepEl, this.titleEl, this.objEl, this.rewardEl, this.dotsEl);
    parent.appendChild(this.el);
    this.sizeObserver = new ResizeObserver(this.reserveSpace);
    this.sizeObserver.observe(this.el);
  }

  setStep(step: MissionStep): void {
    this.titleEl.textContent = step.title;
    this.objEl.textContent = step.objective ?? '';
    this.objEl.hidden = !step.objective;
    this.rewardEl.textContent = step.reward ?? '';
    this.rewardEl.hidden = !step.reward;
    if (step.step && step.step.total > 0) {
      this.stepEl.textContent = `STEP ${Math.min(step.step.index + 1, step.step.total)} OF ${step.step.total}`;
      this.stepEl.hidden = false;
      this.renderDots(step.step.index, step.step.total);
      this.dotsEl.hidden = false;
    } else {
      this.stepEl.hidden = true;
      this.dotsEl.hidden = true;
    }
    this.show();
  }

  private renderDots(index: number, total: number): void {
    this.dotsEl.textContent = '';
    for (let i = 0; i < total; i++) {
      const dot = div(i <= index ? 'gt-sa-dot gt-sa-dot--on' : 'gt-sa-dot');
      this.dotsEl.appendChild(dot);
    }
  }

  show(): void {
    if (this.hideTimer) { clearTimeout(this.hideTimer); this.hideTimer = 0; }
    fadeIn(this.el);
  }

  hide(): void {
    this.el.classList.remove('gt-sa-show');
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => { this.el.hidden = true; this.hideTimer = 0; }, 220);
  }

  /** Clear the step and hide the banner. */
  clear(): void { this.hide(); }

  destroy(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.sizeObserver.disconnect();
    document.body.style.removeProperty('--gt-sa-mission-height');
    this.el.remove();
  }
}

/* ======================================= Mission stinger ======================================= */

export type StingerVariant = 'gold' | 'pass' | 'orange';
export interface StingerOptions {
  /** Smaller sub-line under the head. */
  sub?: string;
  /** Hold time before auto-dismiss (ms). Default 2200. Pass 0 to keep until dismiss(). */
  holdMs?: number;
  /** Colour: gold (default), green `pass` (MISSION PASSED), or orange. */
  variant?: StingerVariant;
  parent?: HTMLElement;
}
export interface StingerHandle { readonly el: HTMLElement; dismiss(): void }

/** Big centre one-shot title, e.g. `saMissionStinger('PRE-SEED CLOSED', { sub: '+$5,000', variant: 'pass' })`. */
export function saMissionStinger(text: string, opts: StingerOptions = {}): StingerHandle {
  const parent = opts.parent ?? document.body;
  const variant = opts.variant ?? 'gold';
  const el = div(`gt-sa-stinger gt-sa-stinger--${variant}`);
  el.setAttribute('role', 'status');
  const head = div('gt-sa-stinger__head');
  head.textContent = text;
  const sub = div('gt-sa-stinger__sub');
  sub.textContent = opts.sub ?? '';
  sub.hidden = !opts.sub;
  el.append(head, sub);
  parent.appendChild(el);
  fadeIn(el);
  let removeTimer = 0;
  let fadeTimer = 0;
  const dismiss = (): void => {
    if (!el.isConnected) return;
    el.classList.remove('gt-sa-show');
    if (fadeTimer) clearTimeout(fadeTimer);
    fadeTimer = window.setTimeout(() => el.remove(), 260);
  };
  const hold = opts.holdMs ?? 2200;
  if (hold > 0) removeTimer = window.setTimeout(dismiss, hold);
  return {
    el,
    dismiss: () => { if (removeTimer) clearTimeout(removeTimer); dismiss(); },
  };
}

/* ========================================= Intro slides ========================================= */

export interface ControlHint {
  /** Key-cap label(s), e.g. "W A S D", "SHIFT", "DRAG", "TAP". */
  keys: string;
  /** What it does, e.g. "Move", "Sprint", "Look around". */
  label: string;
}
export interface IntroSlide {
  title: string;
  /** Short kicker above the title, e.g. "SAN FRANCISCO · TECH WEEK". */
  kicker?: string;
  /** Body copy (shown when there are no control rows). */
  body?: string;
  /** Poster illustration (pane 9 art). Optional — the frame shows a graded gradient without it. */
  imageSrc?: string;
  imageAlt?: string;
  /** For the controls slide: render a grid of key-cap + label rows instead of body. */
  controls?: ControlHint[];
}
export interface IntroOptions {
  parent?: HTMLElement;
  /** Advanced past the last slide (also fires after the final tap). */
  onComplete?: () => void;
  /** Skip button pressed (or Escape). */
  onSkip?: () => void;
  /** Fired on each advance with the new 0-based index. */
  onAdvance?: (index: number) => void;
  /** Bottom hint text; default adapts to touch vs keyboard. */
  advanceHint?: string;
  skipLabel?: string;
}

/** SA loading-screen intro overlay: illustrated poster, persistent Skip, any-key/tap to advance. */
export class SaIntroSlides {
  readonly el: HTMLElement;
  private readonly frame: HTMLElement;
  private readonly img: HTMLImageElement;
  private readonly kickerEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly controlsEl: HTMLElement;
  private readonly dotsEl: HTMLElement;
  private readonly skipBtn: HTMLButtonElement;
  private readonly slides: IntroSlide[];
  private readonly opts: IntroOptions;
  private i = 0;
  private mounted = false;
  private readonly onKey: (e: KeyboardEvent) => void;
  private readonly onPointer: (e: Event) => void;

  constructor(slides: IntroSlide[], opts: IntroOptions = {}) {
    this.slides = slides.length ? slides : [{ title: '' }];
    this.opts = opts;
    this.el = div('gt-sa-intro');
    this.frame = div('gt-sa-intro__frame');
    this.img = document.createElement('img');
    this.img.className = 'gt-sa-intro__img';
    this.img.decoding = 'async';
    const scrim = div('gt-sa-intro__scrim');
    const text = div('gt-sa-intro__text');
    this.kickerEl = div('gt-sa-intro__kicker');
    this.titleEl = div('gt-sa-intro__title');
    this.bodyEl = div('gt-sa-intro__body');
    this.controlsEl = div('gt-sa-intro__controls');
    text.append(this.kickerEl, this.titleEl, this.bodyEl, this.controlsEl);
    this.dotsEl = div('gt-sa-intro__dots');
    const advance = div('gt-sa-intro__advance');
    const touch = typeof window !== 'undefined' && 'ontouchstart' in window;
    advance.textContent = opts.advanceHint ?? (touch ? 'Tap to continue' : 'Press any key to continue');
    this.skipBtn = document.createElement('button');
    this.skipBtn.type = 'button';
    this.skipBtn.className = 'gt-sa-intro__skip';
    this.skipBtn.textContent = opts.skipLabel ?? 'Skip';
    this.frame.append(this.img, scrim, text);
    this.el.append(this.frame, this.dotsEl, advance, this.skipBtn);

    this.onKey = (e: KeyboardEvent): void => {
      if (!this.mounted) return;
      if (e.key === 'Escape') { e.preventDefault(); this.skip(); return; }
      // Ignore bare modifier presses so a held Shift/Ctrl doesn't skip through slides.
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta' || e.key === 'Tab') return;
      e.preventDefault();
      this.next();
    };
    this.onPointer = (e: Event): void => {
      if (!this.mounted) return;
      if (e.target instanceof Node && this.skipBtn.contains(e.target)) return; // Skip handles itself.
      this.next();
    };
    this.skipBtn.addEventListener('click', (e) => { e.stopPropagation(); this.skip(); });
  }

  mount(parent: HTMLElement = this.opts.parent ?? document.body): this {
    if (this.mounted) return this;
    this.mounted = true;
    this.render();
    parent.appendChild(this.el);
    fadeIn(this.el);
    window.addEventListener('keydown', this.onKey, true);
    this.el.addEventListener('pointerdown', this.onPointer);
    return this;
  }

  get index(): number { return this.i; }

  go(index: number): void {
    this.i = Math.max(0, Math.min(this.slides.length - 1, index));
    this.render();
  }

  next(): void {
    const { index, done } = advanceSlide(this.i, this.slides.length);
    if (done) { this.complete(); return; }
    this.i = index;
    this.render();
    this.opts.onAdvance?.(this.i);
  }

  private skip(): void {
    this.opts.onSkip?.();
    this.destroy();
  }

  private complete(): void {
    this.opts.onComplete?.();
    this.destroy();
  }

  private render(): void {
    const s = this.slides[this.i];
    if (!s) return;
    this.frame.dataset.mood = slideMood(this.i); // SA sky grade for the no-art fallback
    if (s.imageSrc) { this.img.src = s.imageSrc; this.img.alt = s.imageAlt ?? ''; this.img.hidden = false; }
    else { this.img.removeAttribute('src'); this.img.hidden = true; }
    this.kickerEl.textContent = s.kicker ?? '';
    this.kickerEl.hidden = !s.kicker;
    this.titleEl.textContent = s.title;
    const hasControls = !!(s.controls && s.controls.length);
    this.bodyEl.textContent = s.body ?? '';
    this.bodyEl.hidden = hasControls || !s.body;
    this.controlsEl.hidden = !hasControls;
    if (hasControls) this.renderControls(s.controls!);
    this.renderDots();
  }

  private renderControls(controls: ControlHint[]): void {
    this.controlsEl.textContent = '';
    for (const c of controls) {
      const row = div('gt-sa-ctl');
      const keys = div('gt-sa-ctl__keys');
      keys.textContent = c.keys;
      const label = div('gt-sa-ctl__label');
      label.textContent = c.label;
      row.append(keys, label);
      this.controlsEl.appendChild(row);
    }
  }

  private renderDots(): void {
    this.dotsEl.textContent = '';
    if (this.slides.length < 2) return;
    for (let k = 0; k < this.slides.length; k++) {
      this.dotsEl.appendChild(div(k === this.i ? 'gt-sa-dot gt-sa-dot--on' : 'gt-sa-dot'));
    }
  }

  destroy(): void {
    if (!this.mounted) { this.el.remove(); return; }
    this.mounted = false;
    window.removeEventListener('keydown', this.onKey, true);
    this.el.removeEventListener('pointerdown', this.onPointer);
    this.el.classList.remove('gt-sa-show');
    window.setTimeout(() => this.el.remove(), 220);
  }
}

/* ========================================== Hint chips ========================================== */

export type HintVariant = 'prompt' | 'touch' | 'nudge';
export interface HintOptions {
  /** prompt = centre near-object key prompt (default); touch = positioned control label; nudge = idle. */
  variant?: HintVariant;
  /** Key-cap glyph for prompts, e.g. "E", "M", "T". Omit for a plain chip. */
  keyGlyph?: string;
  /** Auto-hide after this many ms. Omit/0 = sticky until hide(id). */
  timeoutMs?: number;
  /** For `touch`: absolute screen position (px) of the control to label. */
  anchor?: { x: number; y: number };
  parent?: HTMLElement;
}

interface Chip { el: HTMLElement; timer: number }

/** Contextual hint chips, keyed by id so each hint shows once and updates in place. */
export class SaHintChips {
  private readonly parent: HTMLElement;
  private readonly chips = new Map<string, Chip>();
  private nudgeObserver: ResizeObserver | undefined;
  private nudgeHeight = 0;

  // Phone controls start below the notice band. Reserve the hint's actual
  // wrapped height too; prompt/touch chips do not occupy that band.
  private readonly reserveNudgeSpace = () => {
    let height = 0;
    for (const { el } of this.chips.values()) {
      if (el.classList.contains('gt-sa-hint--nudge')) height = Math.max(height, el.getBoundingClientRect().height);
    }
    const next = height > 0 ? Math.ceil(height) + 8 : 0;
    if (next === this.nudgeHeight) return;
    this.nudgeHeight = next;
    if (next) document.body.style.setProperty('--gt-sa-nudge-height', `${next}px`);
    else document.body.style.removeProperty('--gt-sa-nudge-height');
  };

  constructor(parent: HTMLElement = document.body) { this.parent = parent; }

  /** Show or update a chip. Returns its element. */
  show(id: string, text: string, opts: HintOptions = {}): HTMLElement {
    const variant = opts.variant ?? 'prompt';
    let chip = this.chips.get(id);
    if (!chip) {
      const el = div(`gt-sa-hint gt-sa-hint--${variant}`);
      el.setAttribute('role', 'status');
      const key = div('gt-sa-hint__key');
      const label = div('gt-sa-hint__text');
      el.append(key, label);
      (opts.parent ?? this.parent).appendChild(el);
      chip = { el, timer: 0 };
      this.chips.set(id, chip);
      fadeIn(el);
    } else {
      chip.el.className = `gt-sa-hint gt-sa-hint--${variant} gt-sa-show`;
      if (chip.timer) { clearTimeout(chip.timer); chip.timer = 0; }
    }
    const keyEl = chip.el.firstElementChild as HTMLElement;
    const textEl = chip.el.lastElementChild as HTMLElement;
    keyEl.textContent = opts.keyGlyph ?? '';
    keyEl.hidden = !opts.keyGlyph;
    textEl.textContent = text;
    if (variant === 'nudge') {
      this.nudgeObserver ??= new ResizeObserver(this.reserveNudgeSpace);
      this.nudgeObserver.observe(chip.el);
    } else {
      this.nudgeObserver?.unobserve(chip.el);
      if (this.nudgeHeight) this.reserveNudgeSpace();
    }
    if (variant === 'touch' && opts.anchor) {
      chip.el.style.left = `${opts.anchor.x}px`;
      chip.el.style.top = `${opts.anchor.y}px`;
    }
    if (opts.timeoutMs && opts.timeoutMs > 0) {
      chip.timer = window.setTimeout(() => this.hide(id), opts.timeoutMs);
    }
    return chip.el;
  }

  hide(id: string): void {
    const chip = this.chips.get(id);
    if (!chip) return;
    if (chip.timer) clearTimeout(chip.timer);
    chip.el.classList.remove('gt-sa-show');
    const el = chip.el;
    window.setTimeout(() => el.remove(), 200);
    this.chips.delete(id);
    this.nudgeObserver?.unobserve(el);
    if (this.nudgeHeight) this.reserveNudgeSpace();
  }

  has(id: string): boolean { return this.chips.has(id); }

  clear(): void { for (const id of [...this.chips.keys()]) this.hide(id); }

  destroy(): void {
    for (const chip of this.chips.values()) { if (chip.timer) clearTimeout(chip.timer); chip.el.remove(); }
    this.chips.clear();
    this.nudgeObserver?.disconnect();
    document.body.style.removeProperty('--gt-sa-nudge-height');
    this.nudgeHeight = 0;
  }
}

/* ======================================= Gold objective arrow ======================================= */

export interface ArrowUpdate {
  /** Distance to the objective in metres; rendered as "120 M" under the arrow. Omit to hide the label. */
  distanceM?: number;
  /** Force-hide when the caller knows the marker is on-screen and shows a world beacon instead. */
  hideWhenOnScreen?: boolean;
}

/** Gold edge arrow that points at the current objective. Pane 14 projects a world marker to screen px. */
export class SaObjectiveArrow {
  readonly el: HTMLElement;
  private readonly tri: HTMLElement;
  private readonly dist: HTMLElement;

  constructor(parent: HTMLElement = document.body) {
    this.el = div('gt-sa-arrow');
    this.el.hidden = true;
    this.tri = div('gt-sa-arrow__tri');
    this.dist = div('gt-sa-arrow__dist');
    this.el.append(this.tri, this.dist);
    parent.appendChild(this.el);
  }

  /** Point at a target in screen px; `view` is the current viewport size. */
  update(targetXpx: number, targetYpx: number, view: Viewport, opts: ArrowUpdate = {}): void {
    const layout = objectiveArrowLayout(targetXpx, targetYpx, view);
    if (layout.onScreen && opts.hideWhenOnScreen) { this.hide(); return; }
    this.el.style.transform = `translate(${Math.round(layout.x)}px, ${Math.round(layout.y)}px) translate(-50%, -50%)`;
    this.tri.style.transform = `rotate(${layout.angleDeg.toFixed(1)}deg)`;
    if (opts.distanceM !== undefined && Number.isFinite(opts.distanceM)) {
      this.dist.textContent = `${Math.max(0, Math.round(opts.distanceM))} M`;
      this.dist.hidden = false;
    } else {
      this.dist.hidden = true;
    }
    this.show();
  }

  show(): void { fadeIn(this.el); }

  hide(): void {
    this.el.classList.remove('gt-sa-show');
    const el = this.el;
    window.setTimeout(() => { if (!el.classList.contains('gt-sa-show')) el.hidden = true; }, 180);
  }

  destroy(): void { this.el.remove(); }
}
