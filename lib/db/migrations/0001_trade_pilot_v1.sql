BEGIN;

CREATE TABLE IF NOT EXISTS tp_credit_balance (
  user_id text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('demo', 'real')),
  allowance integer NOT NULL CHECK (allowance >= 0),
  consumed integer NOT NULL DEFAULT 0 CHECK (consumed >= 0),
  period_start timestamptz NOT NULL,
  resets_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, mode)
);
CREATE INDEX IF NOT EXISTS tp_credit_balance_resets_at_idx ON tp_credit_balance (resets_at);

CREATE TABLE IF NOT EXISTS tp_analysis (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('demo', 'real')),
  instrument_id text NOT NULL,
  instrument_label text NOT NULL,
  timeframe text NOT NULL,
  timeframe_label text NOT NULL,
  direction text NOT NULL,
  market_sentiment text NOT NULL,
  price_at_analysis numeric(24,8) NOT NULL,
  buy_levels jsonb NOT NULL,
  sell_levels jsonb NOT NULL,
  indicators jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'still_valid',
  active_side text,
  take_profit_one_hit_at timestamptz,
  last_evaluated_price numeric(24,8),
  analyzed_at timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz NOT NULL,
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS tp_analysis_user_mode_analyzed_idx ON tp_analysis (user_id, mode, analyzed_at DESC);
CREATE INDEX IF NOT EXISTS tp_analysis_status_idx ON tp_analysis (status);

CREATE TABLE IF NOT EXISTS tp_idempotency (
  user_id text NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  analysis_id text NOT NULL REFERENCES tp_analysis(id) ON DELETE CASCADE,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
CREATE INDEX IF NOT EXISTS tp_idempotency_created_at_idx ON tp_idempotency (created_at);

CREATE TABLE IF NOT EXISTS tp_price_alert (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  analysis_id text NOT NULL REFERENCES tp_analysis(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('demo', 'real')),
  side text NOT NULL CHECK (side IN ('buy', 'sell')),
  levels jsonb NOT NULL,
  channels jsonb NOT NULL,
  active boolean NOT NULL DEFAULT true,
  last_triggered_level text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tp_price_alert_analysis_side_unique UNIQUE (analysis_id, side)
);
CREATE INDEX IF NOT EXISTS tp_price_alert_active_idx ON tp_price_alert (active);

CREATE TABLE IF NOT EXISTS tp_performance_snapshot (
  mode text NOT NULL CHECK (mode IN ('demo', 'real')),
  instrument_id text NOT NULL DEFAULT '*',
  timeframe text NOT NULL,
  sample integer NOT NULL DEFAULT 0,
  still_valid integer NOT NULL DEFAULT 0,
  expired integer NOT NULL DEFAULT 0,
  stop_loss integer NOT NULL DEFAULT 0,
  tp1 integer NOT NULL DEFAULT 0,
  tp2 integer NOT NULL DEFAULT 0,
  win_rate integer,
  completion integer,
  minimum_samples integer,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mode, instrument_id, timeframe)
);

COMMIT;
