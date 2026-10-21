import { analyticsContext, track } from '../analytics';
import { createOutbidReceiptTracker, rememberOutbidCheckout } from './analyticsReceipt';
import { flags } from '@gtasf/shared/flags';
import { referralShareUrl } from '../referrals/client';
import { formatOutbidMoney, isOutbidSnapshot, outbidAmountToLead, outbidCents, safeOutbidLink,
  OUTBID_MAXIMUM_BID_CENTS, type OutbidSnapshot, type OutbidViewer, type OutbidCheckoutRequest } from '@gtasf/shared/outbid';
import './outbid.css';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = '') {
  const node = document.createElement(tag); node.className = className; node.textContent = text; return node;
}
function button(text: string, className = '') { const node = el('button', className, text); node.type = 'button'; return node; }
function link(text: string, href: string) { const node = el('a', '', text); node.href = href; node.target = '_blank'; node.rel = 'noopener noreferrer sponsored'; return node; }
function centsFromInput(value: string): number | null {
  if (!/^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/.test(value)) return null;
  const [dollars, fraction = ''] = value.split('.');
  const cents = BigInt(dollars!) * 100n + BigInt(fraction.padEnd(2, '0'));
  return cents >= 100n && cents <= BigInt(OUTBID_MAXIMUM_BID_CENTS) ? Number(cents) : null;
}

