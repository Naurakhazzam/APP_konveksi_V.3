-- ================================================================
-- MIGRATION: Bundle cutting "partial" boleh lanjut ke tahap berikutnya
--
-- BUG: selesai_cutting_batch menandai bundle 'partial' (bukan 'selesai')
-- kalau qty aktual < qty rencana. Tapi bagian lain sistem hanya menerima
-- status 'selesai':
--   - scan_jahit_terima     -> RAISE 'Bundle belum selesai tahap Cutting'
--   - scan_terima_generic   -> RAISE 'Tahap % belum selesai'
--   - split_bundle_awal_jahit -> RAISE 'Bundle belum selesai tahap Cutting'
-- Sementara Antrian Cutting tab "Selesai" SUDAH menganggap partial = selesai.
--
-- Akibatnya bundle yang dipotong sebagian TERJEBAK: dianggap selesai di
-- Cutting, tapi ditolak masuk Jahit. Contoh nyata: PO-0080 Storma Navy
-- XXL & XXXL, dipotong 8 dari rencana 12, tidak pernah muncul di Jahit.
--
-- Fix: perlakukan 'partial' sama dengan 'selesai' SELAMA qty aktual > 0.
-- Partial dengan qty 0 berarti tidak ada yang dipotong — tetap ditolak,
-- supaya tidak muncul di antrian jahit dengan qty 0.
-- ================================================================

