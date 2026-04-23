-- =============================================================================
-- MIGRATION: 013_scan_station_prep.sql
-- Action: Persiapan DB untuk Phase 06 — Scan Station
-- Dibuat: 21 April 2026
-- Depends on: 007_master_tambahan.sql, 011_phase05_prep.sql
-- =============================================================================
-- Isi:
--   1. CREATE TABLE settings (konfigurasi tenant)
--   2. ALTER TABLE pemakaian_bahan (tambah po_item_id + rate_per_pcs)
--   3. ALTER TABLE hpp_komponen (tambah tahap_produksi untuk link upah per tahap)
--   4. Indexes
-- =============================================================================


-- =============================================================================
-- 1. TABEL: settings
-- Konfigurasi level tenant. Satu baris per tenant (singleton).
-- =============================================================================

CREATE TABLE settings (
  id                            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                     TEXT          NOT NULL UNIQUE DEFAULT 'STX-001',

  -- Karyawan default untuk tahap borongan (tahap 3-7: lubang_kancing s.d. packing)
  -- Diisi owner via halaman Settings setelah migration ini jalan.
  -- Selama NULL, scan tahap borongan tetap bisa jalan tapi karyawan_id di scan_log = NULL
  default_karyawan_borongan_id  UUID          REFERENCES karyawan(id),

  -- Threshold jam untuk warning "bundle mandek" di monitoring
  -- Default 24 jam — bisa diubah owner
  stok_warning_jam              INT           NOT NULL DEFAULT 24,

  -- Threshold gap HPP untuk status boncos/hemat (dalam rupiah)
  -- Default 50.000 — sesuai BR-06 §4.2
  hpp_gap_threshold             NUMERIC(12,2) NOT NULL DEFAULT 50000,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- Semua user aktif bisa READ settings (dibutuhkan RPC scan untuk ambil default karyawan)
CREATE POLICY "settings_select_active_user"
  ON settings FOR SELECT
  USING (is_active_user() AND tenant_id = 'STX-001');

-- Hanya owner yang bisa UPDATE settings
CREATE POLICY "settings_update_owner"
  ON settings FOR UPDATE
  USING (get_current_user_role() = 'owner');

-- Tidak ada INSERT / DELETE dari user — dikelola via seed + RPC saja
CREATE POLICY "settings_no_insert"
  ON settings FOR INSERT
  WITH CHECK (FALSE);

-- Seed baris awal untuk STX-001
-- default_karyawan_borongan_id sengaja NULL dulu — owner isi via Settings page
INSERT INTO settings (tenant_id)
VALUES ('STX-001');

COMMENT ON TABLE settings IS
  'Konfigurasi tenant Stitchlyx. Singleton — satu baris per tenant.';

COMMENT ON COLUMN settings.default_karyawan_borongan_id IS
  'Karyawan yang otomatis di-assign untuk tahap borongan (lubang_kancing, buang_benang, qc, steam, packing). Diisi owner di halaman Settings.';

COMMENT ON COLUMN settings.stok_warning_jam IS
  'Threshold jam untuk warning bundle mandek di halaman monitoring. Default 24 jam.';

COMMENT ON COLUMN settings.hpp_gap_threshold IS
  'Threshold gap HPP (Rp) untuk klasifikasi boncos/hemat. Default Rp 50.000.';


-- =============================================================================
-- 2. ALTER TABLE pemakaian_bahan
-- Tambah po_item_id dan rate_per_pcs.
--
-- Alasan:
--   Pemakaian bahan diinput SEKALI per artikel (po_item), bukan per bundle.
--   po_item_id dipakai untuk cek "apakah artikel ini sudah punya config pemakaian?"
--   rate_per_pcs disimpan agar bundle berikutnya dari artikel yang sama tidak
--   perlu input ulang — sistem auto-hitung dari rate yang tersimpan.
-- =============================================================================

ALTER TABLE pemakaian_bahan
  ADD COLUMN IF NOT EXISTS po_item_id  UUID          REFERENCES po_item(id),
  ADD COLUMN IF NOT EXISTS rate_per_pcs NUMERIC(14,4);

COMMENT ON COLUMN pemakaian_bahan.po_item_id IS
  'FK ke po_item. Dipakai untuk cek apakah artikel ini sudah punya config pemakaian bahan. NULL untuk data lama sebelum migration ini.';

COMMENT ON COLUMN pemakaian_bahan.rate_per_pcs IS
  'Jumlah bahan yang dipakai per 1 pcs produk (meter, gram, dll). Diinput user saat scan cutting bundle pertama per artikel.';


-- =============================================================================
-- 3. ALTER TABLE hpp_komponen
-- Tambah kolom tahap_produksi.
--
-- Alasan:
--   Saat bundle SELESAI di tahap X, sistem perlu tahu komponen HPP mana yang
--   merepresentasikan upah tahap tersebut — untuk otomatis INSERT gaji_ledger.
--   Hanya komponen kategori 'biaya_produksi' yang perlu diisi tahap_produksi.
--   Komponen 'bahan_baku' dan 'overhead' biarkan NULL.
--
-- Contoh pengisian master data:
--   "Upah Cutting"       → tahap_produksi = 'cutting'
--   "Upah Jahit"         → tahap_produksi = 'jahit'
--   "Upah Lubang Kancing"→ tahap_produksi = 'lubang_kancing'
--   "Upah Buang Benang"  → tahap_produksi = 'buang_benang'
--   "Upah QC"            → tahap_produksi = 'qc'
--   "Upah Steam"         → tahap_produksi = 'steam'
--   "Upah Packing"       → tahap_produksi = 'packing'
--   "Kain Cotton"        → tahap_produksi = NULL (bahan_baku, tidak perlu diisi)
-- =============================================================================

ALTER TABLE hpp_komponen
  ADD COLUMN IF NOT EXISTS tahap_produksi tahap_produksi;

COMMENT ON COLUMN hpp_komponen.tahap_produksi IS
  'Tahap produksi yang menanggung biaya komponen ini. NULL untuk bahan_baku dan overhead. Diisi untuk biaya_produksi (upah) agar sistem bisa otomatis hitung gaji_ledger saat bundle SELESAI.';


-- =============================================================================
-- 4. INDEXES
-- =============================================================================

-- Cek cepat: "apakah artikel ini sudah punya config pemakaian?"
-- Query: EXISTS(SELECT 1 FROM pemakaian_bahan WHERE po_item_id = ? AND inventory_item_id = ?)
CREATE INDEX IF NOT EXISTS idx_pemakaian_po_item
  ON pemakaian_bahan(po_item_id, inventory_item_id);

-- Lookup komponen upah per tahap (dipakai di RPC scan_selesai)
-- Query: SELECT ... FROM hpp_komponen WHERE tahap_produksi = ? AND kategori = 'biaya_produksi'
CREATE INDEX IF NOT EXISTS idx_hpp_komponen_tahap
  ON hpp_komponen(tahap_produksi)
  WHERE tahap_produksi IS NOT NULL;


-- =============================================================================
-- VERIFIKASI (jalankan terpisah untuk konfirmasi)
-- =============================================================================
-- SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public' AND table_name = 'settings';
-- → harus ada 1 baris: settings

-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'pemakaian_bahan' AND column_name IN ('po_item_id','rate_per_pcs');
-- → harus ada 2 baris

-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'hpp_komponen' AND column_name = 'tahap_produksi';
-- → harus ada 1 baris

-- SELECT * FROM settings WHERE tenant_id = 'STX-001';
-- → harus ada 1 baris (seed data)