/** Event-driven DOM only. The existing WorldDO connection supplies setSnapshot. */
export function createOutbidPanel(options: { parent?: HTMLElement; onModalChange?(open: boolean): void; onSnapshot?(snapshot: OutbidSnapshot): void } = {}) {
  if (!flags.outbidBanner) return null;
  const receipts = createOutbidReceiptTracker();
  const parent = options.parent ?? document.body;
  const banner = el('section', 'gt-outbid-banner'); banner.setAttribute('aria-label', 'Outbid city sponsor');
  const badge = el('span', 'gt-outbid-badge', 'OUTBID'), winner = el('div', 'gt-outbid-winner');
  const name = el('div', 'gt-outbid-name', 'Loading the leaderboard…'), message = el('div', 'gt-outbid-message', 'Confirmed bid totals will appear here.');
  winner.append(name, message);
  const target = el('span', 'gt-outbid-target', 'Bids from $1'), claim = button('OUTBID THEM', 'gt-outbid-claim'), showBoard = button(flags.hud ? 'Outbid' : 'Top 50', 'gt-outbid-board-button');
  banner.append(badge, winner, target, claim, showBoard);
  const dialog = el('dialog', 'gt-outbid-dialog'); dialog.setAttribute('aria-labelledby', 'gt-outbid-title');
  const close = button('Close ×', 'gt-outbid-close'); close.setAttribute('aria-label', 'Close Outbid');
  const heading = el('h2', '', 'Outbid San Francisco'); heading.id = 'gt-outbid-title';
  const mode = el('p', 'gt-outbid-mode', 'Loading confirmed totals…');
  const rules = el('p', 'gt-outbid-rules', 'Your confirmed payments add up. The highest total owns the top banner and Salesforce Tower crown. Minimum bid $1. Someone else can outbid you at any time.');
  const shareCrown = button('Share my Salesforce crown', 'gt-outbid-board-button'); shareCrown.hidden = true;
  const board = el('ol', 'gt-outbid-board'); board.setAttribute('aria-label', 'Top 50 paid bidders');
  const empty = el('p', 'gt-outbid-empty', 'Fetching the confirmed leaderboard…');
  const form = el('form', 'gt-outbid-form');
  const formHeading = el('h3', '', 'Make your bid'), quote = el('p', 'gt-outbid-quote');
  function field(label: string, kind: 'input' | 'textarea', maximum: number) {
    const wrapper = el('label', 'gt-outbid-field', label), input = kind === 'textarea' ? document.createElement('textarea') : document.createElement('input');
    input.required = true; input.maxLength = maximum; wrapper.append(input); form.append(wrapper); return input;
  }
  form.append(formHeading, quote);
  const bidderName = field('Name or company', 'input', 48); bidderName.autocomplete = 'organization';
  const bidMessage = field('Short message', 'textarea', 140);
  const bidLink = field('Website or profile URL', 'input', 2048) as HTMLInputElement; bidLink.type = 'url'; bidLink.placeholder = 'https://';
  const amount = field('Add to your total · USD', 'input', 9) as HTMLInputElement; amount.inputMode = 'decimal'; amount.value = '1.00';
  const creditLabel = el('label', 'gt-outbid-credit'), useCredit = el('input', ''); useCredit.type = 'checkbox';
  creditLabel.append(useCredit, document.createTextNode('Use available referral credit'));
  const creditQuote = el('p', 'gt-outbid-credit-quote'); creditQuote.setAttribute('aria-live', 'polite');
  if (flags.referrals && flags.referralCredit) form.append(creditLabel, creditQuote);
  const logoLabel = el('label', 'gt-outbid-field', 'Logo · optional, subject to ad approval');
  const logo = el('input', ''); logo.type = 'file'; logo.accept = 'image/png,image/jpeg,image/webp'; logoLabel.append(logo); form.append(logoLabel);
  logo.disabled = !flags.moderation;
  const notice = el('p', 'gt-outbid-notice', 'Text and links are checked before Checkout. Logos appear only after approval.');
  if (!flags.moderation) notice.textContent = 'Text and links are checked before Checkout. Logo uploads are not available yet.';
  const status = el('p', 'gt-outbid-status'); status.setAttribute('role', 'status');
  const submit = el('button', 'gt-outbid-submit', 'Continue to test Checkout'); submit.type = 'submit';
  form.append(notice, status, submit); dialog.append(close, heading, mode, rules, shareCrown, board, empty, form);
  parent.append(banner, dialog); document.body.classList.add('gt-outbid-active');
  let snapshot: OutbidSnapshot | undefined, viewer: OutbidViewer | undefined, lastState = '', disposed = false, pending = false;
  let announcedOpen = false, refreshing: Promise<void> | undefined, refreshAgain = false;
  let requestKey = '', requestBody = '', uploadedLogo: { file: File; assetId: string } | undefined;
  let credit: { grossCents: number; creditCents: number; cashCents: number } | undefined, creditLoading = false, quoteGeneration = 0;
  let amountEdited = false;
  const controller = new AbortController();
  let winnerLink: HTMLAnchorElement | undefined;
  const rows = new Map<string, { row: HTMLLIElement; rank: HTMLSpanElement; title: HTMLAnchorElement;
    message: HTMLParagraphElement; total: HTMLElement; logo?: HTMLImageElement }>();

  function availability() {
    const ready = flags.outbidCheckout && snapshot?.checkoutAvailable === true;
    submit.disabled = !ready || pending || creditLoading || (useCredit.checked && !credit);
    if (!ready && !pending) status.textContent = 'Checkout is not available yet. You can still view the leaderboard.';
    return ready;
  }
  async function loadCreditQuote() {
    const generation = ++quoteGeneration, grossCents = centsFromInput(amount.value.trim());
    credit = undefined;
    if (!useCredit.checked) { creditLoading = false; creditQuote.textContent = ''; availability(); return; }
    if (grossCents === null) { creditQuote.textContent = 'Enter a valid bid amount to see your credit.'; availability(); return; }
    creditLoading = true; creditQuote.textContent = 'Checking available credit…'; availability();
    try {
      const response = await fetch(`/api/outbid/credit-quote?amountCents=${grossCents}`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      const quote = await response.json() as { grossCents?: number; creditCents?: number; cashCents?: number; claimed?: boolean; error?: string };
      if (generation !== quoteGeneration || disposed) return;
      if (!response.ok) throw new Error(quote.error ?? 'Credit is temporarily unavailable.');
      if (!quote.claimed) throw new Error('Verify your email in Share and earn to use your credit.');
      if (quote.grossCents !== grossCents || !Number.isSafeInteger(quote.creditCents) || quote.creditCents! < 0 || quote.creditCents! > grossCents
        || quote.cashCents !== grossCents - quote.creditCents!) throw new Error('Credit quote is unavailable.');
      if (!quote.creditCents) throw new Error('No available credit yet. Earnings become available after seven days.');
      credit = { grossCents, creditCents: quote.creditCents, cashCents: quote.cashCents };
      creditQuote.textContent = `${formatOutbidMoney(BigInt(grossCents))} bid − ${formatOutbidMoney(BigInt(credit.creditCents))} credit = ${formatOutbidMoney(BigInt(credit.cashCents))} at Checkout. Credit is held until payment or verified checkout expiry.`;
    } catch (error) { if (generation === quoteGeneration && !disposed) creditQuote.textContent = error instanceof Error ? error.message : 'Credit is unavailable.'; }
    finally { if (generation === quoteGeneration) { creditLoading = false; availability(); } }
  }
  useCredit.addEventListener('change', () => { void loadCreditQuote(); });
  amount.addEventListener('input', () => { amountEdited = true; credit = undefined; quoteGeneration++; creditLoading = false; if (useCredit.checked) creditQuote.textContent = 'Finish entering your bid to update the credit quote.'; availability(); });
  amount.addEventListener('change', () => { void loadCreditQuote(); });
  function updateQuote() {
    if (!snapshot) return;
    shareCrown.hidden = !viewer || snapshot.entries[0]?.bidderId !== viewer.bidderId;
    const paid = outbidCents(viewer?.totalCents ?? '0') ?? 0n;
    const needed = outbidAmountToLead(snapshot, viewer);
    quote.textContent = `Your confirmed total: ${formatOutbidMoney(paid)}. Add ${formatOutbidMoney(needed)} to lead at the current totals.`;
    target.textContent = snapshot.entries.length ? `To lead: ${formatOutbidMoney(needed)}` : 'First bid: $1.00';
    if (!amountEdited && document.activeElement !== amount && !pending && needed <= BigInt(OUTBID_MAXIMUM_BID_CENTS)) {
      const next = `${needed / 100n}.${String(needed % 100n).padStart(2, '0')}`;
      if (next !== amount.value) { amount.value = next; if (useCredit.checked) void loadCreditQuote(); }
    }
  }
  function setSnapshot(value: unknown): boolean {
    if (disposed || !isOutbidSnapshot(value) || (snapshot && value.revision < snapshot.revision)) return false;
    const key = JSON.stringify(value); if (key === lastState) return true;
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusedRow = active && board.contains(active) ? active : null;
    const focusedWinner = active === winnerLink;
    const scrollTop = dialog.scrollTop, focusTop = focusedRow?.getBoundingClientRect().top;
    lastState = key; snapshot = value;
    if (viewer) { const mine = value.entries.find(entry => entry.bidderId === viewer!.bidderId); if (mine) viewer = { bidderId: mine.bidderId, totalCents: mine.totalCents }; }
    mode.textContent = value.mode === 'test' ? 'TEST MODE · Stripe test payments only' : 'USD · cumulative confirmed payments';
    badge.textContent = value.mode === 'test' ? 'OUTBID · TEST' : 'OUTBID';
    submit.textContent = value.mode === 'test' ? 'Continue to test Checkout' : 'Continue to Checkout';
    const first = value.entries[0];
    if (first) {
      name.textContent = `#1 ${first.name} · ${formatOutbidMoney(first.totalCents)}`;
      winnerLink ??= link(first.message, first.url);
      winnerLink.textContent = first.message; winnerLink.href = first.url;
      if (message.firstChild !== winnerLink) message.replaceChildren(winnerLink);
    } else { name.textContent = 'The crown is open'; message.textContent = 'Be the first to put your name over San Francisco.'; }
    empty.hidden = value.entries.length > 0; empty.textContent = 'No confirmed bids yet. Start the leaderboard.';
    const remaining = new Set(rows.keys());
    let cursor = board.firstElementChild;
    for (const entry of value.entries) {
      let item = rows.get(entry.bidderId);
      if (!item) {
        const row = el('li', 'gt-outbid-row'), rank = el('span', 'gt-outbid-rank');
        const body = el('div', 'gt-outbid-row-copy'), title = link(entry.name, entry.url);
        const copy = el('p', ''), total = el('strong', 'gt-outbid-total');
        body.append(title, copy); row.append(rank, body, total);
        item = { row, rank, title, message: copy, total }; rows.set(entry.bidderId, item);
      }
      remaining.delete(entry.bidderId);
      item.rank.textContent = `#${entry.rank}`; item.title.textContent = entry.name; item.title.href = entry.url;
      item.message.textContent = entry.message; item.total.textContent = formatOutbidMoney(entry.totalCents);
      if (entry.logoUrl) {
        if (!item.logo) {
          item.logo = el('img', 'gt-outbid-logo'); item.logo.alt = ''; item.logo.width = 32; item.logo.height = 32; item.logo.loading = 'lazy';
          item.row.insertBefore(item.logo, item.rank.nextSibling);
        }
        if (item.logo.getAttribute('src') !== entry.logoUrl) item.logo.src = entry.logoUrl;
      } else { item.logo?.remove(); delete item.logo; }
      if (item.row !== cursor) board.insertBefore(item.row, cursor);
      cursor = item.row.nextElementSibling;
    }
    for (const id of remaining) { rows.get(id)!.row.remove(); rows.delete(id); }
    updateQuote(); availability();
    if (focusedRow && dialog.open) {
      // Moving an existing row can blur its link. Retain the same bidder and
      // its viewport position, even when a confirmed payment changes its rank.
      if (focusedRow.isConnected) {
        if (document.activeElement !== focusedRow) focusedRow.focus({ preventScroll: true });
        dialog.scrollTop = scrollTop;
        dialog.scrollTop += focusedRow.getBoundingClientRect().top - focusTop!;
      } else { close.focus({ preventScroll: true }); dialog.scrollTop = scrollTop; }
    } else if (focusedWinner && !winnerLink?.isConnected) showBoard.focus({ preventScroll: true });
    options.onSnapshot?.(value); return true;
  }
  async function refresh() {
    if (disposed) return;
    if (refreshing) { refreshAgain = true; return refreshing; }
    refreshing = (async () => {
      const request = new AbortController();
      let deadline: ReturnType<typeof setTimeout> | undefined;
      let onDispose: (() => void) | undefined;
      try {
        // A stalled body must also release the shared refresh so a later event can retry.
        const interrupted = new Promise<never>((_, reject) => {
          onDispose = () => { request.abort(); reject(new Error('Leaderboard closed.')); };
          controller.signal.addEventListener('abort', onDispose, { once: true });
          deadline = setTimeout(() => {
            reject(new Error('Leaderboard is reconnecting. Please try again shortly.')); request.abort();
          }, 4000);
        });
        const data: unknown = await Promise.race([(async () => {
          const response = await fetch('/api/outbid', { credentials: 'same-origin', cache: 'no-store', signal: request.signal });
          if (!response.ok) throw new Error('Leaderboard is reconnecting. Please try again shortly.');
          return response.json();
        })(), interrupted]);
        if (disposed) return;
        if (!data || typeof data !== 'object' || !('snapshot' in data) || !isOutbidSnapshot(data.snapshot)) throw new Error('Leaderboard is temporarily unavailable.');
        if ('viewer' in data && data.viewer && typeof data.viewer === 'object' && 'bidderId' in data.viewer && typeof data.viewer.bidderId === 'string'
          && 'totalCents' in data.viewer && outbidCents(data.viewer.totalCents) !== null) viewer = data.viewer as OutbidViewer;
        else viewer = undefined;
        if (!pending) status.textContent = '';
        setSnapshot(data.snapshot); updateQuote(); availability();
        void receipts.refresh();
      } catch (error) { if (!disposed) { status.textContent = error instanceof Error ? error.message : 'Leaderboard unavailable.'; if (!snapshot) { mode.textContent = 'Reconnecting to the leaderboard…'; name.textContent = 'Leaderboard reconnecting…'; } } }
      finally {
        clearTimeout(deadline);
        if (onDispose) controller.signal.removeEventListener('abort', onDispose);
        refreshing = undefined;
        if (refreshAgain && !disposed) { refreshAgain = false; void refresh(); }
      }
    })();
    return refreshing;
  }
  function open(focusBid = false) {
    if (disposed) return;
    if (!dialog.open) {
      onClose(); track('outbid_view'); announcedOpen = true; options.onModalChange?.(true); dialog.showModal();
      dialog.scrollTop = 0;
    }
    (focusBid ? bidderName : close).focus({ preventScroll: true });
    if (focusBid) form.scrollIntoView({ block: 'nearest' });
    void refresh();
  }
  function hide() { if (dialog.open) dialog.close(); onClose(); }
  function onClose() {
    // Native close restores focus synchronously. Its queued event may arrive
    // after another panel takes focus or this dialog opens again.
    if (dialog.open || !announcedOpen) return;
    announcedOpen = false; options.onModalChange?.(false);
  }
  claim.addEventListener('click', () => open(true)); showBoard.addEventListener('click', () => open());
  close.addEventListener('click', hide); dialog.addEventListener('close', onClose);
  shareCrown.addEventListener('click', async () => {
    if (!viewer || snapshot?.entries[0]?.bidderId !== viewer.bidderId) return;
    const url = await referralShareUrl(new URL('/go/salesforce-tower', location.origin));
    const text = `I just took the Salesforce crown in Grand Tech Auto: San Francisco! ${url}`;
    try { await navigator.clipboard.writeText(text); status.textContent = 'Crown share copied.'; }
    catch { status.textContent = text; }
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); hide(); });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (pending || !availability() || !form.reportValidity()) return;
    const amountCents = centsFromInput(amount.value.trim()), url = safeOutbidLink(bidLink.value.trim());
    if (amountCents === null) { status.textContent = 'Enter at least $1.00, with no more than two decimal places.'; amount.focus(); return; }
    if (!url) { status.textContent = 'Use a public HTTPS website or profile link.'; bidLink.focus(); return; }
    const body: OutbidCheckoutRequest = { name: bidderName.value.trim(), message: bidMessage.value.trim(), url, amountCents };
    if (useCredit.checked) {
      if (!credit || credit.grossCents !== amountCents) { await loadCreditQuote(); status.textContent = 'Review the updated credit quote, then continue.'; return; }
      body.useCredit = true; body.expectedCreditCents = credit.creditCents;
    }
    if (!body.name || !body.message) { status.textContent = 'Add your name and a short message.'; return; }
    pending = true; availability(); status.textContent = 'Checking your message and link…';
    try {
      const file = logo.files?.[0];
      if (file) {
        if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 2_000_000) throw new Error('Choose a PNG, JPEG or WebP smaller than 2 MB.');
        const bitmap = await createImageBitmap(file); const pixels = bitmap.width * bitmap.height; bitmap.close();
        if (pixels > 1_000_000) throw new Error('Keep your logo at or below one megapixel, such as 1000 × 1000.');
        if (uploadedLogo?.file !== file) {
          const upload = new FormData(); upload.append('file', file);
          const uploaded = await fetch('/api/outbid/logo', { method: 'POST', body: upload, credentials: 'same-origin', signal: controller.signal });
          const result = await uploaded.json() as { assetId?: unknown; error?: unknown };
          if (!uploaded.ok || typeof result.assetId !== 'string') throw new Error(typeof result.error === 'string' ? result.error.slice(0,240) : 'Logo upload is not available yet.');
          uploadedLogo = { file, assetId: result.assetId };
        }
        body.logoAssetId = uploadedLogo!.assetId;
      }
      const analytics = analyticsContext();
      const payload = JSON.stringify({ ...body, ...(analytics ? { analytics } : {}) });
      if (!requestKey || requestBody !== payload) { requestKey = crypto.randomUUID(); requestBody = payload; }
      const response = await fetch('/api/outbid/checkout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestKey }, body: payload, signal: controller.signal });
      const data = await response.json() as { url?: unknown; orderId?: unknown; error?: unknown };
      if (response.status === 409) { requestKey = ''; if (useCredit.checked) void loadCreditQuote(); }
      if (!response.ok || typeof data.url !== 'string') throw new Error(typeof data.error === 'string' ? data.error.slice(0,240) : 'Checkout could not start. Please try again.');
      const checkout = new URL(data.url);
      if (checkout.protocol !== 'https:' || checkout.hostname !== 'checkout.stripe.com' || checkout.username || checkout.password || checkout.port) throw new Error('Checkout returned an invalid payment link.');
      rememberOutbidCheckout(data.orderId);
      status.textContent = 'Opening Stripe Checkout…'; window.location.assign(checkout.href);
    } catch (error) { if (!disposed) status.textContent = error instanceof Error ? error.message : 'Checkout could not start.'; }
    finally { pending = false; if (!disposed) availability(); }
  });
  function onFocus() { void refresh(); }
  window.addEventListener('focus', onFocus);
  availability(); void refresh();
  return {
    element: banner, setSnapshot, refresh, open, hide,
    get modalOpen() { return dialog.open; },
    destroy() { if (disposed) return; disposed = true; receipts.destroy(); controller.abort(); hide(); dialog.removeEventListener('close', onClose); banner.remove(); dialog.remove(); rows.clear(); winnerLink = undefined; document.body.classList.remove('gt-outbid-active'); window.removeEventListener('focus', onFocus); },
  };
}
