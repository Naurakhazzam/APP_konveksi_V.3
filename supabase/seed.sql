-- =============================================================================
-- SEED: seed.sql
-- Data awal untuk inisialisasi system.
-- Dibuat: 20 April 2026
-- =============================================================================

-- 1. Sequence bundle & SJ (Pakai ON CONFLICT agar tidak error jika sudah ada)
INSERT INTO bundle_sequence (tenant_id, last_sequence)
VALUES ('STX-001', 0)
ON CONFLICT (tenant_id) DO NOTHING;

INSERT INTO sj_sequence (tahun, tenant_id, last_sequence)
VALUES (2026, 'STX-001', 0)
ON CONFLICT (tahun, tenant_id) DO NOTHING;

-- 2. Kategori Transaksi Default
INSERT INTO kategori_trx (nama, jenis, tenant_id)
VALUES 
  ('Pembelian Kain', 'direct_bahan', 'STX-001'),
  ('Pembelian Aksesori', 'direct_bahan', 'STX-001'),
  ('Upah Jahit', 'direct_upah', 'STX-001'),
  ('Listrik', 'overhead', 'STX-001'),
  ('Sewa Gedung', 'overhead', 'STX-001'),
  ('Internet', 'overhead', 'STX-001'),
  ('Pembayaran Klien', 'masuk', 'STX-001'),
  ('Pendapatan Lain', 'masuk', 'STX-001')
ON CONFLICT DO NOTHING;
