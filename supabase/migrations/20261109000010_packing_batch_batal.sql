-- ════════════════════════════════════════════════════════════════════
-- Packing ikut pola tahap borongan: selesai banyak bundle sekaligus
-- (terima + selesai atomik, upah ke karyawan borongan default) dan
-- Batal Selesai (ditolak bila sudah masuk surat jalan / upah dibayar).
-- Isi fungsi sama dengan 20261109000009, hanya daftar tahap ditambah 'packing'.
-- ════════════════════════════════════════════════════════════════════


-- 1. Selesaikan banyak bundle sekaligus — terima + selesai dalam satu
--    transaksi (dulu 2 RPC per bundle, berurutan dari browser).
--    p_items: [{bundle_id, qty?, alasan_qty_id?}] — qty kosong = qty penuh.
CREATE OR REPLACE FUNCTION public.tahap_selesai_batch(
  p_tahap text, p_items jsonb, p_user_id uuid, p_tenant_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_order     text[] := ARRAY['cutting','jahit','lubang_kancing','buang_benang','qc','steam','packing'];
  v_prev      text;
  v_ids       uuid[];
  v_b         RECORD;
  v_item      jsonb;
  v_st        jsonb;
  v_prev_st   jsonb;
  v_qty_masuk int;
  v_qty       int;
  v_alasan    uuid;
  v_karyawan  uuid;
  v_warna_id  uuid;
  v_aks       RECORD;
  v_res       jsonb;
  v_n         int := 0;
  v_upah      numeric := 0;
BEGIN
  IF p_tahap NOT IN ('lubang_kancing','buang_benang','qc','steam','packing') THEN
    RAISE EXCEPTION 'Tahap tidak didukung: %', p_tahap;
  END IF;
  v_prev := v_order[array_position(v_order, p_tahap) - 1];

  SELECT array_agg((e ->> 'bundle_id')::uuid) INTO v_ids
  FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) e;
  IF COALESCE(array_length(v_ids, 1), 0) = 0 THEN RAISE EXCEPTION 'Tidak ada bundle dipilih'; END IF;

  SELECT default_karyawan_borongan_id INTO v_karyawan
  FROM settings WHERE tenant_id = p_tenant_id LIMIT 1;

  FOR v_b IN
    SELECT b.id, b.barcode, b.status_tahap, b.ditutup_at, pi.qty_per_bundle, pi.warna, pr.model_id
    FROM bundle b
    JOIN po_item pi ON pi.id = b.po_item_id
    JOIN produk pr  ON pr.id = pi.produk_id
    WHERE b.id = ANY(v_ids) AND b.tenant_id = p_tenant_id
    ORDER BY b.barcode
    FOR UPDATE OF b
  LOOP
    v_st      := COALESCE(v_b.status_tahap, '{}'::jsonb);
    v_prev_st := v_st -> v_prev;

    IF v_b.ditutup_at IS NOT NULL THEN
      RAISE EXCEPTION 'Bundle % sudah ditutup (data lama)', v_b.barcode;
    END IF;
    IF COALESCE(v_prev_st ->> 'status', '') <> 'selesai' THEN
      RAISE EXCEPTION 'Bundle % belum selesai di tahap %', v_b.barcode, initcap(replace(v_prev, '_', ' '));
    END IF;
    IF (v_st -> p_tahap ->> 'status') = 'selesai' THEN
      RAISE EXCEPTION 'Bundle % sudah selesai di tahap ini', v_b.barcode;
    END IF;

    v_qty_masuk := COALESCE(
      (v_st -> p_tahap ->> 'qty_terima')::numeric,
      (v_prev_st ->> 'qty_selesai')::numeric,
      (v_prev_st ->> 'qty_terima')::numeric,
      (v_st -> 'cutting' ->> 'qty_aktual')::numeric,
      v_b.qty_per_bundle)::int;

    SELECT e INTO v_item FROM jsonb_array_elements(p_items) e
    WHERE (e ->> 'bundle_id')::uuid = v_b.id LIMIT 1;
    v_qty    := COALESCE(NULLIF(v_item ->> 'qty', '')::int, v_qty_masuk);
    v_alasan := NULLIF(v_item ->> 'alasan_qty_id', '')::uuid;

    IF v_qty < 1 THEN RAISE EXCEPTION 'Qty % minimal 1', v_b.barcode; END IF;
    IF v_qty > v_qty_masuk THEN
      RAISE EXCEPTION 'Qty % (%) melebihi qty masuk (%)', v_b.barcode, v_qty, v_qty_masuk;
    END IF;
    IF v_qty < v_qty_masuk AND v_alasan IS NULL THEN
      RAISE EXCEPTION 'Qty % kurang dari qty masuk — wajib pilih alasan', v_b.barcode;
    END IF;

    -- Terima (bila belum). Bundle lama yang sudah 'terima' langsung diselesaikan.
    IF NOT (v_st ? p_tahap) THEN
      UPDATE bundle SET status_tahap = jsonb_set(v_st, ARRAY[p_tahap], jsonb_build_object(
        'status', 'terima', 'qty_terima', v_qty_masuk,
        'waktu_terima', now(), 'start_time', now(),
        'karyawan_id', v_karyawan, 'updated_by', p_user_id))
      WHERE id = v_b.id;

      INSERT INTO scan_log (bundle_id, tahap, tipe, karyawan_id, qty, user_id, tenant_id)
      VALUES (v_b.id, p_tahap::tahap_produksi, 'terima'::scan_tipe, v_karyawan, v_qty_masuk, p_user_id, p_tenant_id);

      -- Aksesori tahap ini (mis. kancing di Lubang Kancing), sesuai warna.
      SELECT id INTO v_warna_id FROM warna
      WHERE LOWER(nama) = LOWER(v_b.warna) AND tenant_id = p_tenant_id LIMIT 1;

      FOR v_aks IN
        SELECT inventory_item_id, SUM(qty_per_pcs) AS qty_per_pcs FROM (
          SELECT ma.inventory_item_id, ma.qty_per_pcs
          FROM model_aksesori ma
          WHERE ma.model_id = v_b.model_id AND ma.tenant_id = p_tenant_id
            AND ma.tahap_pakai::text = p_tahap
            AND (ma.warna_id IS NULL OR ma.warna_id = v_warna_id)
          UNION ALL
          SELECT wa.inventory_item_id, wa.qty_per_pcs
          FROM warna_aksesori wa
          WHERE v_warna_id IS NOT NULL AND wa.warna_id = v_warna_id
            AND wa.tenant_id = p_tenant_id AND wa.tahap_pakai::text = p_tahap
        ) x GROUP BY inventory_item_id
      LOOP
        CONTINUE WHEN COALESCE(v_aks.qty_per_pcs, 0) * v_qty <= 0;
        UPDATE inventory_item SET stok_aktual = stok_aktual - v_aks.qty_per_pcs * v_qty
        WHERE id = v_aks.inventory_item_id AND tenant_id = p_tenant_id;
        INSERT INTO pemakaian_aksesori (bundle_id, inventory_item_id, qty_pakai, tahap, tenant_id)
        VALUES (v_b.id, v_aks.inventory_item_id, v_aks.qty_per_pcs * v_qty, p_tahap::tahap_produksi, p_tenant_id)
        ON CONFLICT (bundle_id, inventory_item_id, tahap)
        DO UPDATE SET qty_pakai = pemakaian_aksesori.qty_pakai + EXCLUDED.qty_pakai;
      END LOOP;
    END IF;

    v_res := scan_selesai(v_b.barcode, p_tahap::tahap_produksi, v_karyawan, v_qty,
                          NULL, v_alasan, p_user_id, p_tenant_id);
    v_upah := v_upah + COALESCE((v_res ->> 'upah_nominal')::numeric, 0);
    v_n := v_n + 1;
  END LOOP;

  IF v_n <> array_length(v_ids, 1) THEN
    RAISE EXCEPTION 'Sebagian bundle tidak ditemukan';
  END IF;

  RETURN jsonb_build_object('jumlah', v_n, 'upah_total', v_upah);
