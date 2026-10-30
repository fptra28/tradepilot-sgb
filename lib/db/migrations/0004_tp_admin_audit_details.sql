-- Detail aksi admin (mis. penyesuaian kredit: mode, nilai sebelum/sesudah).
-- Idempotent: aman dijalankan ulang. Membutuhkan 0003.
BEGIN;
ALTER TABLE tp_admin_audit ADD COLUMN IF NOT EXISTS details jsonb;
COMMIT;
