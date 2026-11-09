-- =============================================================================
-- batal_mulai_cutting: kembalikan bundle "Sedang Dipotong" ke Menunggu.
-- Bundle sisa yang dibuat saat Mulai (sebagian) dan masih Menunggu digabung
-- kembali ke bundle asalnya, sehingga isinya kembali seperti sebelum dimulai.
-- Belum ada upah/bahan yang tercatat saat Mulai, jadi tidak ada yang dibalik.
-- =============================================================================
CREATE OR REPLACE FUNCTION batal_mulai_cutting(p_bundle_ids UUID[], p_user_id UUID, p_tenant_id TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_b RECORD; v_gabung INT; v_hapus TEXT[]; v_count INT := 0; v_total_gabung INT := 0;
BEGIN
  IF p_bundle_ids IS NULL OR array_length(p_bundle_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Tidak ada bundle dipilih';
  END IF;
  FOR v_b IN
    SELECT id, barcode, status_tahap, qty_rencana FROM bundle
    WHERE id = ANY(p_bundle_ids) AND tenant_id = p_tenant_id FOR UPDATE
  LOOP
    IF COALESCE(v_b.status_tahap->'cutting'->>'status', '') NOT IN ('progress', 'terima') THEN
      RAISE EXCEPTION 'Bundle % tidak sedang dipotong — muat ulang halaman', v_b.barcode;
    END IF;

    SELECT COALESCE(SUM(qty_rencana), 0)::int, array_agg(barcode)
      INTO v_gabung, v_hapus
    FROM bundle
    WHERE sisa_dari_bundle_id = v_b.id AND tenant_id = p_tenant_id
      AND status_tahap->'cutting' IS NULL AND ditutup_at IS NULL;
    DELETE FROM bundle
    WHERE sisa_dari_bundle_id = v_b.id AND tenant_id = p_tenant_id
      AND status_tahap->'cutting' IS NULL AND ditutup_at IS NULL;

    UPDATE bundle
    SET status_tahap = status_tahap - 'cutting',
        qty_rencana  = COALESCE(qty_rencana, 0) + v_gabung
    WHERE id = v_b.id;

    INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
    VALUES (p_user_id, 'produksi', 'Batal Mulai Cutting', v_b.barcode,
      jsonb_build_object('bundle_id', v_b.id, 'start_time', v_b.status_tahap->'cutting'->>'start_time',
                         'qty_dimulai', v_b.qty_rencana, 'sisa_digabung', v_gabung, 'bundle_sisa_dihapus', v_hapus),
      p_tenant_id);
    v_count := v_count + 1;
    v_total_gabung := v_total_gabung + v_gabung;
  END LOOP;
  RETURN jsonb_build_object('jumlah_bundle', v_count, 'sisa_digabung', v_total_gabung);
END; $$;

GRANT EXECUTE ON FUNCTION batal_mulai_cutting(UUID[], UUID, TEXT) TO authenticated;
