CREATE TABLE IF NOT EXISTS referral_credit_holds (
  order_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES referral_accounts(id),
  gross_cents INTEGER NOT NULL,
  credit_cents INTEGER NOT NULL,
  consumed_cents INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('held','consumed','released')),
  session_id TEXT UNIQUE,
  payment_id TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS referral_credit_account ON referral_credit_holds(account_id,state);
