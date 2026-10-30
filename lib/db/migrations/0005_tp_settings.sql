-- Pengaturan TradePilot yang bisa diubah super_admin dari konsol admin
-- (kuota kredit standar per mode, kill switch analisis). Nilai kosong = pakai
-- default dari env. Idempotent: aman dijalankan ulang.
BEGIN;

CREATE TABLE IF NOT EXISTS tp_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by integer,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
