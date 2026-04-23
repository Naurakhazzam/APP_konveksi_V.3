-- =============================================================================
-- MIGRATION: 002_produksi_tables.sql
-- Phase 02 — Database Schema: Tabel Produksi
-- Dibuat: 20 April 2026
-- Depends on: 001_core_tables.sql (helper functions, user_profile, karyawan, klien)
-- =============================================================================


-- =============================================================================
-- ENUMs
-- =============================================================================

CREATE TYPE po_status AS ENUM (
  'draft',
  'aktif',
  'selesai',
  'dibatalkan'
);

CREATE TYPE scan_tipe AS ENUM (
  'terima',
  'selesai'
);

-- Tahap produksi (sesuai BR-02: 7 tahap)
CREATE TYPE tahap_produksi AS ENUM (
  'cutting',
  'jahit',
  'obras',
  'kancing',
  'setrika',
  'packing',
  'qc'
);


-- =============================================================================
-- 1. TABEL: po (Purchase Order)
-- =============================================================================

CREATE TABLE po (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  no_po           TEXT        NOT NULL UNIQUE,
  klien_id        UUID        NOT NULL REFERENCES klien(id),
  status          po_status   NOT NULL DEFAULT 'draft',
  tanggal_order   DATE        NOT NULL,
  tanggal_target  DATE        NOT NULL,
  catatan         TEXT,
  tenant_id       TEXT        NOT NULL DEFAULT 'STX-001',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID        REFERENCES user_profile(id)
);

ALTER TABLE po ENABLE ROW LEVEL SECURITY;

-- Semua user aktif bisa READ
CREATE POLICY "po_select_active_user"
  ON po FOR SELECT
  USING (is_active_user() AND tenant_id = 'STX-001');

-- Hanya owner dan admin_produksi yang bisa INSERT
CREATE POLICY "po_insert"
  ON po FOR INSERT
  WITH CHECK (
    get_current_user_role() IN ('owner', 'admin_produksi')
  );

-- Hanya owner dan admin_produksi yang bisa UPDATE
CREATE POLICY "po_update"
  ON po FOR UPDATE
  USING (
    get_current_user_role() IN ('owner', 'admin_produksi')
  );

-- Hanya owner yang bisa DELETE (aksi destruktif — wajib sudo mode di app layer)
CREATE POLICY "po_delete_owner"
  ON po FOR DELETE
  USING (get_current_user_role() = 'owner');


-- =============================================================================
-- 2. TABEL: po_item
-- Item produk per PO (warna, size, qty).
-- =============================================================================

