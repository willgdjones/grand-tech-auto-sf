import './friendsPanel.css';
import { FUNDING_ROUNDS } from '@gtasf/shared/funding';
import { createFriendsClient, type DmMessage, type FriendMe, type FriendPresence, type FriendsClient } from './client';

/**
 * Friends & DMs panel (PLAN-v2.1 decision 5 chat row: Friends / DM). Self-contained SA-styled
 * `<dialog>` over the friends client (pane 13's /api/friends/*, gtasf-q4yo + the /dm transport):
 *   - Roster view: your handle, add-a-friend by username, incoming requests (accept/decline), and
 *     your friends with a live presence dot + funding stage; "Message" opens a DM thread.
 *   - DM view: the mutual-friends thread (polled while open) with a send box; Jev-moderated server-side.
 * Gated by flags.friends at the main.ts call site (self-mounts a launcher button into `parent`), so
 * it's a no-op surface until friends ships. All reads fail soft (empty roster / "no messages yet").
 */
const EMPTY_ME: FriendMe = { username: null, friends: [], incoming: [], outgoing: [] };
const ROSTER_REFRESH_MS = 5000;
const DM_POLL_MS = 3000;

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (text) el.textContent = text;
  if (className) el.className = className;
  return el;
}

const stageLabel = (stage: number | undefined): string =>
  stage == null || !Number.isInteger(stage) ? '' : FUNDING_ROUNDS[stage]?.label ?? '';

export interface FriendsPanel {
  readonly button: HTMLButtonElement;
  readonly element: HTMLDialogElement;
  open(): void;
  close(): void;
  destroy(): void;
}

