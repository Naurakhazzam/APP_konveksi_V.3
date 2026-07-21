-- =============================================================================
-- MIGRATION: 20260721000002_move_lacak_barcode_top_level.sql
-- Lacak Barcode dipindah dari sub-menu Produksi (/app/produksi/lacak-barcode)
-- menjadi tab utama tersendiri di sidebar (/app/lacak-barcode).
-- =============================================================================

UPDATE role_permissions
SET path = '/app/lacak-barcode'
WHERE path = '/app/produksi/lacak-barcode'
  AND tenant_id = 'STX-001';
