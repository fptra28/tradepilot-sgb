-- Persisted operational health for the TradePilot admin console.
-- Idempotent and safe to run more than once.
BEGIN;

CREATE TABLE IF NOT EXISTS tp_operational_health (
  key text PRIMARY KEY,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  checked_at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS tp_operational_event (
  id bigserial PRIMARY KEY,
  category text NOT NULL,
  success boolean NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tp_operational_event_category_created_idx
  ON tp_operational_event (category, created_at);

COMMIT;
