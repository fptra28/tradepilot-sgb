-- Aligns Trade Pilot v1 with "Requirement API — TradePilot" (2026-10-15).
-- Idempotent: safe to run more than once. Requires 0001_trade_pilot_v1.sql.
BEGIN;

-- Auto-provisioned users (opaque HMAC id only, no PII).
CREATE TABLE IF NOT EXISTS tp_user (
  user_id text PRIMARY KEY,
  first_seen_mode text NOT NULL CHECK (first_seen_mode IN ('demo', 'real')),
  created_at timestamptz NOT NULL DEFAULT now(),
  bootstrapped_at timestamptz
);

-- Backfill users that already have a credit balance.
INSERT INTO tp_user (user_id, first_seen_mode, created_at, bootstrapped_at)
SELECT DISTINCT ON (user_id) user_id, mode, updated_at, updated_at
FROM tp_credit_balance
ORDER BY user_id, updated_at
ON CONFLICT (user_id) DO NOTHING;

-- Data snapshot, localized market context, and audit trail per analysis.
ALTER TABLE tp_analysis ADD COLUMN IF NOT EXISTS candle_count integer;
ALTER TABLE tp_analysis ADD COLUMN IF NOT EXISTS candle_as_of timestamptz;
ALTER TABLE tp_analysis ADD COLUMN IF NOT EXISTS market_context jsonb;
ALTER TABLE tp_analysis ADD COLUMN IF NOT EXISTS model text;
ALTER TABLE tp_analysis ADD COLUMN IF NOT EXISTS prompt_version text;
ALTER TABLE tp_analysis ADD COLUMN IF NOT EXISTS ai_input jsonb;
ALTER TABLE tp_analysis ADD COLUMN IF NOT EXISTS ai_output jsonb;
ALTER TABLE tp_analysis ADD COLUMN IF NOT EXISTS ai_cache_hit boolean NOT NULL DEFAULT false;
ALTER TABLE tp_analysis ADD COLUMN IF NOT EXISTS prompt_tokens integer NOT NULL DEFAULT 0;
ALTER TABLE tp_analysis ADD COLUMN IF NOT EXISTS completion_tokens integer NOT NULL DEFAULT 0;
ALTER TABLE tp_analysis ADD COLUMN IF NOT EXISTS total_tokens integer NOT NULL DEFAULT 0;
ALTER TABLE tp_analysis ADD COLUMN IF NOT EXISTS estimated_cost_usd numeric(12,6) NOT NULL DEFAULT 0;
ALTER TABLE tp_analysis ADD COLUMN IF NOT EXISTS request_id text;
CREATE INDEX IF NOT EXISTS tp_analysis_user_mode_status_idx ON tp_analysis (user_id, mode, status);

-- Per-level price alert status.
ALTER TABLE tp_price_alert ADD COLUMN IF NOT EXISTS triggered_levels jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE tp_price_alert ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Saved trading plans (input + FE-calculated result).
CREATE TABLE IF NOT EXISTS tp_trading_plan (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  analysis_id text NOT NULL REFERENCES tp_analysis(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('demo', 'real')),
  variant text NOT NULL CHECK (variant IN ('buy', 'sell')),
  account_type text NOT NULL CHECK (account_type IN ('micro', 'mini', 'regular')),
  trading_capital numeric(24,2) NOT NULL CHECK (trading_capital > 0),
  loss_limit numeric(24,2) NOT NULL CHECK (loss_limit >= 0),
  risk_style text NOT NULL,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tp_trading_plan_user_analysis_idx ON tp_trading_plan (user_id, analysis_id, created_at);

COMMIT;
