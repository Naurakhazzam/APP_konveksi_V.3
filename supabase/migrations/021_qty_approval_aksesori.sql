-- ============================================================
-- Migration 021: QTY Approval System + Aksesori Tables
-- ============================================================

-- 1. Tabel master label alasan qty kurang (configurable)
CREATE TABLE alasan_qty (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  label       TEXT        NOT NULL,
  urutan      INT         NOT NULL DEFAULT 0,
  aktif       BOOLEAN     NOT NULL DEFAULT true,
  tenant_id   TEXT        NOT NULL DEFAULT 'STX-001',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE alasan_qty ENABLE ROW LEVEL SECURITY;
CREATE POLICY "alasan_qty_select" ON alasan_qty FOR SELECT USING (is_active_user());
CREATE POLICY "alasan_qty_insert" ON alasan_qty FOR INSERT WITH CHECK (get_current_user_role() = 'owner');
CREATE POLICY "alasan_qty_update" ON alasan_qty FOR UPDATE USING (get_current_user_role() = 'owner');
CREATE POLICY "alasan_qty_delete" ON alasan_qty FOR DELETE USING (get_current_user_role() = 'owner');

-- Seed default labels
INSERT INTO alasan_qty (label, urutan) VALUES
  ('Bahan cacat / rusak', 1),
  ('Kesalahan potong', 2),
  ('Hilang / tercecer', 3),
  ('Salah ukuran', 4),
  ('Lainnya', 99);


-- 2. Tabel antrian approval qty lebih (async, owner approve/reject)
CREATE TABLE qty_approval_request (
  id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_log_id     UUID            NOT NULL REFERENCES scan_log(id),
  bundle_id       UUID            NOT NULL REFERENCES bundle(id),
  tahap           tahap_produksi  NOT NULL,
  qty_diajukan    INT             NOT NULL,
  qty_default     INT             NOT NULL,
  status          TEXT            NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected')),
  catatan_owner   TEXT,
  resolved_at     TIMESTAMPTZ,
  resolved_by     UUID            REFERENCES user_profile(id),
  tenant_id       TEXT            NOT NULL DEFAULT 'STX-001',
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
  created_by      UUID            NOT NULL REFERENCES user_profile(id)
);

ALTER TABLE qty_approval_request ENABLE ROW LEVEL SECURITY;
CREATE POLICY "qty_approval_select" ON qty_approval_request FOR SELECT
  USING (is_active_user() AND tenant_id = 'STX-001');
CREATE POLICY "qty_approval_insert" ON qty_approval_request FOR INSERT
  WITH CHECK (is_active_user());
CREATE POLICY "qty_approval_update_owner" ON qty_approval_request FOR UPDATE
  USING (get_current_user_role() = 'owner');

CREATE INDEX idx_qty_approval_pending
  ON qty_approval_request(tenant_id, status)
  WHERE status = 'pending';


-- 3. Tabel aksesori per model produk (auto-deduct saat scan terima)
CREATE TABLE model_aksesori (
  id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id            UUID            NOT NULL REFERENCES model_produk(id) ON DELETE CASCADE,
  inventory_item_id   UUID            NOT NULL REFERENCES inventory_item(id),
  qty_per_pcs         NUMERIC(14,4)   NOT NULL CHECK (qty_per_pcs > 0),
  tahap_pakai         tahap_produksi  NOT NULL,
  tenant_id           TEXT            NOT NULL DEFAULT 'STX-001',
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
  created_by          UUID            REFERENCES user_profile(id),
  UNIQUE(model_id, inventory_item_id, tahap_pakai)
);

ALTER TABLE model_aksesori ENABLE ROW LEVEL SECURITY;
CREATE POLICY "model_aksesori_select" ON model_aksesori FOR SELECT USING (is_active_user());
CREATE POLICY "model_aksesori_insert" ON model_aksesori FOR INSERT WITH CHECK (get_current_user_role() = 'owner');
CREATE POLICY "model_aksesori_update" ON model_aksesori FOR UPDATE USING (get_current_user_role() = 'owner');
CREATE POLICY "model_aksesori_delete" ON model_aksesori FOR DELETE USING (get_current_user_role() = 'owner');

CREATE INDEX idx_model_aksesori_model ON model_aksesori(model_id, tahap_pakai);


-- 4. Tabel log pemakaian aksesori (tracking otomatis saat scan terima)
CREATE TABLE pemakaian_aksesori (
  id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id           UUID            NOT NULL REFERENCES bundle(id),
  inventory_item_id   UUID            NOT NULL REFERENCES inventory_item(id),
  qty_pakai           NUMERIC(14,4)   NOT NULL,
  tahap               tahap_produksi  NOT NULL,
  tenant_id           TEXT            NOT NULL DEFAULT 'STX-001',
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
  UNIQUE(bundle_id, inventory_item_id, tahap)
);

ALTER TABLE pemakaian_aksesori ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pemakaian_aksesori_select" ON pemakaian_aksesori FOR SELECT USING (is_active_user());
CREATE POLICY "pemakaian_aksesori_insert" ON pemakaian_aksesori FOR INSERT WITH CHECK (FALSE);


-- 5. Tambah kolom ke user_profile: PIN approval (4 digit, disimpan sebagai bcrypt hash)
ALTER TABLE user_profile
  ADD COLUMN IF NOT EXISTS approval_pin TEXT;

COMMENT ON COLUMN user_profile.approval_pin IS
  'Bcrypt hash dari PIN 4 digit owner untuk konfirmasi approve/reject qty. NULL = belum diset.';


-- 6. Tambah kolom ke scan_log: alasan qty kurang + flag qty lebih
ALTER TABLE scan_log
  ADD COLUMN IF NOT EXISTS alasan_qty_id UUID REFERENCES alasan_qty(id),
  ADD COLUMN IF NOT EXISTS is_qty_lebih   BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN scan_log.alasan_qty_id IS
  'Alasan ketika qty selesai < qty terima. Wajib diisi saat qty kurang.';
COMMENT ON COLUMN scan_log.is_qty_lebih IS
  'True jika qty selesai > qty terima. Approval request dibuat secara async.';
