-- =============================================================================
-- MIGRATION: 20261113000001_akses_lihat_produksi_admin_keuangan.sql
-- Grant akses LIHAT halaman scan & kroscek produksi ke role admin_keuangan.
-- Perubahan data tetap ditolak di server (assertCanEditProduksi) — read-only.
-- (Sudah dijalankan langsung di DB 2026-11-13; file ini sebagai catatan.)
-- =============================================================================

INSERT INTO role_permissions (role, path, can_view, tenant_id)
VALUES
  ('admin_keuangan', '/app/produksi/scan/cutting',        true, 'STX-001'),
  ('admin_keuangan', '/app/produksi/scan/jahit',          true, 'STX-001'),
  ('admin_keuangan', '/app/produksi/scan/lubang-kancing', true, 'STX-001'),
  ('admin_keuangan', '/app/produksi/scan/buang-benang',   true, 'STX-001'),
  ('admin_keuangan', '/app/produksi/scan/qc',             true, 'STX-001'),
  ('admin_keuangan', '/app/produksi/scan/steam',          true, 'STX-001'),
  ('admin_keuangan', '/app/produksi/scan/packing',        true, 'STX-001'),
  ('admin_keuangan', '/app/produksi/kroscek-pekerjaan',   true, 'STX-001')
ON CONFLICT (role, path, tenant_id) DO UPDATE SET can_view = true;
