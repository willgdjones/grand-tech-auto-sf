/**
 * Founder-ladder share card (PLAN step 4: "An image of your billboard in SF + a gtasf.com link that
 * spawns the visitor in front of it"). A <dialog> showing a generated share image (the startup's
 * lettermark + name on a stylised SF billboard, drawn to a canvas) and a one-tap copy of a gtasf.com
 * deep link that spawns a visitor in front of the billboard (reuses ?at= via the caller's copyLink).
 */
import { lettermark } from './logo';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.className = className; if (text) node.textContent = text; return node;
}

export interface ShareCardOptions {
  parent?: HTMLElement;
  name: string;
  /** Copy a gtasf.com deep link to the clipboard and resolve with the copied link (caller owns ?at=). */
  copyLink(): Promise<string>;
  /**
   * Resolve a (referral-wrapped) gtasf.com deep link WITHOUT touching the clipboard, used to pre-fill
   * the "Share on X" compose-intent href. Omit to hide the X button. The PLAYER posts from their own
   * account via x.com/intent — we never post on their behalf.
   */
  shareUrl?(): Promise<string>;
  /** Called when the card is dismissed (Done). */
  onClose?(): void;
  /** The real in-world billboard render (dataURL) captured in-game; falls back to a drawn billboard. */
  imageUrl?: string | null;
}

export interface ShareCard {
  readonly element: HTMLDialogElement;
  readonly isOpen: boolean;
  show(): void;
  destroy(): void;
}

/** Draw the startup on a stylised SF billboard into the canvas (the shareable "image of your billboard"). */
function paintShareImage(canvas: HTMLCanvasElement, name: string): void {
  const W = 1200, H = 630;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const mark = lettermark(name);
  // Dusk SF sky.
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#2a3f5c'); sky.addColorStop(0.55, '#16233a'); sky.addColorStop(1, '#0b1422');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
  // A faint skyline silhouette along the lower third.
  ctx.fillStyle = '#0a1320';
  for (let x = 0, i = 0; x < W; x += 54, i++) {
    const h = 60 + ((i * 97) % 110);
    ctx.fillRect(x, H - 150 - h, 46, h + 150);
  }
  // Billboard panel.
  const bx = 150, by = 90, bw = W - 300, bh = 340, r = 18;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 18;
  ctx.fillStyle = '#12201a';
  ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, r); ctx.fill();
  ctx.restore();
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.12)';
  ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, r); ctx.stroke();
  // Billboard support posts.
  ctx.fillStyle = '#0c1813';
  ctx.fillRect(bx + 70, by + bh, 26, 150); ctx.fillRect(bx + bw - 96, by + bh, 26, 150);
  // Lettermark badge.
  const badge = 150, bgx = bx + 54, bgy = by + (bh - badge) / 2;
  ctx.fillStyle = mark.bg;
  ctx.beginPath(); ctx.roundRect(bgx, bgy, badge, badge, 32); ctx.fill();
  ctx.fillStyle = mark.fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `900 76px Haettenschweiler, 'Arial Narrow Bold', Impact, sans-serif`;
  ctx.fillText(mark.initials, bgx + badge / 2, bgy + badge / 2 + 4);
  // Startup name + tagline.
  const tx = bgx + badge + 46;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#fffbe9';
  ctx.font = `900 ${name.length > 18 ? 62 : 78}px Haettenschweiler, 'Arial Narrow Bold', Impact, sans-serif`;
  ctx.fillText(name.toUpperCase(), tx, by + 150, bw - badge - 130);
  ctx.fillStyle = '#f0b429';
  ctx.font = `700 26px Arial, sans-serif`;
  ctx.fillText('LIVE ON A BILLBOARD IN SAN FRANCISCO', tx, by + 210);
  // Footer wordmark.
  ctx.fillStyle = '#f6edda'; ctx.textAlign = 'center';
  ctx.font = `900 34px Haettenschweiler, 'Arial Narrow Bold', Impact, sans-serif`;
  ctx.fillText('GTASF.COM', W / 2, H - 46);
}

