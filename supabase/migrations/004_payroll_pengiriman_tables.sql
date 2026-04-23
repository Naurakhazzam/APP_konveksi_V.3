-- =============================================================================
-- MIGRATION: 004_payroll_pengiriman_tables.sql
-- Phase 02 — Database Schema: Payroll & Pengiriman
-- Dibuat: 20 April 2026
-- Depends on: 001_core_tables.sql, 002_produksi_tables.sql, 003_inventory_jurnal_tables.sql
-- =============================================================================


-- =============================================================================
-- 1. TABEL: gaji_ledger
-- Ledger upah karyawan (BR-07). Setiap entri = satu unit upah.
-- Immutable setelah INSERT — tidak ada UPDATE langsung (hanya via RPC atomic).
-- Status flow: belum_lunas → lunas / escrow / cancelled
-- =============================================================================

CREATE TYPE gaji_ledger_tipe AS ENUM (
  'selesai',        -- upah normal dari scan selesai
  'reject_potong',  -- potongan akibat reject
  'rework'          -- upah rework
);

CREATE TYPE gaji_status AS ENUM (
  'belum_lunas',
  'lunas',
  'escrow',         -- di-hold, belum bisa dicairkan
  'cancelled'
);

CREATE TABLE gaji_ledger (
  id              UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  karyawan_id     UUID              NOT NULL REFERENCES karyawan(id),
  tipe            gaji_ledger_tipe  NOT NULL,
  total           NUMERIC(14,2)     NOT NULL CHECK (total > 0),
  tanggal         DATE              NOT NULL,
  sumber_id       TEXT              NOT NULL,   -- scan_log.id atau koreksi_qty.id sebagai reference
  keterangan      TEXT              NOT NULL,
  status          gaji_status       NOT NULL DEFAULT 'belum_lunas',
  tanggal_bayar   TIMESTAMPTZ,                  -- diisi saat status menjadi 'lunas'
  is_printed      BOOLEAN           NOT NULL DEFAULT FALSE,
  tenant_id       TEXT              NOT NULL DEFAULT 'STX-001',
  created_at      TIMESTAMPTZ       NOT NULL DEFAULT now(),
  created_by      UUID              REFERENCES user_profile(id)
);

ALTER TABLE gaji_ledger ENABLE ROW LEVEL SECURITY;

-- Hanya owner dan supervisor yang bisa READ gaji_ledger (sesuai BR-10 §2.1)
CREATE POLICY "gaji_ledger_select"
  ON gaji_ledger FOR SELECT
  USING (
    get_current_user_role() IN ('owner', 'supervisor')
    AND tenant_id = 'STX-001'
  );

-- INSERT hanya via service_role (Postgres RPC atomic — BR-07 pay_salary_atomic)
-- Tidak ada INSERT langsung via authenticated user
CREATE POLICY "gaji_ledger_no_direct_insert"
  ON gaji_ledger FOR INSERT
  WITH CHECK (FALSE);

-- UPDATE status (bayar) hanya via service_role (RPC atomic)
CREATE POLICY "gaji_ledger_no_direct_update"
  ON gaji_ledger FOR UPDATE
  USING (FALSE);

-- Tidak ada DELETE — immutable payroll record


-- =============================================================================
-- 2. TABEL: kasbon
-- Pinjaman karyawan yang dipotong dari gaji.
-- =============================================================================

CREATE TYPE kasbon_status AS ENUM (
  'belum_lunas',
  'lunas'
);

CREATE TABLE kasbon (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  karyawan_id     UUID          NOT NULL REFERENCES karyawan(id),
  jumlah          NUMERIC(14,2) NOT NULL CHECK (jumlah > 0),
  tanggal         DATE          NOT NULL,
  keterangan      TEXT          NOT NULL,
  status          kasbon_status NOT NULL DEFAULT 'belum_lunas',
  tenant_id       TEXT          NOT NULL DEFAULT 'STX-001',
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  created_by      UUID          REFERENCES user_profile(id)
);

