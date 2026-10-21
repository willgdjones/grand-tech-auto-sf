/** Cosmetic party state. Hosts and positions are resolved from authenticated WorldDO peers. */
export interface FundingParty {
  hostId: string;
  startupName: string;
  anchor: { x: number; y: number; z: number };
  endsAt: number;
}
export interface FundingParties { parties: FundingParty[]; yours: FundingParty | null; serverNow: number }
export const FUNDING_PARTY_DURATION_MS = 15 * 60_000;
