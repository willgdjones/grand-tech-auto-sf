CREATE TABLE IF NOT EXISTS referral_orders (
  order_id TEXT PRIMARY KEY,
  product TEXT NOT NULL CHECK(product IN ('outbid','ad','billboard')),
  buyer_device_id TEXT NOT NULL REFERENCES referral_devices(device_id),
  buyer_account_id TEXT NOT NULL REFERENCES referral_accounts(id),
  referrer_id TEXT REFERENCES referral_accounts(id),
  created_at INTEGER NOT NULL,
  eligible_until INTEGER NOT NULL,
  cash_cents INTEGER NOT NULL CHECK(cash_cents >= 0 AND cash_cents <= 99999999)
);
CREATE INDEX IF NOT EXISTS referral_orders_buyer ON referral_orders(buyer_account_id);
CREATE INDEX IF NOT EXISTS referral_orders_referrer ON referral_orders(referrer_id);
CREATE TABLE IF NOT EXISTS referral_fraud_identities (
  account_id TEXT NOT NULL REFERENCES referral_accounts(id),
  kind TEXT NOT NULL CHECK(kind IN ('email','card')),
  hash TEXT NOT NULL,
  PRIMARY KEY(account_id,kind,hash)
);
CREATE INDEX IF NOT EXISTS referral_fraud_lookup ON referral_fraud_identities(kind,hash);
CREATE TABLE IF NOT EXISTS referral_payments (
  order_id TEXT PRIMARY KEY REFERENCES referral_orders(order_id),
  payment_id TEXT NOT NULL UNIQUE,
  refunded_cents INTEGER NOT NULL,
  disputed INTEGER NOT NULL,
  blocked INTEGER NOT NULL DEFAULT 0,
  paid_at INTEGER NOT NULL,
  observed_at INTEGER NOT NULL,
  target_cents INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS referral_ledger (
  id TEXT PRIMARY KEY,
  order_id TEXT REFERENCES referral_orders(order_id),
  account_id TEXT NOT NULL REFERENCES referral_accounts(id),
  amount_cents INTEGER NOT NULL,
  available_at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS referral_ledger_account ON referral_ledger(account_id,available_at);
CREATE INDEX IF NOT EXISTS referral_ledger_order ON referral_ledger(order_id);
