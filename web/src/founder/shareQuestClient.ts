/**
 * Founder-ladder phase 5.1 — client for the Thought-leader "repost my take" SHARE quest (flags.shareQuest).
 * Walk up + E → a card shows the thought-leader's FICTIONAL take with "Repost on X" (opens x.com/intent/post
 * pre-filled — the player posts from their OWN account; we never post for them) + "I reposted it" which POSTs
 * the once-ever claim. The server can't verify the post; the once-ever ref is the anti-farm bound.
 *
 * Inert unless a share NPC is mounted (itself gated by flags.shareQuest), so it never runs in a prod build
 * with the flag off. (In its own file — shareQuest.ts is the worker money path.)
 */
import type { MemeNpcSpec } from '@gtasf/shared/founder/memeQuests';
import type { FundingProfile } from '@gtasf/shared/funding';

export interface FounderShareQuestDeps {
  /** Refresh the valuation HUD + round state with the server's post-credit profile. */
  onProfile(profile: FundingProfile): void;
  /** Surface the result as a non-blocking toast. */
  notify(title: string, detail?: string): void;
  /** The referral-wrapped game link to attach to the repost (inbound attribution; may be async). */
  shareUrl(): string | Promise<string>;
}

async function post(path: string, body: unknown): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) return null;
    return await r.json() as Record<string, unknown>;
  } catch { return null; }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.className = className; if (text) node.textContent = text; return node;
}

export interface FounderShareQuest {
  /** Open the share card for a share NPC. No-op for non-share NPCs or a take-less spec. */
  start(spec: MemeNpcSpec): void;
  dispose(): void;
}

export function createFounderShareQuest(deps: FounderShareQuestDeps): FounderShareQuest {
  const root = el('section', 'gt-share-quest'); root.hidden = true;
  const card = el('div', 'gt-share-quest-card');
  const kicker = el('div', 'gt-share-quest-kicker');
  const take = el('p', 'gt-share-quest-take');
  const actions = el('div', 'gt-share-quest-actions');
  const repost = el('button', 'gt-share-quest-repost', 'Repost on X ↗');
  const done = el('button', 'gt-share-quest-done', 'I reposted it');
  const close = el('button', 'gt-share-quest-close', '✕'); close.setAttribute('aria-label', 'Close');
  actions.append(repost, done); card.append(close, kicker, take, actions); root.append(card); document.body.append(root);
  let current: MemeNpcSpec | null = null, claiming = false, shareLink = '';
  const hide = () => { root.hidden = true; current = null; claiming = false; };
  close.addEventListener('click', hide);
  repost.addEventListener('click', () => {
    if (!current?.take) return;
    const intent = new URL('https://x.com/intent/post');
    intent.searchParams.set('text', current.take); // the player posts from their OWN account; we never post.
    if (shareLink) intent.searchParams.set('url', shareLink);
    window.open(intent.href, '_blank', 'noopener'); // sync on the click gesture, so popup blockers allow it
  });
  done.addEventListener('click', () => {
    if (!current || claiming) return;
    claiming = true; done.disabled = true;
    const id = current.id;
    void post('/api/funding/share-claim', { npcId: id }).then(res => {
      if (res?.status === 'completed') { if (res.profile) deps.onProfile(res.profile as FundingProfile); deps.notify('Thanks for the repost!', 'Valuation up.'); hide(); }
      else if (res?.status === 'blocked') { deps.notify('You already reposted this one.'); hide(); }
      else { deps.notify("Couldn't record that — try again."); claiming = false; done.disabled = false; }
    });
  });
  return {
    start(spec) {
      if (spec.questKind !== 'share' || !spec.take) return;
      current = spec; claiming = false; done.disabled = false;
      kicker.textContent = `SIDE QUEST · ${spec.archetype}`;
      take.textContent = `“${spec.take}”`;
      // Resolve the (possibly-async) referral link now, while the player reads the take, so the repost
      // click can open X synchronously with the link already in hand.
      shareLink = ''; void Promise.resolve(deps.shareUrl()).then(link => { shareLink = link; }).catch(() => {});
      root.hidden = false;
    },
    dispose() { root.remove(); current = null; },
  };
}
