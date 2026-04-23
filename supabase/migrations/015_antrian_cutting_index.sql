-- =============================================================================
-- MIGRATION: 015_antrian_cutting_index.sql
-- Tujuan: Menambah GIN index pada bundle.status_tahap untuk mempercepat
--         query JSONB di halaman Antrian Cutting dan Monitoring.
-- Dibuat: 21 April 2026
-- Depends on: 002_produksi_tables.sql (tabel bundle sudah ada)
-- =============================================================================

-- GIN index memungkinkan query seperti:
--   status_tahap->'cutting' IS NULL          → antrian (belum di-scan)
--   status_tahap->'cutting'->>'status' = 'terima'  → sedang dipotong
--   status_tahap->'cutting'->>'status' = 'selesai' → selesai cutting
-- tanpa full table scan pada setiap load halaman.

CREATE INDEX IF NOT EXISTS idx_bundle_status_tahap_gin
  ON bundle USING GIN (status_tahap);

-- Index tambahan untuk filter per-PO yang sering dipakai di antrian
-- (sudah ada idx_bundle_po_id di migration 002, tidak perlu dibuat ulang)

-- Verifikasi: jalankan query ini setelah migration untuk konfirmasi index aktif
-- SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'bundle';
