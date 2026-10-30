-- Log audit aksi admin konsol TradePilot (mis. pencarian nasabah via email).
-- Tidak menyimpan email: hanya admin, aksi, userId HMAC hasil pencarian, dan waktu.
-- Idempotent: aman dijalankan ulang. Membutuhkan 0001 & 0002.
BEGIN;

CREATE TABLE IF NOT EXISTS tp_admin_audit (
  id bigserial PRIMARY KEY,
  admin_user_id integer NOT NULL,
  action text NOT NULL,
  target_user_id text,
  found boolean NOT NULL DEFAULT false,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tp_admin_audit_created_idx ON tp_admin_audit (created_at DESC);
CREATE INDEX IF NOT EXISTS tp_admin_audit_admin_idx ON tp_admin_audit (admin_user_id, created_at DESC);

COMMIT;