-- Helper: apakah suatu tahap sudah boleh dilanjutkan?
CREATE OR REPLACE FUNCTION tahap_sudah_beres(p_status_tahap JSONB, p_tahap TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN (p_status_tahap -> p_tahap ->> 'status') = 'selesai' THEN TRUE
    WHEN (p_status_tahap -> p_tahap ->> 'status') = 'partial'
         AND COALESCE(
               (p_status_tahap -> p_tahap ->> 'qty_aktual')::NUMERIC,
               (p_status_tahap -> p_tahap ->> 'qty_selesai')::NUMERIC,
               0
             ) > 0
      THEN TRUE
    ELSE FALSE
  END;
$$;

COMMENT ON FUNCTION tahap_sudah_beres(JSONB, TEXT) IS
  'TRUE kalau tahap sudah selesai ATAU partial dengan qty aktual > 0 (dipotong sebagian, barangnya nyata ada).';


-- ── 1. scan_jahit_terima ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.scan_jahit_terima(
  p_barcode text, p_karyawan_id uuid, p_qty numeric, p_user_id uuid, p_tenant_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_bundle                 RECORD;
  v_scan_log_id            UUID;
  v_stok_warnings          JSONB := '[]'::JSONB;
  v_consume_result         JSONB;
  v_aksesori               RECORD;
  v_warna_id               UUID;
  v_qty_pakai              NUMERIC;
  v_kategori_aksesori_id   UUID;
BEGIN
  SELECT id INTO v_kategori_aksesori_id
  FROM kategori_trx
  WHERE nama = 'Pembelian Aksesori' AND jenis = 'direct_bahan'
    AND aktif = TRUE AND tenant_id = p_tenant_id
  LIMIT 1;

  SELECT b.id, b.po_item_id, b.status_tahap, pi.warna, produk.model_id
  INTO v_bundle
  FROM bundle b
  JOIN po_item pi  ON pi.id = b.po_item_id
  JOIN produk      ON produk.id = pi.produk_id
  WHERE b.barcode = p_barcode AND b.tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Barcode tidak ditemukan: %', p_barcode;
  END IF;

  -- PERUBAHAN: terima juga cutting 'partial' selama qty aktual > 0
  IF NOT tahap_sudah_beres(v_bundle.status_tahap, 'cutting') THEN
    RAISE EXCEPTION 'Bundle belum selesai tahap Cutting';
  END IF;

  IF (v_bundle.status_tahap -> 'jahit' ->> 'status') IS NOT NULL THEN
    RAISE EXCEPTION 'Bundle sudah di-scan di tahap Jahit';
  END IF;

  SELECT id INTO v_warna_id
  FROM warna
  WHERE LOWER(nama) = LOWER(v_bundle.warna) AND tenant_id = p_tenant_id
  LIMIT 1;

  FOR v_aksesori IN
    SELECT inventory_item_id, qty_per_pcs
    FROM model_aksesori
    WHERE model_id = v_bundle.model_id AND tenant_id = p_tenant_id
      AND tahap_pakai = 'jahit'
      AND (warna_id IS NULL OR warna_id = v_warna_id)
  LOOP
    v_qty_pakai := v_aksesori.qty_per_pcs * p_qty;
    v_consume_result := consume_fifo_atomic(
      v_aksesori.inventory_item_id, v_qty_pakai, v_bundle.po_item_id,
      v_bundle.id, v_aksesori.qty_per_pcs, p_user_id, p_tenant_id,
      v_kategori_aksesori_id, 'jahit'
    );
    IF v_consume_result ->> 'status' = 'stok_kurang' THEN
      v_stok_warnings := v_stok_warnings || jsonb_build_object(
        'item_nama',  v_consume_result ->> 'item_nama',
        'qty_kurang', v_consume_result -> 'qty_kurang',
        'sisa_stok',  v_consume_result -> 'sisa_stok'
      );
    END IF;
  END LOOP;

  IF v_warna_id IS NOT NULL THEN
    FOR v_aksesori IN
      SELECT inventory_item_id, qty_per_pcs
      FROM warna_aksesori
      WHERE warna_id = v_warna_id AND tenant_id = p_tenant_id AND tahap_pakai = 'jahit'
    LOOP
      v_qty_pakai := v_aksesori.qty_per_pcs * p_qty;
      v_consume_result := consume_fifo_atomic(
        v_aksesori.inventory_item_id, v_qty_pakai, v_bundle.po_item_id,
        v_bundle.id, v_aksesori.qty_per_pcs, p_user_id, p_tenant_id,
        v_kategori_aksesori_id, 'jahit'
      );
      IF v_consume_result ->> 'status' = 'stok_kurang' THEN
        v_stok_warnings := v_stok_warnings || jsonb_build_object(
          'item_nama',  v_consume_result ->> 'item_nama',
          'qty_kurang', v_consume_result -> 'qty_kurang',
          'sisa_stok',  v_consume_result -> 'sisa_stok'
        );
      END IF;
    END LOOP;
  END IF;

  INSERT INTO scan_log (bundle_id, tahap, tipe, qty, karyawan_id, user_id, tenant_id)
  VALUES (v_bundle.id, 'jahit'::tahap_produksi, 'terima'::scan_tipe,
          p_qty, p_karyawan_id, p_user_id, p_tenant_id)
  RETURNING id INTO v_scan_log_id;

  UPDATE bundle
  SET status_tahap = jsonb_set(status_tahap, '{jahit}', jsonb_build_object(
    'status','terima','qty_terima',p_qty,'waktu_terima',now(),
    'qty_selesai',NULL,'waktu_selesai',NULL,'karyawan_id',p_karyawan_id
  ))
  WHERE id = v_bundle.id;

  RETURN jsonb_build_object('scan_log_id', v_scan_log_id, 'stok_warnings', v_stok_warnings);
END;
$function$;


-- ── 2. scan_terima_generic ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.scan_terima_generic(
  p_barcode text, p_tahap tahap_produksi, p_karyawan_id uuid,
  p_qty integer, p_user_id uuid, p_tenant_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_bundle            RECORD;
  v_tahap_status      TEXT;
  v_scan_log_id       UUID;
  v_tahap_text        TEXT := p_tahap::TEXT;
  v_prev_tahap_text   TEXT;
  v_resolved_karyawan UUID := p_karyawan_id;
  v_aksesori          RECORD;
  v_qty_deduct        NUMERIC;
  v_po_id             UUID;
  v_kategori_id       UUID;
  v_nominal           NUMERIC;
BEGIN
  v_prev_tahap_text := CASE v_tahap_text
    WHEN 'jahit'          THEN 'cutting'
    WHEN 'lubang_kancing' THEN 'jahit'
    WHEN 'buang_benang'   THEN 'lubang_kancing'
    WHEN 'qc'             THEN 'buang_benang'
    WHEN 'steam'          THEN 'qc'
    WHEN 'packing'        THEN 'steam'
    ELSE NULL
  END;

  SELECT b.id, b.po_item_id, b.status_tahap, mp.id AS model_id, pi.po_id AS po_id
  INTO v_bundle
  FROM bundle b
  JOIN po_item pi      ON pi.id = b.po_item_id
  JOIN produk p        ON p.id  = pi.produk_id
  JOIN model_produk mp ON mp.id = p.model_id
  WHERE b.barcode = p_barcode AND b.tenant_id = p_tenant_id
  FOR UPDATE OF b;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Barcode tidak ditemukan: %', p_barcode;
  END IF;

  v_po_id := v_bundle.po_id;

  -- PERUBAHAN: terima juga tahap sebelumnya 'partial' selama qty aktual > 0
  IF v_prev_tahap_text IS NOT NULL THEN
    IF NOT tahap_sudah_beres(v_bundle.status_tahap, v_prev_tahap_text) THEN
      RAISE EXCEPTION 'Tahap % belum selesai.', v_prev_tahap_text;
    END IF;
  END IF;

  v_tahap_status := v_bundle.status_tahap -> v_tahap_text ->> 'status';
  IF v_tahap_status IS NOT NULL THEN
    RAISE EXCEPTION 'Bundle sudah di-scan di tahap ini (status: %)', v_tahap_status;
  END IF;

  IF v_resolved_karyawan IS NULL THEN
    SELECT default_karyawan_borongan_id INTO v_resolved_karyawan
    FROM settings WHERE tenant_id = p_tenant_id LIMIT 1;
  END IF;

  INSERT INTO scan_log (bundle_id, tahap, tipe, qty, karyawan_id, user_id, tenant_id)
  VALUES (v_bundle.id, p_tahap, 'terima'::scan_tipe, p_qty, v_resolved_karyawan, p_user_id, p_tenant_id)
  RETURNING id INTO v_scan_log_id;

  UPDATE bundle
  SET status_tahap = jsonb_set(status_tahap, ARRAY[v_tahap_text], jsonb_build_object(
    'status', 'terima', 'qty_terima', p_qty, 'waktu_terima', now(),
    'qty_selesai', NULL, 'waktu_selesai', NULL, 'karyawan_id', v_resolved_karyawan
  )) WHERE id = v_bundle.id;

  SELECT id INTO v_kategori_id
  FROM kategori_trx
  WHERE jenis = 'direct_bahan' AND aktif = TRUE AND tenant_id = p_tenant_id
  LIMIT 1;

  FOR v_aksesori IN
    SELECT ma.inventory_item_id, ma.qty_per_pcs, ii.harga_referensi, ii.nama AS item_nama
    FROM model_aksesori ma
    JOIN inventory_item ii ON ii.id = ma.inventory_item_id
    WHERE ma.model_id = v_bundle.model_id AND ma.tahap_pakai = p_tahap
      AND ma.tenant_id = p_tenant_id
  LOOP
    v_qty_deduct := v_aksesori.qty_per_pcs * p_qty;

    UPDATE inventory_item SET stok_aktual = stok_aktual - v_qty_deduct
    WHERE id = v_aksesori.inventory_item_id;

    INSERT INTO pemakaian_aksesori (bundle_id, inventory_item_id, qty_pakai, tahap, tenant_id)
    VALUES (v_bundle.id, v_aksesori.inventory_item_id, v_qty_deduct, p_tahap, p_tenant_id)
    ON CONFLICT (bundle_id, inventory_item_id, tahap) DO NOTHING;

    v_nominal := v_qty_deduct * v_aksesori.harga_referensi;
    IF v_kategori_id IS NOT NULL AND v_po_id IS NOT NULL AND v_nominal > 0 THEN
      INSERT INTO jurnal_entry (
        kategori_trx_id, jenis, nominal, tanggal, no_faktur,
        keterangan, qty, inventory_item_id, tag_po_ids, tenant_id, created_by
      ) VALUES (
        v_kategori_id, 'direct_bahan', v_nominal, CURRENT_DATE,
        'AUTO-AKS-' || to_char(CURRENT_DATE, 'YYYYMMDD'),
        'Pemakaian aksesori ' || v_tahap_text || ': ' || v_aksesori.item_nama,
        v_qty_deduct, v_aksesori.inventory_item_id,
        jsonb_build_array(v_po_id::TEXT), p_tenant_id, p_user_id
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('scan_log_id', v_scan_log_id);
END;
$function$;


-- ── 3. split_bundle_awal_jahit: syarat cutting ikut melonggar ─────
CREATE OR REPLACE FUNCTION split_bundle_awal_jahit(
  p_barcode TEXT, p_qty_assign NUMERIC, p_karyawan_id UUID,
  p_user_id UUID, p_tenant_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_bundle               RECORD;
  v_qty_total             NUMERIC;
  v_qty_sisa              NUMERIC;
  v_split_count           INT;
  v_new_barcode           TEXT;
  v_new_no_urut           INT;
  v_new_bundle_id         UUID;
  v_child_status_tahap    JSONB;
  v_scan_log_id           UUID;
  v_stok_warnings         JSONB := '[]'::JSONB;
  v_consume_result        JSONB;
  v_aksesori              RECORD;
  v_warna_id              UUID;
  v_qty_pakai             NUMERIC;
  v_kategori_aksesori_id  UUID;
BEGIN
  SELECT id INTO v_kategori_aksesori_id
  FROM kategori_trx
  WHERE nama = 'Pembelian Aksesori' AND jenis = 'direct_bahan'
    AND aktif = TRUE AND tenant_id = p_tenant_id
  LIMIT 1;

  SELECT b.id, b.po_id, b.po_item_id, b.status_tahap, b.barcode,
         b.no_urut_po, pi.warna, pi.qty_per_bundle, produk.model_id
  INTO v_bundle
  FROM bundle b
  JOIN po_item pi  ON pi.id = b.po_item_id
  JOIN produk      ON produk.id = pi.produk_id
  WHERE b.barcode = p_barcode AND b.tenant_id = p_tenant_id
  FOR UPDATE OF b;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Barcode tidak ditemukan: %', p_barcode;
  END IF;

  IF NOT tahap_sudah_beres(v_bundle.status_tahap, 'cutting') THEN
    RAISE EXCEPTION 'Bundle belum selesai tahap Cutting';
  END IF;

  IF (v_bundle.status_tahap -> 'jahit' ->> 'status') IS NOT NULL THEN
    RAISE EXCEPTION 'Bundle sudah diserahterimakan di tahap Jahit — gunakan fitur Split biasa untuk membagi pekerjaan yang sedang berjalan';
  END IF;

  v_qty_total := COALESCE(
    (v_bundle.status_tahap -> 'cutting' ->> 'qty_aktual')::NUMERIC,
    v_bundle.qty_per_bundle
  );

  IF p_qty_assign IS NULL OR p_qty_assign <= 0 OR p_qty_assign >= v_qty_total THEN
    RAISE EXCEPTION 'Qty yang ditugaskan harus antara 1 dan % (kalau mau semua, pakai Serah Terima biasa)', v_qty_total - 1;
  END IF;

  v_qty_sisa := v_qty_total - p_qty_assign;

  SELECT COUNT(*) INTO v_split_count
  FROM bundle WHERE barcode LIKE p_barcode || 'h%' AND tenant_id = p_tenant_id;

  v_new_barcode := p_barcode || 'h' || (v_split_count + 1)::TEXT;

  SELECT COALESCE(MAX(no_urut), 0) + 1 INTO v_new_no_urut
  FROM bundle WHERE po_id = v_bundle.po_id AND tenant_id = p_tenant_id;

  v_child_status_tahap := jsonb_set(
    v_bundle.status_tahap, '{cutting,qty_aktual}', to_jsonb(p_qty_assign)
  ) || jsonb_build_object(
    'jahit', jsonb_build_object(
      'status','terima','qty_terima',p_qty_assign,'waktu_terima',now(),
      'qty_selesai',NULL,'waktu_selesai',NULL,'karyawan_id',p_karyawan_id
    )
  );

  INSERT INTO bundle (
    barcode, po_id, po_item_id, no_urut, no_urut_po,
    parent_bundle_id, status_tahap, tenant_id, created_by
  )
  VALUES (
    v_new_barcode, v_bundle.po_id, v_bundle.po_item_id, v_new_no_urut,
    v_bundle.no_urut_po, v_bundle.id, v_child_status_tahap, p_tenant_id, p_user_id
  )
  RETURNING id INTO v_new_bundle_id;

  SELECT id INTO v_warna_id
  FROM warna WHERE LOWER(nama) = LOWER(v_bundle.warna) AND tenant_id = p_tenant_id
  LIMIT 1;

  FOR v_aksesori IN
    SELECT inventory_item_id, qty_per_pcs
    FROM model_aksesori
    WHERE model_id = v_bundle.model_id AND tenant_id = p_tenant_id
      AND tahap_pakai = 'jahit' AND (warna_id IS NULL OR warna_id = v_warna_id)
  LOOP
    v_qty_pakai := v_aksesori.qty_per_pcs * p_qty_assign;
    v_consume_result := consume_fifo_atomic(
      v_aksesori.inventory_item_id, v_qty_pakai, v_bundle.po_item_id,
      v_new_bundle_id, v_aksesori.qty_per_pcs, p_user_id, p_tenant_id,
      v_kategori_aksesori_id, 'jahit'
    );
    IF v_consume_result ->> 'status' = 'stok_kurang' THEN
      v_stok_warnings := v_stok_warnings || jsonb_build_object(
        'item_nama',  v_consume_result ->> 'item_nama',
        'qty_kurang', v_consume_result -> 'qty_kurang',
        'sisa_stok',  v_consume_result -> 'sisa_stok'
      );
    END IF;
  END LOOP;

  IF v_warna_id IS NOT NULL THEN
    FOR v_aksesori IN
      SELECT inventory_item_id, qty_per_pcs
      FROM warna_aksesori
      WHERE warna_id = v_warna_id AND tenant_id = p_tenant_id AND tahap_pakai = 'jahit'
    LOOP
      v_qty_pakai := v_aksesori.qty_per_pcs * p_qty_assign;
      v_consume_result := consume_fifo_atomic(
        v_aksesori.inventory_item_id, v_qty_pakai, v_bundle.po_item_id,
        v_new_bundle_id, v_aksesori.qty_per_pcs, p_user_id, p_tenant_id,
        v_kategori_aksesori_id, 'jahit'
      );
      IF v_consume_result ->> 'status' = 'stok_kurang' THEN
        v_stok_warnings := v_stok_warnings || jsonb_build_object(
          'item_nama',  v_consume_result ->> 'item_nama',
          'qty_kurang', v_consume_result -> 'qty_kurang',
          'sisa_stok',  v_consume_result -> 'sisa_stok'
        );
      END IF;
    END LOOP;
  END IF;

  INSERT INTO scan_log (bundle_id, tahap, tipe, qty, karyawan_id, user_id, tenant_id)
  VALUES (v_new_bundle_id, 'jahit'::tahap_produksi, 'terima'::scan_tipe,
          p_qty_assign, p_karyawan_id, p_user_id, p_tenant_id)
  RETURNING id INTO v_scan_log_id;

  UPDATE bundle
  SET status_tahap = jsonb_set(status_tahap, '{cutting,qty_aktual}', to_jsonb(v_qty_sisa))
  WHERE id = v_bundle.id;

  RETURN jsonb_build_object(
    'scan_log_id', v_scan_log_id,
    'new_bundle_id', v_new_bundle_id,
    'new_bundle_barcode', v_new_barcode,
    'new_bundle_qty', p_qty_assign,
    'parent_bundle_id', v_bundle.id,
    'parent_sisa_qty', v_qty_sisa,
    'stok_warnings', v_stok_warnings
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION tahap_sudah_beres(JSONB, TEXT) TO authenticated;
