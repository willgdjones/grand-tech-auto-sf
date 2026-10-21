-- Living map pitching (flag pitching, gtasf-y5vc, docs/engineering/living-map.md): the AI pitch judge's daily
-- spend meter (SF day). micro_usd = reserved/reconciled OpenRouter cost; refused = pitches scored by the fallback
-- because the $10/day cap was reached. No transcripts or audio are stored. Payouts go through funding_credits.
CREATE TABLE IF NOT EXISTS pitch_judge_spend (
  day       TEXT PRIMARY KEY,
  micro_usd INTEGER NOT NULL DEFAULT 0,
  calls     INTEGER NOT NULL DEFAULT 0,
  refused   INTEGER NOT NULL DEFAULT 0
);
