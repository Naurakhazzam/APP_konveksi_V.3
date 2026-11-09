-- =============================================================================
-- (Sudah diterapkan 9 Nov 2026) Bundle cutting 'partial' alur lama (tab Pending)
-- → Selesai dengan qty terpotong; sisa dibuat sebagai bundle baru di Menunggu.
-- Hasil: 25 bundle, 302 pcs sisa. Audit: aksi 'Pindah Sisa Partial ke Menunggu'.
-- =============================================================================
DO $$
DECLARE
  r RECORD; v_sisa JSONB; v_qty INT;
  u UUID := '71fb0890-5306-47be-a9c0-c5cce41cca95';
BEGIN
  FOR r IN
    SELECT b.id, b.barcode, b.qty_rencana::int AS rencana,
      COALESCE((b.status_tahap->'cutting'->>'qty_dipotong')::int, (b.status_tahap->'cutting'->>'qty_aktual')::int, 0) AS induk,
      COALESCE((SELECT SUM((c.status_tahap->'cutting'->>'qty_aktual')::int) FROM bundle c
                WHERE c.parent_bundle_id = b.id AND c.barcode LIKE b.barcode || 'c%'), 0)::int AS susulan
    FROM bundle b
    WHERE b.tenant_id = 'STX-001' AND b.status_tahap->'cutting'->>'status' = 'partial' AND b.ditutup_at IS NULL
    FOR UPDATE
  LOOP
    v_sisa := NULL;
    v_qty := r.rencana - r.induk - r.susulan;
    IF v_qty > 0 THEN v_sisa := _buat_bundle_sisa(r.id, v_qty, u, 'STX-001'::text); END IF;
    UPDATE bundle
    SET qty_rencana = r.induk,
        status_tahap = jsonb_set(status_tahap, '{cutting}', (status_tahap->'cutting') || jsonb_build_object(
          'status', 'selesai', 'qty_rencana', r.rencana, 'sisa_dipindah_ke', v_sisa->>'barcode', 'dipindah_at', now()))
    WHERE id = r.id;
    INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
    VALUES (u, 'produksi', 'Pindah Sisa Partial ke Menunggu', r.barcode,
      jsonb_build_object('bundle_id', r.id, 'rencana', r.rencana, 'dipotong', r.induk,
                         'susulan', r.susulan, 'sisa', v_qty, 'bundle_sisa', v_sisa->>'barcode'), 'STX-001');
  END LOOP;
END $$;
