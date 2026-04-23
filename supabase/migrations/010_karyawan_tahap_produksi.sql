-- ============================================================
-- MIGRATION 010: Tambah kolom tahap_produksi ke tabel karyawan
-- Setiap karyawan punya daftar tahap sendiri (multi-assign)
-- ============================================================

ALTER TABLE karyawan
ADD COLUMN tahap_produksi TEXT[] NOT NULL DEFAULT '{}';

-- Verifikasi
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'karyawan'
  AND column_name = 'tahap_produksi';
