-- =============================================================================
-- MIGRATION: 017_po_tanggal_target_nullable.sql
-- Tujuan: Mengizinkan tanggal_target di tabel po menjadi NULL.
-- Dibuat: 22 April 2026
-- Konteks: PO tanpa deadline adalah valid secara bisnis.
--          Column sebelumnya NOT NULL, sehingga import PO tanpa target date gagal.
-- =============================================================================

ALTER TABLE po
  ALTER COLUMN tanggal_target DROP NOT NULL;
