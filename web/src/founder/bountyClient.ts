/**
 * "Most Wanted founder" bounty — client (flag mostWantedBounty; server: worker/src/world/bounty.ts). Renders the server's
 * QUEST 'bounty' / 'bounty-claimed' events: a red "$" pin on the minimap and a "MOST WANTED" tag over the target's head,
 * a banner when YOU are the target, and toasts for a new Most Wanted and a collected bounty (victim-funded: the target's
 * own WASTED cost, capped). No rules live here.
 */
import { Vector3, type Camera } from 'three';
import { formatFunding } from '@gtasf/shared/funding';
import { parseQuestEvent } from '@gtasf/shared/founder/questEvents';
import './bountyClient.css';

export interface BountyClientDeps {
  notify(title: string, detail?: string): void;
  /** The HUD $ changed (a bounty was collected): refresh the profile. */
  refreshProfile(): void;
  parent?: HTMLElement;
}
export interface BountyClient {
  onQuest(json: string): void;
  /** The current target's wire id (null = no bounty, or it's you). */
  readonly targetId: number | null;
  /** Per frame: place the over-head tag at the target's world position (metres), or hide it. */
  update(camera: Camera, target: { x: number; y: number; z: number } | null): void;
  /** The minimap pin for the target (last known position). */
  readonly marker: { x: number; z: number; letter: string; fill: string } | null;
  dispose(): void;
}

const el = (tag: string, cls: string, text = '') => { const n = document.createElement(tag); n.className = cls; if (text) n.textContent = text; return n; };

export function createBountyClient(deps: BountyClientDeps): BountyClient {
  const parent = deps.parent ?? document.body;
  const tag = el('div', 'gt-bounty-tag'); tag.hidden = true;
  const banner = el('div', 'gt-bounty-banner'); banner.hidden = true;
  parent.append(tag, banner);
  let targetId: number | null = null, last: { x: number; z: number } | null = null;
  const scratch = new Vector3();

  return {
    onQuest(json) {
      const e = parseQuestEvent(json);
      if (e?.kind === 'bounty') {
        const was = targetId;
        targetId = e.you ? null : e.targetId; last = null;
        banner.hidden = !e.you;
        if (e.you) banner.textContent = `💰 YOU'RE THE MOST WANTED FOUNDER · ${formatFunding(e.amountCents)} ON YOUR HEAD`;
        tag.textContent = `💰 MOST WANTED · ${formatFunding(e.amountCents)}`;
        if (e.targetId !== null && !e.you && was !== e.targetId) deps.notify(`💰 Most Wanted: ${e.name}`, `Up to ${formatFunding(e.amountCents)} out of their valuation. Take them down.`);
      } else if (e?.kind === 'bounty-claimed') {
        if (e.you) { deps.notify(`💰 Bounty collected: +${formatFunding(e.amountCents)}`, `You took down ${e.target}.`); deps.refreshProfile(); }
        else deps.notify(`💰 ${e.killer} took down ${e.target}`, `${formatFunding(e.amountCents)} bounty collected.`);
      }
    },
    get targetId() { return targetId; },
    update(camera, target) {
      if (targetId === null || !target) { tag.hidden = true; return; }
      last = { x: target.x, z: target.z };
      scratch.set(target.x, target.y + 2.4, target.z).project(camera);
      const visible = scratch.z > -1 && scratch.z < 1 && Math.abs(scratch.x) < 1.1 && Math.abs(scratch.y) < 1.1;
      tag.hidden = !visible;
      if (visible) tag.style.transform = `translate(${((scratch.x + 1) / 2 * innerWidth).toFixed(0)}px, ${((1 - scratch.y) / 2 * innerHeight).toFixed(0)}px) translate(-50%, -100%)`;
    },
    get marker() { return targetId !== null && last ? { x: last.x, z: last.z, letter: '$', fill: '#e5484d' } : null; },
    dispose() { tag.remove(); banner.remove(); },
  };
}