export function createFriendsPanel(options: { parent?: HTMLElement; client?: FriendsClient; onModalChange?(open: boolean): void } = {}): FriendsPanel {
  const client = options.client ?? createFriendsClient();

  const button = node('button', '👥 Friends', 'gt-friends-launch'); button.type = 'button';
  (options.parent ?? document.body).append(button);

  const dialog = node('dialog', '', 'gt-friends');
  dialog.setAttribute('aria-label', 'Friends and direct messages');

  // --- Roster view ---
  const roster = node('div', '', 'gt-friends-view');
  const header = node('header', '', 'gt-friends-header');
  const title = node('h2', 'Friends', 'gt-friends-title');
  const closeBtn = node('button', 'Close ×', 'gt-friends-close'); closeBtn.type = 'button';
  header.append(title, closeBtn);
  const handleLine = node('p', '', 'gt-friends-handle');
  // Claim-a-username path, shown when you don't have one yet (so the panel works even if friends is on
  // without onboarding — otherwise you could never add anyone). Hidden once you have a handle.
  const claimForm = node('form', '', 'gt-friends-add'); claimForm.hidden = true;
  const claimInput = node('input', '', 'gt-friends-add-input') as HTMLInputElement;
  claimInput.placeholder = 'Pick your username'; claimInput.maxLength = 20; claimInput.autocomplete = 'off';
  const claimBtn = node('button', 'Claim', 'gt-friends-add-btn'); claimBtn.type = 'submit';
  claimForm.append(claimInput, claimBtn);
  const addForm = node('form', '', 'gt-friends-add');
  const addInput = node('input', '', 'gt-friends-add-input') as HTMLInputElement;
  addInput.placeholder = 'Add a founder by username'; addInput.maxLength = 20; addInput.autocomplete = 'off';
  const addBtn = node('button', 'Add', 'gt-friends-add-btn'); addBtn.type = 'submit';
  addForm.append(addInput, addBtn);
  const addStatus = node('p', '', 'gt-friends-status'); addStatus.setAttribute('role', 'status');
  const incomingWrap = node('div', '', 'gt-friends-incoming');
  const listTitle = node('p', 'Your friends', 'gt-friends-section');
  const list = node('ul', '', 'gt-friends-list');
  roster.append(header, handleLine, claimForm, addForm, addStatus, incomingWrap, listTitle, list);

  // --- DM view ---
  const dm = node('div', '', 'gt-friends-view'); dm.hidden = true;
  const dmHeader = node('header', '', 'gt-friends-header');
  const dmBack = node('button', '‹ Friends', 'gt-friends-back'); dmBack.type = 'button';
  const dmName = node('h2', '', 'gt-friends-title');
  const dmClose = node('button', 'Close ×', 'gt-friends-close'); dmClose.type = 'button';
  dmName.style.overflowWrap = 'anywhere';
  dmHeader.append(dmBack, dmClose);
  const thread = node('ul', '', 'gt-friends-thread');
  const dmForm = node('form', '', 'gt-friends-send');
  const dmInput = node('input', '', 'gt-friends-send-input') as HTMLInputElement;
  dmInput.placeholder = 'Message…'; dmInput.maxLength = 300; dmInput.autocomplete = 'off';
  const dmSend = node('button', 'Send', 'gt-friends-send-btn'); dmSend.type = 'submit';
  const dmStatus = node('p', '', 'gt-friends-status'); dmStatus.setAttribute('role', 'status');
  dmForm.append(dmInput, dmSend);
  dm.append(dmHeader, dmName, thread, dmForm, dmStatus);

  dialog.append(roster, dm);
  document.body.append(dialog);

  let disposed = false, announced = false;
  let rosterPending = false, rosterGeneration = 0;
  let fetchingRosterGeneration: number | null = null;
  const pendingResponses = new Set<string>();
  let me: FriendMe = EMPTY_ME;
  let presence = new Map<string, FriendPresence>();
  let dmWith: string | null = null, lastTs = 0, dmGeneration = 0;
  let fetchingDmGeneration: number | null = null;
  const drafts = new Map<string, string>();
  const pendingSends = new Set<string>();
  const sendErrors = new Map<string, string>();
  let rosterTimer: ReturnType<typeof setInterval> | undefined, dmTimer: ReturnType<typeof setInterval> | undefined;

  function setModal(open: boolean) { if (open === announced) return; announced = open; options.onModalChange?.(open); }

  function showView(view: 'roster' | 'dm') {
    roster.hidden = view !== 'roster';
    dm.hidden = view !== 'dm';
  }

  function renderRoster() {
    const hasName = Boolean(me.username);
    handleLine.textContent = hasName ? `You are @${me.username}` : 'Pick a username to add friends and send DMs.';
    claimForm.hidden = hasName;   // show the claim box only until you have a handle
    addForm.hidden = !hasName;    // can't request friends without one
    incomingWrap.replaceChildren();
    if (me.incoming.length) {
      incomingWrap.append(node('p', 'Friend requests', 'gt-friends-section'));
      for (const name of me.incoming) {
        const row = node('div', '', 'gt-friends-req');
        row.append(node('span', `@${name}`, 'gt-friends-name'));
        const yes = node('button', 'Accept', 'gt-friends-ok'); yes.type = 'button';
        const no = node('button', 'Decline', 'gt-friends-no'); no.type = 'button';
        yes.disabled = no.disabled = pendingResponses.has(name);
        yes.addEventListener('click', () => void respond(name, true));
        no.addEventListener('click', () => void respond(name, false));
        row.append(yes, no); incomingWrap.append(row);
      }
    }
    list.replaceChildren();
    if (!me.friends.length) { list.append(node('li', 'No friends yet — add one above.', 'gt-friends-empty')); }
    for (const name of me.friends) {
      const p = presence.get(name);
      const li = node('li', '', 'gt-friends-row');
      const dot = node('span', '', 'gt-friends-dot'); dot.dataset.online = String(Boolean(p?.online));
      const who = node('span', `@${name}`, 'gt-friends-name');
      const meta = node('span', p?.online ? (stageLabel(p.stage) || 'Online') : 'Offline', 'gt-friends-meta');
      const msg = node('button', 'Message', 'gt-friends-msg'); msg.type = 'button';
      msg.addEventListener('click', () => void openDm(name));
      li.append(dot, who, meta, msg); list.append(li);
    }
    for (const name of me.outgoing) list.append(node('li', `@${name} · request sent`, 'gt-friends-pending'));
  }

  async function refreshRoster(background = false) {
    if (disposed || !dialog.open || (background && fetchingRosterGeneration !== null)) return;
    const generation = ++rosterGeneration;
    fetchingRosterGeneration = generation;
    const [meNext, presNext] = await Promise.all([client.me(), client.presence()]).finally(() => {
      if (fetchingRosterGeneration === generation) fetchingRosterGeneration = null;
    });
    if (disposed || !dialog.open || generation !== rosterGeneration) return;
    me = meNext; presence = new Map(presNext.map(p => [p.username, p]));
    // Do not replace an action under the pointer or drop keyboard focus mid-navigation.
    // Explicit opens and mutation responses still render immediately.
    if (background && (list.contains(document.activeElement) || incomingWrap.contains(document.activeElement)
      || list.matches(':hover') || incomingWrap.matches(':hover'))) return;
    renderRoster();
  }

  async function respond(name: string, accept: boolean) {
    if (disposed || pendingResponses.has(name)) return;
    pendingResponses.add(name);
    renderRoster();
    addStatus.textContent = `${accept ? 'Accepting' : 'Declining'} @${name}…`;
    addStatus.dataset.kind = '';
    try {
      const status = await client.respond(name, accept);
      if (disposed) return;
      if (status === 'friends' || status === 'declined') {
        addStatus.textContent = status === 'friends' ? `You're now friends with @${name}!` : `Declined @${name}'s request.`;
        addStatus.dataset.kind = 'ok';
        await refreshRoster();
      } else {
        addStatus.textContent = 'Could not update this request. Try again or reopen Friends to refresh it.';
        addStatus.dataset.kind = 'error';
      }
    } catch {
      if (!disposed) {
        addStatus.textContent = 'Could not reach the city. Please try again.';
        addStatus.dataset.kind = 'error';
      }
    } finally {
      pendingResponses.delete(name);
      if (!disposed) renderRoster();
    }
  }

  function renderThread(messages: readonly DmMessage[]) {
    const followLatest = thread.scrollHeight - thread.clientHeight - thread.scrollTop <= 2;
    if (messages.length) thread.querySelector('.gt-friends-empty')?.remove();
    for (const m of messages) {
      const li = node('li', '', 'gt-friends-msg-row');
      li.dataset.mine = String(m.from === me.username);
      li.append(node('span', m.text, 'gt-friends-msg-text'));
      thread.append(li);
      lastTs = Math.max(lastTs, m.ts);
    }
    if (messages.length && followLatest) thread.scrollTop = thread.scrollHeight;
  }

  async function openDm(name: string) {
    const generation = ++dmGeneration; stopDmPoll();
    dmWith = name; lastTs = 0; dmName.textContent = `@${name}`;
    renderComposer();
    thread.replaceChildren();
    showView('dm');
    fetchingDmGeneration = generation;
    const msgs = await client.fetchDms(name).catch(() => []);
    if (fetchingDmGeneration === generation) fetchingDmGeneration = null;
    if (disposed || !dialog.open || generation !== dmGeneration || dmWith !== name) return;
    if (!msgs.length) thread.append(node('li', 'No messages yet — say hi.', 'gt-friends-empty'));
    renderThread(msgs);
    dmInput.focus({ preventScroll: true });
    startDmPoll();
  }

  async function pollDm() {
    if (!dmWith || fetchingDmGeneration === dmGeneration) return;
    const target = dmWith, generation = dmGeneration;
    fetchingDmGeneration = generation;
    try {
      // The server already uses created_at > since; adding one would skip messages.
      const msgs = await client.fetchDms(target, lastTs);
      if (!disposed && dialog.open && generation === dmGeneration && dmWith === target && msgs.length) renderThread(msgs);
    } catch { /* Keep current history; the next poll can retry. */ }
    finally { if (fetchingDmGeneration === generation) fetchingDmGeneration = null; }
  }

  function startDmPoll() { stopDmPoll(); dmTimer = setInterval(() => void pollDm(), DM_POLL_MS); }
  function stopDmPoll() { if (dmTimer !== undefined) { clearInterval(dmTimer); dmTimer = undefined; } }

  function setRosterPending(pending: boolean) {
    rosterPending = pending;
    claimBtn.disabled = addBtn.disabled = pending;
    claimInput.readOnly = addInput.readOnly = pending;
  }
  function rosterRequestFailed() {
    if (disposed) return;
    addStatus.textContent = 'Could not reach the city. Your text is still here; try again.';
    addStatus.dataset.kind = 'error';
  }
  claimForm.addEventListener('submit', async event => {
    event.preventDefault();
    const name = claimInput.value.trim();
    if (!name || rosterPending || disposed) return;
    setRosterPending(true);
    addStatus.textContent = 'Claiming…'; addStatus.dataset.kind = '';
    try {
      const res = await client.claim(name);
      if (disposed) return;
      if (res.ok) { addStatus.textContent = `You are @${res.username}.`; addStatus.dataset.kind = 'ok'; claimInput.value = ''; void refreshRoster(); }
      else {
        addStatus.textContent = { invalid: 'Use 3–20 letters, numbers or _.', rejected: 'That username was rejected.', taken: 'That username is taken.', 'already-claimed': 'You already have a username.', unavailable: 'Username claims are unavailable right now. Please try again shortly.' }[res.error] ?? 'Could not claim.';
        addStatus.dataset.kind = 'error';
      }
    } catch { rosterRequestFailed(); }
    finally { setRosterPending(false); }
  });

  addForm.addEventListener('submit', async event => {
    event.preventDefault();
    const name = addInput.value.trim();
    if (!name || rosterPending || disposed) return;
    setRosterPending(true);
    addStatus.textContent = 'Sending…'; addStatus.dataset.kind = '';
    try {
      const status = await client.request(name);
      if (disposed) return;
      addStatus.textContent = {
        requested: 'Request sent.', friends: `You're now friends with @${name}!`, exists: 'Request already pending.',
        'already-friends': 'Already friends.', self: "That's you.", 'no-username': 'Claim a username first (after your first payout).',
        unavailable: 'Friend requests are unavailable right now. Please try again shortly.',
      }[status] ?? 'Could not send.';
      addStatus.dataset.kind = status === 'friends' || status === 'requested' ? 'ok' : 'error';
      if (status === 'requested' || status === 'friends') addInput.value = '';
      void refreshRoster();
    } catch { rosterRequestFailed(); }
    finally { setRosterPending(false); }
  });

  function renderComposer() {
    if (!dmWith) return;
    const pending = pendingSends.has(dmWith), error = sendErrors.get(dmWith);
    dmInput.value = drafts.get(dmWith) ?? '';
    dmInput.readOnly = pending; dmSend.disabled = pending;
    dmSend.textContent = pending ? 'Sending…' : 'Send';
    dmStatus.textContent = pending ? 'Sending…' : error ?? '';
    dmStatus.dataset.kind = error && !pending ? 'error' : '';
  }
  dmInput.addEventListener('input', () => {
    if (!dmWith) return;
    drafts.set(dmWith, dmInput.value);
    sendErrors.delete(dmWith); dmStatus.textContent = ''; dmStatus.dataset.kind = '';
  });
  dmForm.addEventListener('submit', async event => {
    event.preventDefault();
    const text = dmInput.value.trim();
    if (!text || !dmWith || pendingSends.has(dmWith)) return;
    const to = dmWith;
    drafts.set(to, dmInput.value); pendingSends.add(to); sendErrors.delete(to); renderComposer();
    try {
      const res = await client.sendDm(to, text);
      if (disposed) return;
      if (res.ok) { drafts.delete(to); if (dmWith === to && dialog.open) void pollDm(); }
      else sendErrors.set(to, res.error === 'rejected' ? 'Message blocked. Edit it and try again.' : 'Could not send. Your draft is here; try again.');
    } catch {
      if (!disposed) sendErrors.set(to, 'Could not send. Your draft is here; try again.');
    } finally {
      pendingSends.delete(to);
      if (!disposed && dmWith === to) renderComposer();
    }
  });

  dmBack.addEventListener('click', () => { stopDmPoll(); dmGeneration++; dmWith = null; showView('roster'); void refreshRoster(); });
  closeBtn.addEventListener('click', () => close());
  dmClose.addEventListener('click', () => close());
  button.addEventListener('click', () => open());
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', settleClosed);

  function open() {
    if (disposed || dialog.open) return;
    showView('roster');
    if (!dialog.open) { setModal(true); dialog.showModal(); }
    void refreshRoster();
    rosterTimer = setInterval(() => { if (roster.hidden === false) void refreshRoster(true); }, ROSTER_REFRESH_MS);
  }
  function close() {
    if (dialog.open) dialog.close(); settleClosed();
  }
  function settleClosed() {
    // A native close event is queued; it must not tear down a newly reopened panel.
    if (dialog.open) return;
    rosterGeneration++;
    stopDmPoll(); dmGeneration++; dmWith = null;
    if (rosterTimer !== undefined) { clearInterval(rosterTimer); rosterTimer = undefined; }
    setModal(false);
  }

  return {
    button, element: dialog, open, close,
    destroy() {
      if (disposed) return; disposed = true;
      close();
      dialog.remove(); button.remove();
    },
  };
}
