-- =============================================================================
-- MIGRATION: 011_phase05_prep.sql
-- Action: Pre-flight Phase 05 — Fix ENUM + tambah kolom qty_per_bundle
-- Dibuat: 21 April 2026
-- Depends on: 002_produksi_tables.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- BAGIAN 1: Fix tahap_produksi ENUM
-- Rename nilai lama → nilai baru yang sesuai dengan factory ini.
-- Mapping: obras→buang_benang, kancing→lubang_kancing, setrika→steam
-- Catatan: ALTER TYPE ... RENAME VALUE aman, tidak rebuild tabel.
-- -----------------------------------------------------------------------------
ALTER TYPE tahap_produksi RENAME VALUE 'obras'   TO 'buang_benang';
ALTER TYPE tahap_produksi RENAME VALUE 'kancing' TO 'lubang_kancing';
ALTER TYPE tahap_produksi RENAME VALUE 'setrika' TO 'steam';


-- -----------------------------------------------------------------------------
-- BAGIAN 2: Tambah kolom qty_per_bundle ke po_item
-- Berapa pcs per bundle (default 12 = selusin, bisa diubah per line item).
-- -----------------------------------------------------------------------------
ALTER TABLE po_item
  ADD COLUMN IF NOT EXISTS qty_per_bundle INT NOT NULL DEFAULT 12;

COMMENT ON COLUMN po_item.qty_per_bundle IS
  'Jumlah pcs per bundle untuk PO line item ini. Default 12 (1 lusin).';


-- -----------------------------------------------------------------------------
-- BAGIAN 3: Tambah kolom no_urut_po ke bundle
-- Untuk keperluan display: "Bundle ke-X dari total Y di PO ini"
-- Sudah ada no_urut (per po_item), ini no_urut global di level PO.
-- -----------------------------------------------------------------------------
ALTER TABLE bundle
  ADD COLUMN IF NOT EXISTS no_urut_po INT;

COMMENT ON COLUMN bundle.no_urut_po IS
  'Nomor urut bundle di level PO (lintas semua po_item). Diisi saat generate.';


-- -----------------------------------------------------------------------------
-- VERIFIKASI (read-only, tidak mengubah data)
-- -----------------------------------------------------------------------------
-- Jalankan ini secara terpisah untuk verifikasi:
-- SELECT enumlabel FROM pg_enum
--   JOIN pg_type ON pg_enum.enumtypid = pg_type.oid
--   WHERE pg_type.typname = 'tahap_produksi'
--   ORDER BY enumsortorder;
-- Expected: cutting, jahit, buang_benang, lubang_kancing, steam, packing, qc
