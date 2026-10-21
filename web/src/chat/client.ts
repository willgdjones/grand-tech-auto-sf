import { Vector3, type Camera } from 'three';
import { flags } from '@gtasf/shared/flags';
import { chatEventId, CHAT_BUBBLE_MS, CHAT_RADIUS_M } from '@gtasf/shared/chat/constants';
import { normalizeDisplay } from '@gtasf/shared/chat/normalize';
import type { C2SMessage, S2CMessage } from '@gtasf/shared/protocol/types';
import { createVoiceChat } from './voice';
import { senderColor } from './senderColor';
import './chat.css';

type ChatMessage = Extract<S2CMessage, { type: 'CHAT_BROADCAST' }>;
type ChatCommand = Extract<C2SMessage, { type: 'CHAT' | 'EVENT_JOIN' | 'EVENT_LEAVE' }>;
type Position = { id: number; x: number; y: number; z: number };
type Bubble = { element: HTMLElement; expires: number; width: number; height: number; placeholder?: boolean };
// With overhead nameplates on (PLAN-v2 §6), bubbles share the plate's head anchor (2.05 m, see
// web/src/hud/nameplates.ts PLATE_HEIGHT_M) and lift a fixed screen amount so they clear the
// fixed-height plate at every distance; the gap is distance-independent because the anchor is
// shared. The two-line plate (startup 14px + meta 11px, both 1.15 line-height ≈ 29 px) plus the
// bubble's 3px drop shadow need ~32 px; 34 px leaves a small visible gap above the plate. Without
// nameplates, the original 2.2 m anchor and no lift are kept. (gtasf-chat-bubble-nameplate-stack-uegg)
const NAMEPLATE_HEAD_M = 2.05, NAMEPLATE_CLEAR_PX = 34;
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') {
  const value = document.createElement(tag); value.textContent = text; value.className = className; return value;
}
export function createChat(options: { parent?: HTMLElement; send(message: ChatCommand): boolean; connected(): boolean; onModalChange?(open: boolean): void }) {
  if (!flags.chat) return null;
  const button = node('button', 'Chat · T', 'gt-chat-launch'); button.type = 'button';
  (options.parent ?? document.body).append(button);
  const dialog = node('dialog', '', 'gt-chat-dialog'); dialog.setAttribute('aria-label', 'City chat');
  const header = node('header'), title = node('h2', 'City chat'), close = node('button', 'Close ×'); close.type = 'button';
  header.append(title, close);
  const label = node('label', 'Channel'), channel = node('select'); channel.setAttribute('aria-label', 'Chat channel');
  const nearby = node('option', `Nearby · ${CHAT_RADIUS_M} m`), event = node('option', 'Walk into an event to join its chat');
  nearby.value = 'nearby'; event.value = 'event'; event.disabled = true; channel.append(nearby); if (flags.eventChat) channel.append(event); label.append(channel);
  const log = node('ol', '', 'gt-chat-log'); log.setAttribute('aria-live', 'polite'); log.setAttribute('aria-label', 'Chat messages');
  const hint = node('p', 'Say hello to people nearby. Messages are moderated.', 'gt-chat-hint');
  const form = node('form'), input = node('textarea'); input.rows = 2; input.maxLength = 320; input.placeholder = 'Say hello…';
  input.setAttribute('aria-label', 'Your message'); input.autocomplete = 'off'; input.spellcheck = true;
  const status = node('p', '', 'gt-chat-status'); status.setAttribute('role', 'status');
  const send = node('button', 'Send'); send.type = 'submit'; form.append(input, send); dialog.append(header, label, log, hint, form, status); document.body.append(dialog);
  const layer = node('div', '', 'gt-chat-bubbles'); layer.setAttribute('aria-hidden', 'true'); document.body.append(layer);
  // Always-visible SA-style ambient log + persistent "Press T to chat" hint (FB2 gtasf-osfm): recent
  // lines sit bottom-left above the radar and fade when idle, instead of chat hiding in the modal.
  const ambient = node('div', '', 'gt-chat-ambient'); ambient.setAttribute('aria-live', 'polite'); ambient.setAttribute('aria-label', 'Recent chat');
  const ambientLines = node('div', '', 'gt-chat-ambient-lines');
  // The hint doubles as the mobile tappable chat entry (gtasf-osfm): tap/click it to open chat.
  const ambientHint = node('button', 'Press T to chat', 'gt-chat-ambient-hint'); ambientHint.type = 'button';
  ambientHint.setAttribute('aria-label', 'Open chat');
  // Inline quick-chat in the always-visible log (PLAN-v2.1 §6, gtasf-6ofg): type right here, no modal.
  // While the input is focused the input system's consumesTextKeys() blocks movement keys, so WASD
  // never fires mid-sentence; Enter sends (keeps focus for the next line), Esc/blur closes.
  const inlineForm = node('form', '', 'gt-chat-inline');
  const inlineInput = node('input', '', 'gt-chat-inline-input') as HTMLInputElement;
  inlineInput.type = 'text'; inlineInput.maxLength = 320; inlineInput.autocomplete = 'off';
  inlineInput.placeholder = 'Say something…'; inlineInput.setAttribute('aria-label', 'Chat message');
  const inlineStatus = node('p', '', 'gt-chat-inline-status'); inlineStatus.hidden = true;
  inlineStatus.id = 'gt-chat-inline-status'; inlineStatus.setAttribute('role', 'status');
  inlineInput.setAttribute('aria-describedby', inlineStatus.id);
  inlineForm.hidden = true; inlineForm.append(inlineInput, inlineStatus);
  function setStatus(message: string) {
    status.textContent = message; inlineStatus.textContent = message; inlineStatus.hidden = !message;
  }
  ambientHint.addEventListener('click', () => openInline());
  ambient.append(ambientLines, inlineForm, ambientHint); document.body.append(ambient);
  let ambientFade: number | undefined;
  function pushAmbient(name: string, text: string, senderId: number) {
    const line = node('div', '', 'gt-chat-ambient-line');
    const who = node('strong', name); who.style.color = senderColor(senderId, senderId === selfId);
    line.append(who, node('span', ` ${text}`));
    ambientLines.append(line);
    while (ambientLines.childElementCount > 5) ambientLines.firstElementChild?.remove();
    ambient.dataset.active = 'true';
    if (ambientFade !== undefined) clearTimeout(ambientFade);
    ambientFade = window.setTimeout(() => { ambient.dataset.active = 'false'; }, 12000);
  }
  const bubbles = new Map<number, Bubble>(), bubbleElements = new WeakMap<Element, Bubble>(), history: ChatMessage[] = [], seen = new Set<number>();
  // Measure when content/viewport changes, rather than forcing layout every frame.
  const bubbleSizes = new ResizeObserver(entries => {
    for (const entry of entries) {
      const bubble = bubbleElements.get(entry.target), size = entry.borderBoxSize[0];
      if (bubble && size && size.inlineSize > 0) { bubble.width = size.inlineSize; bubble.height = size.blockSize; }
    }
  });
  function removeBubble(id: number) {
    const bubble = bubbles.get(id); if (!bubble) return;
    bubbleSizes.unobserve(bubble.element); bubble.element.remove(); bubbles.delete(id);
  }
  let selfId = 0, joined = 0, desired: { id: string; title: string; wire: number } | null = null, joinAt = 0;
  let serial = crypto.getRandomValues(new Uint32Array(1))[0]!, disposed = false, wasConnected = false, announcedOpen = false;
  let readerAnchor: { id: string; offset: number; scrollTop: number } | undefined;
  const point = new Vector3();
  // HUD layout changes less often than camera projection. Cache its rectangles so
  // bubbles can avoid controls without forcing layout in the animation loop.
  const hudSelector = '.gt-look-fallback,.gt-funding-room,.gt-gps-status,#app>footer,.gt-radar,.gtasf-touch .buttons,.gtasf-touch .stick,.gtasf-touch .ride-hint';
  const hudNodes = new Set<Element>();
  let hudRects: DOMRect[] = [], hudRead: number | undefined;
  const hudSizes = new ResizeObserver(scheduleHudRead);
  const hudChanges = new MutationObserver(entries => {
    // Some HUD writers set the same hidden attribute every frame.
    if (entries.some(entry => entry.type === 'childList' || entry.oldValue !== (entry.target as Element).getAttribute(entry.attributeName!))) scheduleHudRead();
  });
  function scheduleHudRead() {
    if (disposed || hudRead !== undefined) return;
    hudRead = requestAnimationFrame(() => {
      hudRead = undefined;
      const current = new Set(document.querySelectorAll(hudSelector));
      for (const element of hudNodes) if (!current.has(element)) { hudSizes.unobserve(element); hudNodes.delete(element); }
      for (const element of current) if (!hudNodes.has(element)) {
        hudNodes.add(element); hudSizes.observe(element);
        hudChanges.observe(element, { attributes: true, attributeOldValue: true, attributeFilter: ['hidden', 'class', 'style', 'data-expanded'] });
      }
      // The notice attribute also changes visibility/position through :has rules.
      const notice = document.querySelector('#trip-status');
      if (notice) hudChanges.observe(notice, { attributes: true, attributeOldValue: true, attributeFilter: ['hidden', 'class', 'style', 'data-notice'] });
      hudRects = [];
      for (const element of current) {
        if (element.matches('.gt-radar[data-expanded=true]')) continue;
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility !== 'visible') continue;
        const rect = element.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) hudRects.push(rect);
      }
      hudRects.sort((a, b) => b.top - a.top);
    });
  }
  hudChanges.observe(document.body, { childList: true, attributes: true, attributeOldValue: true, attributeFilter: ['class'] });
  window.addEventListener('resize', scheduleHudRead);
  scheduleHudRead();
  function selectedRoom() { return channel.value === 'event' && desired ? desired.wire : 0; }
  function renderLog(followLatest = false) {
    const follow = followLatest || log.scrollHeight - log.clientHeight - log.scrollTop <= 2;
    // Keep a partially visible message at the same offset as older history expires.
    const top = follow ? 0 : log.getBoundingClientRect().top + log.clientTop;
    // Reuse the offset until the reader scrolls, avoiding cumulative CSS-pixel rounding.
    let anchor = !follow && readerAnchor?.scrollTop === log.scrollTop ? readerAnchor : undefined;
    if (!follow && !anchor) for (const child of log.children) {
      const rect = child.getBoundingClientRect();
      if (rect.bottom > top) { anchor = { id: (child as HTMLElement).dataset.messageId!, offset: rect.top - top, scrollTop: log.scrollTop }; break; }
    }
    let retained: HTMLLIElement | undefined;
    log.replaceChildren();
    for (const message of history.filter(value => value.eventId === selectedRoom()).slice(-40)) {
      const item = node('li'), name = node('strong', `${isSpoken(message) ? '🎙 ' : ''}${message.name}: `); item.dataset.messageId = String(message.messageId);
      item.append(name, document.createTextNode(message.text)); log.append(item);
      if (item.dataset.messageId === anchor?.id) retained = item;
    }
    if (follow) { log.scrollTop = log.scrollHeight; readerAnchor = undefined; }
    else if (retained && anchor) {
      log.scrollTop += retained.getBoundingClientRect().top - top - anchor.offset;
      readerAnchor = { ...anchor, scrollTop: log.scrollTop };
    } else { log.scrollTop = 0; readerAnchor = undefined; } // The anchor expired: show oldest retained.
  }
  function updateChannel() {
    event.disabled = !desired || joined !== desired.wire;
    event.textContent = desired ? `${desired.title}${event.disabled ? ' · joining…' : ''}` : 'Walk into an event to join its chat';
    if (event.disabled && channel.value === 'event') { channel.value = 'nearby'; renderLog(true); }
    hint.textContent = channel.value === 'event' ? 'Only people in this event room can hear you.' : `People within ${CHAT_RADIUS_M} metres can hear you. Messages are moderated.`;
  }
  function open() {
    if (disposed || dialog.open) return;
    onClose(); announcedOpen = true;
    options.onModalChange?.(true); dialog.showModal(); input.focus({ preventScroll: true }); renderLog(true);
  }
  function hide() { if (dialog.open) dialog.close(); onClose(); }
  function onClose() {
    // Native close restores focus immediately. Its queued event may arrive
    // after chat reopens or another panel has taken keyboard ownership.
    if (dialog.open || !announcedOpen) return;
    announcedOpen = false; options.onModalChange?.(false);
  }
  button.addEventListener('click', open); close.addEventListener('click', hide); dialog.addEventListener('close', onClose);
  dialog.addEventListener('cancel', e => { e.preventDefault(); hide(); });
  channel.addEventListener('change', () => { updateChannel(); renderLog(true); input.focus(); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); } });
  // Shared by the text form and voice chat so both go through the same moderation/transport path.
  function sendText(raw: string): boolean {
    const clean = normalizeDisplay(raw);
    if (!clean.ok) { setStatus(clean.reason === 'EMPTY' ? 'Write a message first.' : 'Keep your message shorter: up to 160 characters or 320 bytes.'); return false; }
    if (!options.connected()) { setStatus('Chat is reconnecting. Your message is still here.'); return false; }
    serial = (serial + 1) >>> 0;
    if (!options.send({ type: 'CHAT', clientMsgId: serial, eventId: selectedRoom(), text: clean.display })) { setStatus('Chat is reconnecting. Try again shortly.'); return false; }
    setStatus('Sent.'); return true;
  }
  form.addEventListener('submit', e => { e.preventDefault(); if (sendText(input.value)) { input.value = ''; input.focus(); } });
  function openInline() {
    if (disposed || inlineForm.hidden === false) { inlineInput.focus({ preventScroll: true }); return; }
    if (ambientFade !== undefined) { clearTimeout(ambientFade); ambientFade = undefined; }
    setStatus('');
    ambient.dataset.active = 'true'; inlineForm.hidden = false; ambientHint.hidden = true;
    inlineInput.focus({ preventScroll: true });
  }
  function closeInline() {
    if (inlineForm.hidden) return;
    inlineForm.hidden = true; ambientHint.hidden = false; inlineInput.value = ''; inlineInput.blur();
    ambient.dataset.active = 'true';
    if (ambientFade !== undefined) clearTimeout(ambientFade);
    ambientFade = window.setTimeout(() => { ambient.dataset.active = 'false'; }, 12000);
  }
  let inlineComposing = false;
  inlineInput.addEventListener('compositionstart', () => { inlineComposing = true; });
  inlineInput.addEventListener('compositionend', () => { inlineComposing = false; });
  inlineInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') e.preventDefault(); // Submit explicitly only after composition has finished.
    // IME Enter/Escape belongs to the candidate picker, never to chat or game shortcuts.
    // keyCode 229 covers browsers that end composition before dispatching the final key.
    if (inlineComposing || e.isComposing || e.keyCode === 229) { e.stopPropagation(); return; }
    if (e.key === 'Enter') { e.stopPropagation(); inlineForm.requestSubmit(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeInline(); }
  });
  inlineInput.addEventListener('blur', () => { if (!inlineInput.value.trim()) closeInline(); });
  inlineForm.addEventListener('submit', e => { e.preventDefault(); if (!inlineComposing && sendText(inlineInput.value)) { inlineInput.value = ''; inlineInput.focus({ preventScroll: true }); } });
  // Hold-to-talk voice chat (gtasf-slzj); null unless flags.voiceChat. Posts transcripts via sendText.
  const voice = createVoiceChat({ parent: form, sendText, setStatus: message => { status.textContent = message; } });
  function setEvent(value: { id: string; title: string } | null) {
    if (!flags.eventChat) return;
    if (desired?.id === value?.id) return;
    if (desired && options.connected()) options.send({ type: 'EVENT_LEAVE', eventId: desired.wire });
    desired = value ? { ...value, wire: chatEventId(value.id) } : null; joined = 0; joinAt = 0; updateChannel();
  }
  function receive(message: S2CMessage) {
    if (disposed) return;
    if (message.type === 'WELCOME') { selfId = message.id; joined = 0; joinAt = 0; updateChannel(); return; }
    if (message.type === 'EVENT_STATE' && message.playerId === selfId && desired?.wire === message.eventId) {
      joined = message.present ? message.eventId : 0; updateChannel(); return;
    }
    if (message.type === 'PLAYER_LEAVE') { removeBubble(message.id); return; }
    if (message.type !== 'CHAT_BROADCAST' || seen.has(message.messageId)) return;
    seen.add(message.messageId); if (seen.size > 128) seen.delete(seen.values().next().value!);
    history.push(message); if (history.length > 80) history.shift(); if (dialog.open) renderLog();
    pushAmbient(`${isSpoken(message) ? '🎙 ' : ''}${message.name}`, message.text, message.senderId); // spoken lines keep their 🎙 in the feed too
    addBubble(message.senderId, message.name, message.text, isSpoken(message), CHAT_BUBBLE_MS);
  }
  /** Spoken bubbles (gtasf-gc9q): CHAT_BROADCAST carries an optional 'spoken' bit; mark them with 🎙. */
  const isSpoken = (message: object) => (message as { spoken?: unknown }).spoken === true;
  function addBubble(senderId: number, name: string, text: string, spoken: boolean, lifetimeMs: number) {
    removeBubble(senderId);
    if (bubbles.size >= 24) removeBubble(bubbles.keys().next().value!);
    const bubble = node('div', '', spoken ? 'gt-chat-bubble gt-chat-bubble-spoken' : 'gt-chat-bubble'); bubble.style.visibility = 'hidden';
    const bName = node('strong', spoken ? `🎙 ${name}` : name); bName.style.color = senderColor(senderId, senderId === selfId);
    bubble.append(bName, node('span', text)); layer.append(bubble);
    const record: Bubble = { element: bubble, expires: performance.now() + lifetimeMs, width: 0, height: 0 };
    bubbles.set(senderId, record); bubbleElements.set(bubble, record); bubbleSizes.observe(bubble); scheduleHudRead();
  }
  return {
    button, open, hide, openInline, closeInline, setEvent, receive,
    /** The speaker's own spoken-bubble placeholder ('🎙 …' while transcribing, or a short status). The server's
     *  CHAT_BROADCAST for this player replaces it (same sender key); otherwise it expires after `ms`. */
    showSpeaking(text = '…', ms = 9000) { if (!disposed && selfId) { addBubble(selfId, 'You', text, true, ms); const own = bubbles.get(selfId); if (own) own.placeholder = true; } },
    /** Like showSpeaking, but never covers the speaker's real bubble: the server's CHAT_BROADCAST usually arrives
     *  over the socket BEFORE the caption POST's 200, and re-showing '…' then erased the founder's own bubble. */
    showSpeakingIfPending(text = '…', ms = 2500) { const own = selfId ? bubbles.get(selfId) : undefined; if (own && !own.placeholder) return; this.showSpeaking(text, ms); },
    clearSpeaking() { if (selfId) removeBubble(selfId); },
    get modalOpen() { return dialog.open; }, get inlineOpen() { return !inlineForm.hidden; },
    /** Metre-space positions should use the same interpolated avatars that the game renders. */
    update(camera: Camera, localId: number, positions: Iterable<Position>, now = performance.now()) {
      if (disposed) return; selfId = localId || selfId;
      const connected = options.connected(); send.disabled = !connected;
      if (!connected && wasConnected) { joined = 0; joinAt = 0; updateChannel(); }
      wasConnected = connected;
      if (connected && desired && joined !== desired.wire && now >= joinAt) { joinAt = now + 2500; options.send({ type: 'EVENT_JOIN', eventId: desired.wire }); }
      if (!bubbles.size) return;
      const poses = new Map([...positions].map(p => [p.id, p]));
      for (const [id, bubble] of bubbles) {
        if (now >= bubble.expires) { removeBubble(id); continue; }
        const pose = poses.get(id); if (!pose) { bubble.element.hidden = true; continue; }
        point.set(pose.x, pose.y + (flags.nameplates ? NAMEPLATE_HEAD_M : 2.2), pose.z).project(camera);
        bubble.element.hidden = point.z < -1 || point.z > 1 || Math.abs(point.x) > 1 || Math.abs(point.y) > 1;
        if (!bubble.element.hidden) {
          const x = (point.x * .5 + .5) * innerWidth, y = (-point.y * .5 + .5) * innerHeight - (flags.nameplates ? NAMEPLATE_CLEAR_PX : 0);
          const center = Math.max(8 + bubble.width / 2, Math.min(innerWidth - 8 - bubble.width / 2, x));
          let bottom = Math.max(8 + bubble.height, Math.min(innerHeight - 8, y));
          for (const rect of hudRects) {
            if (center + bubble.width / 2 > rect.left - 8 && center - bubble.width / 2 < rect.right + 8 && bottom > rect.top - 8 && bottom - bubble.height < rect.bottom + 8) bottom = rect.top - 8;
          }
          bubble.element.style.left = `${center}px`;
          bubble.element.style.top = `${bottom}px`;
          bubble.element.style.visibility = bubble.width > 0 && bottom - bubble.height >= 8 ? '' : 'hidden';
        }
      }
    },
    destroy() {
      if (disposed) return; disposed = true;
      if (desired && options.connected()) options.send({ type: 'EVENT_LEAVE', eventId: desired.wire });
      hide();
      dialog.removeEventListener('close', onClose); dialog.remove(); button.remove(); bubbleSizes.disconnect(); layer.remove(); bubbles.clear(); history.length = 0;
      if (ambientFade !== undefined) clearTimeout(ambientFade); ambient.remove(); voice?.destroy();
      hudSizes.disconnect(); hudChanges.disconnect(); hudNodes.clear(); hudRects = [];
      window.removeEventListener('resize', scheduleHudRead); if (hudRead !== undefined) cancelAnimationFrame(hudRead);
    },
  };
}
