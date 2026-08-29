-- =============================================================================
-- MIGRATION: 20260829000005_akses_overview_pekerja_admin_keuangan.sql
-- Grant akses /app/penggajian/overview-pekerja ke role admin_keuangan (Salma),
-- supaya bisa melihat dan melunaskan upah pekerja langsung dari halaman ini.
-- =============================================================================

INSERT INTO role_permissions (role, path, can_view, tenant_id)
VALUES ('admin_keuangan', '/app/penggajian/overview-pekerja', true, 'STX-001')
ON CONFLICT (role, path, tenant_id) DO UPDATE SET can_view = true;
