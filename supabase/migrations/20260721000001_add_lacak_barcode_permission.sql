-- =============================================================================
-- MIGRATION: 20260721000001_add_lacak_barcode_permission.sql
-- Grant akses halaman baru /app/produksi/lacak-barcode ke semua role internal
-- non-owner (owner selalu dapat akses semua path lewat ALL_APP_PATHS di
-- DashboardLayout, jadi tidak perlu baris terpisah untuk owner).
-- =============================================================================

INSERT INTO role_permissions (role, path, can_view, tenant_id)
VALUES
  ('admin_produksi', '/app/produksi/lacak-barcode', true, 'STX-001'),
  ('admin_keuangan', '/app/produksi/lacak-barcode', true, 'STX-001'),
  ('supervisor',     '/app/produksi/lacak-barcode', true, 'STX-001'),
  ('mandor',         '/app/produksi/lacak-barcode', true, 'STX-001')
ON CONFLICT (role, path, tenant_id) DO UPDATE SET can_view = true;