/**
 * Build an x.com compose-intent URL that opens X's own composer pre-filled with the player's boast +
 * their deep link. This opens the player's own composer in a new tab; the player chooses to post. We
 * never post on their behalf (same pattern as the GTM organiser card).
 */
function tweetIntent(name: string, shareLink: string): string {
  const intent = new URL('https://x.com/intent/post');
  intent.searchParams.set('text', `I just founded ${name} in Grand Tech Auto: San Francisco — it's live on a billboard in SF. Come see it 👇`);
  intent.searchParams.set('url', shareLink);
  return intent.href;
}

export function createShareCard(options: ShareCardOptions): ShareCard {
  const parent = options.parent ?? document.body;
  const dialog = el('dialog', 'gt-founder-share');
  dialog.setAttribute('aria-labelledby', 'gt-founder-share-title');
  const title = el('h2', 'gt-founder-share-title', 'Your billboard is up'); title.id = 'gt-founder-share-title';
  // Prefer the real in-world billboard render captured in-game; fall back to a drawn billboard.
  const image: HTMLCanvasElement | HTMLImageElement = options.imageUrl
    ? Object.assign(el('img', 'gt-founder-share-image'), { src: options.imageUrl, alt: `${options.name} on a billboard in San Francisco` })
    : el('canvas', 'gt-founder-share-image');
  const link = el('input', 'gt-founder-share-link'); link.readOnly = true; link.value = 'gtasf.com/…';
  const actions = el('div', 'gt-founder-share-actions');
  const copy = el('button', 'gt-founder-share-copy', 'Copy share link'); copy.type = 'button';
  // Compose-intent anchor: the player posts from their own X account; we never post for them. Hidden
  // until its href is resolved (pre-fetched on show) so a click always carries the real deep link.
  const tweet = el('a', 'gt-founder-share-x', 'Share on X');
  tweet.target = '_blank'; tweet.rel = 'noopener noreferrer'; tweet.hidden = true;
  const done = el('button', 'gt-founder-share-done', 'Done'); done.type = 'button';
  const status = el('p', 'gt-founder-share-status'); status.setAttribute('role', 'status');
  actions.append(copy); // Copy · [Share on X] · Done
  if (options.shareUrl) actions.append(tweet);
  actions.append(done);
  dialog.append(
    el('div', 'gt-founder-share-kicker', 'SHARE YOUR STARTUP'),
    title, image, link, actions, status,
  );
  parent.append(dialog);
  if (image instanceof HTMLCanvasElement) paintShareImage(image, options.name);

  let disposed = false, copying = false;
  function close(): void { if (dialog.open) dialog.close(); options.onClose?.(); }
  copy.addEventListener('click', async () => {
    if (copying || disposed) return;
    copying = true; copy.disabled = true; status.textContent = 'Copying your link…';
    try {
      const url = await options.copyLink();
      if (!disposed) { link.value = url; status.textContent = 'Link copied — share it anywhere.'; }
    } catch (error) {
      if (!disposed) status.textContent = error instanceof Error ? error.message : 'Could not copy the link.';
    } finally { copying = false; if (!disposed) copy.disabled = false; }
  });
  done.addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });

  // Pre-fetch the deep link once so the X anchor's href is set synchronously before any click
  // (a click handler that awaits would be treated as a popup and blocked by the browser).
  let fetchedShareUrl = false;
  async function prepareTweet(): Promise<void> {
    if (fetchedShareUrl || !options.shareUrl) return;
    fetchedShareUrl = true;
    try {
      const url = await options.shareUrl();
      if (!disposed) tweet.href = tweetIntent(options.name, url);
      if (!disposed) tweet.hidden = false;
    } catch { fetchedShareUrl = false; /* leave the X button hidden; Copy still works */ }
  }

  return {
    element: dialog,
    get isOpen() { return dialog.open; },
    show() {
      if (disposed || dialog.open) return;
      void prepareTweet();
      dialog.showModal(); copy.focus({ preventScroll: true });
    },
    destroy() { if (disposed) return; disposed = true; if (dialog.open) dialog.close(); dialog.remove(); },
  };
}