END;
$$;

-- 2. Batal selesai: bundle kembali ke Antrian tahap ini.
--    Ditolak bila sudah masuk tahap berikutnya (selain yang otomatis dilewati)
--    atau upahnya sudah dibayar. Stok aksesori tahap ini dikembalikan.
CREATE OR REPLACE FUNCTION public.tahap_batal_selesai_batch(
  p_tahap text, p_bundle_ids uuid[], p_alasan text, p_user_id uuid, p_tenant_id text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_order  text[] := ARRAY['cutting','jahit','lubang_kancing','buang_benang','qc','steam','packing'];
  v_idx    int;
  v_b      RECORD;
  v_st     jsonb;
  v_t      text;
  v_i      int;
  v_hapus  text[];
  v_upah   jsonb;
  v_n      int := 0;
BEGIN
  IF p_tahap NOT IN ('lubang_kancing','buang_benang','qc','steam','packing') THEN
    RAISE EXCEPTION 'Tahap tidak didukung: %', p_tahap;
  END IF;
  IF p_alasan IS NULL OR trim(p_alasan) = '' THEN RAISE EXCEPTION 'Alasan wajib diisi'; END IF;
  v_idx := array_position(v_order, p_tahap);

  FOR v_b IN
    SELECT b.id, b.barcode, b.po_id, b.status_tahap FROM bundle b
    WHERE b.id = ANY(p_bundle_ids) AND b.tenant_id = p_tenant_id
    ORDER BY b.barcode FOR UPDATE OF b
  LOOP
    v_st := COALESCE(v_b.status_tahap, '{}'::jsonb);
    IF COALESCE(v_st -> p_tahap ->> 'status', '') <> 'selesai' THEN
      RAISE EXCEPTION 'Bundle % belum selesai di tahap ini', v_b.barcode;
    END IF;
    IF COALESCE((v_st -> p_tahap ->> 'dilewati')::boolean, false) THEN
      RAISE EXCEPTION 'Bundle % otomatis melewati tahap ini — tidak ada yang dibatalkan', v_b.barcode;
    END IF;

    v_hapus := ARRAY[p_tahap];
    FOR v_i IN (v_idx + 1) .. array_length(v_order, 1) LOOP
      v_t := v_order[v_i];
      CONTINUE WHEN NOT (v_st ? v_t);
      IF COALESCE((v_st -> v_t ->> 'dilewati')::boolean, false) THEN
        v_hapus := array_append(v_hapus, v_t);   -- dipasang ulang otomatis oleh trigger
      ELSE
        RAISE EXCEPTION 'Bundle % sudah masuk tahap % — batalkan dulu dari menu tahap itu',
          v_b.barcode, initcap(replace(v_t, '_', ' '));
      END IF;
    END LOOP;

    IF EXISTS (SELECT 1 FROM surat_jalan_item WHERE bundle_id = v_b.id) THEN
      RAISE EXCEPTION 'Bundle % sudah masuk surat jalan', v_b.barcode;
    END IF;
    IF EXISTS (SELECT 1 FROM reject_log r WHERE r.bundle_id = v_b.id AND r.tenant_id = p_tenant_id
               AND r.tahap_ditemukan::text = ANY(v_hapus)) THEN
      RAISE EXCEPTION 'Bundle % punya catatan reject di tahap ini — selesaikan dulu di menu Reject', v_b.barcode;
    END IF;
    IF EXISTS (SELECT 1 FROM gaji_ledger gl
               WHERE gl.tenant_id = p_tenant_id AND gl.sumber_id = v_b.id::text
                 AND gl.keterangan = 'Upah ' || p_tahap || ' - ' || v_b.barcode
                 AND gl.status IN ('lunas', 'escrow')) THEN
      RAISE EXCEPTION 'Upah % bundle % sudah dibayar — tidak bisa dibatalkan',
        initcap(replace(p_tahap, '_', ' ')), v_b.barcode;
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'total', total, 'status', status)), '[]'::jsonb)
    INTO v_upah FROM gaji_ledger
    WHERE tenant_id = p_tenant_id AND sumber_id = v_b.id::text AND status <> 'cancelled'
      AND keterangan = 'Upah ' || p_tahap || ' - ' || v_b.barcode;
    UPDATE gaji_ledger SET status = 'cancelled'
    WHERE tenant_id = p_tenant_id AND sumber_id = v_b.id::text AND status <> 'cancelled'
      AND keterangan = 'Upah ' || p_tahap || ' - ' || v_b.barcode;

    UPDATE qty_approval_request SET scan_log_id = NULL
    WHERE scan_log_id IN (SELECT id FROM scan_log WHERE bundle_id = v_b.id AND tahap::text = ANY(v_hapus));
    DELETE FROM qty_approval_request
    WHERE bundle_id = v_b.id AND tenant_id = p_tenant_id AND status = 'pending' AND tahap::text = ANY(v_hapus);
    DELETE FROM scan_log WHERE bundle_id = v_b.id AND tahap::text = ANY(v_hapus);

    PERFORM _kembalikan_aksesori_tahap(v_b.id, v_b.po_id, p_tahap, p_tenant_id);

    FOREACH v_t IN ARRAY v_hapus LOOP
      v_st := v_st - v_t;
    END LOOP;
    UPDATE bundle SET status_tahap = v_st WHERE id = v_b.id;

    INSERT INTO audit_log (user_id, modul, aksi, target, metadata, tenant_id)
    VALUES (p_user_id, 'produksi', 'Batal Selesai ' || initcap(replace(p_tahap, '_', ' ')), v_b.barcode,
      jsonb_build_object('bundle_id', v_b.id, 'tahap', p_tahap, 'tahap_dihapus', to_jsonb(v_hapus),
        'status_tahap_lama', v_b.status_tahap, 'upah_dibatalkan', v_upah, 'alasan', trim(p_alasan)),
      p_tenant_id);
    v_n := v_n + 1;
  END LOOP;

  IF v_n = 0 OR v_n <> COALESCE(array_length(p_bundle_ids, 1), 0) THEN
    RAISE EXCEPTION 'Sebagian bundle tidak ditemukan';
  END IF;
  RETURN jsonb_build_object('jumlah', v_n);
END;
$$;