ALTER TABLE kasbon ENABLE ROW LEVEL SECURITY;

-- Owner dan supervisor bisa READ kasbon (sesuai BR-10 §2.1 Kasbon)
CREATE POLICY "kasbon_select"
  ON kasbon FOR SELECT
  USING (
    get_current_user_role() IN ('owner', 'supervisor')
    AND tenant_id = 'STX-001'
  );

-- Owner dan supervisor bisa INSERT kasbon baru (sesuai BR-10 §2.2 Manage Kasbon)
CREATE POLICY "kasbon_insert"
  ON kasbon FOR INSERT
  WITH CHECK (get_current_user_role() IN ('owner', 'supervisor'));

-- UPDATE status (lunas) oleh owner atau supervisor
CREATE POLICY "kasbon_update"
  ON kasbon FOR UPDATE
  USING (get_current_user_role() IN ('owner', 'supervisor'));

-- Hanya owner yang bisa DELETE
CREATE POLICY "kasbon_delete_owner"
  ON kasbon FOR DELETE
  USING (get_current_user_role() = 'owner');


-- =============================================================================
-- 3. TABEL: surat_jalan
-- Header surat jalan. Status hanya 'draft' atau 'final'.
-- Setelah final, bundle tidak bisa dipindah ke SJ lain (enforced di app layer + RLS).
-- =============================================================================

CREATE TYPE sj_status AS ENUM (
  'draft',
  'final'
);

CREATE TABLE surat_jalan (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  nomor_sj        TEXT        NOT NULL UNIQUE,
  klien_id        UUID        NOT NULL REFERENCES klien(id),
  tanggal         DATE        NOT NULL,
  status          sj_status   NOT NULL DEFAULT 'final',
  catatan         TEXT,
  tenant_id       TEXT        NOT NULL DEFAULT 'STX-001',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID        REFERENCES user_profile(id)
);

ALTER TABLE surat_jalan ENABLE ROW LEVEL SECURITY;

-- Semua user aktif bisa READ surat jalan (sesuai BR-10 §2.1 Riwayat Pengiriman)
CREATE POLICY "surat_jalan_select_active_user"
  ON surat_jalan FOR SELECT
  USING (is_active_user() AND tenant_id = 'STX-001');

-- Hanya owner dan admin_produksi bisa INSERT (sesuai BR-10 §2.1 Buat Surat Jalan)
CREATE POLICY "surat_jalan_insert"
  ON surat_jalan FOR INSERT
  WITH CHECK (get_current_user_role() IN ('owner', 'admin_produksi'));

-- Hanya owner dan admin_produksi bisa UPDATE (sebelum final)
-- Setelah final: enforced di app layer via Server Action
CREATE POLICY "surat_jalan_update"
  ON surat_jalan FOR UPDATE
  USING (get_current_user_role() IN ('owner', 'admin_produksi'));

-- Hanya owner yang bisa DELETE
CREATE POLICY "surat_jalan_delete_owner"
  ON surat_jalan FOR DELETE
  USING (get_current_user_role() = 'owner');


-- =============================================================================
-- 4. TABEL: surat_jalan_item
-- Relasi bundle ke surat jalan. UNIQUE(bundle_id) mencegah satu bundle masuk 2 SJ.
-- =============================================================================

