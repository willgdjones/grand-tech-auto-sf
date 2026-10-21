import { flags } from '@gtasf/shared/flags';
import { type DeathKind, SF_GENERAL_RESPAWN } from '@gtasf/shared/combat/economy';
import type { Env } from '../env';
import { fundingDevice, fundingSameOrigin } from '../funding/identity';
import { getFundingProfile } from '../funding/store';
import { applyCombatPenalty } from '../funding/penalty';
import { buyWeapon, ownedWeapons } from './shop';

/**
 * GTA V pivot — LANE B (combat & police) HTTP routes (flag combat, gtasf-combat-gate-health-economy-8cqg).
 *
 * `/api/combat/death` applies the valuation cost of being WASTED (−2%, min $1k) or BUSTED (−5%) and returns
 * the new valuation plus the respawn anchor (SF General). It is handled here in the Worker (not WorldDO)
 * because it only needs the authenticated device + D1 — death is self-reported in v1 and the cost is a pure
 * self-inflicted debit, idempotent on `incidentId`. When server-validated damage drives death later
 * (lane B step 5), WorldDO will call applyCombatPenalty directly with a server-minted incident id.
 */
function combatJson(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function handleCombatRequest(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith('/api/combat/')) return null;
  if (!flags.combat) return combatJson({ error: 'Combat is disabled' }, 503);
  if (!fundingSameOrigin(request)) return combatJson({ error: 'Same-origin request required' }, 403);

  if (path === '/api/combat/death' && request.method === 'POST') {
    let body: unknown;
    try { body = await request.json(); } catch { return combatJson({ error: 'Invalid body' }, 400); }
    const kind = (body as { kind?: unknown } | null)?.kind;
    const incidentId = (body as { incidentId?: unknown } | null)?.incidentId;
    if (kind !== 'wasted' && kind !== 'busted') return combatJson({ error: 'Invalid kind' }, 400);
    if (typeof incidentId !== 'string' || incidentId.length < 1 || incidentId.length > 200) return combatJson({ error: 'Invalid incident id' }, 400);
    // The 'srv:' namespace is reserved for server-minted death incidents (WorldDO server-driven deaths, step 5):
    // a client must not be able to pre-claim one, which would let it block the authoritative debit for that id.
    if (incidentId.startsWith('srv:')) return combatJson({ error: 'Reserved incident id' }, 400);

    const device = await fundingDevice(request, env.DB);
    if (!device) return combatJson({ error: 'not-connected' }, 409);

    const now = Date.now();
    try {
      const result = await applyCombatPenalty(env.DB, device, incidentId, kind as DeathKind, now);
      if (!result.ok) {
        const status = result.reason === 'unknown-profile' ? 409 : 503;
        return combatJson({ error: result.reason }, status);
      }
      return combatJson({
        status: 'applied',
        kind: result.kind,
        costCents: result.costCents,
        currentCents: result.currentCents,
        replay: result.replay,
        respawn: SF_GENERAL_RESPAWN,
        profile: await getFundingProfile(env.DB, device, now),
      });
    } catch (error) {
      // A client-supplied incident id that collides with another device throws; treat as a bad request.
      if (error instanceof RangeError) return combatJson({ error: error.message }, 400);
      console.warn('combat-death failed', error instanceof Error ? error.name : 'unknown');
      return combatJson({ error: 'unavailable' }, 503);
    }
  }

  // savedLoadout (critique #20): the weapons this device bought, so they come back next session. Read-only.
  if (path === '/api/combat/loadout' && request.method === 'GET') {
    if (!flags.savedLoadout || !flags.gunShop) return combatJson({ error: 'off' }, 404);
    const device = await fundingDevice(request, env.DB);
    if (!device) return combatJson({ weapons: [] });
    try { return combatJson({ weapons: await ownedWeapons(env.DB, device) }); }
    catch (error) { console.warn('combat-loadout failed', error instanceof Error ? error.name : 'unknown'); return combatJson({ error: 'unavailable' }, 503); }
  }

  if (path === '/api/combat/buy-weapon' && request.method === 'POST') {
    if (!flags.gunShop) return combatJson({ error: 'Gun shop is disabled' }, 503);
    let body: unknown;
    try { body = await request.json(); } catch { return combatJson({ error: 'Invalid body' }, 400); }
    const weapon = (body as { weapon?: unknown } | null)?.weapon;
    const allowDownRound = (body as { allowDownRound?: unknown } | null)?.allowDownRound === true; // the player confirmed the drop
    if (typeof weapon !== 'string') return combatJson({ error: 'Invalid weapon' }, 400);
    const device = await fundingDevice(request, env.DB);
    if (!device) return combatJson({ error: 'not-connected' }, 409);
    const now = Date.now();
    try {
      const result = await buyWeapon(env.DB, device, weapon, now, { allowDownRound });
      if (!result.ok && result.reason === 'down-round') return combatJson({ error: 'down-round', round: result.round, priceCents: result.priceCents }, 409);
      if (!result.ok) {
        const status = result.reason === 'unknown-profile' ? 409 : result.reason === 'not-for-sale' ? 400 : 402;
        return combatJson({ error: result.reason }, status);
      }
      return combatJson({
        status: result.owned ? 'owned' : 'bought',
        weapon: result.weapon,
        chargedCents: result.chargedCents,
        currentCents: result.currentCents,
        profile: await getFundingProfile(env.DB, device, now),
      });
    } catch (error) {
      console.warn('combat-buy failed', error instanceof Error ? error.name : 'unknown');
      return combatJson({ error: 'unavailable' }, 503);
    }
  }

  return combatJson({ error: 'Not found' }, 404);
}
