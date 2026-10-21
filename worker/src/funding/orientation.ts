/**
 * Founder Orientation one-time award (PLAN-onboarding.md decision 3, gtasf-n34i). The tutorial's
 * first big cheque is server-validated: WorldFunding's tick checks each peer's authoritative pose
 * against the shared ring and credits once, ever, through the normal funding ledger. Players are
 * still "Unnamed Founder" at this point (identity comes after this payout), so the credit is allowed
 * without a startup name.
 */
import { flags } from '@gtasf/shared/flags';
import { insideOrientationRing, orientationAwardCents, ORIENTATION_LABEL, ORIENTATION_SOURCE_REF } from '@gtasf/shared/onboarding/tutorial';
import { PASSENGER_FLAG } from '../world/vehicles';
import type { FundingAwardInput, FundingPeer } from './world';

/** A peer qualifies when it is DRIVING (not on foot, not a robotaxi passenger) through the ring. */
export function orientationQualifies(peer: FundingPeer): boolean {
  if (!flags.onboarding || !peer.deviceId || peer.onFoot) return false;
  if (peer.pose.flags & PASSENGER_FLAG) return false;
  return insideOrientationRing(peer.pose.x, peer.pose.z, peer.pose.y);
}

/** The canonical credit: the cheque size is fixed server-side, never taken from the client. */
export function orientationCredit(): FundingAwardInput {
  return { source: 'event', sourceRef: ORIENTATION_SOURCE_REF, label: ORIENTATION_LABEL, amountCents: orientationAwardCents(), allowUnnamed: true };
}
