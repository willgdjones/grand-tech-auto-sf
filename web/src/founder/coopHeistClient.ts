/**
 * Co-op heist — client (flag coopHeist; server: WorldDO handleHeistJoin / completeCrewRun / releaseCrew). An invite card
 * (Join as the getaway driver) for players near the rival's office when someone starts the heist; for the crew, a HUD
 * line + minimap marker (the office's grab, then the First Round drop) and an automatic delivery attempt while standing
 * at the drop; notices for the leader ("X is your getaway driver") and both payouts. Every rule is server-side.
 * Reuses the street-race card styles (gt-race-card*, gt-race-hud).
 */
import { missionById } from '@gtasf/shared/founder/missions';
import { formatFunding } from '@gtasf/shared/funding';
import { parseQuestEvent, type QuestEvent } from '@gtasf/shared/founder/questEvents';
import { placePoint } from '../spawn/locations';
import './streetRaceClient.css';

export interface CoopHeistClientDeps {
  sid(): number | undefined;
  notify(title: string, detail?: string): void;
  /** The player is on their own job / trial / race: don't pop invites. */
  busy(): boolean;
  refreshProfile(): void;
  parent?: HTMLElement;
}
export interface CoopHeistClient {
  onQuest(json: string): void;
  update(player: { readonly x: number; readonly z: number }): void;
  readonly marker: { x: number; z: number; letter: string } | null;
  /** On a crew run: the player's own job starts should stand down. */
  readonly crewing: boolean;
  dispose(): void;
}

const HEIST = missionById('steal-pitch-deck');
const RETRY_MS = 2500;
const el = (tag: string, cls: string, text = '') => { const n = document.createElement(tag); n.className = cls; if (text) n.textContent = text; return n; };

export function createCoopHeistClient(deps: CoopHeistClientDeps): CoopHeistClient {
  const parent = deps.parent ?? document.body;
  const card = el('section', 'gt-race-card'); card.hidden = true;
  const hud = el('div', 'gt-race-hud'); hud.hidden = true;
  parent.append(card, hud);
  const grab = HEIST ? placePoint(HEIST.start) : null;
  const dropObjective = HEIST ? [...HEIST.objectives].reverse().find(o => o.at) : undefined;
  const drop = dropObjective?.at ? placePoint(dropObjective.at) : null;
  const dropRadius = Math.max(4, (dropObjective?.radiusM ?? 10) - 2);
  let crew: { host: string; grabbed: boolean; note: string } | null = null;
  let tryAt = 0, inflight = false, cardTimer: ReturnType<typeof setTimeout> | undefined;

  async function post(path: string, body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    try {
      const r = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, sid: deps.sid() }) });
      return await r.json() as Record<string, unknown>;
    } catch { return null; }
  }
  function end(): void { crew = null; hud.hidden = true; }
  function invite(e: Extract<QuestEvent, { kind: 'heist-invite' }>): void {
    if (crew || deps.busy() || !HEIST) return;
    card.replaceChildren(el('div', 'gt-race-card-title', `🚗 ${e.host} is stealing the pitch deck`),
      el('div', 'gt-race-card-line', `Be their getaway driver: same payout, your own daily heist. Join at the office within ${Math.round(e.joinInMs / 1000)} s.`));
    const row = el('div', 'gt-race-card-actions');
    const join = el('button', 'gt-race-card-btn', 'Join'), close = el('button', 'gt-race-card-btn gt-race-card-close', 'Dismiss');
    join.addEventListener('click', async () => {
      card.hidden = true;
      const res = await post('/api/funding/heist-join', { hostSid: e.hostSid });
      if (res?.status === 'joined') { crew = { host: String(res.host ?? e.host), grabbed: false, note: '' }; return; }
      const why: Record<string, string> = { 'too-far': 'Get to the rival’s office (the H) to join.', cooldown: 'You already pulled the heist today.',
        full: 'They already have a driver.', closed: 'Too late — they’re gone.', busy: 'Finish your current job first.' };
      deps.notify('Couldn’t join the heist.', why[String(res?.reason)] ?? 'That heist is over.');
    });
    close.addEventListener('click', () => { card.hidden = true; });
    row.append(join, close); card.append(row); card.hidden = false;
    if (cardTimer) clearTimeout(cardTimer);
    cardTimer = setTimeout(() => { card.hidden = true; }, e.joinInMs);
  }
  async function deliver(): Promise<void> {
    inflight = true;
    const res = await post('/api/funding/mission-complete', {});
    inflight = false;
    if (!crew) return;
    const status = String(res?.status ?? '');
    if (status === 'completed') {
      const amount = (res?.outcome as { amountCents?: string } | undefined)?.amountCents;
      deps.notify('🚗 Getaway pays off', amount ? `+${formatFunding(amount)} for your part in the heist.` : 'Paid.'); deps.refreshProfile(); end();
    } else if (status === 'waiting-for-leader') crew.note = `Waiting for ${crew.host} to deliver the deck`;
    else if (status === 'too-late') { deps.notify('Too late.', `${crew.host} delivered over 2 minutes ago.`); end(); }
    else if (status === 'blocked' || res?.error === 'no-active-mission') { deps.notify('The heist is over for you.'); end(); }
    else crew.note = 'Not yet — lose the heat and make sure you passed the office';
  }

  return {
    onQuest(json) {
      const e = parseQuestEvent(json);
      if (!e) return;
      if (e.kind === 'heist-invite') invite(e);
      else if (e.kind === 'heist-crew') deps.notify(e.role === 'leader' ? `🚗 ${e.partner} is your getaway driver` : `🚗 You’re ${e.partner}’s getaway driver`,
        e.role === 'leader' ? 'Both of you get paid when you deliver together.' : 'Pass the office, lose the heat, meet them at First Round.');
      else if (e.kind === 'heist-paid') { deps.notify('🚗 Getaway pays off', `+${formatFunding(e.amountCents)} — ${e.partner} delivered the deck.`); deps.refreshProfile(); end(); }
      else if (e.kind === 'heist-cancelled') { if (crew) deps.notify('Heist called off.', 'Your crew dropped out.'); end(); }
    },
    update(player) {
      if (!crew || !grab || !drop) return;
      if (!crew.grabbed && Math.hypot(player.x - grab.x, player.z - grab.z) <= 9) crew.grabbed = true;
      const atDrop = crew.grabbed && Math.hypot(player.x - drop.x, player.z - drop.z) <= dropRadius;
      if (atDrop && !inflight && performance.now() >= tryAt) { tryAt = performance.now() + RETRY_MS; void deliver(); }
      hud.hidden = false;
      hud.textContent = `🚗 Getaway for ${crew.host} · ${crew.note && atDrop ? crew.note : crew.grabbed ? 'meet them at First Round (D)' : 'pass the rival’s office (H)'}`;
    },
    get marker() {
      if (!crew || !grab || !drop) return null;
      return crew.grabbed ? { x: drop.x, z: drop.z, letter: 'D' } : { x: grab.x, z: grab.z, letter: 'H' };
    },
    get crewing() { return crew !== null; },
    dispose() { card.remove(); hud.remove(); if (cardTimer) clearTimeout(cardTimer); },
  };
}
