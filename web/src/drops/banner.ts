import { flags } from '@gtasf/shared/flags';
import { formatCheque, type FundDropClaim, type LiveFundDrop } from '@gtasf/shared/drops';
import type { DropsClient } from './client';
import '../theme/saTheme.css';
import './banner.css';

function distanceLabel(metres: number): string {
  return metres < 950 ? `${Math.max(0, Math.round(metres / 10) * 10)} m` : `${(metres / 1000).toFixed(metres < 9500 ? 1 : 0)} km`;
}
function countdownLabel(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000)), m = Math.floor(total / 60), s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
function setText(element: HTMLElement, value: string) {
  if (element.textContent !== value) element.textContent = value;
}
function setHidden(element: HTMLElement, value: boolean) {
  if (element.hidden !== value) element.hidden = value;
}

/**
 * The "<Fund> announces a new fund — come pitch!" banner: live N/50 counter, close countdown,
 * and a direction+distance cue so the open drop is findable without a radar change. A one-shot
 * centre-screen toast celebrates a secured cheque.
 */
export function createDropBanner(options: { parent?: HTMLElement } = {}) {
  if (!flags.fundDrops) return null;
  const host = options.parent ?? document.body;
  const banner = document.createElement('div');
  banner.className = 'gt-drop-banner'; banner.hidden = true;
  banner.setAttribute('role', 'status'); banner.setAttribute('aria-live', 'polite');
  banner.dataset.vcDrop = ''; // Detection hook for tools/founder-path-smoke.mjs (VC fund drop step).
  const title = document.createElement('div'); title.className = 'gt-drop-title';
  const sub = document.createElement('div'); sub.className = 'gt-drop-sub';
  const count = document.createElement('span'); count.className = 'gt-drop-count';
  const timer = document.createElement('span'); timer.className = 'gt-drop-timer';
  const dir = document.createElement('span'); dir.className = 'gt-drop-dir';
  sub.append(count, timer, dir);
  const teaser = document.createElement('div'); teaser.className = 'gt-drop-teaser'; teaser.hidden = true;
  banner.append(title, sub, teaser); host.append(banner);

  const toast = document.createElement('div');
  toast.className = 'gt-drop-toast'; toast.setAttribute('role', 'status');
  const toastHead = document.createElement('div'); toastHead.className = 'gt-drop-toast-head';
  const toastAmount = document.createElement('div'); toastAmount.className = 'gt-drop-toast-amount';
  const toastSub = document.createElement('div'); toastSub.className = 'gt-drop-toast-sub';
  toast.append(toastHead, toastAmount, toastSub); host.append(toast);

  let disposed = false, toastTimer = 0, reservedHeight = -1;
  // Contextual onboarding hints share the top-centre band. Measure only when the
  // rendered banner changes size (name/teaser wrapping, viewport or visibility).
  const reserveSpace = () => {
    if (disposed) return;
    const height = banner.hidden ? 0 : Math.ceil(banner.getBoundingClientRect().height);
    if (height === reservedHeight) return;
    reservedHeight = height;
    document.body.style.setProperty('--gt-drop-banner-height', `${height}px`);
  };
  const sizeObserver = new ResizeObserver(reserveSpace);
  sizeObserver.observe(banner);
  return {
    element: banner, toastElement: toast,
    /** Call from the drops client's onClaim so a secured cheque is celebrated once. */
    celebrate(claim: FundDropClaim) {
      if (disposed || claim.position <= 0) return;
      toastHead.textContent = 'CHEQUE SECURED';
      toastAmount.textContent = formatCheque(claim.amountCents);
      toastSub.textContent = `#${claim.position} to pitch ${claim.fundName}`;
      toast.classList.add('gt-drop-toast-show');
      clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => toast.classList.remove('gt-drop-toast-show'), 4200);
    },
    update(client: DropsClient, now = Date.now()) {
      if (disposed) return;
      const near = client.nearest;
      const drop: LiveFundDrop | undefined = near?.drop ?? client.active[0];
      if (!drop) {
        if (!banner.hidden) { banner.hidden = true; reserveSpace(); }
        return;
      }
      setHidden(banner, false);
      const yours = drop.yourClaim && drop.yourClaim.position > 0 ? drop.yourClaim : null;
      const out = !yours && drop.remaining <= 0;
      banner.classList.toggle('gt-drop-claimed', Boolean(yours));
      banner.classList.toggle('gt-drop-closed', out);
      const headline = yours ? `✓ You pitched ${drop.fundName}`
        : out ? `${drop.fundName}: fund closed — all ${drop.capacity} cheques claimed`
        : drop.tagline;
      // Replacing identical text nodes still dirties the live DOM. Preserve the
      // normal per-frame state calculation, but write only changed values.
      const countClass = `gt-drop-count${drop.remaining <= 0 ? ' gt-drop-out' : drop.remaining <= 10 ? ' gt-drop-low' : ''}`;
      if (count.className !== countClass) count.className = countClass;
      setText(count, yours ? `Cheque #${yours.position}/${drop.capacity}`
        : `${drop.remaining}/${drop.capacity} cheque${drop.remaining === 1 ? '' : 's'} left`);
      setText(timer, `closes ${countdownLabel(drop.closesAt - now)}`);
      const direction = near && !yours && !out ? `${near.compass} · ${distanceLabel(near.distance)}` : '';
      setText(dir, direction); setHidden(dir, !direction);
      // When the next fund is within the lookahead (a rotation is imminent), tease where it lands.
      const next = client.state?.upcoming;
      const tease = next ? `Next: ${next.fundName} at ${next.location.label} in ${countdownLabel(next.opensAt - now)}` : '';
      setText(teaser, tease); setHidden(teaser, !tease);
      setText(title, headline);
    },
    destroy() {
      if (disposed) return; disposed = true; clearTimeout(toastTimer);
      sizeObserver.disconnect(); document.body.style.removeProperty('--gt-drop-banner-height');
      banner.remove(); toast.remove();
    },
  };
}
export type DropBanner = NonNullable<ReturnType<typeof createDropBanner>>;