CREATE TABLE surat_jalan_item (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  sj_id           UUID    NOT NULL REFERENCES surat_jalan(id) ON DELETE CASCADE,
  bundle_id       UUID    NOT NULL REFERENCES bundle(id) UNIQUE,  -- satu bundle hanya di satu SJ
  qty_kirim       INT     NOT NULL CHECK (qty_kirim > 0),
  tenant_id       TEXT    NOT NULL DEFAULT 'STX-001',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE surat_jalan_item ENABLE ROW LEVEL SECURITY;

-- Semua user aktif bisa READ
CREATE POLICY "sj_item_select_active_user"
  ON surat_jalan_item FOR SELECT
  USING (is_active_user() AND tenant_id = 'STX-001');

-- INSERT via RPC finalize_surat_jalan (SECURITY DEFINER) — tidak langsung
CREATE POLICY "sj_item_no_direct_insert"
  ON surat_jalan_item FOR INSERT
  WITH CHECK (FALSE);

-- Tidak ada UPDATE atau DELETE — immutable setelah SJ final


-- =============================================================================
-- 5. TABEL: sj_sequence
-- Sequence nomor SJ per tahun per tenant (format: SJ/2026/00001).
-- =============================================================================

CREATE TABLE sj_sequence (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  tahun           INT     NOT NULL,
  tenant_id       TEXT    NOT NULL DEFAULT 'STX-001',
  last_sequence   INT     NOT NULL DEFAULT 0,

  CONSTRAINT unique_sj_sequence UNIQUE (tahun, tenant_id)
);

ALTER TABLE sj_sequence ENABLE ROW LEVEL SECURITY;

-- Tidak ada akses langsung — hanya via service_role / Postgres function
CREATE POLICY "sj_sequence_no_direct_access"
  ON sj_sequence FOR ALL
  USING (FALSE);

-- Seed baris awal untuk tahun sekarang
INSERT INTO sj_sequence (tahun, tenant_id, last_sequence)
VALUES (2026, 'STX-001', 0);


-- =============================================================================
-- 6. TABEL: audit_log
-- Immutable audit trail semua aksi penting (BR-10 §6).
-- INSERT hanya via service_role — tidak dari client langsung.
-- =============================================================================

CREATE TABLE audit_log (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES user_profile(id),
  modul       TEXT        NOT NULL,  -- 'produksi', 'keuangan', 'penggajian', dll
  aksi        TEXT        NOT NULL,  -- 'Input PO', 'Bayar Gaji', 'Hapus Bundle', dll
  target      TEXT,                  -- ID atau identifier objek yang diaksi
  metadata    JSONB,                 -- detail tambahan (qty, nominal, dll)
  tenant_id   TEXT        NOT NULL DEFAULT 'STX-001',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Hanya owner yang bisa READ audit log (sesuai BR-10 §2.1)
CREATE POLICY "audit_log_select_owner"
  ON audit_log FOR SELECT
  USING (
    get_current_user_role() = 'owner'
    AND tenant_id = 'STX-001'
  );

-- INSERT hanya via service_role (dipanggil dari Postgres trigger / RPC)
-- Tidak ada INSERT langsung dari client
CREATE POLICY "audit_log_no_direct_insert"
  ON audit_log FOR INSERT
  WITH CHECK (FALSE);

-- Tidak ada UPDATE atau DELETE — immutable audit trail


-- =============================================================================
-- FK TAMBAHAN: bundle.surat_jalan_id → surat_jalan
-- (bundle dibuat di 002, surat_jalan baru tersedia di file ini)
-- =============================================================================

ALTER TABLE bundle
  ADD CONSTRAINT fk_bundle_surat_jalan
  FOREIGN KEY (surat_jalan_id) REFERENCES surat_jalan(id);


-- =============================================================================
-- INDEXES
-- =============================================================================

-- Lookup gaji per karyawan berdasarkan status (rekap gaji, laporan)
CREATE INDEX idx_gaji_ledger_karyawan
  ON gaji_ledger(karyawan_id, status);

-- Lookup bundle yang belum masuk SJ (untuk pilih bundle saat buat SJ)
CREATE INDEX idx_bundle_belum_kirim
  ON bundle(tenant_id)
  WHERE surat_jalan_id IS NULL;

-- Lookup kasbon belum lunas per karyawan (untuk potong gaji)
CREATE INDEX idx_kasbon_karyawan_status
  ON kasbon(karyawan_id, status)
  WHERE status = 'belum_lunas';

-- Lookup audit log per modul (laporan aktivitas)
CREATE INDEX idx_audit_log_modul
  ON audit_log(tenant_id, modul, created_at DESC);
