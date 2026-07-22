-- =============================================================================
-- MIGRATION: 20260722000001_add_detail_lot_permission.sql
-- Grant akses halaman baru /app/inventory/detail-lot ke role yang sudah
-- punya akses ke halaman Inventory lain (owner otomatis dapat semua path).
-- =============================================================================

INSERT INTO role_permissions (role, path, can_view, tenant_id)
VALUES
  ('admin_produksi', '/app/inventory/detail-lot', true, 'STX-001'),
  ('admin_keuangan', '/app/inventory/detail-lot', true, 'STX-001')
ON CONFLICT (role, path, tenant_id) DO UPDATE SET can_view = true;