CREATE TABLE po_item (
  id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id           UUID            NOT NULL REFERENCES po(id) ON DELETE CASCADE,
  produk_id       UUID,           -- FK ke tabel produk (dibuat di migration selanjutnya)
  warna           TEXT            NOT NULL,
  size            TEXT            NOT NULL,
  qty_order       INT             NOT NULL CHECK (qty_order > 0),
  hpp_estimasi    NUMERIC(14,2)   NOT NULL DEFAULT 0,
  tenant_id       TEXT            NOT NULL DEFAULT 'STX-001',
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

ALTER TABLE po_item ENABLE ROW LEVEL SECURITY;

-- Semua user aktif bisa READ
CREATE POLICY "po_item_select_active_user"
  ON po_item FOR SELECT
  USING (is_active_user() AND tenant_id = 'STX-001');

-- Hanya owner dan admin_produksi bisa INSERT / UPDATE
CREATE POLICY "po_item_insert"
  ON po_item FOR INSERT
  WITH CHECK (get_current_user_role() IN ('owner', 'admin_produksi'));

CREATE POLICY "po_item_update"
  ON po_item FOR UPDATE
  USING (get_current_user_role() IN ('owner', 'admin_produksi'));

-- Hanya owner yang bisa DELETE
CREATE POLICY "po_item_delete_owner"
  ON po_item FOR DELETE
  USING (get_current_user_role() = 'owner');


-- =============================================================================
-- 3. TABEL: bundle
-- Satu bundle = satu barcode = satu unit kerja produksi.
-- status_tahap: JSONB menyimpan status tiap tahap, contoh:
--   { "cutting": "selesai", "jahit": "proses", "obras": "pending", ... }
-- =============================================================================

CREATE TABLE bundle (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  barcode         TEXT        NOT NULL UNIQUE,
  po_id           UUID        NOT NULL REFERENCES po(id),
  po_item_id      UUID        NOT NULL REFERENCES po_item(id),
  no_urut         INT         NOT NULL,
  status_tahap    JSONB       NOT NULL DEFAULT '{}',
  surat_jalan_id  UUID,       -- FK ke surat_jalan (dibuat di migration selanjutnya)
  tenant_id       TEXT        NOT NULL DEFAULT 'STX-001',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID        REFERENCES user_profile(id)
);

ALTER TABLE bundle ENABLE ROW LEVEL SECURITY;

-- Semua user aktif bisa READ
CREATE POLICY "bundle_select_active_user"
  ON bundle FOR SELECT
  USING (is_active_user() AND tenant_id = 'STX-001');

-- Hanya owner dan admin_produksi bisa INSERT
CREATE POLICY "bundle_insert"
  ON bundle FOR INSERT
  WITH CHECK (get_current_user_role() IN ('owner', 'admin_produksi'));

-- Hanya owner dan admin_produksi bisa UPDATE (termasuk update status_tahap saat scan)
CREATE POLICY "bundle_update"
  ON bundle FOR UPDATE
  USING (get_current_user_role() IN ('owner', 'admin_produksi'));

-- Hanya owner yang bisa DELETE
CREATE POLICY "bundle_delete_owner"
  ON bundle FOR DELETE
  USING (get_current_user_role() = 'owner');


-- =============================================================================
-- 4. TABEL: bundle_sequence
-- Menyimpan sequence global untuk penomoran bundle per tenant.
-- Satu baris per tenant. Diupdate atomic via Postgres function (Phase 05).
-- =============================================================================

CREATE TABLE bundle_sequence (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       TEXT    NOT NULL UNIQUE DEFAULT 'STX-001',
  last_sequence   INT     NOT NULL DEFAULT 0
);

ALTER TABLE bundle_sequence ENABLE ROW LEVEL SECURITY;

-- Hanya sistem (service_role) yang mengoperasikan tabel ini.
-- Tidak ada akses langsung dari user biasa via REST API.
-- Policy dummy agar RLS aktif tapi tidak ada akses via anon/authenticated role.
CREATE POLICY "bundle_sequence_no_direct_access"
  ON bundle_sequence FOR ALL
  USING (FALSE);

-- Seed baris awal untuk tenant STX-001
INSERT INTO bundle_sequence (tenant_id, last_sequence)
VALUES ('STX-001', 0);


-- =============================================================================
-- 5. TABEL: scan_log
-- Audit trail setiap scan di setiap tahap produksi.
-- Immutable — tidak ada UPDATE atau DELETE (hanya INSERT).
-- =============================================================================

CREATE TABLE scan_log (
  id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id       UUID            NOT NULL REFERENCES bundle(id),
  tahap           tahap_produksi  NOT NULL,
  tipe            scan_tipe       NOT NULL,
  qty             INT             NOT NULL CHECK (qty > 0),
  karyawan_id     UUID            REFERENCES karyawan(id),
  user_id         UUID            NOT NULL REFERENCES user_profile(id),
  catatan         TEXT,
  tenant_id       TEXT            NOT NULL DEFAULT 'STX-001',
  created_at      TIMESTAMPTZ     NOT NULL DEFAULT now()
);

ALTER TABLE scan_log ENABLE ROW LEVEL SECURITY;

-- Semua user aktif bisa READ
CREATE POLICY "scan_log_select_active_user"
  ON scan_log FOR SELECT
  USING (is_active_user() AND tenant_id = 'STX-001');

-- Owner, admin_produksi, mandor bisa INSERT (sesuai BR-10 §2.1 Scan Station)
CREATE POLICY "scan_log_insert"
  ON scan_log FOR INSERT
  WITH CHECK (
    get_current_user_role() IN ('owner', 'admin_produksi', 'mandor')
  );

-- scan_log bersifat immutable: tidak ada UPDATE atau DELETE
-- (koreksi dilakukan via entri scan_log baru dengan catatan, bukan edit)


-- =============================================================================
-- INDEXES
-- =============================================================================

-- Lookup barcode saat scan (paling sering dipakai)
CREATE INDEX idx_bundle_barcode
  ON bundle(barcode);

-- Lookup semua scan untuk bundle tertentu per tahap
CREATE INDEX idx_scan_log_bundle
  ON scan_log(bundle_id, tahap);

-- Lookup semua bundle per PO
CREATE INDEX idx_bundle_po_id
  ON bundle(po_id);

-- Lookup semua item per PO
CREATE INDEX idx_po_item_po_id
  ON po_item(po_id);
