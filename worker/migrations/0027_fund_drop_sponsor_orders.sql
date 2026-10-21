-- VC fund-drop sponsor checkout (PLAN-v2 decision 3; bead gtasf-v2-drop-sponsor-checkout-c41g).
-- The paid ad product that renames a future drop under a real VC/startup. A purchase is a two-step,
-- money-safe flow mirroring sponsored_angels (0022): the checkout route records a PENDING order keyed
-- by the Stripe Checkout session id (holding the full name/url, which exceed Stripe's 500-char
-- metadata limit), and the webhook captures the manual-capture charge and applies the sponsor to
-- fund_drop_sponsors via setDropSponsor(). The slot's live rename still lives in fund_drop_sponsors
-- (0018) — this table is only the checkout ledger, so the shipped admin plumbing is untouched.
-- Charges stay off until Stripe keys exist and flags.fundDropSponsors + checkoutConfigured(env).
CREATE TABLE IF NOT EXISTS fund_drop_sponsor_orders (
  checkout_id TEXT PRIMARY KEY,         -- Stripe Checkout session id
  season TEXT NOT NULL,
  slot INTEGER NOT NULL CHECK(slot >= 0),
  name TEXT NOT NULL,                   -- sponsor display name (validated 1..120)
  url TEXT,                             -- optional https link
  logo_url TEXT,                        -- optional https logo link
  amount_cents INTEGER NOT NULL CHECK(amount_cents >= 50),
  -- pending -> settled (charge captured, sponsor applied) | refunded (slot taken between buy + capture)
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'settled', 'refunded')),
  created_at INTEGER NOT NULL,
  settled_at INTEGER
);
-- Look up outstanding/held orders for a slot (double-sell guard at checkout time).
CREATE INDEX IF NOT EXISTS fund_drop_sponsor_orders_slot ON fund_drop_sponsor_orders(season, slot, status);
